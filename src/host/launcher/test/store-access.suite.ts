/**
 * store-access Node suite (task 5.2, from installed-apps.spec.md §9–18) over a real
 * MemoryFs-backed VersionStore + a Map-backed AppIndex + a spy `deleteStorage`. Covers fork
 * mapping, independent evolution, lineage discipline on every access, own engine appId, the
 * active-bundle read, and delete refcounting (last reference removes the repo; a sibling fork
 * survives; the user-data db is dropped with the right id).
 */

import { Harness } from './harness';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import { AppIndex } from '../app-index';
import { StoreAccess, storeIdOf } from '../store-access';
import { promptEnvelope } from '../prompt-envelope';
import type { AppRecord } from '../../bridge/contract';

const REC = (id: string): AppRecord => ({ appId: id, name: id, manifest: { capabilities: ['storage'] } });

// A monotonic clock for the store's commit timestamps (mirrors vstore:test's `clock()`) — the
// real wall clock has only second granularity here (task 3.2 timeline/history ordering tests
// need snapshots to strictly increase, not tie within the same second).
function storeClock(): () => number {
  let t = 1_700_000_000_000;
  return () => (t += 1000);
}

function harnessAccess() {
  const store = createMemoryStore({ autoCompact: false, now: storeClock() });
  const index = new AppIndex(new MapKVBackend());
  const deleted: string[] = [];
  let t = 1000;
  const access = new StoreAccess({ store, index, deleteStorage: id => { deleted.push(id); }, now: () => (t += 1000) });
  return { store, index, access, deleted };
}

type Store = ReturnType<typeof createMemoryStore>;

/** A promise plus its resolver — a gate the test holds open and releases on cue. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Guard against the bare-await hang: a promise that must settle within `ms` (a deadlocked mutex
 *  would otherwise hang the whole launcher suite with no test named).
 *
 *  The timer is deliberately NOT `unref`'d. A deadlocked mutex leaves the loop with nothing else
 *  pending, and an unref'd guard lets Node exit as "unsettled top-level await" (exit 13, no test
 *  named) — the very hang this helper exists to turn into a named failure. It is cleared the
 *  instant the raced promise settles, so a passing check never holds the process open. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const expiry = new Promise<T>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${what} never settled within ${ms}ms`)), ms);
  });
  return Promise.race([p, expiry]).finally(() => clearTimeout(timer));
}

/** Let every ready continuation run: a macrotask boundary drains the microtask queue, so anything
 *  that COULD have proceeded (the whole MemoryFs-backed read path is promise-only) HAS proceeded. */
async function flush(turns = 3): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}

/** A held switch: `landed` resolves the moment the real checkout has moved the repo HEAD, while
 *  the call itself is still in flight; `release` lets it return. */
interface HeldSwitch {
  landed: Promise<void>;
  release: () => void;
}

/**
 * Instrument a REAL store so a test can (a) see the exact order of the two repo operations that
 * race — `switchLineage` and the `active()` read — and (b) hold one switch open.
 *
 * The hold models the genuine interleaving window, not a stall: the wrapped call performs the real
 * switch FIRST (the checkout moves the repo HEAD) and only then waits on the gate, because that is
 * exactly the window in which a concurrent `active()` read observes another lineage's snapshot. A
 * fake that also delayed the effect would hide the bug it is here to catch. `landed` exposes that
 * instant so a test can start the second operation inside the window deterministically, instead of
 * racing the real checkout for it.
 */
function instrumentRepoOps(store: Store): { calls: string[]; hold: (appId: string, lineageId: string) => HeldSwitch } {
  const calls: string[] = [];
  const gates = new Map<string, { open: Promise<void>; landed: () => void }>();
  const realSwitch = store.switchLineage.bind(store);
  const realActive = store.active.bind(store);
  store.switchLineage = async (appId, lineageId) => {
    const key = `sw:${appId}:${lineageId}`;
    calls.push(key);
    const res = await realSwitch(appId, lineageId);
    const gate = gates.get(key);
    if (gate != null) {
      gate.landed(); // the HEAD has already moved; the call just hasn't returned yet
      await gate.open;
    }
    return res;
  };
  store.active = async appId => {
    calls.push(`rd:${appId}`);
    return realActive(appId);
  };
  return {
    calls,
    hold(appId, lineageId) {
      const key = `sw:${appId}:${lineageId}`;
      const open = deferred();
      const landed = deferred();
      gates.set(key, { open: open.promise, landed: landed.resolve });
      return {
        landed: landed.promise,
        release: () => {
          gates.delete(key);
          open.resolve();
        },
      };
    },
  };
}

export async function runStoreAccessTests(h: Harness): Promise<void> {
  // §9 fork mapping
  await h.test('store-access §9 fork creates a new entry: shared repo, new lineage, provenance', async () => {
    const { index, access } = harnessAccess();
    const orig = await access.install({ id: 'water-counter', name: 'Water Counter', record: REC('water-counter'), bundleSource: 'BUNDLE_V1', prompt: 'Example: track water', example: true });
    const fork = await access.fork(orig);
    h.ok(fork.id !== orig.id, 'fork carries a fresh launcher id');
    h.eq(storeIdOf(fork), 'water-counter', 'fork shares the original repo (storeId)');
    h.ok(fork.lineageId !== 'main' && fork.lineageId.startsWith('fork-'), 'fork tracks a new lineage');
    h.eq(fork.forkedFrom, { id: 'water-counter', name: 'Water Counter' }, 'provenance recorded');
    h.eq(index.list().map(a => a.id), ['water-counter', fork.id], 'both entries in the index');
  });

  // §10 independent evolution + §11 correct lineage on every access
  await h.test('store-access §10-11 fork evolves independently; original reads its own bundle', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const fork = await access.fork(orig);
    // advance the fork's lineage with a new snapshot
    await store.snapshot(storeIdOf(fork), { 'bundle.js': 'V2_FORK' }, 'fork edit'); // HEAD is on fork lineage post-fork
    h.eq(await access.activeBundle(fork), 'V2_FORK', 'fork sees its own advanced bundle');
    // reading the original must switch the repo back to main and return V1
    h.eq(await access.activeBundle(orig), 'V1', 'original still reads its own bundle after the fork diverged');
    // and the fork is still V2 (switching did not disturb it)
    h.eq(await access.activeBundle(fork), 'V2_FORK', 'fork unchanged by the original read');
  });

  // §12 own engine appId
  await h.test('store-access §12 engine appId is the launcher id (own user data), not the repo', async () => {
    const { access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const fork = await access.fork(orig);
    h.eq(access.engineAppId(orig), 'wc', 'original engine appId == its launcher id');
    h.eq(access.engineAppId(fork), fork.id, 'fork engine appId == its OWN launcher id (independent user data)');
    h.ok(access.engineAppId(fork) !== storeIdOf(fork), 'engine appId differs from the shared repo id');
  });

  // §13 active-bundle read
  await h.test('store-access §13 activeBundle returns the active snapshot bundle.js', async () => {
    const { access } = harnessAccess();
    const orig = await access.install({ id: 'tip', name: 'Tip', record: REC('tip'), bundleSource: 'TIP_SRC', prompt: 'p' });
    h.eq(await access.activeBundle(orig), 'TIP_SRC', 'reads the installed bundle source');
  });

  // §14 delete last reference removes repo keys + drops user data
  await h.test('store-access §14 deleting the only entry removes the repo + user-data db', async () => {
    const { store, index, access, deleted } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    await access.remove(orig);
    h.eq(index.get('wc'), null, 'index entry gone');
    h.eq((await store.history('wc')).length, 0, 'repo history gone (store.remove called)');
    h.eq(deleted, ['wc'], 'user-data db dropped with the launcher id');
  });

  // §15 surviving sibling fork
  await h.test('store-access §15 deleting the original spares a surviving fork', async () => {
    const { store, index, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const fork = await access.fork(orig);
    await access.remove(orig);
    h.eq(index.get('wc'), null, 'original index entry gone');
    h.ok(index.get(fork.id) != null, 'fork entry survives');
    h.ok((await store.history(storeIdOf(fork))).length > 0, 'repo (shared) survives — fork keeps its history');
    h.eq(await access.activeBundle(fork), 'V1', 'fork still launches with its bundle');
  });

  // §16 then deleting the fork (now last reference) removes the repo
  await h.test('store-access §16 deleting the fork last removes the repo + its user data', async () => {
    const { store, index, access, deleted } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const fork = await access.fork(orig);
    await access.remove(orig); // repo survives (fork references it)
    await access.remove(fork); // now last reference → repo removed
    h.eq((await store.history('wc')).length, 0, 'repo removed once the last reference is deleted');
    h.eq(index.list().length, 0, 'index empty');
    const sortedDeleted = [...deleted].sort((a, b) => a.localeCompare(b));
    const expectedDeleted = ['wc', fork.id].slice().sort((a, b) => a.localeCompare(b));
    h.eq(sortedDeleted, expectedDeleted, 'both user-data dbs dropped by their own ids');
  });

  // §19 ensure-lineage-first discipline across the new history-surface wrappers
  await h.test('store-access §19 history/timeline/activeId ensure lineage first (fork then original)', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const fork = await access.fork(orig); // repo HEAD now on the fork lineage
    await store.snapshot(storeIdOf(fork), { 'bundle.js': 'V2_FORK' }, 'fork edit');
    // Reading the ORIGINAL must switch the repo back to main before answering.
    h.eq((await access.history(orig)).map(s => s.prompt), ['p1'], 'original history is its own line, not the fork edit');
    h.eq(await access.activeId(orig), (await access.history(orig))[0].id, 'original activeId matches its own tip');
    // Reading the FORK again must switch back.
    h.eq((await access.timeline(fork))[0].prompt, 'fork edit', 'fork timeline sees its own latest edit');
  });

  // §20 fork entry lists its own line, not a sibling lineage's post-fork snapshots
  await h.test('store-access §20 fork entry history excludes the original\'s later post-fork edit', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const fork = await access.fork(orig);
    await access.activeBundle(orig); // switches the repo back to main (via the wrapper, so the lineage cache stays accurate)
    await store.snapshot(storeIdOf(orig), { 'bundle.js': 'V2_ORIG' }, 'orig post-fork edit');
    // history() is a strict backward ancestor walk from the fork's own tip, so it is safe in
    // every case, diverged or not: it can never surface a sibling lineage's later commit.
    const forkHistory = await access.history(fork);
    h.eq(forkHistory.map(s => s.prompt), ['p1'], 'fork history has no trace of the original\'s later edit');
  });

  // §20b same guarantee for timeline(), once the fork has diverged with its own snapshot.
  // NOTE (see handoff/lineage-correctness.md, snapshot-lineage-identity): the engine's
  // isSameLine gate now excludes sibling-lineage descendants — a candidate that is a DAG
  // descendant of the active tip is only kept if its stamped creating lineage matches the
  // active lineage. The non-diverged-fork over-inclusion this NOTE used to describe is fixed
  // at the engine level, so timeline() is correct here whether or not the fork has diverged;
  // this test still diverges the fork to also exercise the ordinary case.
  await h.test('store-access §20b once diverged, fork entry timeline excludes the original\'s later edit', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const fork = await access.fork(orig); // HEAD now on fork-1 (== the fork point, cache accurate)
    await store.snapshot(storeIdOf(fork), { 'bundle.js': 'V_FORK' }, 'fork edit'); // fork diverges
    await access.activeBundle(orig); // switches back to main via the wrapper (cache stays accurate)
    await store.snapshot(storeIdOf(orig), { 'bundle.js': 'V2_ORIG' }, 'orig post-fork edit');
    const forkTimeline = await access.timeline(fork);
    h.eq(forkTimeline.map(s => s.prompt), ['fork edit', 'p1'], 'diverged fork timeline has no trace of the original\'s later edit');
  });

  // §21 fork with an explicit version id
  await h.test('store-access §21 fork(entry, versionId) forks from the given snapshot, not the active one', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'p2'); // active snapshot is now g2
    const history = await access.history(orig);
    const g1 = history[history.length - 1].id; // oldest = g1
    const fork = await access.fork(orig, g1);
    h.eq(await access.activeBundle(fork), 'V1', 'fork(entry, g1) checked out g1, not the active g2');
    h.eq(fork.forkedFrom, { id: 'wc', name: 'WC' }, 'provenance still recorded on an explicit-id fork');
    // fork(entry) with no id keeps forking from the active snapshot, unchanged.
    const fork2 = await access.fork(orig);
    h.eq(await access.activeBundle(fork2), 'V2', 'fork(entry) with no id still forks from the active snapshot');
  });

  // §22 activeId reflects restores
  await h.test('store-access §22 activeId reflects a rollback', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'p2');
    const history = await access.history(orig);
    const g1 = history[history.length - 1].id;
    h.ok((await access.activeId(orig)) !== g1, 'active id starts on the newest snapshot');
    await access.rollback(orig, g1);
    h.eq(await access.activeId(orig), g1, 'activeId reflects the rollback target');
  });

  // §23 re-pin moves the label (last write wins) — verified against the engine
  await h.test('store-access §23 re-pinning an existing label to a new snapshot moves it', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'p2');
    const history = await access.history(orig);
    const g1 = history[history.length - 1].id;
    const g2 = history[0].id;
    await access.pin(orig, g1, 'known-good');
    const pins1 = await access.listPins(orig);
    h.eq(pins1.map(p => p.snapshotId), [g1], 'pin initially points at g1');
    await access.pin(orig, g2, 'known-good'); // re-pin same label, different snapshot
    const pins2 = await access.listPins(orig);
    h.eq(pins2.length, 1, 'still exactly one pin under that label (moved, not duplicated)');
    h.eq(pins2[0].snapshotId, g2, 're-pinning moved the label to the new snapshot');
  });

  // §27 engineAppId resolves the storage group (linked-apps-data-model D1)
  await h.test('store-access §27 engineAppId resolves storageGroupId ?? id', async () => {
    const { access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    h.eq(access.engineAppId(orig), 'wc', 'ungrouped entry resolves to its own id');
    const shared = await access.fork(orig, undefined, { shareData: true });
    h.eq(shared.storageGroupId, 'wc', 'shared fork copies the founder\'s own id as its group');
    h.eq(access.engineAppId(shared), 'wc', 'grouped entry resolves to the group id, not its own launcher id');
  });

  // §28-29 fork shareData controls storageGroupId
  await h.test('store-access §28 fork(entry, versionId, {shareData:true}) joins the parent\'s group', async () => {
    const { access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const shared = await access.fork(orig, undefined, { shareData: true });
    h.eq(shared.storageGroupId, 'wc', 'joins the founder\'s group (parent was itself ungrouped)');
  });

  await h.test('store-access §29 fork without shareData gets no storageGroupId (unchanged default)', async () => {
    const { access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const noArg = await access.fork(orig);
    const explicitFalse = await access.fork(orig, undefined, { shareData: false });
    h.eq(noArg.storageGroupId, undefined, 'no third argument at all: own group, same as today');
    h.eq(explicitFalse.storageGroupId, undefined, 'shareData:false: own group');
  });

  // §30 group membership is immutable / transitive through the founder
  await h.test('store-access §30 fork-of-a-fork with shareData:true resolves to the ORIGINAL founder', async () => {
    const { access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const shared = await access.fork(orig, undefined, { shareData: true });
    h.eq(shared.storageGroupId, 'wc', 'first sharer joins the founder\'s group');
    const grandchild = await access.fork(shared, undefined, { shareData: true });
    h.eq(grandchild.storageGroupId, 'wc', 'fork-of-a-fork still resolves to the original founder, never re-rooted');
    h.eq(access.engineAppId(grandchild), 'wc', 'grandchild engine appId is the founder\'s id');
  });

  // §32 delete is refcount-gated on storage, both orders
  await h.test('store-access §32 founder-first delete: storage survives while a sharer remains', async () => {
    const { access, deleted } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const shared = await access.fork(orig, undefined, { shareData: true });
    await access.remove(orig);
    h.eq(deleted, [], 'deleteStorage NOT called: the sharer still references the group');
    h.eq(access.engineAppId(shared), 'wc', 'surviving sharer still resolves to the same group id');
  });

  await h.test('store-access §32 sharer-first delete: storage survives while the founder remains', async () => {
    const { access, deleted } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const shared = await access.fork(orig, undefined, { shareData: true });
    await access.remove(shared);
    h.eq(deleted, [], 'deleteStorage NOT called: the founder still references the group');
    h.eq(access.engineAppId(orig), 'wc', 'surviving founder still resolves to its own group id');
  });

  await h.test('store-access §32 deleting the last remaining group member drops the storage', async () => {
    const { access, deleted } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const shared = await access.fork(orig, undefined, { shareData: true });
    await access.remove(orig); // sharer remains, storage survives
    await access.remove(shared); // last reference
    h.eq(deleted, ['wc'], 'deleteStorage called once the group has no remaining member');
  });

  // §33 ungrouped delete unchanged
  await h.test('store-access §33 ungrouped delete calls deleteStorage immediately (unchanged)', async () => {
    const { access, deleted } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    await access.remove(orig);
    h.eq(deleted, ['wc'], 'never-shared entry: refcount 1 -> 0 in the same step');
  });

  // §34 update snapshots onto the same lineage and updates the index record
  await h.test('store-access §34 update snapshots the same lineage, updates record, id/lineage/createdAt unchanged', async () => {
    const { index, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const newRecord = REC('wc-v2');
    const updated = await access.update(orig, { record: newRecord, bundleSource: 'V2', prompt: 'p2' });
    h.eq(updated.id, orig.id, 'id unchanged');
    h.eq(updated.lineageId, orig.lineageId, 'lineage unchanged');
    h.eq(updated.createdAt, orig.createdAt, 'createdAt unchanged');
    h.eq(updated.record, newRecord, 'record updated');
    // The new record's name ('wc-v2') deliberately differs from the entry's own name ('WC') —
    // `update` must NOT adopt it. `app.name` (not `app.record.name`) is what tile-colour resolution
    // hashes for an app with no declared/injected colour (`tiles.ts#tileColor` -> `appColor(name)`
    // via `HomeScreen`/`HistoryScreen`'s `AppTile`/`tileColor` calls, both keyed on `app.name`).
    // Refreshing the entry's name from the record here would silently move that app's hue the first
    // time it is renamed by a rebuild — see build-lifecycle.ts's PRESERVE comment on `deliverResult`.
    h.eq(updated.name, orig.name, 'update preserves the entry\'s own name — tile-colour hash stability for records with no declared colour depends on it, not adopting `spec.record.name`');
    h.eq(index.get('wc')?.record, newRecord, 'index reflects the new record');
    h.eq(await access.activeBundle(orig), 'V2', 'the new bundle is the active snapshot');
    h.eq((await access.history(orig)).map(s => s.prompt), ['p2', 'p1'], 'update snapshots onto the same lineage (history grows)');
  });

  // §35 install/update write schema.json only when supplied
  await h.test('store-access §35 install writes schema.json only when supplied', async () => {
    const { store, access } = harnessAccess();
    const withSchema = await access.install({ id: 'a', name: 'A', record: REC('a'), bundleSource: 'V1', prompt: 'p', schemaJson: '{"schemaVersion":1,"collections":{}}' });
    const withoutSchema = await access.install({ id: 'b', name: 'B', record: REC('b'), bundleSource: 'V1', prompt: 'p' });
    const activeA = await store.active(storeIdOf(withSchema));
    const activeB = await store.active(storeIdOf(withoutSchema));
    h.eq(activeA?.artifacts['schema.json'], '{"schemaVersion":1,"collections":{}}', 'schema.json written when supplied to install');
    h.eq(activeB?.artifacts['schema.json'], undefined, 'schema.json absent when omitted from install');
  });

  await h.test('store-access §35b update writes schema.json only when supplied', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    const updated = await access.update(orig, { record: orig.record, bundleSource: 'V2', prompt: 'p2', schemaJson: '{"schemaVersion":1,"collections":{}}' });
    const active = await store.active(storeIdOf(updated));
    h.eq(active?.artifacts['schema.json'], '{"schemaVersion":1,"collections":{}}', 'schema.json written when supplied to update');
    const updated2 = await access.update(updated, { record: orig.record, bundleSource: 'V3', prompt: 'p3' });
    const active2 = await store.active(storeIdOf(updated2));
    h.eq(active2?.artifacts['schema.json'], undefined, 'schema.json absent from a later update that omits it');
  });

  // §36 activeSource reads the genuine source.ts artifact (#52-D5 / D14), never bundle.js
  await h.test('store-access §36 activeSource reads source.ts, never aliases the bundle', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'BUNDLE_V1', source: 'ORIGINAL_TS_V1', prompt: 'p1' });
    h.eq(await access.activeSource(orig), 'ORIGINAL_TS_V1', 'activeSource reads the distinct source.ts artifact, not bundle.js');
    h.ok((await store.active(storeIdOf(orig)))?.artifacts['source.ts'] === 'ORIGINAL_TS_V1', 'source.ts is tracked as its own snapshot file');
    const updated = await access.update(orig, { record: orig.record, bundleSource: 'BUNDLE_V2', source: 'ORIGINAL_TS_V2', prompt: 'p2' });
    h.eq(await access.activeSource(updated), 'ORIGINAL_TS_V2', 'activeSource reflects the latest update\'s source.ts');
  });

  await h.test('store-access §36b activeSource reports absence honestly for a legacy install (no source supplied)', async () => {
    const { access } = harnessAccess();
    const legacy = await access.install({ id: 'legacy', name: 'Legacy', record: REC('legacy'), bundleSource: 'BUNDLE_V1', prompt: 'p1' });
    h.eq(await access.activeSource(legacy), undefined, 'no source.ts written -> activeSource reports absence, not the bundle');
    const updatedNoSource = await access.update(legacy, { record: legacy.record, bundleSource: 'BUNDLE_V2', prompt: 'p2' });
    h.eq(await access.activeSource(updatedNoSource), undefined, 'an update that omits source stays a legacy snapshot too');
  });

  // §diff smoke: diff wrapper ensures lineage and delegates through
  await h.test('store-access diff(entry, a, b) reports per-file changes through the wrapper', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: 'p1' });
    await store.snapshot('wc', { 'bundle.js': 'V2' }, 'p2');
    const history = await access.history(orig);
    const g1 = history[history.length - 1].id;
    const g2 = history[0].id;
    const changes = await access.diff(orig, g1, g2);
    const bundle = changes.find(c => c.file === 'bundle.js');
    h.ok(!!bundle && bundle.status === 'modified' && bundle.after === 'V2', 'diff wrapper delegates through and reports the bundle change');
  });

  // ── activeDescription — the edit flow's re-prompt context (`AppContext.description`) ─────────

  await h.test('store-access: activeDescription resolves the CURRENT version\'s prompt, envelope or raw', async () => {
    const { access } = harnessAccess();
    const orig = await access.install({
      id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: promptEnvelope('a timer for my pour-over recipe'),
    });
    h.eq(await access.activeDescription(orig), 'a timer for my pour-over recipe', 'reads the v2 envelope\'s text');

    const legacy = await access.install({ id: 'legacy', name: 'Legacy', record: REC('legacy'), bundleSource: 'V1', prompt: 'a raw legacy prompt' });
    h.eq(await access.activeDescription(legacy), 'a raw legacy prompt', 'a raw string reads as its own text, same as history-logic');
  });

  await h.test('store-access: activeDescription tracks the CURRENT version, not the first one', async () => {
    const { access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1', prompt: promptEnvelope('add a timer') });
    const updated = await access.update(orig, { record: orig.record, bundleSource: 'V2', prompt: promptEnvelope('add a fruit tea section') });
    h.eq(await access.activeDescription(updated), 'add a fruit tea section', 'the latest delivered prompt, not the install one');
  });

  // ── per-repo serialization: a fork and its original are ONE repo ────────────────────────────
  // A repo's HEAD is a single shared mutable cursor and `ensureLineage` is a check-then-act across
  // an await, while the launcher's busy gate (app-busy.ts) is keyed by LAUNCHER id — which a fork
  // and its original do not share. So "Prompt again" on a fork (an un-awaited `activeDescription`)
  // racing "Open" on the original used to leave the loser reading the other lineage's snapshot:
  // wrong data, silently. `StoreAccess.serial` makes switch-then-read atomic per repo.

  await h.test('store-access: concurrent ops on ONE shared repo serialize — each read sees its own lineage', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1_MAIN', prompt: 'the original prompt' });
    const fork = await access.fork(orig); // repo HEAD is now on the fork lineage
    await store.snapshot(storeIdOf(fork), { 'bundle.js': 'V2_FORK' }, promptEnvelope('the fork prompt'));
    await access.activeBundle(orig); // switch back to main, so the cache reads 'main' as in the bug report
    h.eq(storeIdOf(fork), storeIdOf(orig), 'precondition: the fork and the original share one repo');

    const spy = instrumentRepoOps(store);
    const held = spy.hold('wc', fork.lineageId); // A's switch lands, then hangs

    let aRead: string | undefined;
    let bRead: string | undefined;
    // A: "Prompt again" on the FORK — fired without awaiting, exactly as the prompt flow does.
    const pA = access.activeDescription(fork).then(v => { aRead = v; });
    // Wait for A's checkout to have actually moved the repo HEAD onto the fork lineage. That is
    // the window the bug lives in: A has switched but not yet read, and B's own lineage check is
    // about to consult a cache that still says 'main'.
    await within(held.landed, 5000, "A's switch landing on the repo");
    // B: "Open" on the ORIGINAL, fired inside that window.
    const pB = access.activeBundle(orig).then(v => { bRead = v; });
    await flush();

    h.eq(spy.calls, [`sw:wc:${fork.lineageId}`], 'B has not touched the repo while A holds it: no switch, no read');
    h.eq(bRead, undefined, "B's read has not landed while A holds the repo");

    held.release();
    await within(pA, 5000, 'A (activeDescription on the fork)');
    await within(pB, 5000, 'B (activeBundle on the original)');

    h.eq(
      spy.calls,
      [`sw:wc:${fork.lineageId}`, 'rd:wc', 'sw:wc:main', 'rd:wc'],
      "B's switch runs only after A's WHOLE operation (switch + read) finished — switch-then-read is atomic per repo",
    );
    h.eq(aRead, 'the fork prompt', "A observed the FORK's snapshot");
    h.eq(bRead, 'V1_MAIN', "B observed the ORIGINAL's snapshot, not the fork's V2_FORK");
  });

  await h.test('store-access: ops on DIFFERENT repos still run concurrently (the mutex is per repo, not global)', async () => {
    const { store, index, access } = harnessAccess();
    const alpha = await access.install({ id: 'alpha', name: 'Alpha', record: REC('alpha'), bundleSource: 'ALPHA_V1', prompt: 'a' });
    const beta = await access.install({ id: 'beta', name: 'Beta', record: REC('beta'), bundleSource: 'BETA_V1', prompt: 'b' });
    // A second wrapper over the same store starts with an EMPTY lineage cache (the fresh-process
    // case), so the first read of each repo genuinely switches.
    const fresh = new StoreAccess({ store, index });

    const spy = instrumentRepoOps(store);
    const held = spy.hold('alpha', 'main');

    let aRead: string | undefined;
    const pA = fresh.activeBundle(alpha).then(v => { aRead = v; });
    await within(held.landed, 5000, "alpha's switch landing on its repo");

    // Beta's WHOLE operation is awaited to completion while alpha's gate is still shut — the
    // independence is proved by construction, not by giving beta a tick budget and hoping it
    // fits. (It does not always fit: one read is ~10 `crypto.subtle.digest` round-trips through
    // isomorphic-git, each off the event loop, so on a loaded CI runner the read needs more
    // macrotask turns than any fixed flush allows. That is what made the old `await flush()`
    // form report a slow read as a serialization bug.) Under a single global mutex this await is
    // a deadlock — `held.release()` is below it and unreachable — which `within` turns into a
    // named failure instead of a suite-wide hang.
    const bRead = await within(fresh.activeBundle(beta), 5000, "beta's read while alpha is held");

    h.eq(spy.calls, ['sw:alpha:main', 'sw:beta:main', 'rd:beta'], "beta switched and read while alpha's switch is still in flight");
    h.eq(bRead, 'BETA_V1', 'the beta read completed without waiting for alpha');
    h.eq(aRead, undefined, 'alpha is still held, so nothing of its own has resolved');

    held.release();
    await within(pA, 5000, 'alpha (the held read)');
    h.eq(aRead, 'ALPHA_V1', 'alpha completes with its own bundle once released');
  });

  await h.test('store-access: a failed op orders the next one without failing it (the chain is not poisoned)', async () => {
    const { store, access } = harnessAccess();
    const orig = await access.install({ id: 'wc', name: 'WC', record: REC('wc'), bundleSource: 'V1_MAIN', prompt: 'p1' });
    const realActive = store.active.bind(store);
    let failNext = true;
    store.active = async appId => {
      if (failNext) {
        failNext = false;
        throw new Error('boom: transient store failure');
      }
      return realActive(appId);
    };
    // Both ops are on the SAME repo chain; the second is queued behind the failing first.
    const pFail = access.activeBundle(orig);
    const pNext = access.activeBundle(orig);
    await h.throws(() => within(pFail, 5000, 'the failing op'), 'boom', 'the failure is delivered to its OWN caller, not swallowed');
    h.eq(await within(pNext, 5000, 'the op queued behind a failure'), 'V1_MAIN', 'the next op on that repo still runs and resolves normally');
  });
}
