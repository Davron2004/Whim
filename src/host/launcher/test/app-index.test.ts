/**
 * app-index Node suite (task 5.1, from installed-apps.spec.md §1–8). MMKV-backed records +
 * ordered list + seed marker, behind the mockable KVBackend seam (MapKVBackend). Restart
 * survival is a fresh index over the SAME backing map.
 */

import { Harness } from './harness';
import { MapKVBackend, assertNoGitLeak } from '../../version-store';
import { AppIndex, InstalledApp } from '../app-index';
import type { AppRecord } from '../../bridge/contract';

const REC = (id: string): AppRecord => ({ appId: id, name: id, manifest: { capabilities: [] } });

function entry(id: string, over: Partial<InstalledApp> = {}): InstalledApp {
  return { id, name: id, createdAt: 1000, record: REC(id), lineageId: 'main', ...over };
}

export async function runAppIndexTests(h: Harness): Promise<void> {
  // §1 CRUD
  await h.test('app-index §1 put then get returns the record; unknown id → null', async () => {
    const idx = new AppIndex(new MapKVBackend());
    const a = entry('water-counter', { name: 'Water Counter', example: true });
    idx.put(a);
    h.eq(idx.get('water-counter'), a, 'get returns the stored record verbatim');
    h.eq(idx.get('nope'), null, 'unknown id returns null');
  });

  // §2 ordering + in-place update
  await h.test('app-index §2 list is in install order; re-put updates in place', async () => {
    const idx = new AppIndex(new MapKVBackend());
    idx.put(entry('a'));
    idx.put(entry('b'));
    idx.put(entry('c'));
    h.eq(idx.list().map(x => x.id), ['a', 'b', 'c'], 'install order preserved, newest last');
    idx.put(entry('b', { name: 'B renamed' }));
    h.eq(idx.list().map(x => x.id), ['a', 'b', 'c'], 're-put does not duplicate the order entry');
    h.eq(idx.get('b')!.name, 'B renamed', 're-put updates the record in place');
  });

  // §3 remove
  await h.test('app-index §3 remove drops the record + order entry; survivors unchanged', async () => {
    const idx = new AppIndex(new MapKVBackend());
    idx.put(entry('a'));
    idx.put(entry('b'));
    idx.put(entry('c'));
    idx.remove('b');
    h.eq(idx.list().map(x => x.id), ['a', 'c'], 'removed id is gone; survivors keep order');
    h.eq(idx.get('b'), null, 'removed record no longer readable');
  });

  // §4 restart survival
  await h.test('app-index §4 a fresh index over the same backend survives a "restart"', async () => {
    const map = new Map<string, string>();
    const idx1 = new AppIndex(new MapKVBackend(map));
    idx1.put(entry('water-counter', { name: 'Water Counter', example: true }));
    idx1.put(entry('tip-splitter', { name: 'Tip Splitter', example: true }));
    const idx2 = new AppIndex(new MapKVBackend(map)); // simulate process kill + relaunch
    h.eq(idx2.list().map(x => x.id), ['water-counter', 'tip-splitter'], 'records + order survived');
    h.eq(idx2.get('water-counter')!.name, 'Water Counter', 'names survived');
    h.ok(idx2.get('water-counter')!.example === true, 'example labels survived');
  });

  // §5 seed marker
  await h.test('app-index §5 seed marker: 0 on a virgin backend, reads back after markSeeded', async () => {
    const idx = new AppIndex(new MapKVBackend());
    h.eq(idx.seedVersion(), 0, 'virgin backend reports seed version 0');
    idx.markSeeded(2);
    h.eq(idx.seedVersion(), 2, 'markSeeded round-trips');
  });

  // refcount (used by delete refcounting in store-access)
  await h.test('app-index refCount counts entries sharing a repo', async () => {
    const idx = new AppIndex(new MapKVBackend());
    idx.put(entry('water-counter')); // original: storeId == id
    idx.put(entry('water-counter__fork-1', { storeId: 'water-counter', lineageId: 'fork-1' }));
    idx.put(entry('tip-splitter'));
    h.eq(idx.refCount('water-counter'), 2, 'original + fork both reference the repo');
    h.eq(idx.refCount('tip-splitter'), 1, 'lone original references its own repo once');
  });

  // §8 no git vocabulary in any return shape
  await h.test('app-index §8 records leak no git vocabulary', async () => {
    const idx = new AppIndex(new MapKVBackend());
    idx.put(entry('water-counter', { name: 'Water Counter' }));
    idx.put(entry('water-counter__fork-1', { storeId: 'water-counter', lineageId: 'fork-1', forkedFrom: { id: 'water-counter', name: 'Water Counter' } }));
    assertNoGitLeak(idx.list(), 'index.list');
    h.ok(idx.get('water-counter__fork-1')!.lineageId === 'fork-1', 'lineageId is a product string, not a ref');
  });
}
