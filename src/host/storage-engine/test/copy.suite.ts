/**
 * The data copy (copy-app-data, task 1.4) against real node:sqlite files: fidelity, a consistent
 * snapshot beside a writer, refusal to overwrite, every failure kind leaving no file behind and
 * the source byte-identical, independent schema evolution afterwards, and the one-module rule for
 * the snapshot statement. Run from `acceptance.ts`.
 */

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createEngine } from '../engine';
import { createNodeSqlExecutor, readAppliedSchemaFromFile } from '../bindings/node-sqlite';
import { RecordingExecutor, SqlExecutor } from '../sql-executor';
import { SchemaArtifact, StorageEngine, StorageEngineError } from '../contract';
import { AppliedSchema, burnedIdFloor } from '../schema';
import { CopyOpener, copyStore, storeFileName } from '../copy';
import { createNodeCopyOpener, createNodeCopyStorage } from '../copy-node';
import { DataCopyError, DataCopyErrorKind, isSupersetSchema } from '../copy-contract';
import { BUSY_TIMEOUT_MS } from '../busy-timeout';

export interface CopySuiteHelpers {
  ok(cond: boolean, msg: string): void;
  eq(a: unknown, b: unknown, msg: string): void;
  fail(msg: string): void;
}

// v1 → v2: `tag` (f5) is tombstoned with data in it; `mood` (f6) and `rating` (f7) are added. The
// accumulated union for c1 is f1–f7 with f5 retired, so its burned-ID floor is 7.
const notesV1: SchemaArtifact = {
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
    People: { id: 'c2', tombstones: [], fields: { name: { id: 'f1', type: 'text' } } },
  },
};

const notesV2: SchemaArtifact = {
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
    People: { id: 'c2', tombstones: [], fields: { name: { id: 'f1', type: 'text' } } },
  },
};

function withField(base: SchemaArtifact, name: string, field: { id: string; type: 'text' | 'int'; default: string | number }): SchemaArtifact {
  const notes = base.collections.Notes;
  return {
    ...base,
    collections: { ...base.collections, Notes: { ...notes, fields: { ...notes.fields, [name]: field } } },
  };
}

function engineOver(file: string): { store: StorageEngine; rec: RecordingExecutor } {
  const rec = new RecordingExecutor(createNodeSqlExecutor(file));
  return { store: createEngine(rec), rec };
}

/** A source store written through the real engine: Notes records with ids 3, 7 and 12 (the rest
 *  removed), data in the column that is later retired, kv values, and a second collection. */
function seedSource(dir: string, appId: string): void {
  const { store } = engineOver(path.join(dir, storeFileName(appId)));
  store.open(notesV1);
  for (let i = 1; i <= 12; i++) {
    store.records.append('Notes', { title: `note ${i}`, body: `body ${i}`, pinned: i % 2 === 0, score: i * 10, tag: `tag-${i}` });
  }
  for (let i = 1; i <= 12; i++) if (![3, 7, 12].includes(i)) store.records.remove('Notes', i);
  store.records.append('People', { name: 'Ada' });
  store.open(notesV2);
  store.records.update('Notes', 7, { mood: 'great', rating: 4.5 });
  store.kv.set('theme', 'dark');
  store.kv.set('counter', 42);
  store.kv.set('prefs', { sizes: [1, 2, 3], on: true });
  store.close();
}

const sha256 = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function rows(sql: SqlExecutor, statement: string): Record<string, unknown>[] {
  return sql.execute(statement).rows.map(r => ({ ...r }));
}

/** Every schema object and every row of every table, read straight off the file. */
function dump(file: string): { objects: Record<string, unknown>[]; tables: Record<string, Record<string, unknown>[]> } {
  const sql = createNodeSqlExecutor(file);
  try {
    const objects = rows(sql, `SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name`);
    const tables: Record<string, Record<string, unknown>[]> = {};
    for (const o of objects) {
      if (o.type === 'table') tables[String(o.name)] = rows(sql, `SELECT rowid AS _rowid, * FROM "${String(o.name)}" ORDER BY rowid`);
    }
    return { objects, tables };
  } finally {
    sql.close();
  }
}

/** One query on its own short-lived connection. */
function query(file: string, statement: string): Record<string, unknown>[] {
  const sql = createNodeSqlExecutor(file);
  try {
    return rows(sql, statement);
  } finally {
    sql.close();
  }
}

function columnsOf(file: string, table: string): string[] {
  return query(file, `PRAGMA table_info("${table}")`).map(r => String(r.name));
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`did not settle within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runCopyTests(root: string, h: CopySuiteHelpers): Promise<void> {
  const { ok, eq, fail } = h;
  let n = 0;
  /** A fresh storage directory per test, so no test sees another's files. */
  const freshDir = (): string => {
    const dir = path.join(root, `copy-${++n}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const fileIn = (dir: string, appId: string): string => path.join(dir, storeFileName(appId));

  async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await withTimeout(fn(), 30_000);
      console.log('• ' + name);
    } catch (err) {
      fail(`${name}: threw ${(err as Error).message}`);
      console.error(`  ✗ ${name} THREW: ${(err as Error).stack}`);
    }
  }

  async function expectCopyError(kind: DataCopyErrorKind, p: Promise<unknown>, what: string): Promise<void> {
    try {
      await p;
    } catch (err) {
      ok(err instanceof DataCopyError, `${what}: rejects with a DataCopyError (got ${String(err)})`);
      if (err instanceof DataCopyError) eq(err.kind, kind, `${what}: the error kind`);
      return;
    }
    fail(`${what}: expected a "${kind}" rejection, but the copy resolved`);
  }

  /** The directory holds exactly `names` (sorted) — nothing the copy wrote is left over. */
  const filesAre = (dir: string, names: string[], msg: string): void => eq(fs.readdirSync(dir).sort(), [...names].sort(), msg);

  // ── fidelity ──────────────────────────────────────────────────────────────

  await test('§H copy: every table, row id, retired column, kv value and _meta arrives unchanged', async () => {
    const dir = freshDir();
    seedSource(dir, 'notes');
    const src = fileIn(dir, 'notes');
    const before = sha256(src);

    const report = await createNodeCopyStorage(dir)({ from: 'notes', to: 'notes__fork-1' });
    const dst = fileIn(dir, 'notes__fork-1');

    eq(dump(dst), dump(src), 'the copy holds the same schema objects and the same rows (rowids included) in every table');
    eq(query(dst, 'SELECT id FROM "c1" ORDER BY id').map(r => r.id), [3, 7, 12], 'the record ids 3, 7 and 12 survive');
    const retired = query(dst, 'SELECT id, "f5" FROM "c1" ORDER BY id');
    eq(retired, [{ id: 3, f5: 'tag-3' }, { id: 7, f5: 'tag-7' }, { id: 12, f5: 'tag-12' }], 'the retired column f5 is present with its data');
    eq(readAppliedSchemaFromFile(dst), readAppliedSchemaFromFile(src), 'the accumulated _meta schema equals the source');
    ok(readAppliedSchemaFromFile(dst).collections.some(c => c.retired.some(col => col.id === 'f5')), 'the copied _meta still lists f5 as retired');
    eq(report.bytes, fs.readFileSync(dst).length, 'the report gives the size of the copy on disk');
    ok(report.ms >= 0, 'the report gives a duration');
    eq(sha256(src), before, 'the source file is byte-identical after the copy');

    const { store, rec } = engineOver(dst);
    const mark = rec.mark();
    store.open(notesV2);
    eq(rec.log.slice(mark).filter(e => /^\s*(CREATE|ALTER)/i.test(e.sql)).length, 0, 'the copy opens with the source\'s artifact with zero DDL');
    eq(store.records.list('Notes').map(r => [r.id, r.title, r.mood]), [[3, 'note 3', 'ok'], [7, 'note 7', 'great'], [12, 'note 12', 'ok']], 'the engine reads the copied records by their ids');
    eq([store.kv.get('theme'), store.kv.get('counter'), store.kv.get('prefs')], ['dark', 42, { sizes: [1, 2, 3], on: true }], 'every kv value reads back');
    store.close();
  });

  await test('§H copy: a snapshot is one committed state while another connection is writing', async () => {
    const dir = freshDir();
    seedSource(dir, 'live');
    const src = fileIn(dir, 'live');
    const writer = new DatabaseSync(src);
    writer.exec(`INSERT INTO "c1" ("f1") VALUES ('committed before')`);
    writer.exec('BEGIN IMMEDIATE');
    writer.exec(`INSERT INTO "c1" ("f1") VALUES ('in flight')`);
    writer.exec(`UPDATE "c1" SET "f1" = 'changed in flight' WHERE id = 3`);

    await createNodeCopyStorage(dir)({ from: 'live', to: 'live__fork-1' });
    writer.exec('COMMIT');
    writer.close();

    const copied = query(fileIn(dir, 'live__fork-1'), 'SELECT "f1" FROM "c1" ORDER BY id').map(r => r.f1);
    eq(copied, ['note 3', 'note 7', 'note 12', 'committed before'], 'the copy holds the committed write and none of the uncommitted ones');
    const source = query(src, 'SELECT "f1" FROM "c1" ORDER BY id').map(r => r.f1);
    eq(source, ['changed in flight', 'note 7', 'note 12', 'committed before', 'in flight'], 'the writer\'s transaction still committed to the source');
  });

  await test('§H copy: a live-engine write that meets the snapshot\'s lock waits for it and succeeds', async () => {
    const dir = freshDir();
    seedSource(dir, 'busy');
    const src = fileIn(dir, 'busy');
    const { store } = engineOver(src);
    store.open(notesV2);

    // The snapshot holds a read transaction on the source for its whole run. Another PROCESS holds
    // one here (this thread cannot hold the lock and also be the blocked writer), released after
    // HOLD_MS, so the write below meets the lock deterministically and must outlast it.
    const HOLD_MS = 400;
    const holder = spawn(
      process.execPath,
      [
        '-e',
        `const { DatabaseSync } = require('node:sqlite');
         const db = new DatabaseSync(process.argv[1]);
         db.exec('BEGIN'); db.prepare('SELECT count(*) FROM "c1"').all();
         process.stdout.write('held\\n');
         setTimeout(() => { db.exec('COMMIT'); db.close(); }, ${HOLD_MS});`,
        src,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const exited = new Promise<number | null>(resolve => holder.once('exit', code => resolve(code)));
    try {
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          holder.stdout.once('data', () => resolve());
          holder.once('error', reject);
          holder.once('exit', () => reject(new Error('the lock holder exited before it held the lock')));
        }),
        10_000,
      );

      const started = Date.now();
      let thrown: unknown;
      try {
        store.records.append('Notes', { title: 'written during the snapshot' });
      } catch (err) {
        thrown = err;
      }
      const waited = Date.now() - started;
      ok(thrown === undefined, `live write during a snapshot: the write that met the lock did not throw (got ${String(thrown)})`);
      ok(waited >= HOLD_MS / 2, `live write during a snapshot: the write waited for the lock instead of slipping past it (${waited} ms)`);
      ok(waited < BUSY_TIMEOUT_MS, `live write during a snapshot: the write finished inside the busy timeout (${waited} ms)`);
      eq(await withTimeout(exited, 10_000), 0, 'live write during a snapshot: the lock holder released the lock and exited cleanly');
      eq(store.records.list('Notes').some(r => r.title === 'written during the snapshot'), true, 'live write during a snapshot: the write is in the store');
    } finally {
      holder.kill();
      store.close();
    }
  });

  // ── refusal ───────────────────────────────────────────────────────────────

  await test('§H copy: a target that already holds a store is refused and left untouched', async () => {
    const dir = freshDir();
    seedSource(dir, 'orig');
    seedSource(dir, 'taken');
    const { store } = engineOver(fileIn(dir, 'taken'));
    store.open(notesV2);
    store.kv.set('theme', 'only in the existing target');
    store.close();
    const target = fileIn(dir, 'taken');
    const targetBefore = sha256(target);
    const srcBefore = sha256(fileIn(dir, 'orig'));

    await expectCopyError('io', createNodeCopyStorage(dir)({ from: 'orig', to: 'taken' }), 'copying onto an existing store');
    ok(fs.existsSync(target), 'the existing target file is still there');
    eq(sha256(target), targetBefore, 'the existing target file is byte-identical');
    eq(sha256(fileIn(dir, 'orig')), srcBefore, 'the source is byte-identical');
  });

  await test('§H copy: a target id that could name another directory is refused before anything is opened', async () => {
    const dir = freshDir();
    seedSource(dir, 'orig');
    for (const to of ['../escape', 'a/b', '..', '']) {
      await expectCopyError('io', createNodeCopyStorage(dir)({ from: 'orig', to }), `target "${to}"`);
    }
    filesAre(dir, ['orig.db'], 'no file was written anywhere in the storage directory');
    ok(!fs.existsSync(path.join(root, 'escape.db')), 'nothing was written outside it');
  });

  // ── failures ──────────────────────────────────────────────────────────────

  /** The node opener with the source connection's snapshot replaced: it writes `partial` bytes to
   *  the target (a half-written file) and then throws `err`. */
  function failingSnapshot(dir: string, err: unknown): CopyOpener {
    const base = createNodeCopyOpener(dir);
    return {
      ...base,
      open(appId) {
        const conn = base.open(appId);
        return {
          ...conn,
          runAsync: async (_statement, params) => {
            fs.writeFileSync(String(params[0]), Buffer.alloc(4096, 7));
            throw err;
          },
        };
      },
    };
  }

  const sqliteError = (message: string, errcode: number): Error => Object.assign(new Error(message), { code: 'ERR_SQLITE_ERROR', errcode, errstr: message });

  await test('§H copy: running out of space is no_space, and the half-written file is deleted', async () => {
    // node:sqlite's shape for SQLITE_FULL (code 13), and op-sqlite's, which carries only the message
    // (`opsqlite_execute`: "[op-sqlite] statement execution error: " + sqlite3_errmsg).
    const shapes: [string, unknown][] = [
      ['node:sqlite', sqliteError('database or disk is full', 13)],
      ['op-sqlite', new Error('[op-sqlite] statement execution error: database or disk is full')],
    ];
    for (const [binding, err] of shapes) {
      const dir = freshDir();
      seedSource(dir, 'full');
      const before = sha256(fileIn(dir, 'full'));
      await expectCopyError('no_space', copyStore(failingSnapshot(dir, err), { from: 'full', to: 'full__fork-1' }), `SQLITE_FULL from ${binding}`);
      filesAre(dir, ['full.db'], `${binding}: no copy file remains`);
      eq(sha256(fileIn(dir, 'full')), before, `${binding}: the source is byte-identical`);
    }
  });

  await test('§H copy: an I/O failure mid-snapshot is io, and the half-written file is deleted', async () => {
    const dir = freshDir();
    seedSource(dir, 'midway');
    const before = sha256(fileIn(dir, 'midway'));
    await expectCopyError('io', copyStore(failingSnapshot(dir, sqliteError('disk I/O error', 10)), { from: 'midway', to: 'midway__fork-1' }), 'a disk I/O error');
    filesAre(dir, ['midway.db'], 'no copy file remains');
    eq(sha256(fileIn(dir, 'midway')), before, 'the source is byte-identical');
  });

  await test('§H copy: a missing source is source_unreadable and gains no file', async () => {
    const dir = freshDir();
    await expectCopyError('source_unreadable', createNodeCopyStorage(dir)({ from: 'ghost', to: 'ghost__fork-1' }), 'a source that does not exist');
    filesAre(dir, [], 'neither a source nor a copy file was created');
  });

  await test('§H copy: a source that is not a database is source_unreadable and stays as it was', async () => {
    const dir = freshDir();
    const src = fileIn(dir, 'garbled');
    fs.writeFileSync(src, Buffer.from('this is not an SQLite database, just bytes '.repeat(200)));
    const before = sha256(src);
    await expectCopyError('source_unreadable', createNodeCopyStorage(dir)({ from: 'garbled', to: 'garbled__fork-1' }), 'a garbled source');
    filesAre(dir, ['garbled.db'], 'no copy file remains');
    eq(sha256(src), before, 'the source is byte-identical');
  });

  /** The node opener, except that opening the copy first passes its file through `tamper`. */
  function tamperingOpener(dir: string, to: string, tamper: (file: string) => void): CopyOpener {
    const base = createNodeCopyOpener(dir);
    return {
      ...base,
      open(appId) {
        if (appId === to) tamper(fileIn(dir, appId));
        return base.open(appId);
      },
    };
  }

  await test('§H copy: a copy that fails its integrity check is verify_failed and deleted', async () => {
    const dir = freshDir();
    seedSource(dir, 'src');
    const before = sha256(fileIn(dir, 'src'));
    // Point the header's freelist at a live page (trunk page 2, one page long): every table still
    // reads back whole, and the integrity check reports the damage as a row instead of throwing,
    // so only that check can catch it.
    const corrupt = (file: string): void => {
      const bytes = fs.readFileSync(file);
      bytes.writeUInt32BE(2, 32);
      bytes.writeUInt32BE(1, 36);
      fs.writeFileSync(file, bytes);
      eq(burnedIdFloor(readAppliedSchemaFromFile(file)), { c1: 7, c2: 1 }, 'sanity: the damaged copy\'s _meta still reads back whole');
    };
    await expectCopyError('verify_failed', copyStore(tamperingOpener(dir, 'src__fork-1', corrupt), { from: 'src', to: 'src__fork-1' }), 'a corrupted copy');
    filesAre(dir, ['src.db'], 'the corrupt copy was deleted');
    eq(sha256(fileIn(dir, 'src')), before, 'the source is byte-identical');
  });

  await test('§H copy: a copy whose _meta lost the retired fields is verify_failed and deleted', async () => {
    const dir = freshDir();
    seedSource(dir, 'src');
    // The copy's _meta rewritten to the last-applied artifact's view: the retired f5 is dropped.
    const lastAppliedOnly = (file: string): void => {
      const db = new DatabaseSync(file);
      const applied = JSON.parse(String((db.prepare(`SELECT v FROM "_meta" WHERE k = 'applied_schema'`).get() as { v: string }).v)) as AppliedSchema;
      for (const c of applied.collections) c.retired = [];
      db.prepare(`UPDATE "_meta" SET v = ? WHERE k = 'applied_schema'`).run(JSON.stringify(applied));
      db.close();
    };
    await expectCopyError('verify_failed', copyStore(tamperingOpener(dir, 'src__fork-1', lastAppliedOnly), { from: 'src', to: 'src__fork-1' }), 'a copy missing the retired identities');
    filesAre(dir, ['src.db'], 'the copy was deleted');
  });

  await test('§H isSupersetSchema: identities must all be present with their types; active or retired does not matter', async () => {
    const source: AppliedSchema = { collections: [{ id: 'c1', active: [{ id: 'f1', type: 'text' }], retired: [{ id: 'f2', type: 'int' }] }] };
    ok(isSupersetSchema(source, source), 'a schema contains itself');
    ok(isSupersetSchema({ collections: [{ id: 'c1', active: [{ id: 'f1', type: 'text' }, { id: 'f3', type: 'bool' }], retired: [{ id: 'f2', type: 'int' }] }, { id: 'c2', active: [], retired: [] }] }, source), 'a grown union contains the source');
    ok(isSupersetSchema({ collections: [{ id: 'c1', active: [], retired: [{ id: 'f1', type: 'text' }, { id: 'f2', type: 'int' }] }] }, source), 'a column retired since still counts');
    ok(!isSupersetSchema({ collections: [{ id: 'c1', active: [{ id: 'f1', type: 'text' }], retired: [] }] }, source), 'a missing retired column fails');
    ok(!isSupersetSchema({ collections: [{ id: 'c1', active: [{ id: 'f1', type: 'text' }], retired: [{ id: 'f2', type: 'text' }] }] }, source), 'a column with another type fails');
    ok(!isSupersetSchema({ collections: [] }, source), 'a missing collection fails');
  });

  // ── evolution after the copy ──────────────────────────────────────────────

  await test('§H copy: the original and the copy evolve independently and never reuse a pre-copy identity', async () => {
    const dir = freshDir();
    seedSource(dir, 'A');
    const a = fileIn(dir, 'A');
    const c = fileIn(dir, 'A__fork-1');
    const floorAtCopy = burnedIdFloor(readAppliedSchemaFromFile(a));
    await createNodeCopyStorage(dir)({ from: 'A', to: 'A__fork-1' });
    eq(floorAtCopy, { c1: 7, c2: 1 }, 'sanity: the source union reaches ordinal 7 in Notes');
    eq(burnedIdFloor(readAppliedSchemaFromFile(c)), floorAtCopy, 'the copy\'s burned-ID floor starts at the source\'s floor');

    const storeA = engineOver(a).store;
    const storeC = engineOver(c).store;
    storeA.open(withField(notesV2, 'archived', { id: 'f8', type: 'text', default: '' }));
    storeC.open(withField(notesV2, 'votes', { id: 'f9', type: 'int', default: 0 }));
    ok(columnsOf(a, 'c1').includes('f8') && !columnsOf(a, 'c1').includes('f9'), 'A has its own new column and none for C\'s');
    ok(columnsOf(c, 'c1').includes('f9') && !columnsOf(c, 'c1').includes('f8'), 'C has its own new column and none for A\'s');
    eq(storeA.records.list('Notes').map(r => r.id), [3, 7, 12], 'A reads its pre-copy records');
    eq(storeC.records.list('Notes').map(r => r.id), [3, 7, 12], 'C reads its pre-copy records');

    // f5 as a new int field (and no longer listed as a tombstone, so the artifact itself is valid).
    const reusesF5 = withField(notesV2, 'reused', { id: 'f5', type: 'int', default: 0 });
    reusesF5.collections.Notes = { ...reusesF5.collections.Notes, tombstones: [] };
    for (const [name, store] of [['A', storeA], ['C', storeC]] as const) {
      try {
        store.open(reusesF5);
        fail(`${name}: reusing the retired f5 for a new field was accepted`);
      } catch (err) {
        ok(err instanceof StorageEngineError && err.detail.kind === 'tombstone_violation', `${name}: reusing the retired f5 is a tombstone_violation (got ${String(err)})`);
      }
    }

    storeA.records.append('Notes', { title: 'only in A' });
    storeC.records.remove('Notes', 3);
    eq(storeA.records.list('Notes').map(r => r.id), [3, 7, 12, 13], 'A keeps the record C deleted and has its own new one');
    eq(storeC.records.list('Notes').map(r => r.id), [7, 12], 'C does not see A\'s new record');
    storeA.close();
    storeC.close();
  });

  await test('§H copy: a copy opened by older code runs no DDL and keeps every field of the union', async () => {
    const dir = freshDir();
    seedSource(dir, 'A');
    await createNodeCopyStorage(dir)({ from: 'A', to: 'A__fork-1' });
    const c = fileIn(dir, 'A__fork-1');
    const { store, rec } = engineOver(c);
    const mark = rec.mark();
    store.open(notesV1);
    eq(rec.log.slice(mark).filter(e => /^\s*(CREATE|ALTER)/i.test(e.sql)).length, 0, 'opening the copy with the older artifact runs zero DDL');
    eq(store.records.list('Notes').map(r => r.tag), ['tag-3', 'tag-7', 'tag-12'], 'the older code reads the data the copy carried in f5');
    store.close();
    const floor = burnedIdFloor(readAppliedSchemaFromFile(c));
    eq(floor, { c1: 7, c2: 1 }, 'the copy\'s floor is still the source\'s floor at copy time');
  });

  // ── the one-module rule ───────────────────────────────────────────────────

  await test('§H the snapshot statement appears only in storage-engine/copy.ts', async () => {
    const srcRoot = path.resolve(process.cwd(), 'src');
    const token = new RegExp(`\\b${['VAC', 'UUM'].join('')}\\b`, 'i');
    const hits: string[] = [];
    const walk = (d: string): void => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'generated' && entry.name !== 'node_modules') walk(full);
        } else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && token.test(fs.readFileSync(full, 'utf8'))) {
          hits.push(path.relative(srcRoot, full));
        }
      }
    };
    walk(srcRoot);
    eq(hits, [path.join('host', 'storage-engine', 'copy.ts')], 'the token occurs in copy.ts and in no other source file');
  });
}
