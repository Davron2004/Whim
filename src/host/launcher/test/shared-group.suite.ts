/**
 * A storage group's members through every launcher operation (separate-shared-data tasks 1.3–1.5;
 * linked-apps "A group member becomes independent by copying, never by leaving its group", "No
 * operation on an existing entry changes its storage group", "A launcher record is never written
 * for an entry the index no longer holds"), on the file-backed rig: a real version store, the
 * launcher KV, and real store files. Every group is made the one way the product makes it
 * (`continueSharingData`), every row is written through a real engine, and every read goes through
 * `engineAppId` after the operation, so a test fails if an app lands on another store.
 */

import fs from 'node:fs';

import { Harness } from './harness';
import { AppIndex, type InstalledApp } from '../app-index';
import { AppGoneError, type StoreAccess } from '../store-access';
import { deliverResult } from '../build-lifecycle';
import { DataCopyJournal } from '../data-copy-journal';
import { PendingPurgeStore, completeInterruptedPurges, completePurge, type PurgeDeps } from '../pending-purge';
import { PendingBuildStore } from '../pending-builds';
import { RunJournalStore } from '../run-journal';
import type { KVBackend } from '../../version-store';
import type { SchemaArtifact } from '../../storage-engine/contract';
import type { WireAppRecord } from '@whim/contract';
import {
  accessOver, disposeDeviceState, fileDelete, fileOf, filesOf, installApp, newDeviceState, sha256, withEngine,
  type DeviceState, type Rig,
} from './data-copy-rig';

const NOTES: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { title: { id: 'f1', type: 'text' } } } },
};

/** A delivered change that declares storage under the same schema (it satisfies `bundleDefinesApp`). */
function wire(name: string): WireAppRecord {
  return {
    name,
    source: 'export default () => null;',
    bundle: 'var __WHIM_APP_MODULE__ = (() => ({}))();',
    manifest: { capabilities: ['storage'] },
    schema: NOTES as unknown as WireAppRecord['schema'],
  };
}

interface Contents {
  notes: string[];
  theme: unknown;
}

/** What the store `appId` names holds, read through the engine. */
function contentsOf(state: DeviceState, appId: string): Contents {
  return withEngine(state, appId, NOTES, (engine) => ({
    notes: engine.records.list('Notes').map((r) => String(r.title)),
    theme: engine.kv.get('theme'),
  }));
}

/** What `app` reads at its next launch: the store the index's record for it resolves to. */
function readsOf(rig: Rig, state: DeviceState, id: string): Contents {
  const app = rig.index.get(id);
  if (app == null) throw new Error(`no entry for "${id}"`);
  return contentsOf(state, rig.access.engineAppId(app));
}

function write(state: DeviceState, appId: string, title: string): void {
  withEngine(state, appId, NOTES, (engine) => engine.records.append('Notes', { title }));
}

const GROUP_DATA: Contents = { notes: ['from A', 'from B'], theme: 'dark' };

/** Founder A with saved rows and a kv value, and B sharing A's group, which B has written to. */
async function group(state: DeviceState, access: StoreAccess): Promise<{ a: InstalledApp; b: InstalledApp }> {
  const a = await installApp(access, 'a', NOTES);
  withEngine(state, 'a', NOTES, (engine) => {
    engine.records.append('Notes', { title: 'from A' });
    engine.kv.set('theme', 'dark');
  });
  const b = await access.continueSharingData(a);
  write(state, access.engineAppId(b), 'from B');
  return { a, b };
}

function purgeDeps(state: DeviceState, rig: Rig): PurgeDeps {
  return {
    purges: new PendingPurgeStore(state.kv),
    index: rig.index,
    access: rig.access,
    pending: new PendingBuildStore(state.kv),
    journal: new RunJournalStore(state.kv),
  };
}

/** Delete through the product's path: arm the purge, then let the Undo window end. */
async function deleteApp(state: DeviceState, rig: Rig, app: InstalledApp): Promise<void> {
  const deps = purgeDeps(state, rig);
  deps.purges.armApp(app);
  const marker = deps.purges.list().find((m) => m.kind === 'app' && m.id === app.id);
  if (marker == null) throw new Error('the purge was not armed');
  await completePurge(deps, marker);
}

/** Every launcher KV key with its value, and every store file with its hash: all a launch can change. */
function deviceSnapshot(state: DeviceState): { kv: [string, unknown][]; files: [string, string][] } {
  const kv = state.kv.getAllKeys().sort((x, y) => x.localeCompare(y)).map((k): [string, unknown] => [k, state.kv.getString(k)]);
  const files = fs.readdirSync(state.dir).sort((x, y) => x.localeCompare(y)).map((f): [string, string] => [f, sha256(`${state.dir}/${f}`)]);
  return { kv, files };
}

/** A relaunch as `LauncherRoot` orders it (the copy sweep, then interrupted purges), twice. Returns
 *  the rig of the second launch; asserts that the second launch changed no record and no file. */
async function relaunchTwice(h: Harness, state: DeviceState): Promise<Rig> {
  const launch = async (): Promise<Rig> => {
    const rig = accessOver(state);
    await rig.access.sweepDataCopies();
    await completeInterruptedPurges(purgeDeps(state, rig));
    return rig;
  };
  await launch();
  const afterFirst = deviceSnapshot(state);
  const rig = await launch();
  h.eq(deviceSnapshot(state), afterFirst, 'a second launch changes no record and no file');
  return rig;
}

/** Every version id on every lineage of `repo`. Moves the repo's HEAD, so the caller builds a fresh
 *  `StoreAccess` (a relaunch) before its next operation. */
async function versionsOf(state: DeviceState, repo: string): Promise<{ lineages: string[]; versions: string[] }> {
  const lineages = (await state.store.lineages(repo)).sort((x, y) => x.localeCompare(y));
  const versions = new Set<string>();
  for (const lineage of lineages) {
    await state.store.switchLineage(repo, lineage);
    for (const s of await state.store.timeline(repo, { limit: Number.POSITIVE_INFINITY })) versions.add(s.id);
  }
  return { lineages, versions: [...versions].sort((x, y) => x.localeCompare(y)) };
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return e;
  }
}

/** The launcher KV as a process that dies on the second write of an index entry (`app:` or the
 *  order) once armed: from then on every persisted effect throws without happening. */
function dyingKv(kv: KVBackend): { kv: KVBackend; arm: () => void; check: () => void; dead: () => boolean } {
  let armed = false;
  let indexWrites = 0;
  let dead = false;
  const check = (): void => {
    if (dead) throw new Error('the process died');
  };
  const indexWrite = (key: string): void => {
    if (!armed || (key !== 'order' && !key.startsWith('app:'))) return;
    indexWrites++;
    if (indexWrites === 2) {
      dead = true;
      check();
    }
  };
  return {
    arm: () => {
      armed = true;
    },
    check,
    dead: () => dead,
    kv: {
      getString: (key) => {
        check();
        return kv.getString(key);
      },
      getAllKeys: () => {
        check();
        return kv.getAllKeys();
      },
      set: (key, value) => {
        check();
        indexWrite(key);
        kv.set(key, value);
      },
      delete: (key) => {
        check();
        indexWrite(key);
        kv.delete(key);
      },
    },
  };
}

export async function runSharedGroupTests(h: Harness): Promise<void> {
  // ── 1.3 the index is the authority for an existing entry ─────────────────────────────────────

  await h.test('index authority: a rebuild keeps a sharer in its group, and it still reads its founder\'s data', async () => {
    const state = newDeviceState();
    try {
      const rig = accessOver(state);
      const { b } = await group(state, rig.access);
      const delivered = await deliverResult({ access: rig.access, appId: b.id, editing: b, text: 'add a dark mode', wire: wire('B') });
      h.eq(delivered.id, b.id, 'precondition: at its tip, the change updated B itself');
      h.eq(rig.index.get(b.id)?.storageGroupId, 'a', 'B\'s record still names A\'s group');
      h.eq(readsOf(rig, state, b.id), GROUP_DATA, 'and B\'s next launch reads what A (and B) saved');
      h.eq(filesOf(state, b.id), [], 'no store was made under B\'s own id');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('index authority: a continuation\'s first build lands in the original\'s group', async () => {
    const state = newDeviceState();
    try {
      const rig = accessOver(state);
      const a = await installApp(rig.access, 'a', NOTES);
      withEngine(state, 'a', NOTES, (engine) => {
        engine.records.append('Notes', { title: 'from A' });
        engine.kv.set('theme', 'dark');
      });
      const first = await rig.access.activeId(a);
      await deliverResult({ access: rig.access, appId: a.id, editing: a, text: 'v2', wire: wire('A') });
      await rig.access.rollback(a, first!);
      const continued = await deliverResult({ access: rig.access, appId: a.id, editing: rig.index.get(a.id)!, text: 'v3', wire: wire('A') });
      h.ok(continued.id !== a.id, 'precondition: behind its tip, the change continued as a new entry');
      h.eq(rig.index.get(continued.id)?.storageGroupId, 'a', 'the new entry\'s record names A\'s group after the build\'s record is written');
      h.eq(readsOf(rig, state, continued.id), { notes: ['from A'], theme: 'dark' }, 'and its first launch reads A\'s saved data');
      h.eq(rig.index.get(a.id)?.storageGroupId, undefined, 'A still has its own store');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('index authority: the caller\'s object cannot move an app between stores', async () => {
    const state = newDeviceState();
    try {
      const rig = accessOver(state);
      const { b } = await group(state, rig.access);
      const x = await installApp(rig.access, 'x', NOTES);
      write(state, 'x', 'from X');
      const spec = (app: InstalledApp) => ({ record: app.record, bundleSource: 'var __WHIM_APP_MODULE__ = 1;', prompt: 'a change' });

      const ungrouped: InstalledApp = { ...b };
      delete ungrouped.storageGroupId;
      const written1 = await rig.access.update(ungrouped, spec(b));
      h.eq([written1.storageGroupId, rig.index.get(b.id)?.storageGroupId], ['a', 'a'], 'a sharer\'s object with its group removed: the record keeps A\'s group');
      h.eq(readsOf(rig, state, b.id), GROUP_DATA, 'and B still reads the group\'s store');

      const written2 = await rig.access.update({ ...b, storageGroupId: 'x' }, spec(b));
      h.eq([written2.storageGroupId, rig.index.get(b.id)?.storageGroupId], ['a', 'a'], 'a sharer\'s object naming another app: the record keeps A\'s group');
      h.eq(readsOf(rig, state, b.id), GROUP_DATA, 'and B does not read X\'s store');

      const written3 = await rig.access.update({ ...x, storageGroupId: 'a' }, spec(x));
      h.eq([written3.storageGroupId, rig.index.get('x')?.storageGroupId], [undefined, undefined], 'an ungrouped app\'s object given a group: the record stays ungrouped');
      h.eq(readsOf(rig, state, 'x'), { notes: ['from X'], theme: undefined }, 'and X still reads its own store');
      h.eq(contentsOf(state, 'a'), GROUP_DATA, 'the group\'s store is untouched');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('index authority: going back, a tile change and delete-then-Undo leave a sharer\'s group and data alone', async () => {
    const state = newDeviceState();
    try {
      const rig = accessOver(state);
      const { b } = await group(state, rig.access);
      const first = await rig.access.activeId(b);
      await deliverResult({ access: rig.access, appId: b.id, editing: b, text: 'v2', wire: wire('B') });
      const unchanged = (step: string): void => {
        h.eq(rig.index.get(b.id)?.storageGroupId, 'a', `${step}: B's record still names A's group`);
        h.eq(readsOf(rig, state, b.id), GROUP_DATA, `${step}: B reads the same data`);
      };
      await rig.access.rollback(rig.index.get(b.id)!, first!);
      h.eq(await rig.access.activeId(b), first, 'precondition: B went back');
      unchanged('going back');
      rig.index.setTileOverride(b.id, { tint: 'violet', icon: 'music' });
      unchanged('a tile change');
      rig.index.clearTileOverride(b.id);
      unchanged('a tile reset');
      const deps = purgeDeps(state, rig);
      deps.purges.armApp(rig.index.get(b.id)!);
      deps.purges.cancel('app', b.id);
      await completeInterruptedPurges(purgeDeps(state, rig));
      unchanged('delete, then Undo, then a launch');
    } finally {
      disposeDeviceState(state);
    }
  });

  for (const founder of ['gone', 'present'] as const) {
    for (const where of ['at its tip', 'behind its tip'] as const) {
      await h.test(`index authority: a build that lands after its app was deleted writes nothing (${where}, founder ${founder})`, async () => {
        const state = newDeviceState();
        try {
          const rig = accessOver(state);
          const { a, b } = await group(state, rig.access);
          if (where === 'behind its tip') {
            const first = await rig.access.activeId(b);
            await deliverResult({ access: rig.access, appId: b.id, editing: b, text: 'v2', wire: wire('B') });
            await rig.access.rollback(b, first!);
          }
          const stale = rig.index.get(b.id)!;
          const c = await rig.access.fork(stale, undefined, { data: 'copy' });
          if (founder === 'gone') await deleteApp(state, rig, a);
          const groupSha = sha256(fileOf(state, 'a'));
          await deleteApp(state, rig, stale);
          h.eq(rig.index.get(b.id), null, 'precondition: B\'s delete completed');
          const ids = rig.index.list().map((e) => e.id);
          const before = await versionsOf(state, 'a');

          const relaunched = accessOver(state);
          const err = await rejection(deliverResult({ access: relaunched.access, appId: b.id, editing: stale, text: 'v3', wire: wire('B') }));
          h.ok(err instanceof AppGoneError, `the delivery is refused with AppGoneError (got ${String(err)})`);
          h.eq(relaunched.index.get(b.id), null, 'the index holds no entry for B');
          h.eq(relaunched.index.list().map((e) => e.id), ids, 'and no new entry was created');
          h.eq(await versionsOf(state, 'a'), before, 'the version store has no new version and no new lineage');
          h.eq(filesOf(state, b.id), [], 'no file exists under B\'s id');
          if (founder === 'gone') h.eq(filesOf(state, 'a'), [], 'nor under its former group\'s id, its last member gone');
          else h.eq(sha256(fileOf(state, 'a')), groupSha, 'the founder\'s group file is unchanged');
          h.eq(contentsOf(state, c.id), GROUP_DATA, 'the copy keeps its data');
        } finally {
          disposeDeviceState(state);
        }
      });
    }
  }

  await h.test('index authority: a copy is not made from an app the index no longer holds', async () => {
    for (const data of ['fresh', 'copy'] as const) {
      const state = newDeviceState();
      try {
        const rig = accessOver(state);
        const { b } = await group(state, rig.access);
        await deleteApp(state, rig, b);
        const dir = fs.readdirSync(state.dir).sort((x, y) => x.localeCompare(y));
        const journal = new DataCopyJournal(state.kv).list();
        const before = await versionsOf(state, 'a');
        const relaunched = accessOver(state);
        const err = await rejection(relaunched.access.fork(b, undefined, { data }));
        h.ok(err instanceof AppGoneError, `"${data}": the copy is refused with AppGoneError (got ${String(err)})`);
        h.eq(new DataCopyJournal(state.kv).list(), journal, `"${data}": the copy journal is unchanged`);
        h.eq(await versionsOf(state, 'a'), before, `"${data}": the version store's lineages are unchanged`);
        h.eq(fs.readdirSync(state.dir).sort((x, y) => x.localeCompare(y)), dir, `"${data}": the storage directory is unchanged`);
        h.eq(relaunched.index.list().map((e) => e.id), ['a'], `"${data}": no entry was written`);
      } finally {
        disposeDeviceState(state);
      }
    }
  });

  await h.test('index: a kill between the two writes of a new entry leaves no entry, and the sweep takes the copy\'s store', async () => {
    const state = newDeviceState();
    try {
      const setup = accessOver(state);
      const { b } = await group(state, setup.access);
      const dying = dyingKv(state.kv);
      const realDelete = fileDelete(state);
      const doomed = accessOver(state, {
        kv: dying.kv,
        deleteStorage: (appId) => {
          dying.check();
          return realDelete(appId);
        },
      });
      dying.arm();
      await rejection(doomed.access.fork(b, undefined, { data: 'copy' }));
      h.ok(dying.dead(), 'precondition: the process died on the entry\'s second write');
      const records = new DataCopyJournal(state.kv).list();
      h.eq(records.length, 1, 'precondition: the copy\'s journal record outlived the process');
      const copyId = records[0]?.copyAppId ?? '';
      h.ok(filesOf(state, copyId).length > 0, 'precondition: the copy\'s file outlived the process');

      const relaunched = accessOver(state);
      h.eq([relaunched.index.has(copyId), relaunched.index.get(copyId)], [false, null], 'a fresh launcher reports no entry for the copy');
      h.ok(!relaunched.index.list().some((e) => e.id === copyId), 'and the grid lists none');
      await relaunched.access.sweepDataCopies();
      h.eq(filesOf(state, copyId), [], 'the sweep deletes the copy\'s file');
      h.eq(new DataCopyJournal(state.kv).list(), [], 'and clears the journal');
      h.eq(readsOf(relaunched, state, b.id), GROUP_DATA, 'the group is whole');

      const index = new AppIndex(state.kv);
      index.put({ ...b, id: copyId, lineageId: 'fork-x' });
      h.eq(index.list().filter((e) => e.id === copyId).length, 1, 'an entry put under that id later is listed once');

      // A record an older build wrote without its order entry.
      state.kv.set('app:legacy', JSON.stringify({ ...b, id: 'legacy' }));
      h.ok(!index.list().some((e) => e.id === 'legacy'), 'precondition: a record missing from the order is not listed');
      index.put({ ...b, id: 'legacy' });
      h.eq(index.list().filter((e) => e.id === 'legacy').length, 1, 'putting it again lists it once');
      index.put({ ...b, id: 'legacy', name: 'renamed' });
      h.eq(index.list().filter((e) => e.id === 'legacy').map((e) => e.name), ['renamed'], 'and an update of a listed entry keeps it listed once');
    } finally {
      disposeDeviceState(state);
    }
  });

  // ── 1.4 the route: copy a member with "Copy the data", then delete it ────────────────────────

  await h.test('group route: copying a sharer, then deleting it, leaves the founder\'s store byte-identical and the copy on its own file', async () => {
    const state = newDeviceState();
    try {
      const rig = accessOver(state);
      const { a, b } = await group(state, rig.access);
      const groupSha = sha256(fileOf(state, 'a'));
      const c = await rig.access.fork(b, undefined, { data: 'copy' });
      h.eq(sha256(fileOf(state, 'a')), groupSha, 'the copy leaves the group\'s file byte-identical');
      h.eq([c.storageGroupId, rig.access.engineAppId(c)], [undefined, c.id], 'the copy has no group and its own store');
      h.eq(readsOf(rig, state, c.id), GROUP_DATA, 'and holds the group\'s data');
      await deleteApp(state, rig, rig.index.get(b.id)!);
      h.eq(rig.index.get(b.id), null, 'B is deleted');
      h.eq(sha256(fileOf(state, 'a')), groupSha, 'the delete leaves the group\'s file byte-identical');

      const after = await relaunchTwice(h, state);
      h.eq(sha256(fileOf(state, 'a')), groupSha, 'the launches leave the group\'s file byte-identical');
      h.eq(readsOf(after, state, c.id), GROUP_DATA, 'the copy keeps its data on its own file');
      write(state, after.access.engineAppId(a), 'A again');
      h.eq(readsOf(after, state, a.id).notes, [...GROUP_DATA.notes, 'A again'], 'A still reads and writes its store');
      h.eq(readsOf(after, state, c.id), GROUP_DATA, 'and A\'s write does not reach the copy');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('group route: copying the founder, then deleting it, leaves the sharer on the group\'s store and the copy on its own file', async () => {
    const state = newDeviceState();
    try {
      const rig = accessOver(state);
      const { a, b } = await group(state, rig.access);
      const groupSha = sha256(fileOf(state, 'a'));
      const c = await rig.access.fork(a, undefined, { data: 'copy' });
      h.eq(sha256(fileOf(state, 'a')), groupSha, 'the copy leaves the group\'s file byte-identical');
      h.eq(c.storageGroupId, undefined, 'the copy has no group');
      await deleteApp(state, rig, rig.index.get(a.id)!);
      h.eq(rig.index.get(a.id), null, 'A is deleted');
      h.eq(sha256(fileOf(state, 'a')), groupSha, 'the group\'s file stays for B, byte-identical');

      const after = await relaunchTwice(h, state);
      h.eq(sha256(fileOf(state, 'a')), groupSha, 'the launches leave it byte-identical');
      h.eq(after.index.get(b.id)?.storageGroupId, 'a', 'B still names the group');
      h.eq(readsOf(after, state, c.id), GROUP_DATA, 'the copy holds the group\'s data in its own file');
      write(state, after.access.engineAppId(after.index.get(b.id)!), 'B again');
      h.eq(readsOf(after, state, b.id).notes, [...GROUP_DATA.notes, 'B again'], 'B still reads and writes the group\'s file');
      h.eq(readsOf(after, state, c.id), GROUP_DATA, 'and B\'s write does not reach the copy');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('group route: copying the last member, then deleting it, drops the group\'s store and keeps the copy\'s data', async () => {
    const state = newDeviceState();
    try {
      const rig = accessOver(state);
      const { a, b } = await group(state, rig.access);
      await deleteApp(state, rig, a);
      h.eq(rig.index.list().map((e) => e.id), [b.id], 'precondition: B is the only member left');
      const groupSha = sha256(fileOf(state, 'a'));
      const c = await rig.access.fork(b, undefined, { data: 'copy' });
      h.eq(sha256(fileOf(state, 'a')), groupSha, 'the copy leaves the group\'s file byte-identical');
      await deleteApp(state, rig, rig.index.get(b.id)!);
      h.eq(filesOf(state, 'a'), [], 'the group\'s file is deleted with its last member');

      const after = await relaunchTwice(h, state);
      h.eq(after.index.list().map((e) => e.id), [c.id], 'only the copy is left');
      h.eq(readsOf(after, state, c.id), GROUP_DATA, 'and it opens with all of its data');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('group route: a kill between the copy and the delete leaves three whole apps, and a second launch changes nothing', async () => {
    const state = newDeviceState();
    try {
      const rig = accessOver(state);
      const { a, b } = await group(state, rig.access);
      const groupSha = sha256(fileOf(state, 'a'));
      const c = await rig.access.fork(b, undefined, { data: 'copy' });
      const records = rig.index.list();
      h.eq(sha256(fileOf(state, 'a')), groupSha, 'the copy leaves the group\'s file byte-identical');

      const after = await relaunchTwice(h, state);
      h.eq(after.index.list(), records, 'A, B and C are all present with the records they had');
      h.eq(sha256(fileOf(state, 'a')), groupSha, 'the group\'s file is byte-identical');
      h.eq([after.access.engineAppId(after.index.get(a.id)!), after.access.engineAppId(after.index.get(b.id)!)], ['a', 'a'], 'A and B still share one store');
      h.eq([readsOf(after, state, a.id), readsOf(after, state, b.id), readsOf(after, state, c.id)], [GROUP_DATA, GROUP_DATA, GROUP_DATA], 'all three read complete data');
      h.eq(new DataCopyJournal(state.kv).list(), [], 'the copy journal is empty');
    } finally {
      disposeDeviceState(state);
    }
  });

  for (const founder of ['present', 'gone'] as const) {
    for (const died of ['entry still indexed', 'entry already removed'] as const) {
      await h.test(`group route: a sharer's purge that died part-way keeps the group's store while a member remains, and drops it with the last one (${died}, founder ${founder})`, async () => {
        const state = newDeviceState();
        try {
          const rig = accessOver(state);
          const { a, b } = await group(state, rig.access);
          const groupSha = sha256(fileOf(state, 'a'));
          const c = await rig.access.fork(b, undefined, { data: 'copy' });
          h.eq(sha256(fileOf(state, 'a')), groupSha, 'the copy leaves the group\'s file byte-identical');
          if (founder === 'gone') await deleteApp(state, rig, a);
          // The death: the purge was armed, and the process stopped before or after dropping B's entry.
          new PendingPurgeStore(state.kv).armApp(rig.index.get(b.id)!);
          if (died === 'entry already removed') rig.index.remove(b.id);

          const after = await relaunchTwice(h, state);
          h.eq(after.index.get(b.id), null, 'the next launch finished deleting B');
          h.eq(new PendingPurgeStore(state.kv).list(), [], 'and cleared its marker');
          if (founder === 'present') {
            h.eq(sha256(fileOf(state, 'a')), groupSha, 'the group\'s file survives, byte-identical, while A resolves to it');
            h.eq(readsOf(after, state, a.id), GROUP_DATA, 'and A reads it');
          } else {
            h.eq(filesOf(state, 'a'), [], 'the group\'s file is deleted with its last member');
          }
          h.eq(readsOf(after, state, c.id), GROUP_DATA, 'the copy\'s data is unchanged');
        } finally {
          disposeDeviceState(state);
        }
      });
    }
  }

  // ── 1.5 the copy question is asked of the store a sharer resolves to ─────────────────────────

  await h.test('group route: a sharer with data in its group is asked the copy question', async () => {
    const state = newDeviceState();
    try {
      const rig = accessOver(state);
      const { b } = await group(state, rig.access);
      h.eq(filesOf(state, b.id), [], 'precondition: no file exists under B\'s own id');
      h.eq(contentsOf(state, 'a'), GROUP_DATA, 'precondition: the group\'s store holds a kv value and rows');
      h.eq(await rig.access.hasSavedData(rig.index.get(b.id)!), true, 'B is asked "Copy the data, or start fresh?"');
      h.eq(filesOf(state, b.id), [], 'and asking created no file under B\'s id');
    } finally {
      disposeDeviceState(state);
    }
  });
}
