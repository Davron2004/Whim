/**
 * build-lifecycle Node suite (launcher-ghost-tiles chain-2, task 2.5, from `prompt-flow/spec.md`
 * and `pending-builds/spec.md`).
 *
 * The generation flow's identity and its persisted transitions, exercised for real rather than
 * grepped: the launcher id decided before the request goes out and reused by delivery, the
 * failure payload that survives the screen, the deletions that cancel and dismiss perform, the
 * retry that reuses its record's id — and, the load-bearing one, the ORDER delivery settles in
 * (install/update first, pending-record delete second) and what a death mid-delivery leaves
 * behind. `LauncherRoot.tsx` imports `react-native` and cannot be imported here, which is exactly
 * why this logic lives in `build-lifecycle.ts`.
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { PendingBuildStore } from '../pending-builds';
import type { InstalledApp } from '../app-index';
import type { InstallSpec, StoreAccess, UpdateSpec } from '../store-access';
import {
  deliverAndSettle,
  deliverResult,
  dropPendingBuild,
  failPendingBuild,
  hydratedDiagnostics,
  pendingFailure,
  retryBuildScreen,
  startPendingBuild,
} from '../build-lifecycle';
import type { WireAppRecord } from '@whim/contract';

const WIRE: WireAppRecord = {
  name: 'Tip Splitter',
  source: 'export default () => null;',
  bundle: '(()=>{})()',
  manifest: {},
  schema: {},
};

function installedFrom(spec: InstallSpec): InstalledApp {
  return { id: spec.id, name: spec.name, createdAt: 0, record: spec.record, lineageId: 'main' };
}

/** A `StoreAccess` stand-in that only answers the calls a NEW-INSTALL delivery makes, and lets a
 *  test watch the moment `install` runs. Everything else on the class is deliberately absent: a
 *  delivery that reached for it would fail loudly rather than pass on a silent stub. */
function fakeAccess(opts: {
  onInstall?: (spec: InstallSpec) => void;
  installThrows?: boolean;
  installs?: InstallSpec[];
  updates?: { entry: InstalledApp; spec: UpdateSpec }[];
}): StoreAccess {
  return {
    install: async (spec: InstallSpec) => {
      opts.installs?.push(spec);
      opts.onInstall?.(spec);
      if (opts.installThrows) throw new Error('device storage went away mid-install');
      return installedFrom(spec);
    },
    update: async (entry: InstalledApp, spec: UpdateSpec) => {
      opts.updates?.push({ entry, spec });
      return { ...entry, record: spec.record };
    },
  } as unknown as StoreAccess;
}

const APP: InstalledApp = {
  id: 'app-installed',
  name: 'Brew Timer',
  createdAt: 1,
  // A Tier-0 installed app: it declares no capabilities and no storage, which `AppManifest`
  // spells `capabilities: []` (the field is required) and `AppRecord` spells as an absent
  // `schemaArtifact`. Only ever an edit/rebuild TARGET here — nothing reads its manifest.
  record: { appId: 'app-installed', name: 'Brew Timer', manifest: { capabilities: [] } },
  lineageId: 'main',
};

export async function runBuildLifecycleTests(h: Harness): Promise<void> {
  // ── the id is decided before the request goes out, and delivery reuses it ────────────────────

  await h.test('start: a new install gets a fresh id and a building record before any request', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const id = startPendingBuild(store, { text: '  a tip splitter for camping trips with friends  ' });
    const rec = store.get(id);
    h.ok(rec != null, 'the record exists the moment the attempt starts');
    h.eq(rec!.id, id, 'the record carries the allocated id');
    h.eq(rec!.state, 'building', 'and starts building');
    h.eq(rec!.prompt, '  a tip splitter for camping trips with friends  ', 'the prompt is stored verbatim');
    h.eq(rec!.workingTitle, 'a tip splitter for camping', 'with a prompt-derived working title');
    h.ok(rec!.editingAppId === undefined, 'a new install marks no app as being edited');
  });

  await h.test('start: a rebuild reuses the app’s OWN id — minting a fresh one would fork it', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const id = startPendingBuild(store, { editing: APP, text: 'add a dark mode' });
    h.eq(id, APP.id, 'the attempt writes to the app it rebuilds, not to a new app');
    h.eq(store.get(id)!.editingAppId, APP.id, 'and the record is marked as a rebuild');
  });

  await h.test('start: two new-install attempts never share an id', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const first = startPendingBuild(store, { text: 'a dice roller' });
    const second = startPendingBuild(store, { text: 'a water counter' });
    h.ok(first !== second, 'each brand-new attempt gets its own launcher id');
    h.eq(store.list().length, 2, 'and both records stand on the grid');
  });

  await h.test('delivery: the installed app keeps the id allocated at generation start', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const installs: InstallSpec[] = [];
    const id = startPendingBuild(store, { text: 'a tip splitter' });
    const delivered = await deliverAndSettle(store, {
      access: fakeAccess({ installs }),
      appId: id,
      text: 'a tip splitter',
      wire: WIRE,
    });
    h.eq(delivered.id, id, 'the delivered app IS the ghost the user watched — not a newly minted id');
    h.eq(installs[0].id, id, 'and the version store was written under that same id');
    h.eq(installs[0].record.appId, id, 'the host record’s appId agrees with it');
  });

  await h.test('delivery: an edit is an in-place update, not an install under the attempt id', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const updates: { entry: InstalledApp; spec: UpdateSpec }[] = [];
    const id = startPendingBuild(store, { editing: APP, text: 'add a dark mode' });
    const access = fakeAccess({ updates });
    // `isAtTip` reads the entry's own history; a rebuild that is at its tip updates in place.
    const atTip = {
      ...access,
      timeline: async () => [{ id: 'snap-1' }],
      history: async () => [{ id: 'snap-1' }],
      activeId: async () => 'snap-1',
    } as unknown as StoreAccess;
    const delivered = await deliverResult({ access: atTip, appId: id, editing: APP, text: 'add a dark mode', wire: WIRE });
    h.eq(delivered.id, APP.id, 'the rebuilt app keeps its own identity');
    h.eq(updates.length, 1, 'and the delivery was an update');
    h.eq(updates[0].entry.id, APP.id, 'onto the entry being rebuilt');
  });

  // ── the ordering that a crash mid-delivery depends on ────────────────────────────────────────

  await h.test('delivery: the pending record is deleted only AFTER the store/index write lands', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const id = startPendingBuild(store, { text: 'a tip splitter' });
    let recordDuringInstall: string | null = null;
    const access = fakeAccess({
      onInstall: () => {
        recordDuringInstall = store.get(id)?.state ?? null;
      },
    });
    await deliverAndSettle(store, { access, appId: id, text: 'a tip splitter', wire: WIRE });
    h.eq(
      recordDuringInstall,
      'building',
      'the record must still be `building` while install runs — deleting first would lose the attempt on a crash',
    );
    h.eq(store.get(id), null, 'and it is gone once delivery has resolved');
    h.eq(store.list(), [], 'so no ghost survives a successful delivery');
  });

  await h.test('delivery: a crash inside delivery leaves an interrupted record, never a lost app', async () => {
    const map = new Map<string, string>();
    const store = new PendingBuildStore(new MapKVBackend(map));
    const id = startPendingBuild(store, { text: 'a tip splitter' });
    let threw = false;
    try {
      await deliverAndSettle(store, {
        access: fakeAccess({ installThrows: true }),
        appId: id,
        text: 'a tip splitter',
        wire: WIRE,
      });
      // eslint-disable-next-line no-restricted-syntax -- the assertion IS "did delivery fail"; the thrown value is deliberately discarded
    } catch {
      threw = true;
    }
    h.ok(threw, 'sanity: the delivery genuinely failed');
    h.eq(store.get(id)!.state, 'building', 'a failed delivery does NOT delete the record');
    // The process dies here and the host relaunches: launch-time demotion is what the user sees.
    const afterRelaunch = new PendingBuildStore(new MapKVBackend(map));
    afterRelaunch.demoteBuildingToInterrupted();
    h.eq(afterRelaunch.get(id)!.state, 'interrupted', 'the attempt surfaces as interrupted, not silently lost');
  });

  // ── failure persists; cancel and dismiss delete ──────────────────────────────────────────────

  await h.test('failure: the record is persisted as failed with its payload, never deleted', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const id = startPendingBuild(store, { text: 'a brew timer' });
    failPendingBuild(store, id, 'The sound part could not be built', [
      { hint: 'Describing the sound differently helps' },
      { hint: 'It works without the chime' },
    ]);
    const rec = store.get(id)!;
    h.eq(rec.state, 'failed', 'state becomes failed');
    h.eq(rec.failure!.reason, 'The sound part could not be built', 'the reason is persisted verbatim');
    h.eq(
      hydratedDiagnostics(rec.failure),
      [{ hint: 'Describing the sound differently helps' }, { hint: 'It works without the chime' }],
      'and every hint row is recoverable from the record',
    );
    h.eq(store.list().map((r) => r.id), [id], 'the record stays on the grid — a failure is not a deletion');
  });

  await h.test('failure: a stream error with no hints persists the reason and no diagnostics field', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const id = startPendingBuild(store, { text: 'a dice roller' });
    failPendingBuild(store, id, 'Something went wrong while building your app.', []);
    const rec = store.get(id)!;
    h.eq(rec.state, 'failed', 'a stream error is a failure like any other');
    h.ok(rec.failure!.diagnostics === undefined, 'no hints writes no field — absent and empty stay the same state');
    h.eq(hydratedDiagnostics(rec.failure), [], 'and hydrating invents no row');
  });

  await h.test('failure: an interrupted record has no payload at all to hydrate from', async () => {
    h.eq(hydratedDiagnostics(undefined), [], 'no payload is no rows, never a fabricated one');
    h.eq(pendingFailure('x', [{ hint: '' }]), { reason: 'x' }, 'an empty hint is not a row');
  });

  await h.test('cancel: the record is deleted, so a cancelled attempt leaves no ghost', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const id = startPendingBuild(store, { text: 'a tip splitter' });
    h.eq(store.list().length, 1, 'sanity: the ghost was there to be cancelled');
    dropPendingBuild(store, id);
    h.eq(store.get(id), null, 'the record is gone');
    h.eq(store.list(), [], 'and nothing remains on the grid for it');
  });

  await h.test('dismiss: dismissing a failed record deletes it, unlike the failure itself', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const id = startPendingBuild(store, { text: 'a brew timer' });
    failPendingBuild(store, id, 'it broke', []);
    h.eq(store.list().length, 1, 'a failure keeps the record (the contrast this test rests on)');
    dropPendingBuild(store, id);
    h.eq(store.list(), [], 'a dismiss removes it');
  });

  // ── retry ────────────────────────────────────────────────────────────────────────────────────

  await h.test('retry: a new attempt reuses the failed record’s launcher id', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const first = startPendingBuild(store, { text: 'a tip splitter' });
    failPendingBuild(store, first, 'it broke', [{ hint: 'try again' }]);
    const retried = startPendingBuild(store, { text: store.get(first)!.prompt, reuseId: first });
    h.eq(retried, first, 'the retry writes to the same launcher id the ghost already has');
    const rec = store.get(first)!;
    h.eq(rec.state, 'building', 'the ghost goes back to building');
    h.ok(rec.failure === undefined, 'and stops carrying the old failure');
    h.eq(store.list().map((r) => r.id), [first], 'one attempt, one record — a retry does not spawn a second ghost');
  });

  await h.test('retry: a retried attempt delivers under that same id', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const first = startPendingBuild(store, { text: 'a tip splitter' });
    failPendingBuild(store, first, 'it broke', []);
    const retried = startPendingBuild(store, { text: 'a tip splitter', reuseId: first });
    const delivered = await deliverAndSettle(store, {
      access: fakeAccess({}),
      appId: retried,
      text: 'a tip splitter',
      wire: WIRE,
    });
    h.eq(delivered.id, first, 'the app the user ends up with is the ghost they retried');
    h.eq(store.list(), [], 'and the record settles away');
  });

  await h.test('retry: the build screen runs the record’s stored prompt, with no invented answers', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const id = startPendingBuild(store, { text: 'a brew timer with a chime' });
    failPendingBuild(store, id, 'it broke', []);
    const screen = retryBuildScreen(store.get(id)!);
    h.eq(screen.kind, 'build', 'a retry opens the build step directly');
    h.eq(screen.text, 'a brew timer with a chime', 'the verbatim prompt is what gets tracked');
    h.eq(screen.rewritten, 'a brew timer with a chime', 'and what generation is asked to build');
    h.eq(screen.questions, [], 'no clarify questions are invented');
    h.eq(screen.answers, {}, 'and no answers are put in the user’s mouth');
    h.eq(screen.stage, null, 'the run starts from nothing observed');
    h.ok(screen.editing === undefined, 'a new-install retry edits no app');
    h.eq(retryBuildScreen(store.get(id)!, APP).editing, APP, 'a rebuild retry stays scoped to its app');
  });

  // ── the persisted payload round-trips into the failure screen's own shape ─────────────────────

  await h.test('payload: hints round-trip through the record unchanged', async () => {
    const hints = [{ hint: 'The chime is the part that fails' }, { hint: 'Everything else already runs' }];
    h.eq(hydratedDiagnostics(pendingFailure('nope', hints)), hints, 'what the screen showed is what it shows again');
  });
}
