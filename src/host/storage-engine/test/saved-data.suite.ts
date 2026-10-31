/**
 * "Does this app's store hold any user data?" (copy-app-data task 3.0, rulings 3 and 40 revised)
 * against real node:sqlite files written through the real engine: kv alone counts, a collection
 * row alone counts, an emptied store and a never-opened app do not, the read never changes or
 * deletes a store, and a store it left table-less (connecting creates a missing file, as op-sqlite's
 * `open` does) is then opened by the engine exactly like a missing one. Run from `acceptance.ts`.
 */

import nodeAssert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';

import { createEngine } from '../engine';
import { createNodeSqlExecutor, readAppliedSchemaFromFile } from '../bindings/node-sqlite';
import { SchemaArtifact, StorageEngine } from '../contract';
import { storeFileName } from '../copy';
import { inspectStore, readSavedData } from '../saved-data';
import { SqlExecutor } from '../sql-executor';
import { createNodeHasSavedData } from '../saved-data-node';
import type { CopySuiteHelpers } from './copy.suite';

const notes: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Notes: { id: 'c1', tombstones: [], fields: { title: { id: 'f1', type: 'text' } } } },
};

export function runSavedDataTests(root: string, h: CopySuiteHelpers): void {
  const { fail } = h;
  // Each check asserts through node:assert in this file. A failed assertion is recorded through
  // `fail`, not thrown, so one run reports every failure; a passing check is forwarded to the shared
  // harness, which keeps the pass count.
  const ok = (passedCheck: boolean, msg: string): void => {
    try {
      nodeAssert.ok(passedCheck, msg);
    } catch (err) {
      if (!(err instanceof nodeAssert.AssertionError)) throw err;
      fail(msg);
      return;
    }
    h.ok(passedCheck, msg);
  };
  const eq = (a: unknown, b: unknown, msg: string): void => {
    try {
      nodeAssert.deepStrictEqual(a, b, msg);
    } catch (err) {
      if (!(err instanceof nodeAssert.AssertionError)) throw err;
      fail(`${msg} (got ${inspect(a, { depth: 6 })}, want ${inspect(b, { depth: 6 })})`);
      return;
    }
    h.eq(a, b, msg);
  };
  let n = 0;
  const freshDir = (): string => {
    const dir = path.join(root, `saved-data-${++n}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };
  const fileIn = (dir: string, appId: string): string => path.join(dir, storeFileName(appId));
  const sha256 = (file: string): string => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

  /** Run `body` on the real engine over `<dir>/<appId>.db`, then close it. */
  function withEngine(dir: string, appId: string, body: (store: StorageEngine) => void): void {
    const store = createEngine(createNodeSqlExecutor(fileIn(dir, appId)));
    try {
      body(store);
    } finally {
      store.close();
    }
  }

  /** The tables a store file holds, sqlite's own excluded. */
  function tablesOf(file: string): string[] {
    const sql = createNodeSqlExecutor(file);
    try {
      return inspectTables(sql);
    } finally {
      sql.close();
    }
  }
  const inspectTables = (sql: SqlExecutor): string[] =>
    sql
      .execute(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .rows.map(r => String(r.name))
      .filter(name => !name.startsWith('sqlite_'))
      .sort((a, b) => a.localeCompare(b));

  function test(name: string, fn: () => void): void {
    try {
      fn();
      console.log('• ' + name);
    } catch (err) {
      fail(`${name}: threw ${(err as Error).message}`);
      console.error(`  ✗ ${name} THREW: ${(err as Error).stack}`);
    }
  }

  test('§I hasSavedData: a store with only a kv value counts as saved', () => {
    const dir = freshDir();
    withEngine(dir, 'kv-only', store => store.kv.set('theme', 'dark'));
    ok(createNodeHasSavedData(dir)('kv-only'), 'kv alone is saved data');
  });

  test('§I hasSavedData: a store with only a collection row counts as saved', () => {
    const dir = freshDir();
    withEngine(dir, 'rows-only', store => {
      store.open(notes);
      store.records.append('Notes', { title: 'a' });
    });
    ok(createNodeHasSavedData(dir)('rows-only'), 'one collection row is saved data');
  });

  test('§I hasSavedData: a never-opened store is not saved; the table-less file the read leaves is then opened by the engine like a missing one', () => {
    const dir = freshDir();
    eq(createNodeHasSavedData(dir)('never-ran'), false, 'a store nothing ever wrote holds nothing');
    eq(tablesOf(fileIn(dir, 'never-ran')), [], 'the read created the file, as op-sqlite does, and wrote no table into it');
    eq(createNodeHasSavedData(dir)('never-ran'), false, 'reading it again still says nothing is saved');

    withEngine(dir, 'never-ran', store => {
      store.open(notes);
      store.records.append('Notes', { title: 'first run' });
    });
    eq(tablesOf(fileIn(dir, 'never-ran')), ['_meta', 'c1', 'kv'], 'the first run made the engine tables and the collection');
    eq(readAppliedSchemaFromFile(fileIn(dir, 'never-ran')).collections.map(c => c.id), ['c1'], 'and recorded the applied schema in _meta');
    ok(createNodeHasSavedData(dir)('never-ran'), 'what the run saved is found');
  });

  test('§I hasSavedData: a store whose data was all deleted, or that only has a schema, is not saved', () => {
    const dir = freshDir();
    withEngine(dir, 'emptied', store => {
      store.open(notes);
      const { id } = store.records.append('Notes', { title: 'gone' });
      store.kv.set('k', 'v');
      ok(createNodeHasSavedData(dir)('emptied'), 'precondition: it holds data while the rows are there');
      store.records.remove('Notes', id);
      store.kv.remove('k');
    });
    eq(createNodeHasSavedData(dir)('emptied'), false, 'with every row and kv value deleted it holds nothing');
    withEngine(dir, 'schema-only', store => store.open(notes));
    eq(createNodeHasSavedData(dir)('schema-only'), false, 'an applied schema with no rows holds nothing');
    ok(fs.existsSync(fileIn(dir, 'schema-only')), 'and its file is kept');
  });

  test('§I hasSavedData: a zero-byte file is not saved, stays zero bytes, and gets no sidecar', () => {
    const dir = freshDir();
    fs.writeFileSync(fileIn(dir, 'zero'), '');
    eq(createNodeHasSavedData(dir)('zero'), false, 'an empty file holds nothing');
    eq(fs.readdirSync(dir), [storeFileName('zero')], 'the file is still there and no sidecar or other file appears');
    eq(fs.readFileSync(fileIn(dir, 'zero')).length, 0, 'and nothing was written into it');
  });

  test('§I hasSavedData: reading never changes a store, and each id answers for its own file', () => {
    const dir = freshDir();
    withEngine(dir, 'a', store => store.kv.set('k', 1));
    withEngine(dir, 'b', store => store.open(notes));
    const before = [sha256(fileIn(dir, 'a')), sha256(fileIn(dir, 'b'))];
    const read = createNodeHasSavedData(dir);
    ok(read('a') && !read('b'), 'each id answers for its own file');
    eq([sha256(fileIn(dir, 'a')), sha256(fileIn(dir, 'b'))], before, 'both store files are byte-identical after the read');
    eq(fs.readdirSync(dir).sort(), [storeFileName('a'), storeFileName('b')], 'no sidecar was left');
  });

  test('§I inspectStore: a table-less db and one with only empty tables hold nothing, a row is data, ignoring _meta and quoted names', () => {
    const sql = createNodeSqlExecutor(':memory:');
    eq(inspectStore(sql), 'empty', 'no table at all');
    sql.execute('CREATE TABLE "_meta" (k TEXT PRIMARY KEY, v TEXT)');
    sql.execute(`INSERT INTO "_meta" (k, v) VALUES ('applied_schema', '{}')`);
    eq(inspectStore(sql), 'empty', 'a _meta row is bookkeeping, not user data');
    sql.execute('CREATE TABLE "odd""name" (id INTEGER PRIMARY KEY)');
    eq(inspectStore(sql), 'empty', 'a table whose name holds a quote is read without error');
    sql.execute('INSERT INTO "odd""name" (id) VALUES (1)');
    eq(inspectStore(sql), 'data', 'a row in it is user data');
    sql.close();
  });

  /** A real connection to `file` that counts how often it is closed. */
  function counting(file: string): { sql: SqlExecutor; closed: () => number } {
    const real = createNodeSqlExecutor(file);
    let closed = 0;
    const sql: SqlExecutor = {
      ...real,
      close: () => {
        closed++;
        real.close();
      },
    };
    return { sql, closed: () => closed };
  }

  test('§I readSavedData: closes the connection after a read, and after a read that throws, which it rethrows without removing the file', () => {
    const dir = freshDir();
    withEngine(dir, 'full', store => store.kv.set('k', 1));
    const full = counting(fileIn(dir, 'full'));
    eq([readSavedData(full.sql), full.closed()], [true, 1], 'a store with data reads true and its connection is closed');

    fs.writeFileSync(fileIn(dir, 'junk'), 'this is not a database file, only text');
    const junk = counting(fileIn(dir, 'junk'));
    let thrown = false;
    try {
      readSavedData(junk.sql);
    } catch {
      thrown = true;
    }
    ok(thrown, 'an unreadable store rejects the read');
    eq(junk.closed(), 1, 'the connection was closed');
    eq(fs.readFileSync(fileIn(dir, 'junk'), 'utf8'), 'this is not a database file, only text', 'the unreadable file is still there, unchanged, for the copy to report');
  });
}
