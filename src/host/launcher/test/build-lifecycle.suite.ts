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
  journalStreamEvent,
  pendingFailure,
  retryBuildScreen,
  startPendingBuild,
} from '../build-lifecycle';
import { RunJournalStore } from '../run-journal';
import { EMPTY_RUN_AGGREGATES, ghostTileColorFor } from '../prompt-flow';
import type { RunSignals } from '../prompt-flow';
import type { GenerationEvent } from '@whim/contract';
import { tileColor } from '../tiles';
import { appColor } from '../../../sdk/theme';
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

  // ── the ghost's hue survives transmute — on the NEW-INSTALL path, and only there ──────────────

  /** A deterministic ghost id, so the two hashes below are fixed values rather than a coin flip
   *  over a ten-colour palette. `reuseId` is the sanctioned way to pin one. */
  const GHOST_ID = 'app-ghost-1';

  await h.test('colour: a delivered new install keeps the exact hue its ghost had', async () => {
    // `app-launcher` spec: "Ghost tile color is a deterministic hash of the launcher id, stable
    // across transmute." The ghost renders `ghostTileColorFor(rec.id)`; the delivered tile resolves
    // `tileColor(name, manifest)`, whose fallback hashes the NAME. Unless delivery records the id
    // hash, the two are different inputs and the hue flips the instant the build completes.
    h.ok(
      ghostTileColorFor(GHOST_ID) !== appColor(WIRE.name),
      'sanity: this id and this name genuinely hash to different hues, so the assertion below is not vacuous',
    );
    const store = new PendingBuildStore(new MapKVBackend());
    const id = startPendingBuild(store, { text: 'a tip splitter', reuseId: GHOST_ID });
    const delivered = await deliverAndSettle(store, { access: fakeAccess({}), appId: id, text: 'a tip splitter', wire: WIRE });
    h.eq(
      tileColor(delivered.name, delivered.record.manifest),
      ghostTileColorFor(GHOST_ID),
      'the tile at that position renders the colour the ghost already had',
    );
  });

  await h.test('colour: an injected hue survives tileColor’s own validity gate, rather than being silently dropped', async () => {
    // `tileColor` only honours a declared colour that is `#rrggbb` and not a reserved shell hue —
    // a value failing either is silently ignored and falls back to `appColor(name)`, i.e. the fix
    // above would look applied and change nothing. So the recorded value is checked directly.
    const store = new PendingBuildStore(new MapKVBackend());
    const id = startPendingBuild(store, { text: 'a tip splitter', reuseId: GHOST_ID });
    const installs: InstallSpec[] = [];
    await deliverAndSettle(store, { access: fakeAccess({ installs }), appId: id, text: 'a tip splitter', wire: WIRE });
    h.eq(installs[0].record.manifest.tileColor, ghostTileColorFor(GHOST_ID), 'the id hash is what got recorded');
    h.eq(tileColor('some other name', installs[0].record.manifest), ghostTileColorFor(GHOST_ID), 'and the resolver honours it over any name hash');
  });

  await h.test('colour: a wire manifest that DOES declare a tile colour still wins over the injection', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const id = startPendingBuild(store, { text: 'a tip splitter', reuseId: GHOST_ID });
    const declared = { ...WIRE, manifest: { tileColor: '#2f6feb' } };
    const delivered = await deliverAndSettle(store, { access: fakeAccess({}), appId: id, text: 'a tip splitter', wire: declared });
    h.eq(delivered.record.manifest.tileColor, '#2f6feb', 'the app’s own declaration is never overwritten by the ghost hash');
    h.eq(tileColor(delivered.name, delivered.record.manifest), '#2f6feb', 'and that is what every surface resolves');
  });

  await h.test('colour: rebuilding an app the user already owns does NOT move its hue', async () => {
    // The trap this test exists for: injecting inside `mapWireRecord` (which both edit branches
    // share) would stamp an id hash over an app whose colour has always been the NAME hash — and
    // for a fork, `editing.record.appId` is the PARENT's id, giving a third hue again. An edit has
    // no ghost to stay stable with, so it must record nothing.
    const store = new PendingBuildStore(new MapKVBackend());
    const updates: { entry: InstalledApp; spec: UpdateSpec }[] = [];
    const id = startPendingBuild(store, { editing: APP, text: 'add a dark mode' });
    const atTip = {
      ...fakeAccess({ updates }),
      timeline: async () => [{ id: 'snap-1' }],
      activeId: async () => 'snap-1',
    } as unknown as StoreAccess;
    await deliverResult({ access: atTip, appId: id, editing: APP, text: 'add a dark mode', wire: WIRE });
    const rebuilt = updates[0].spec.record;
    h.ok(rebuilt.manifest.tileColor === undefined, 'no colour is recorded on a rebuild');
    h.eq(tileColor(APP.name, rebuilt.manifest), appColor(APP.name), 'so the app resolves exactly the hue it resolved before');
    h.ok(tileColor(APP.name, rebuilt.manifest) !== ghostTileColorFor(APP.id), 'and specifically NOT the id hash a shared injection would have stamped');
  });

  await h.test('colour: a behind-tip rebuild forks and still does not move the hue', async () => {
    const store = new PendingBuildStore(new MapKVBackend());
    const updates: { entry: InstalledApp; spec: UpdateSpec }[] = [];
    // A fork copies the parent's record wholesale, so `editing.record.appId` here is the PARENT's
    // id — the case where a shared injection would produce a THIRD distinct hue.
    const forked: InstalledApp = { ...APP, id: 'app-fork', name: APP.name };
    const behindTip = {
      ...fakeAccess({ updates }),
      timeline: async () => [{ id: 'snap-2' }, { id: 'snap-1' }],
      activeId: async () => 'snap-1',
      fork: async () => forked,
    } as unknown as StoreAccess;
    const id = startPendingBuild(store, { editing: APP, text: 'add a dark mode' });
    await deliverResult({ access: behindTip, appId: id, editing: APP, text: 'add a dark mode', wire: WIRE });
    h.eq(updates.length, 1, 'sanity: the behind-tip branch forked and then updated the fork');
    h.eq(updates[0].entry.id, forked.id, 'onto the fork, not the original');
    h.ok(updates[0].spec.record.manifest.tileColor === undefined, 'and again records no colour');
    h.eq(tileColor(forked.name, updates[0].spec.record.manifest), appColor(APP.name), 'the fork resolves the same name hash its parent does');
  });

  await h.test('colour: rebuilding an app that was INSTALLED with an injected hue keeps that hue', async () => {
    // The regression this exists for, and the one shape the two tests above structurally cannot
    // reach: they rebuild `APP`, which never carried a colour, so dropping one is invisible there.
    // `StoreAccess.update` replaces the record WHOLESALE with the one built from the wire, and a
    // typical wire declares no `tileColor` — so a rebuild that passes no fallback does not merely
    // decline to stamp, it DELETES the hue injected at install and the tile flips back to
    // `appColor(name)` on the very first edit. Install for real, then rebuild THAT app.
    const store = new PendingBuildStore(new MapKVBackend());
    const updates: { entry: InstalledApp; spec: UpdateSpec }[] = [];
    const installId = startPendingBuild(store, { text: 'a tip splitter', reuseId: GHOST_ID });
    const installed = await deliverAndSettle(store, {
      access: fakeAccess({}),
      appId: installId,
      text: 'a tip splitter',
      wire: WIRE,
    });
    h.eq(installed.record.manifest.tileColor, ghostTileColorFor(installId), 'precondition: the install injected the ghost hue');

    const atTip = {
      ...fakeAccess({ updates }),
      timeline: async () => [{ id: 'snap-1' }],
      activeId: async () => 'snap-1',
    } as unknown as StoreAccess;
    const rebuildId = startPendingBuild(store, { editing: installed, text: 'add a dark mode' });
    await deliverResult({ access: atTip, appId: rebuildId, editing: installed, text: 'add a dark mode', wire: WIRE });
    const rebuilt = updates[0].spec.record;
    h.eq(rebuilt.manifest.tileColor, ghostTileColorFor(installId), 'the rebuilt record carries the SAME hue forward');
    h.eq(tileColor(rebuilt.name, rebuilt.manifest), ghostTileColorFor(installId), 'so the tile renders what it has rendered since install');
    h.ok(
      tileColor(rebuilt.name, rebuilt.manifest) !== appColor(WIRE.name),
      'and specifically has NOT reverted to the name hash — the ghost-tile fix deferred by one rebuild',
    );
  });

  await h.test('colour: a behind-tip rebuild of a genuinely-installed app forks WITH the parent’s injected hue', async () => {
    // G2: the only existing behind-tip test (above) rebuilds `APP`, a fixture with no `tileColor`,
    // so it cannot see whether a fork carries a colour forward — the exact blind spot that already
    // hid one defect in this change. Install for real (so the id hash is genuinely injected), then
    // drive the actual behind-tip `isAtTip -> fork -> update` path on THAT app.
    const store = new PendingBuildStore(new MapKVBackend());
    const installId = startPendingBuild(store, { text: 'a tip splitter', reuseId: GHOST_ID });
    const installed = await deliverAndSettle(store, {
      access: fakeAccess({}),
      appId: installId,
      text: 'a tip splitter',
      wire: WIRE,
    });
    h.eq(installed.record.manifest.tileColor, ghostTileColorFor(installId), 'precondition: the install injected the ghost hue');

    const updates: { entry: InstalledApp; spec: UpdateSpec }[] = [];
    // A fork copies the parent's record wholesale (same shape the existing behind-tip test uses),
    // so the forked entry starts out carrying the parent's injected `tileColor` too.
    const forked: InstalledApp = { ...installed, id: 'app-fork-real', name: installed.name };
    const behindTip = {
      ...fakeAccess({ updates }),
      timeline: async () => [{ id: 'snap-2' }, { id: 'snap-1' }],
      activeId: async () => 'snap-1',
      fork: async () => forked,
    } as unknown as StoreAccess;
    const rebuildId = startPendingBuild(store, { editing: installed, text: 'add a dark mode' });
    await deliverResult({ access: behindTip, appId: rebuildId, editing: installed, text: 'add a dark mode', wire: WIRE });
    h.eq(updates.length, 1, 'sanity: the behind-tip branch forked and then updated the fork');
    h.eq(updates[0].entry.id, forked.id, 'onto the fork, not the original');
    const rebuilt = updates[0].spec.record;
    h.eq(rebuilt.manifest.tileColor, ghostTileColorFor(installId), 'the forked record carries the parent’s injected hue forward');
    h.eq(tileColor(rebuilt.name, rebuilt.manifest), ghostTileColorFor(installId), 'and the fork resolves to that same hue, not appColor(name)');
  });

  await h.test('colour: a rebuild whose wire DOES declare a colour takes the new declaration', async () => {
    // Preservation is a FALLBACK, never an override: an app that re-declares its own tile colour
    // (`sdk-design-system`: an app declares its own) must be able to change it by rebuilding.
    const store = new PendingBuildStore(new MapKVBackend());
    const updates: { entry: InstalledApp; spec: UpdateSpec }[] = [];
    const coloured: InstalledApp = {
      ...APP,
      record: { appId: APP.id, name: APP.name, manifest: { capabilities: [], tileColor: '#7a3fd0' } },
    };
    const atTip = {
      ...fakeAccess({ updates }),
      timeline: async () => [{ id: 'snap-1' }],
      activeId: async () => 'snap-1',
    } as unknown as StoreAccess;
    const id = startPendingBuild(store, { editing: coloured, text: 'make it blue' });
    const declared = { ...WIRE, manifest: { tileColor: '#2f6feb' } };
    await deliverResult({ access: atTip, appId: id, editing: coloured, text: 'make it blue', wire: declared });
    const rebuilt = updates[0].spec.record;
    h.eq(rebuilt.manifest.tileColor, '#2f6feb', 'the new declaration replaces the old colour');
    h.eq(tileColor(rebuilt.name, rebuilt.manifest), '#2f6feb', 'and that is what every surface resolves');
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

  // ── the stream loop's journal writes and derived signals (generation-run-journal) ─────────────

  const RUN = 'app-journalled';
  const STAGE = (stage: 'plan' | 'generate' | 'check', status: 'start' | 'done' = 'start'): GenerationEvent =>
    ({ type: 'stage', stage, status });
  const TOKEN = (text: string): GenerationEvent => ({ type: 'token', text });

  /** A journal store over an injected clock, so the ~5s aggregate throttle is driven rather than
   *  slept through, plus the empty signals an attempt starts from. */
  function attemptFixture(startedAt = 1_000) {
    let clock = startedAt;
    const journal = new RunJournalStore(new MapKVBackend(), () => clock);
    const signals: RunSignals = { startedAt, aggregates: EMPTY_RUN_AGGREGATES, lastArrivalAt: startedAt };
    return { journal, signals, at: () => clock, tick: (ms: number) => (clock += ms) };
  }

  await h.test('journal: every stage transition is journaled the instant it arrives, by wire name', async () => {
    const f = attemptFixture();
    let signals = f.signals;
    for (const event of [STAGE('plan'), STAGE('generate'), STAGE('check')]) {
      f.tick(10);
      signals = journalStreamEvent(f.journal, RUN, signals, event, f.at());
    }
    const entries = f.journal.get(RUN)!;
    h.eq(entries.length, 3, 'one entry per transition, none throttled away');
    h.eq(entries.map((e) => e.kind), ['stage', 'stage', 'stage'], 'each is a stage entry');
    h.eq(entries.map((e) => e.stage), ['plan', 'generate', 'check'], 'in arrival order, in the WIRE vocabulary');
    h.eq(signals.lastArrivalAt, f.at(), 'and the heartbeat’s arrival stamp follows the last one');
  });

  await h.test('journal: a realistic start/done stream journals ONE entry per stage, on its start edge', async () => {
    // The wire emits BOTH edges of every stage (`status: 'start'|'done'`). A suite that only ever
    // feeds `start` cannot see a doubled spine, so this replays a run the way the server sends it:
    // plan, generate, then a check→repair→check→run loop, each stage opened and closed.
    const f = attemptFixture();
    let signals = f.signals;
    const wire: readonly (readonly ['plan' | 'generate' | 'check' | 'run' | 'repair', 'start' | 'done'])[] = [
      ['plan', 'start'], ['plan', 'done'],
      ['generate', 'start'], ['generate', 'done'],
      ['check', 'start'], ['check', 'done'],
      ['repair', 'start'], ['repair', 'done'],
      ['check', 'start'], ['check', 'done'],
      ['repair', 'start'], ['repair', 'done'],
      ['run', 'start'], ['run', 'done'],
    ];
    for (const [stage, status] of wire) {
      f.tick(100);
      signals = journalStreamEvent(f.journal, RUN, signals, { type: 'stage', stage, status }, f.at());
    }
    const entries = f.journal.get(RUN)!;
    h.eq(entries.length, 7, 'seven stage transitions, not fourteen — a `done` edge is not a second transition');
    h.eq(
      entries.map((e) => e.stage),
      ['plan', 'generate', 'check', 'repair', 'check', 'repair', 'run'],
      'the spine is the run as it happened, each stage appearing exactly once per time it was entered',
    );
    h.eq(
      entries.filter((e) => e.stage === 'repair').length,
      2,
      'two repair attempts — the same figure the shell’s own `status === "start"` tally reports',
    );
    h.eq(signals.lastArrivalAt, f.at(), 'a `done` edge still counts as liveness for the heartbeat');
  });

  await h.test('journal: a burst of tokens is bounded by elapsed time, never one entry per token', async () => {
    const f = attemptFixture();
    let signals = f.signals;
    // Two 2-second bursts of 40 tokens each, 6 seconds apart: dozens of arrivals, and the entry
    // count must follow the ~5s window rather than the arrival count.
    for (let i = 0; i < 40; i++) {
      f.tick(50);
      signals = journalStreamEvent(f.journal, RUN, signals, TOKEN('abcde'), f.at());
    }
    f.tick(6_000);
    for (let i = 0; i < 40; i++) {
      f.tick(50);
      signals = journalStreamEvent(f.journal, RUN, signals, TOKEN('abcde'), f.at());
    }
    const aggregates = f.journal.get(RUN)!.filter((e) => e.kind === 'aggregate');
    h.eq(aggregates.length, 2, '80 token arrivals over ~10s of wall time write one entry per ~5s window, not 80');
    h.eq(signals.aggregates, { chars: 400, tokens: 80 }, 'the in-memory counter still counts every token');
    h.eq(aggregates[0].aggregates, { chars: 5, tokens: 1 }, 'each entry carries the CUMULATIVE totals as of that moment');
    h.eq(aggregates[1].aggregates, { chars: 205, tokens: 41 }, 'so a later entry is a running total, never a per-window delta');
    h.ok(!JSON.stringify(aggregates).includes('abcde'), 'and never the token text itself');
  });

  await h.test('journal: an event that is neither stage nor token writes nothing and moves nothing', async () => {
    const f = attemptFixture();
    const diagnostic: GenerationEvent = {
      type: 'diagnostic',
      diagnostic: { kind: 'type', symbol: 'x', message: 'boom', hint: 'try again' },
    };
    const after = journalStreamEvent(f.journal, RUN, f.signals, diagnostic, f.at() + 5_000);
    h.ok(after === f.signals, 'the same signals object comes back — a React setter sees no change');
    h.eq(f.journal.get(RUN) ?? [], [], 'and no entry is written for it');
  });

  await h.test('journal: the arrival stamp the heartbeat measures from moves on stage AND token', async () => {
    const f = attemptFixture();
    f.tick(3_000);
    const afterStage = journalStreamEvent(f.journal, RUN, f.signals, STAGE('generate'), f.at());
    h.eq(afterStage.lastArrivalAt, f.at(), 'a stage arrival is liveness');
    h.eq(afterStage.startedAt, f.signals.startedAt, 'the attempt’s start never moves');
    f.tick(3_000);
    const afterToken = journalStreamEvent(f.journal, RUN, afterStage, TOKEN('xy'), f.at());
    h.eq(afterToken.lastArrivalAt, f.at(), 'so is a token arrival');
    h.eq(afterToken.aggregates, { chars: 2, tokens: 1 }, 'which is also the only thing that moves the counts');
  });

  // ── the persisted payload round-trips into the failure screen's own shape ─────────────────────

  await h.test('payload: hints round-trip through the record unchanged', async () => {
    const hints = [{ hint: 'The chime is the part that fails' }, { hint: 'Everything else already runs' }];
    h.eq(hydratedDiagnostics(pendingFailure('nope', hints)), hints, 'what the screen showed is what it shows again');
  });
}
