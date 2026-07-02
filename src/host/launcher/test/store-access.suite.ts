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

function harnessAccess() {
  const store = createMemoryStore({ autoCompact: false });
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
    h.eq(
      deleted.sort((a, b) => a.localeCompare(b)),
      ['wc', fork.id].sort((a, b) => a.localeCompare(b)),
      'both user-data dbs dropped by their own ids',
    );
  });
}
