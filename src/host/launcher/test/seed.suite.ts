/**
 * Seeding Node suite (task 5.3, from installed-apps.spec.md §6–7). First-run seeds both
 * examples (snapshot-backed, example-labeled); seeding is idempotent; deleted examples stay
 * deleted (the marker gates the whole routine).
 */

import { Harness } from './harness';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import { AppIndex } from '../app-index';
import { StoreAccess } from '../store-access';
import { seedFirstRun, SeedSpec, SEED_VERSION } from '../seed';
import type { AppRecord } from '../../bridge/contract';

const REC = (id: string): AppRecord => ({ appId: id, name: id, manifest: { capabilities: [] } });
const SEEDS: SeedSpec[] = [
  { id: 'tip-splitter', name: 'Tip Splitter', prompt: 'Example: split a bill with tip', record: REC('tip-splitter'), bundleSource: 'TIP_SRC' },
  { id: 'water-counter', name: 'Water Counter', prompt: 'Example: track glasses of water', record: REC('water-counter'), bundleSource: 'WATER_SRC' },
];

function rig() {
  const store = createMemoryStore({ autoCompact: false });
  const map = new Map<string, string>();
  const index = new AppIndex(new MapKVBackend(map));
  let t = 1000;
  const access = new StoreAccess({ store, index, now: () => (t += 1000) });
  return { store, index, access, map };
}

export async function runSeedTests(h: Harness): Promise<void> {
  await h.test('seed: a fresh install seeds both examples, snapshot-backed + labeled', async () => {
    const { store, index, access } = rig();
    await seedFirstRun(index, access, SEEDS);
    h.eq(index.list().map(a => a.id), ['tip-splitter', 'water-counter'], 'both examples installed');
    h.ok(index.list().every(a => a.example === true), 'both labeled as examples');
    h.eq((await store.history('tip-splitter')).length, 1, 'tip splitter has snapshot #1');
    h.eq((await store.history('water-counter')).length, 1, 'water counter has snapshot #1');
    h.eq(await access.activeBundle(index.get('water-counter')!), 'WATER_SRC', 'bundle source stored');
    h.eq(index.seedVersion(), SEED_VERSION, 'marker recorded');
  });

  await h.test('seed §6 is idempotent across restarts — no duplicates, runs once', async () => {
    const { index, access, store, map } = rig();
    await seedFirstRun(index, access, SEEDS);
    // simulate a restart: a fresh index over the same backing map
    const index2 = new AppIndex(new MapKVBackend(map));
    const access2 = new StoreAccess({ store, index: index2 });
    await seedFirstRun(index2, access2, SEEDS);
    h.eq(index2.list().map(a => a.id), ['tip-splitter', 'water-counter'], 'no duplicate examples after a second seed');
    h.eq((await store.history('tip-splitter')).length, 1, 'not re-snapshotted');
  });

  await h.test('seed §7 deleted examples stay deleted across a restart', async () => {
    const { index, access, store, map } = rig();
    await seedFirstRun(index, access, SEEDS);
    await access.remove(index.get('water-counter')!); // user deletes a seeded example
    h.eq(index.get('water-counter'), null, 'example deleted');
    // restart + re-seed at the same version
    const index2 = new AppIndex(new MapKVBackend(map));
    const access2 = new StoreAccess({ store, index: index2 });
    await seedFirstRun(index2, access2, SEEDS);
    h.eq(index2.get('water-counter'), null, 'deleted example does NOT reappear (marker gates it)');
    h.eq(index2.list().map(a => a.id), ['tip-splitter'], 'only the un-deleted example remains');
  });
}
