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
}
