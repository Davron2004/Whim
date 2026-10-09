/**
 * "Copy the data" across a process death (copy-app-data tasks 2.1/2.4; app-data-copy "A copy is
 * all-or-nothing across crashes"), over real files, a real version store and the real Node copy.
 *
 * A death is modelled as the process stopping: from the moment it dies, every persisted effect —
 * a launcher-KV write, a store delete, a copy — throws without happening, so no cleanup the dying
 * process attempts can reach disk. What it left behind is then relaunched (a new `StoreAccess`
 * over the same KV, version store and directory) and swept, as `LauncherRoot` does at launch.
 * A further case SIGKILLs a real child process in the middle of writing a copy.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

import { Harness } from './harness';
import type { KVBackend } from '../../version-store';
import { AppIndex, type InstalledApp } from '../app-index';
import { DataCopyJournal, sweepDataCopies } from '../data-copy-journal';
import { copyStore, type CopyOpener } from '../../storage-engine/copy';
import { createNodeCopyOpener, createNodeCopyStorage } from '../../storage-engine/copy-node';
import { createNodeSqlExecutor } from '../../storage-engine/bindings/node-sqlite';
import { DataCopyError, type CopyStorage } from '../../storage-engine/copy-contract';
import type { SchemaArtifact } from '../../storage-engine/contract';
import {
  accessOver, disposeDeviceState, fileDelete, fileOf, filesOf, installApp, newDeviceState, sha256, sizeOf, withEngine, withTimeout,
  type DeviceState,
} from './data-copy-rig';

const NOTES: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'text' } } } },
};

/** The original's data: records with ids 3, 7 and 12, and a kv value. */
function seedOriginal(state: DeviceState, appId: string): void {
  withEngine(state, appId, NOTES, (engine) => {
    for (let i = 1; i <= 12; i++) engine.records.append('Notes', { body: `note ${i}` });
    for (let i = 1; i <= 12; i++) if (![3, 7, 12].includes(i)) engine.records.remove('Notes', i);
    engine.kv.set('theme', 'dark');
  });
}

/** What a store holds, read through the engine: record ids with bodies, and the kv value. */
function contentsOf(state: DeviceState, appId: string): { notes: [number, unknown][]; theme: unknown } {
  return withEngine(state, appId, NOTES, (engine) => ({
    notes: engine.records.list('Notes').map((r): [number, unknown] => [r.id, r.body]),
    theme: engine.kv.get('theme'),
  }));
}

const ORIGINAL_CONTENTS = { notes: [[3, 'note 3'], [7, 'note 7'], [12, 'note 12']], theme: 'dark' };

class ProcessDied extends Error {
  constructor() {
    super('the process died');
  }
}

/** The dying process: once `die()` runs, every persisted effect throws without happening. */
class Mortal {
  dead = false;
  die(): never {
    this.dead = true;
    throw new ProcessDied();
  }
  check(): void {
    if (this.dead) throw new ProcessDied();
  }
}

/** The launcher KV as the dying process sees it. `beforeWrite` runs before each write lands. */
function mortalKv(kv: KVBackend, mortal: Mortal, beforeWrite: () => void = () => {}): KVBackend {
  return {
    getString: (key) => {
      mortal.check();
      return kv.getString(key);
    },
    getAllKeys: () => {
      mortal.check();
      return kv.getAllKeys();
    },
    set: (key, value) => {
      mortal.check();
      beforeWrite();
      kv.set(key, value);
    },
    delete: (key) => {
      mortal.check();
      beforeWrite();
      kv.delete(key);
    },
  };
}

type CrashPoint =
  | 'journal written'
  | 'stray guard done'
  | 'copy file partial'
  | 'copy file complete, unverified'
  | 'copy file verified'
  | 'entry written';

const CRASH_POINTS: CrashPoint[] = [
  'journal written',
  'stray guard done',
  'copy file partial',
  'copy file complete, unverified',
  'copy file verified',
  'entry written',
];

/** The id the next copy of `app` takes in its repo: the copy's entry, once it exists. */
function copyEntryOf(index: AppIndex, original: InstalledApp): InstalledApp | undefined {
  return index.list().find((a) => a.id !== original.id);
}

export async function runDataCopyCrashTests(h: Harness): Promise<void> {
  // ── 2.1 the journal and its sweep, on their own ────────────────────────────────────────────────

  await h.test('data-copy journal: records persist across instances on one backend, and clear one at a time', () => {
    const state = newDeviceState();
    try {
      const first = new DataCopyJournal(state.kv);
      first.put({ copyAppId: 'a__fork-1', sourceAppId: 'a', startedAt: 10 });
      first.put({ copyAppId: 'b__fork-2', sourceAppId: 'b', startedAt: 20 });
      const relaunched = new DataCopyJournal(state.kv);
      h.eq(relaunched.list().sort((x, y) => x.startedAt - y.startedAt), [
        { copyAppId: 'a__fork-1', sourceAppId: 'a', startedAt: 10 },
        { copyAppId: 'b__fork-2', sourceAppId: 'b', startedAt: 20 },
      ], 'a new journal over the same backend lists both records');
      relaunched.clear('a__fork-1');
      h.eq(new DataCopyJournal(state.kv).list().map((e) => e.copyAppId), ['b__fork-2'], 'clearing one leaves the other');
      relaunched.clear('nothing-here');
      h.eq(new DataCopyJournal(state.kv).list().length, 1, 'clearing an id with no record changes nothing');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('data-copy journal: an unreadable record still lists by its id, so the sweep can delete its store', async () => {
    const state = newDeviceState();
    try {
      const journal = new DataCopyJournal(state.kv);
      journal.put({ copyAppId: 'x__fork-1', sourceAppId: 'x', startedAt: 1 });
      const key = state.kv.getAllKeys().find((k) => state.kv.getString(k)?.includes('x__fork-1'));
      h.ok(key != null, 'precondition: the record is in the launcher KV');
      state.kv.set(key!, '{not json');
      fs.writeFileSync(fileOf(state, 'x__fork-1'), 'half a store');
      await sweepDataCopies({ journal, index: new AppIndex(state.kv), deleteStorage: fileDelete(state) });
      h.eq(filesOf(state, 'x__fork-1'), [], 'the half-written store is gone');
      h.eq(journal.list(), [], 'and the record is cleared');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('data-copy sweep: never deletes the store of an id an entry is or resolves to', async () => {
    const state = newDeviceState();
    try {
      const { access, index, journal } = accessOver(state);
      const app = await installApp(access, 'wc', NOTES);
      seedOriginal(state, 'wc');
      // A legacy shared copy whose founder is gone: no entry IS 'wc', but one resolves to it.
      index.put({ ...app, id: 'wc__fork-9', storeId: 'wc', lineageId: 'fork-9', storageGroupId: 'wc' });
      index.remove('wc');
      const before = sha256(fileOf(state, 'wc'));
      journal.put({ copyAppId: 'wc', sourceAppId: 'other', startedAt: 1 });
      fs.writeFileSync(fileOf(state, 'own__fork-1'), 'the copy that committed');
      index.put({ ...app, id: 'own__fork-1', storeId: 'own', lineageId: 'fork-1' });
      journal.put({ copyAppId: 'own__fork-1', sourceAppId: 'own', startedAt: 2 });
      await accessOver(state).access.sweepDataCopies();
      h.eq(sha256(fileOf(state, 'wc')), before, 'the group store a sharer resolves to is untouched');
      h.eq(fs.readFileSync(fileOf(state, 'own__fork-1'), 'utf8'), 'the copy that committed', 'the store of an indexed id is untouched');
      h.eq(journal.list(), [], 'both records are cleared');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('data-copy sweep: a delete that fails keeps its record for the next launch, and the others still settle', async () => {
    const state = newDeviceState();
    try {
      const journal = new DataCopyJournal(state.kv);
      const index = new AppIndex(state.kv);
      fs.writeFileSync(fileOf(state, 'a__fork-1'), 'partial');
      fs.writeFileSync(fileOf(state, 'b__fork-1'), 'partial');
      journal.put({ copyAppId: 'a__fork-1', sourceAppId: 'a', startedAt: 1 });
      journal.put({ copyAppId: 'b__fork-1', sourceAppId: 'b', startedAt: 2 });
      const real = fileDelete(state);
      await sweepDataCopies({
        journal,
        index,
        deleteStorage: (id) => {
          if (id === 'a__fork-1') throw new Error('disk busy');
          return real(id);
        },
      });
      h.eq(journal.list().map((e) => e.copyAppId), ['a__fork-1'], 'the failed one keeps its record; the other is settled');
      h.eq([filesOf(state, 'a__fork-1').length, filesOf(state, 'b__fork-1').length], [1, 0], 'only the settled one is deleted');
      await sweepDataCopies({ journal, index, deleteStorage: real });
      h.eq([journal.list(), filesOf(state, 'a__fork-1')], [[], []], 'the next launch finishes it');
    } finally {
      disposeDeviceState(state);
    }
  });

  // ── 2.4 a death at every step boundary ─────────────────────────────────────────────────────────

  for (const point of CRASH_POINTS) {
    await h.test(`data-copy crash: dying at "${point}" leaves no copy or a complete one, and a retry succeeds`, async () => {
      const state = newDeviceState();
      try {
        const setup = accessOver(state);
        const original = await installApp(setup.access, 'wc', NOTES);
        seedOriginal(state, 'wc');
        const originalSha = sha256(fileOf(state, 'wc'));

        const mortal = new Mortal();
        const evidence: string[] = [];
        const index = new AppIndex(state.kv);
        const kv = mortalKv(state.kv, mortal, () => {
          if (point === 'entry written' && copyEntryOf(index, original)) {
            evidence.push('entry present at death');
            mortal.die();
          }
        });
        const realDelete = fileDelete(state);
        const deletedIds: string[] = [];
        const deleteStorage = (appId: string) => {
          mortal.check();
          if (point === 'journal written') {
            if (new DataCopyJournal(state.kv).list().some((e) => e.copyAppId === appId)) evidence.push('journal present at death');
            mortal.die();
          }
          realDelete(appId);
          deletedIds.push(appId);
        };
        const realOpener = createNodeCopyOpener(state.dir);
        const copyStorage: CopyStorage = async (args) => {
          mortal.check();
          if (point === 'stray guard done') {
            if (deletedIds.includes(args.to)) evidence.push('stray guard ran before death');
            mortal.die();
          }
          if (point === 'copy file partial') {
            const bytes = fs.readFileSync(fileOf(state, args.from));
            fs.writeFileSync(fileOf(state, args.to), bytes.subarray(0, Math.floor(bytes.length / 2)));
            evidence.push('partial file written');
            mortal.die();
          }
          if (point === 'copy file complete, unverified') {
            const opener: CopyOpener = {
              open: (appId) => {
                if (appId === args.to) {
                  if (sizeOf(fileOf(state, appId)) > 0) evidence.push('written, unverified file at death');
                  mortal.die();
                }
                return realOpener.open(appId);
              },
              remove: (appId) => {
                mortal.check();
                realOpener.remove(appId);
              },
            };
            return copyStore(opener, args);
          }
          const report = await createNodeCopyStorage(state.dir)(args);
          if (point === 'copy file verified') {
            if (report.bytes > 0 && fs.existsSync(fileOf(state, args.to))) evidence.push('verified copy at death');
            mortal.die();
          }
          return report;
        };
        const dying = accessOver(state, { kv, deleteStorage, copyStorage });
        let settled: string;
        try {
          await withTimeout(dying.access.fork(original, undefined, { data: 'copy' }), 10_000, 'the dying copy');
          settled = 'resolved';
        } catch (e) {
          settled = e instanceof ProcessDied || (e instanceof DataCopyError && e.cause instanceof ProcessDied) ? 'died' : `threw ${String(e)}`;
        }
        h.ok(mortal.dead, `${point}: the process died at that step`);
        h.ok(settled === 'died' || (point === 'entry written' && settled === 'resolved'), `${point}: the copy did not fail any other way (${settled})`);
        h.eq(evidence.length, 1, `${point}: the death landed at the boundary it names (${evidence.join('; ')})`);

        const copyId = `wc__fork-1`;
        const leftBehind = { file: filesOf(state, copyId).length > 0, entry: new AppIndex(state.kv).has(copyId), journal: new DataCopyJournal(state.kv).list().length };
        h.eq(leftBehind.journal, 1, `${point}: the death left the journal record`);

        // Relaunch: a new launcher over what survived, swept the way LauncherRoot sweeps at launch.
        const relaunch = accessOver(state);
        await relaunch.access.sweepDataCopies();
        h.eq(relaunch.journal.list(), [], `${point}: after the sweep the journal is empty`);
        if (point === 'entry written') {
          h.ok(leftBehind.entry && leftBehind.file, 'entry written: the death left the entry and its file');
          h.ok(relaunch.index.has(copyId), 'entry written: the copy is still there after the sweep');
          h.eq(contentsOf(state, copyId), ORIGINAL_CONTENTS, 'entry written: with all of its data');
        } else {
          h.eq(relaunch.index.list().map((a) => a.id), ['wc'], `${point}: no copy appears`);
          h.eq(filesOf(state, copyId), [], `${point}: and no file of it remains`);
        }
        h.eq(sha256(fileOf(state, 'wc')), originalSha, `${point}: the original's file is byte-identical`);

        const retried = await relaunch.access.fork(original, undefined, { data: 'copy' });
        h.eq(contentsOf(state, retried.id), ORIGINAL_CONTENTS, `${point}: making a copy again succeeds, with the original's data`);
        h.eq(relaunch.journal.list(), [], `${point}: and settles its own record`);
        h.eq(sha256(fileOf(state, 'wc')), originalSha, `${point}: the original's file is still byte-identical`);
      } finally {
        disposeDeviceState(state);
      }
    });
  }

  await h.test('data-copy crash: a real copy SIGKILLed mid-write is swept away at relaunch, and a retry succeeds', async () => {
    const state = newDeviceState();
    const childDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-copy-child-'));
    try {
      const { access, index, journal } = accessOver(state);
      const original = await installApp(access, 'big', NOTES);
      withEngine(state, 'big', NOTES, (engine) => engine.records.append('Notes', { body: 'first' }));
      const raw = createNodeSqlExecutor(fileOf(state, 'big'));
      try {
        const chunk = 'x'.repeat(1024 * 1024);
        raw.transaction(() => {
          for (let i = 0; i < 96; i++) raw.execute('INSERT INTO c1 (f1) VALUES (?)', [chunk]);
        });
      } finally {
        raw.close();
      }
      const sourceSize = sizeOf(fileOf(state, 'big'));
      const sourceSha = sha256(fileOf(state, 'big'));
      const copyId = 'big__fork-1';
      // What `fork({ data: 'copy' })` writes before the first byte of the copy.
      journal.put({ copyAppId: copyId, sourceAppId: 'big', startedAt: 1 });

      const child = path.join(childDir, 'copy-child.mjs');
      await build({ entryPoints: [path.resolve(process.cwd(), 'src/host/launcher/test/copy-child.ts')], outfile: child, bundle: true, platform: 'node', format: 'esm', target: 'node20', logLevel: 'warning' });
      const proc = spawn(process.execPath, [child, state.dir, 'big', copyId], { stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      const exited = new Promise<NodeJS.Signals | null>((resolve) => proc.on('exit', (_code, signal) => resolve(signal)));
      const target = fileOf(state, copyId);
      const deadline = Date.now() + 20_000;
      let sizeAtKill = -1;
      while (Date.now() < deadline) {
        const size = fs.existsSync(target) ? sizeOf(target) : 0;
        if (size > 0) {
          proc.kill('SIGKILL');
          sizeAtKill = size;
          break;
        }
      }
      if (sizeAtKill < 0) proc.kill('SIGKILL');
      const signal = await withTimeout(exited, 10_000, 'the killed child');
      h.eq(signal, 'SIGKILL', 'the child was killed, not finished');
      h.ok(!stdout.includes('done'), 'the copy had not finished when it was killed');
      h.ok(sizeAtKill > 0 && sizeAtKill < sourceSize, `the kill landed mid-write (${sizeAtKill} of ${sourceSize} bytes)`);
      h.ok(filesOf(state, copyId).length > 0, 'the killed copy left a partial file behind');

      const relaunch = accessOver(state);
      await relaunch.access.sweepDataCopies();
      h.eq(filesOf(state, copyId), [], 'the sweep deletes the partial file and its sidecars');
      h.eq(relaunch.journal.list(), [], 'and clears the record');
      h.eq(index.has(copyId), false, 'no entry ever pointed at it');
      h.eq(sha256(fileOf(state, 'big')), sourceSha, "the original's file is byte-identical");

      const retried = await relaunch.access.fork(original, undefined, { data: 'copy' });
      h.eq(retried.id, copyId, 'the retry reuses the swept id');
      const rows = withEngine(state, copyId, NOTES, (engine) => engine.records.list('Notes').length);
      h.eq(rows, 97, 'and holds every record of the original');
    } finally {
      fs.rmSync(childDir, { recursive: true, force: true });
      disposeDeviceState(state);
    }
  });

  // ── stray files and the no-seam refusal ────────────────────────────────────────────────────────

  for (const data of ['fresh', 'copy'] as const) {
    await h.test(`data-copy: a stray file under the copy's id never reaches a "${data}" copy`, async () => {
      const state = newDeviceState();
      try {
        const { access } = accessOver(state);
        const original = await installApp(access, 'wc', NOTES);
        seedOriginal(state, 'wc');
        withEngine(state, 'stray', NOTES, (engine) => engine.records.append('Notes', { body: 'not yours' }));
        fs.renameSync(fileOf(state, 'stray'), fileOf(state, 'wc__fork-1'));
        const made = await access.fork(original, undefined, { data });
        h.eq(made.id, 'wc__fork-1', 'precondition: the copy takes the id the stray file sits under');
        const want = data === 'copy' ? ORIGINAL_CONTENTS : { notes: [], theme: undefined };
        h.eq(contentsOf(state, made.id), want, `the "${data}" copy holds ${data === 'copy' ? "only the original's data" : 'nothing'}`);
      } finally {
        disposeDeviceState(state);
      }
    });
  }

  for (const data of ['fresh', 'copy'] as const) {
    await h.test(`data-copy: a "${data}" copy onto an id an entry already uses is refused; that entry and its store are untouched`, async () => {
      const state = newDeviceState();
      try {
        const { access, index, journal } = accessOver(state);
        const original = await installApp(access, 'wc', NOTES);
        seedOriginal(state, 'wc');
        // An entry squatting on the id the next copy takes (a broken invariant).
        index.put({ ...original, id: 'wc__fork-1', name: 'squatter' });
        withEngine(state, 'wc__fork-1', NOTES, (engine) => engine.records.append('Notes', { body: 'squatter data' }));
        const before = sha256(fileOf(state, 'wc__fork-1'));
        await h.throws(() => access.fork(original, undefined, { data }), 'already uses', 'the copy is refused');
        h.eq(index.get('wc__fork-1')?.name, 'squatter', 'the squatting entry is unchanged');
        h.eq(sha256(fileOf(state, 'wc__fork-1')), before, 'and so is its store');
        h.eq(journal.list(), [], 'nothing is left recorded');
      } finally {
        disposeDeviceState(state);
      }
    });
  }

  await h.test('data-copy: "copy" without the seam rejects before any write, and canCopyData is false', async () => {
    const state = newDeviceState();
    try {
      const { access, index } = accessOver(state, { copyStorage: null });
      const original = await installApp(access, 'wc', NOTES);
      seedOriginal(state, 'wc');
      h.eq(access.canCopyData, false, 'an instance without the seam cannot copy data');
      h.eq(accessOver(state).access.canCopyData, true, 'and one with it can');
      const files = fs.readdirSync(state.dir).sort((x, y) => x.localeCompare(y));
      const lineages = await state.store.lineages('wc');
      await h.throws(() => access.fork(original, undefined, { data: 'copy' }), 'no data copy', 'the copy request rejects');
      h.eq(index.list().map((a) => a.id), ['wc'], 'no entry was written');
      h.eq(await state.store.lineages('wc'), lineages, 'no lineage was forked');
      h.eq(fs.readdirSync(state.dir).sort((x, y) => x.localeCompare(y)), files, 'the storage directory is unchanged');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('data-copy: a failed copy writes no entry, leaves no file or record, and rejects with its kind', async () => {
    const state = newDeviceState();
    try {
      const { access, index, journal } = accessOver(state, {
        // A copy that ran out of room part-way and could not delete what it wrote.
        copyStorage: async (args) => {
          fs.writeFileSync(fileOf(state, args.to), 'part of a store');
          throw new DataCopyError('no_space', 'database or disk is full');
        },
      });
      const original = await installApp(access, 'wc', NOTES);
      seedOriginal(state, 'wc');
      let kind: string | undefined;
      try {
        await access.fork(original, undefined, { data: 'copy' });
      } catch (e) {
        kind = e instanceof DataCopyError ? e.kind : `not a DataCopyError: ${String(e)}`;
      }
      h.eq(kind, 'no_space', 'the rejection carries the copy failure kind');
      h.eq([index.list().map((a) => a.id), filesOf(state, 'wc__fork-1'), journal.list()], [['wc'], [], []], 'no entry, no file, no record');
    } finally {
      disposeDeviceState(state);
    }
  });

  await h.test('data-copy: a sweep while a copy runs in this process leaves that copy alone', async () => {
    const state = newDeviceState();
    try {
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      let written!: () => void;
      const fileWritten = new Promise<void>((resolve) => { written = resolve; });
      const real = createNodeCopyStorage(state.dir);
      const { access, journal } = accessOver(state, {
        copyStorage: async (args) => {
          const report = await real(args);
          written();
          await held;
          return report;
        },
      });
      const original = await installApp(access, 'wc', NOTES);
      seedOriginal(state, 'wc');
      const copying = access.fork(original, undefined, { data: 'copy' });
      await withTimeout(fileWritten, 10_000, 'the copy writing its file');
      await access.sweepDataCopies();
      h.eq(journal.list().map((e) => e.copyAppId), ['wc__fork-1'], 'the running copy keeps its record');
      release();
      const made = await withTimeout(copying, 10_000, 'the held copy');
      h.eq(contentsOf(state, made.id), ORIGINAL_CONTENTS, 'and commits with all of its data');
      h.eq(journal.list(), [], 'then settles its own record');
    } finally {
      disposeDeviceState(state);
    }
  });
}
