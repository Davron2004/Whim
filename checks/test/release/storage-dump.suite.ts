/**
 * Acceptance for the storage upgrade evidence (upgrade-to-latest-dependencies 7.1/7.4):
 * `scripts/release/lib/storage-dump.ts` and the `storage-dump`/`storage-diff`/`storage-seed-check`
 * commands of `scripts/release/run.mjs`. Every store here is written by the real storage engine
 * over `node:sqlite` with the stub storage fixture's schemas, then changed behind the engine's back
 * the way a faulty upgrade could change it; the diff must name each change.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import nodeAssert from 'node:assert';
import { test } from '../harness';
import { diffFileListings, diffStorageDumps, dumpStorage, parseFileListing, storageSeedCheck, type StorageDump } from '../../../scripts/release/lib/storage-dump';
import { createEngine } from '../../../src/host/storage-engine/engine';
import { createNodeSqlExecutor } from '../../../src/host/storage-engine/bindings/node-sqlite';
import { FIELD_TYPES } from '../../../src/host/storage-engine/contract';
import type { AppliedSchema } from '../../../src/host/storage-engine/schema';
import { STORAGE_FIXTURE_SCHEMAS } from '../../../server/src/stub-storage-fixture';

const REPO_ROOT = process.cwd();
const scratchDirs: string[] = [];

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-storage-dump-suite-'));
  scratchDirs.push(dir);
  return dir;
}

/** A store as the engine writes it: v1's schema and rows, then v2 opened over it (burning f7)
 *  unless `burn` is false. */
function seedStore(file: string, burn = true): string {
  const engine = createEngine(createNodeSqlExecutor(file));
  engine.open(STORAGE_FIXTURE_SCHEMAS.v1);
  engine.records.append('Entries', { title: 'a', count: 9007199254740991, amount: 0.30000000000000004, done: true, when: 0, details: { k: [1, 'two'] }, legacy: 'kept' });
  engine.records.append('Entries', { title: 'b', count: -1, amount: 1e21, done: false, when: -1, details: null, legacy: null });
  engine.records.append('Tags', { label: 'x', weight: 1, pinned: true, added: 5 });
  engine.kv.set('profile', { name: 'Ada' });
  if (burn) engine.open(STORAGE_FIXTURE_SCHEMAS.v2);
  engine.close();
  return file;
}

/** Runs SQL on a store behind the engine's back. */
function mutate(file: string, sql: string, ...params: (string | number | null)[]): void {
  const db = new DatabaseSync(file);
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}

/** A seeded store and a copy of it, each in its own directory under the same file name. */
function seededPair(): { before: string; after: string } {
  const before = seedStore(path.join(scratch(), 'app-1.db'));
  const after = path.join(scratch(), 'app-1.db');
  fs.copyFileSync(before, after);
  return { before, after };
}

function diffAfter(sql: string, ...params: (string | number | null)[]): string[] {
  const { before, after } = seededPair();
  mutate(after, sql, ...params);
  return diffStorageDumps(dumpStorage(before), dumpStorage(after));
}

function appliedSchemaJson(file: string): AppliedSchema {
  const db = new DatabaseSync(file);
  try {
    return JSON.parse(String(db.prepare(`SELECT v FROM "_meta" WHERE k = 'applied_schema'`).get()?.v)) as AppliedSchema;
  } finally {
    db.close();
  }
}

function releaseCli(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/release/run.mjs'), ...args], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function assertLine(lines: string[], pattern: RegExp): void {
  nodeAssert.ok(lines.some((line) => pattern.test(line)), `no line matches ${pattern}: ${JSON.stringify(lines)}`);
}

export async function run(): Promise<void> {
  await test('storage-dump: a store dumps the same twice and from a copy elsewhere, and dumping changes nothing on disk', () => {
    const { before, after } = seededPair();
    const bytes = fs.readFileSync(before);
    const first = dumpStorage(before);
    nodeAssert.deepStrictEqual(dumpStorage(before), first);
    nodeAssert.deepStrictEqual(dumpStorage(after), first);
    nodeAssert.deepStrictEqual(diffStorageDumps(first, dumpStorage(path.dirname(after))), []);
    nodeAssert.ok(fs.readFileSync(before).equals(bytes), 'the dumped file is byte-for-byte unchanged');
    nodeAssert.deepStrictEqual(fs.readdirSync(path.dirname(before)), ['app-1.db']);
    const tables = first.databases['app-1.db'].tables;
    nodeAssert.deepStrictEqual(Object.keys(tables).sort((a, b) => a.localeCompare(b)), ['_meta', 'c1', 'c2', 'kv']);
    nodeAssert.strictEqual(tables.c1.rows.length, 2);
  });

  await test('storage-diff: a changed value is named with its row, column and both values', () => {
    assertLine(diffAfter(`UPDATE "c1" SET "f1" = 'A' WHERE id = 1`), /^app-1\.db table c1: row id=1 changed: f1 "a" -> "A"$/);
  });

  await test('storage-diff: a real one step off its double (0.30000000000000004 vs 0.3) is a difference', () => {
    assertLine(diffAfter(`UPDATE "c1" SET "f3" = 0.3 WHERE id = 1`), /row id=1 changed: f3 0\.30000000000000004 -> 0\.3$/);
  });

  await test('storage-diff: two integers past 2^53, the same JS number, are told apart', () => {
    const { before, after } = seededPair();
    mutate(before, `UPDATE "c1" SET "f2" = 9223372036854775807 WHERE id = 1`);
    mutate(after, `UPDATE "c1" SET "f2" = 9223372036854775806 WHERE id = 1`);
    assertLine(diffStorageDumps(dumpStorage(before), dumpStorage(after)), /row id=1 changed: f2 9223372036854775807 -> 9223372036854775806$/);
  });

  await test('storage-diff: a missing row is named', () => {
    assertLine(diffAfter(`DELETE FROM "c1" WHERE id = 2`), /^app-1\.db table c1: row missing after: id=2, f1="b", f2=-1, /);
  });

  await test('storage-diff: a dropped table is named', () => {
    assertLine(diffAfter(`DROP TABLE "c2"`), /^app-1\.db: table c2 missing after$/);
  });

  await test("storage-diff: a changed _meta applied schema is named (the burned f7 back among the active columns)", () => {
    const { before, after } = seededPair();
    const applied = appliedSchemaJson(after);
    const entries = applied.collections.find((c) => c.id === 'c1');
    nodeAssert.ok(entries !== undefined && entries.retired.some((c) => c.id === 'f7'), 'setup: the seeded _meta has f7 retired');
    entries.active.push(...entries.retired);
    entries.retired = [];
    mutate(after, `UPDATE "_meta" SET v = ? WHERE k = 'applied_schema'`, JSON.stringify(applied));
    assertLine(diffStorageDumps(dumpStorage(before), dumpStorage(after)), /^app-1\.db table _meta: row k="applied_schema" changed: v /);
  });

  await test('storage-diff: a database missing after, or one that appears, is named', () => {
    const dir = scratch();
    seedStore(path.join(dir, 'app-1.db'));
    seedStore(path.join(dir, 'app-2.db'));
    const both = dumpStorage(dir);
    fs.rmSync(path.join(dir, 'app-2.db'));
    const one = dumpStorage(dir);
    nodeAssert.deepStrictEqual(diffStorageDumps(both, one), ['app-2.db: database missing after']);
    nodeAssert.deepStrictEqual(diffStorageDumps(one, both), ['app-2.db: database added after (not in the before dump)']);
  });

  await test('storage-diff: a journal file left beside a database is named', () => {
    const { before, after } = seededPair();
    fs.writeFileSync(`${after}-journal`, '');
    assertLine(diffStorageDumps(dumpStorage(before), dumpStorage(after)), /^app-1\.db: sidecar files \[\] -> \["-journal 0 bytes"\]$/);
  });

  await test('storage-diff: a changed journal_mode, page_size or auto_vacuum is named although every row is the same', () => {
    const cases: [string, string, RegExp][] = [
      ['PRAGMA journal_mode = WAL', 'journal_mode', /^app-1\.db: journal_mode "delete" -> "wal"$/],
      ['PRAGMA page_size = 8192; VACUUM', 'page_size', /^app-1\.db: page_size 4096 -> 8192$/],
      ['PRAGMA auto_vacuum = FULL; VACUUM', 'auto_vacuum', /^app-1\.db: auto_vacuum 0 -> 1$/],
    ];
    for (const [sql, name, line] of cases) {
      const { before, after } = seededPair();
      const db = new DatabaseSync(after);
      try {
        db.exec(sql);
      } finally {
        db.close();
      }
      const lines = diffStorageDumps(dumpStorage(before), dumpStorage(after));
      nodeAssert.deepStrictEqual(lines.length, 1, `${name}: ${JSON.stringify(lines)}`);
      assertLine(lines, line);
    }
  });

  await test('storage-dump: a file that is not a SQLite database fails, naming the file', () => {
    const file = path.join(scratch(), 'broken.db');
    fs.writeFileSync(file, 'not a database, just text that is long enough to have a header');
    nodeAssert.throws(() => dumpStorage(file), (err: Error) => err.message.startsWith(`${file}: `));
  });

  await test('storage-seed-check: the burned seed passes; v1 alone fails naming the missing burned id', () => {
    const dir = scratch();
    const burned = storageSeedCheck(dumpStorage(seedStore(path.join(dir, 'burned.db'))));
    nodeAssert.deepStrictEqual(burned, { seeds: ['burned.db'], gaps: [] });
    const unburned = storageSeedCheck(dumpStorage(seedStore(path.join(dir, 'v1.db'), false)));
    nodeAssert.deepStrictEqual(unburned, { seeds: [], gaps: ['v1.db: no burned (retired) field id in _meta'] });
  });

  await test("storage-seed-check: a store missing any one of the engine's field types fails, naming the type", () => {
    const file = seedStore(path.join(scratch(), 'app-1.db'));
    const dump = dumpStorage(file);
    for (const type of FIELD_TYPES) {
      const applied = appliedSchemaJson(file);
      for (const c of applied.collections) {
        c.active = c.active.filter((col) => col.type !== type);
        c.retired = c.retired.filter((col) => col.type !== type);
      }
      const changed = JSON.parse(JSON.stringify(dump)) as StorageDump;
      const meta = changed.databases['app-1.db'].tables._meta;
      meta.rows = meta.rows.map((row) => (row[0][1] === 'applied_schema' ? [row[0], ['text', JSON.stringify(applied)]] : row));
      const { seeds, gaps } = storageSeedCheck(changed);
      nodeAssert.deepStrictEqual(seeds, [], `without ${type}`);
      assertLine(gaps, new RegExp(`no column of type ${type} holding a value$`));
    }
  });

  await test('storage-seed-check: a column of a field type that holds only NULLs does not count for that type', () => {
    const file = seedStore(path.join(scratch(), 'app-1.db'));
    nodeAssert.deepStrictEqual(storageSeedCheck(dumpStorage(file)).gaps, [], 'setup: the seeded store passes');
    mutate(file, `UPDATE "c1" SET "f6" = NULL`);
    const { seeds, gaps } = storageSeedCheck(dumpStorage(file));
    nodeAssert.deepStrictEqual(seeds, []);
    nodeAssert.deepStrictEqual(gaps, ['app-1.db: no column of type json holding a value']);
  });

  await test('storage-seed-check: a burned column with no data left, or only one collection with rows, fails', () => {
    const { before, after } = seededPair();
    mutate(before, `UPDATE "c1" SET "f7" = NULL`);
    nodeAssert.deepStrictEqual(storageSeedCheck(dumpStorage(before)).gaps, ['app-1.db: no retired column holds data (c1.f7)']);
    mutate(after, `DELETE FROM "c2"`);
    nodeAssert.deepStrictEqual(storageSeedCheck(dumpStorage(after)).gaps, ['app-1.db: 1 collection(s) with rows, expected at least 2']);
  });

  await test('storage CLI: identical dumps pass, a changed store fails naming the change, the seed check reports, bad usage exits 2', () => {
    const { before, after } = seededPair();
    const dir = scratch();
    const [a, b, c] = ['a.json', 'b.json', 'c.json'].map((name) => path.join(dir, name));
    nodeAssert.strictEqual(releaseCli(['storage-dump', before, '--out', a]).status, 0);
    nodeAssert.strictEqual(releaseCli(['storage-dump', path.dirname(after), '--out', b]).status, 0);
    const pass = releaseCli(['storage-diff', a, b]);
    nodeAssert.strictEqual(pass.status, 0, pass.stdout + pass.stderr);
    nodeAssert.match(pass.stdout, /^storage-diff: PASS: 1 database\(s\), 5 rows,/m);

    mutate(after, `DELETE FROM "c2"`);
    nodeAssert.strictEqual(releaseCli(['storage-dump', after, '--out', c]).status, 0);
    const fail = releaseCli(['storage-diff', a, c]);
    nodeAssert.strictEqual(fail.status, 1, fail.stdout + fail.stderr);
    nodeAssert.match(fail.stdout, /^app-1\.db table c2: row missing after: id=1, /m);
    nodeAssert.match(fail.stdout, /^storage-diff: FAIL \(1 difference\)$/m);

    nodeAssert.match(releaseCli(['storage-seed-check', a]).stdout, /^storage-seed-check: PASS: app-1\.db /m);
    const gaps = releaseCli(['storage-seed-check', c]);
    nodeAssert.strictEqual(gaps.status, 1, gaps.stdout + gaps.stderr);
    nodeAssert.match(gaps.stdout, /^app-1\.db: 1 collection\(s\) with rows, expected at least 2$/m);

    nodeAssert.strictEqual(releaseCli(['storage-diff', a]).status, 2);
    nodeAssert.strictEqual(releaseCli(['storage-dump']).status, 2);
    const notADump = releaseCli(['storage-diff', a, before]);
    nodeAssert.strictEqual(notADump.status, 1, notADump.stdout + notADump.stderr);
  });

  await test('storage-files-diff: a database that moved, a new one, or a lost sidecar is named; the same listing passes', () => {
    const before = parseFileListing('./databases/storage/app-1.db\n./databases/storage/app-1.db-journal\n./databases/whim.launcher.db\n');
    nodeAssert.deepStrictEqual(diffFileListings(before, parseFileListing('databases/whim.launcher.db\ndatabases/storage/app-1.db-journal\ndatabases/storage/app-1.db\n')), []);
    const moved = parseFileListing('./databases/storage/app-1.db-journal\n./databases/whim.launcher.db\n./files/storage/app-1.db\n');
    nodeAssert.deepStrictEqual(diffFileListings(before, moved), [
      'databases/storage/app-1.db: file missing after',
      'files/storage/app-1.db: file added after (not in the before listing)',
    ]);
    assertLine(diffFileListings(before, [...before, 'databases/other.db']), /^databases\/other\.db: file added after /);
    nodeAssert.strictEqual(diffFileListings([], []).length, 1, 'an empty before listing is not a pass');
  });

  await test('storage CLI: storage-files-diff passes on equal listings, exits 1 naming a moved file, 2 on bad usage', () => {
    const dir = scratch();
    const [a, b, c] = ['a.txt', 'b.txt', 'c.txt'].map((name) => path.join(dir, name));
    fs.writeFileSync(a, './databases/storage/app-1.db\n./databases/storage/app-1.db-wal\n');
    fs.writeFileSync(b, './databases/storage/app-1.db-wal\n./databases/storage/app-1.db\n');
    fs.writeFileSync(c, './databases/storage/app-1.db-wal\n./files/app-1.db\n');
    const pass = releaseCli(['storage-files-diff', a, b]);
    nodeAssert.strictEqual(pass.status, 0, pass.stdout + pass.stderr);
    nodeAssert.match(pass.stdout, /^storage-files-diff: PASS: the same 2 file\(s\)/m);
    const fail = releaseCli(['storage-files-diff', a, c]);
    nodeAssert.strictEqual(fail.status, 1, fail.stdout + fail.stderr);
    nodeAssert.match(fail.stdout, /^databases\/storage\/app-1\.db: file missing after$/m);
    nodeAssert.match(fail.stdout, /^files\/app-1\.db: file added after /m);
    nodeAssert.match(fail.stdout, /^storage-files-diff: FAIL \(2 differences\)$/m);
    nodeAssert.strictEqual(releaseCli(['storage-files-diff', a]).status, 2);
    nodeAssert.strictEqual(releaseCli(['storage-files-diff', a, path.join(dir, 'missing.txt')]).status, 1);
  });

  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
}
