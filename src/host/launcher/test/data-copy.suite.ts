/**
 * "Copy the data" after the copy (copy-app-data task 2.5; app-data-copy "Copied schema evolves
 * independently with no identity reuse" / "Copies are fully independent after the copy";
 * linked-apps "A copy never joins its original's group" / "A legacy shared copy keeps sharing"),
 * through `StoreAccess` over a real version store and real store files: the copied union, its
 * floor as generation reads it, independent evolution and writes, deletion through the purge, the
 * legacy shared copy, and the census guard that no `fork` option can share a store.
 */

import fs from 'node:fs';

import { Harness } from './harness';
import type { InstalledApp } from '../app-index';
import type { StoreAccess } from '../store-access';
import { buildGenerateRequest } from '../generation-request';
import { PendingPurgeStore, completePurge } from '../pending-purge';
import { PendingBuildStore } from '../pending-builds';
import { RunJournalStore } from '../run-journal';
import { createEngine } from '../../storage-engine/engine';
import { createNodeSqlExecutor } from '../../storage-engine/bindings/node-sqlite';
import { RecordingExecutor } from '../../storage-engine/sql-executor';
import { burnedIdFloor, type AppliedSchema } from '../../storage-engine/schema';
import type { SchemaArtifact } from '../../storage-engine/contract';
import {
  accessOver, disposeDeviceState, fileOf, filesOf, installApp, newDeviceState, readApplied, sha256, withEngine,
  type DeviceState,
} from './data-copy-rig';

// v1 → v2: `tag` (f5) is retired with data in it; `mood` (f6) and `rating` (f7) are added. The
// union for c1 is f1–f7 with f5 retired, so its burned-ID floor is 7.
const V1: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Notes: {
      id: 'c1',
      tombstones: [],
      fields: {
        title: { id: 'f1', type: 'text' },
        body: { id: 'f2', type: 'text' },
        pinned: { id: 'f3', type: 'bool' },
        score: { id: 'f4', type: 'int' },
        tag: { id: 'f5', type: 'text' },
      },
    },
  },
};

const V2: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Notes: {
      id: 'c1',
      tombstones: ['f5'],
      fields: {
        title: { id: 'f1', type: 'text' },
        body: { id: 'f2', type: 'text' },
        pinned: { id: 'f3', type: 'bool' },
        score: { id: 'f4', type: 'int' },
        mood: { id: 'f6', type: 'text', default: 'ok' },
        rating: { id: 'f7', type: 'float', default: 0 },
      },
    },
  },
};

/** `base` plus one new Notes field, the way a generation adds one. */
function plusField(base: SchemaArtifact, name: string, field: { id: string; type: 'text' | 'int'; default: string | number }): SchemaArtifact {
  const notes = base.collections.Notes;
  return { ...base, collections: { ...base.collections, Notes: { ...notes, fields: { ...notes.fields, [name]: field } } } };
}

function columnTypes(applied: AppliedSchema, collection: string): Record<string, string> {
  const coll = applied.collections.find((c) => c.id === collection);
  return Object.fromEntries([...(coll?.active ?? []), ...(coll?.retired ?? [])].map((c) => [c.id, c.type]));
}

function titles(state: DeviceState, appId: string, schema: SchemaArtifact): [number, unknown][] {
  return withEngine(state, appId, schema, (engine) => engine.records.list('Notes').map((r): [number, unknown] => [r.id, r.title]));
}

/** A at version 2: records 3, 7 and 12 written under v1 (with data in the field v2 retires), then
 *  rebuilt to v2, whose union for Notes reaches f7. Returns A as the index holds it and v1's id. */
async function evolvedOriginal(state: DeviceState, access: StoreAccess): Promise<{ a: InstalledApp; v1: string }> {
  const installed = await installApp(access, 'a', V1, 'V1');
  withEngine(state, 'a', V1, (engine) => {
    for (let i = 1; i <= 12; i++) engine.records.append('Notes', { title: `note ${i}`, body: 'b', pinned: false, score: i, tag: `tag-${i}` });
    for (let i = 1; i <= 12; i++) if (![3, 7, 12].includes(i)) engine.records.remove('Notes', i);
    engine.kv.set('theme', 'dark');
  });
  const [v1] = await access.history(installed);
  const a = await access.update(installed, {
    record: { ...installed.record, schemaArtifact: V2 },
    bundleSource: 'V2',
    prompt: 'a V2',
    schemaJson: JSON.stringify(V2),
  });
  withEngine(state, 'a', V2, (engine) => engine.records.update('Notes', 7, { mood: 'great' }));
  return { a, v1: v1.id };
}

const PRE_COPY = [[3, 'note 3'], [7, 'note 7'], [12, 'note 12']];

export async function runDataCopyTests(h: Harness): Promise<void> {
  await h.test('data-copy: A and its copy C each add a field above the copied floor, and neither sees the other\'s', async () => {
    const state = newDeviceState();
    try {
      const { access } = accessOver(state);
      const { a } = await evolvedOriginal(state, access);
      h.eq(burnedIdFloor(readApplied(state)('a')).c1, 7, "precondition: A's union reaches f7");
      const c = await access.fork(a, undefined, { data: 'copy' });
      h.eq([c.storageGroupId, access.engineAppId(c)], [undefined, c.id], 'the copy resolves to its own store');
      h.eq(readApplied(state)(c.id), readApplied(state)('a'), "the copy's union is A's, retired field included");

      // Each side's next generation allocates above the union it reads for itself.
      const nextA = burnedIdFloor(readApplied(state)(access.engineAppId(a))).c1 + 1;
      const nextC = burnedIdFloor(readApplied(state)(access.engineAppId(c))).c1 + 1;
      h.ok(nextA > 7 && nextC > 7, `both new ordinals are above 7 (A f${nextA}, C f${nextC})`);
      const aV3 = plusField(V2, 'note', { id: `f${nextA}`, type: 'text', default: '' });
      const cV3 = plusField(V2, 'count', { id: `f${nextC}`, type: 'int', default: 0 });
      withEngine(state, 'a', aV3, (engine) => engine.records.update('Notes', 3, { note: 'only in A' }));
      withEngine(state, c.id, cV3, (engine) => engine.records.update('Notes', 3, { count: 5 }));

      h.eq(columnTypes(readApplied(state)('a'), 'c1')[`f${nextA}`], 'text', "A's store has A's new text field");
      h.eq(columnTypes(readApplied(state)(c.id), 'c1')[`f${nextC}`], 'int', "C's store has C's new int field");
      h.eq(columnTypes(readApplied(state)('a'), 'c1').f5, 'text', "A's retired field is still burned");
      h.eq(columnTypes(readApplied(state)(c.id), 'c1').f5, 'text', "and so is C's");
      h.eq(titles(state, 'a', aV3), PRE_COPY, 'A reads its pre-copy records');
      h.eq(titles(state, c.id, cV3), PRE_COPY, 'C reads the same pre-copy records');
      h.eq(withEngine(state, c.id, cV3, (engine) => engine.records.list('Notes').find((r) => r.id === 3)?.count), 5, "C's own write is there");
      h.eq(withEngine(state, 'a', aV3, (engine) => engine.records.list('Notes').find((r) => r.id === 3)?.note), 'only in A', "A's own write is there");
      h.ok(fileOf(state, 'a') !== fileOf(state, c.id) && fs.existsSync(fileOf(state, c.id)), 'they are two files');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('data-copy: a copy from an older version opens with zero DDL, keeps every field, and generates above A\'s floor', async () => {
    const state = newDeviceState();
    try {
      const { access } = accessOver(state);
      const { a, v1 } = await evolvedOriginal(state, access);
      const floorAtCopy = burnedIdFloor(readApplied(state)('a'));
      const d = await access.fork(a, v1, { data: 'copy' });
      h.eq(await access.activeBundle(d), 'V1', "the copy runs version 1's code");

      const rec = new RecordingExecutor(createNodeSqlExecutor(fileOf(state, d.id)));
      const engine = createEngine(rec);
      const mark = rec.log.length; // past the engine's own idempotent bootstrap
      try {
        engine.open(V1);
        h.eq(rec.log.slice(mark).filter((e) => /^\s*(CREATE|ALTER)/i.test(e.sql)).map((e) => e.sql), [], 'its first launch runs no DDL');
        h.eq(engine.records.list('Notes').map((r) => [r.id, r.tag]), [[3, 'tag-3'], [7, 'tag-7'], [12, 'tag-12']], "the older code reads the data A's later version retired");
      } finally {
        engine.close();
      }
      h.eq(columnTypes(readApplied(state)(d.id), 'c1'), columnTypes(readApplied(state)('a'), 'c1'), "its union still holds every field A ever had");

      const request = await buildGenerateRequest(access, readApplied(state), d, 'add a field');
      h.eq(burnedIdFloor(request.app?.appliedSchema as unknown as AppliedSchema), floorAtCopy, "its next generation's floor is A's at copy time");
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('data-copy: writes after the copy stay on their own side', async () => {
    const state = newDeviceState();
    try {
      const { access } = accessOver(state);
      const { a } = await evolvedOriginal(state, access);
      const c = await access.fork(a, undefined, { data: 'copy' });
      withEngine(state, 'a', V2, (engine) => engine.records.append('Notes', { title: 'added in A', body: 'b', pinned: false, score: 0 }));
      withEngine(state, c.id, V2, (engine) => {
        engine.records.remove('Notes', 7);
        engine.kv.set('theme', 'light');
      });
      h.eq(titles(state, 'a', V2), [...PRE_COPY, [13, 'added in A']], 'A still has the record C deleted, and its own new one');
      h.eq(titles(state, c.id, V2), [[3, 'note 3'], [12, 'note 12']], "C has neither A's new record nor the one it deleted");
      h.eq(withEngine(state, 'a', V2, (engine) => engine.kv.get('theme')), 'dark', "C's kv write never reaches A");
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('data-copy: deleting the original, its purge complete, keeps the copy\'s data and lets it launch', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const { a } = await evolvedOriginal(state, access);
      const c = await access.fork(a, undefined, { data: 'copy' });
      const purges = new PendingPurgeStore(state.kv);
      purges.armApp(a);
      const [marker] = purges.list();
      await completePurge({ purges, index, access, pending: new PendingBuildStore(state.kv), journal: new RunJournalStore(state.kv) }, marker);
      h.eq([index.has('a'), filesOf(state, 'a')], [false, []], "A's entry and store are gone");
      h.eq(titles(state, c.id, V2), PRE_COPY, 'C keeps all of its data');
      h.eq(await access.activeBundle(c), 'V2', 'and still launches');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('data-copy: a legacy shared copy keeps sharing, survives its founder, and copying it gives the group\'s data its own file', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state);
      const { a } = await evolvedOriginal(state, access);
      // A #52 shared copy has the record a continuation has today: the founder's id as its group.
      const b = await access.continueSharingData(a);
      h.eq(access.engineAppId(b), 'a', 'precondition: B is in A\'s group');
      withEngine(state, access.engineAppId(b), V2, (engine) => engine.records.append('Notes', { title: 'from B', body: 'b', pinned: false, score: 0 }));
      h.eq(titles(state, access.engineAppId(a), V2).at(-1), [13, 'from B'], 'A reads what B wrote: they still share one store');

      const groupSha = sha256(fileOf(state, 'a'));
      const e = await access.fork(b, undefined, { data: 'copy' });
      h.eq([e.storageGroupId, access.engineAppId(e)], [undefined, e.id], 'the copy of B has its own store');
      h.eq(titles(state, e.id, V2), [...PRE_COPY, [13, 'from B']], "and holds the group's data");
      h.eq(sha256(fileOf(state, 'a')), groupSha, "the group's store is unchanged by the copy");
      h.eq(index.get(b.id)?.storageGroupId, 'a', 'B still names A\'s group');

      await access.remove(a);
      h.eq(titles(state, access.engineAppId(b), V2).at(-1), [13, 'from B'], 'B survives its founder\'s deletion with the group\'s data');
      await access.remove(b);
      h.eq(filesOf(state, 'a'), [], "the group's store goes with its last member");
      h.eq(titles(state, e.id, V2).length, 4, "the copy of B keeps its own data");
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('data-copy: deleting a sharer keeps its founder\'s data (a legacy group, either order)', async () => {
    const state = newDeviceState();
    try {
      const { access } = accessOver(state);
      const { a } = await evolvedOriginal(state, access);
      const b = await access.continueSharingData(a);
      await access.remove(b);
      h.eq(titles(state, access.engineAppId(a), V2), PRE_COPY, 'A keeps the group\'s data when B is deleted');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('data-copy census: no fork option combination, from a grouped or ungrouped app, sets a storage group', async () => {
    const state = newDeviceState();
    try {
      const { access } = accessOver(state);
      const { a, v1 } = await evolvedOriginal(state, access);
      const grouped = await access.continueSharingData(a);
      const options: unknown[] = [undefined, {}, { data: 'fresh' }, { data: 'copy' }, { shareData: true }, { shareData: true, data: 'copy' }, { shareData: true, data: 'fresh' }];
      let made = 0;
      for (const source of [a, grouped]) {
        for (const versionId of [undefined, v1]) {
          for (const opts of options) {
            const copy = await access.fork(source, versionId, opts as Parameters<StoreAccess['fork']>[2]);
            made++;
            h.ok(!('storageGroupId' in copy) && access.engineAppId(copy) === copy.id, `fork(${source.id}, ${String(versionId != null)}, ${JSON.stringify(opts)}) resolves to its own store`);
          }
        }
      }
      h.eq(made, 2 * 2 * options.length, 'every combination made a copy');
    } finally {
      disposeDeviceState(state);
    }
  });
}
