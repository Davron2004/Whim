/**
 * Node acceptance for the storage engine core (Decision #40, D7 fast checkpoint; D5a/D8).
 * Real SQLite via node:sqlite behind a RecordingExecutor, so every check can assert WHAT
 * SQL actually ran. Green here is NOT the pass — the device probe (task 7) is — it is the
 * correctness gate the engine clears first, and the gate CI runs on every push.
 *
 * Sections:
 *   §A  mini-app-storage spec scenarios (isolation, verbs, filters, KV cap, ephemeral)
 *   §B  storage-schema-evolution spec scenarios (rename, conflicts, tombstone, rollback, DDL)
 *   §C  ★ INJECTION INVARIANT BLOCK ★ — a never-regress security invariant (§16.4), the
 *       reason the whole suite is a per-push CI gate. Owned like sandbox containment, not a
 *       feature test: caller text is bound or rejected, never interpolated.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createEngine } from '../engine';
import { createNodeSqlExecutor } from '../bindings/node-sqlite';
import { RecordingExecutor } from '../sql-executor';
import { SchemaArtifact, StorageEngine, StorageEngineError, StorageErrorKind } from '../contract';

// ── tiny harness ─────────────────────────────────────────────────────────────

let passed = 0;
const failures: string[] = [];

function ok(cond: boolean, msg: string): void {
  if (cond) passed++;
  else {
    failures.push(msg);
    console.error('  ✗ ' + msg);
  }
}
function eq(a: unknown, b: unknown, msg: string): void {
  ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
}
function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log('• ' + name);
  } catch (err) {
    failures.push(`${name}: threw ${(err as Error).message}`);
    console.error(`  ✗ ${name} THREW: ${(err as Error).stack}`);
  }
}
function expectError(kind: StorageErrorKind, fn: () => void): StorageEngineError {
  try {
    fn();
  } catch (err) {
    if (err instanceof StorageEngineError) {
      ok(err.detail.kind === kind, `expected error kind "${kind}", got "${err.detail.kind}" (${err.detail.hint})`);
      ok(typeof err.detail.hint === 'string' && err.detail.hint.length > 0, `error "${kind}" must carry a hint`);
      return err;
    }
    throw err;
  }
  failures.push(`expected a "${kind}" StorageEngineError, but nothing threw`);
  throw new Error('did not throw');
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-storage-'));
const dbPath = (name: string) => path.join(TMP, `${name}.db`);

function engineAt(file: string, kvSizeCapBytes?: number): { store: StorageEngine; rec: RecordingExecutor } {
  const rec = new RecordingExecutor(createNodeSqlExecutor(file));
  return { store: createEngine(rec, { kvSizeCapBytes }), rec };
}
function memEngine(kvSizeCapBytes?: number): { store: StorageEngine; rec: RecordingExecutor } {
  return engineAt(':memory:', kvSizeCapBytes);
}

// Expenses v1: amount(int)/note(text)/spentAt(date). v2 renames note→memo (same id f2).
const expensesV1: SchemaArtifact = {
  schemaVersion: 1,
  collections: {
    Expenses: {
      id: 'c1',
      tombstones: [],
      fields: {
        amount: { id: 'f1', type: 'int' },
        note: { id: 'f2', type: 'text' },
        spentAt: { id: 'f3', type: 'date' },
      },
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// §A  mini-app-storage spec scenarios
// ═══════════════════════════════════════════════════════════════════════════

test('§A isolation: two apps with the same collection cannot see each other; separate files', () => {
  const a = engineAt(dbPath('app-a'));
  const b = engineAt(dbPath('app-b'));
  a.store.open(expensesV1);
  b.store.open(expensesV1);
  a.store.records.append('Expenses', { amount: 100, note: 'A only' });
  b.store.records.append('Expenses', { amount: 200, note: 'B only' });
  eq(a.store.records.list('Expenses').map(r => r.note), ['A only'], 'app A sees only its own row');
  eq(b.store.records.list('Expenses').map(r => r.note), ['B only'], 'app B sees only its own row');
  ok(fs.existsSync(dbPath('app-a')) && fs.existsSync(dbPath('app-b')), 'each app is a separate file on disk');
  a.store.close();
  b.store.close();
});

test('§A the verb surface accepts no app/store-addressing parameter', () => {
  const { store } = memEngine();
  eq(Object.keys(store.kv).sort(), ['get', 'remove', 'set'], 'kv surface is exactly get/set/remove');
  eq(Object.keys(store.records).sort(), ['append', 'list', 'remove', 'update'], 'records surface is exactly append/list/update/remove');
  // No verb takes an app id / db path: collection name is the only addressing argument, and
  // the engine holds exactly one handle (bound at construction) — there is no way to name
  // another store. (The TypeScript contract makes this a compile-time guarantee too.)
});

test('§A verbs: append returns an id, list/update/remove round-trip', () => {
  const { store } = memEngine();
  store.open(expensesV1);
  const { id } = store.records.append('Expenses', { amount: 1299, note: 'lunch', spentAt: 1700000000000 });
  ok(typeof id === 'number' && id > 0, 'append returns a positive integer id');
  eq(store.records.list('Expenses'), [{ id, amount: 1299, note: 'lunch', spentAt: 1700000000000 }], 'row reads back intact');
  store.records.update('Expenses', id, { amount: 1399 });
  eq(store.records.list('Expenses')[0].amount, 1399, 'update applied');
  store.records.remove('Expenses', id);
  eq(store.records.list('Expenses'), [], 'remove hard-deletes (D6)');
});

test('§A record granularity: a partial update leaves unnamed fields intact', () => {
  const { store } = memEngine();
  store.open(expensesV1);
  const { id } = store.records.append('Expenses', { amount: 5, note: 'keep me', spentAt: 42 });
  store.records.update('Expenses', id, { amount: 12 });
  const row = store.records.list('Expenses')[0];
  eq([row.note, row.spentAt], ['keep me', 42], 'note + spentAt untouched by an amount-only patch');
});

test('§A reads filter/order/bound: a date-bucketed query returns only the bucket', () => {
  const { store } = memEngine();
  store.open(expensesV1);
  for (const [n, t] of [['a', 10], ['b', 20], ['c', 30], ['d', 40]] as const) {
    store.records.append('Expenses', { amount: t, note: n, spentAt: t });
  }
  const got = store.records.list('Expenses', {
    where: { spentAt: { gte: 20, lt: 40 } },
    orderBy: { field: 'spentAt', direction: 'desc' },
    limit: 1,
  });
  eq(got.map(r => r.note), ['c'], 'only in-range rows, ordered desc, capped at limit');
  const offsetGot = store.records.list('Expenses', { orderBy: { field: 'spentAt', direction: 'asc' }, limit: 2, offset: 1 });
  eq(offsetGot.map(r => r.note), ['b', 'c'], 'offset + limit page through in order');
});

test('§A kv: scalars round-trip; oversized writes are rejected with a records-pointing hint', () => {
  const { store } = memEngine(64); // tiny cap to exercise rejection
  store.kv.set('theme', 'dark');
  eq(store.kv.get('theme'), 'dark', 'kv scalar round-trips');
  eq(store.kv.get('missing'), undefined, 'absent key is undefined');
  store.kv.set('ok', { a: 1 });
  const err = expectError('kv_too_large', () => store.kv.set('ok', Array.from({ length: 50 }, (_, i) => i)));
  ok(/records\.append/.test(err.detail.hint), 'oversize hint points at records.append');
  eq(store.kv.get('ok'), { a: 1 }, 'the prior value under the key is unchanged after a rejected write');
  store.kv.remove('theme');
  eq(store.kv.get('theme'), undefined, 'kv.remove deletes');
});

test('§A ephemeral mode: writes do not survive and leave no file', () => {
  const before = fs.readdirSync(TMP).length;
  const eng = memEngine();
  eng.store.open(expensesV1);
  eng.store.records.append('Expenses', { amount: 9, note: 'ghost' });
  eng.store.kv.set('k', 'v');
  eng.store.close();
  ok(fs.readdirSync(TMP).length === before, 'ephemeral (:memory:) created no file');
  const persist = engineAt(dbPath('persist-same-app'));
  persist.store.open(expensesV1);
  eq(persist.store.records.list('Expenses'), [], 'none of the ephemeral writes are present in a persistent store');
  persist.store.close();
});

test('§A persistence: data survives reopening the same file (restart simulated)', () => {
  const file = dbPath('restart');
  const first = engineAt(file);
  first.store.open(expensesV1);
  const { id } = first.store.records.append('Expenses', { amount: 777, note: 'survive' });
  first.store.kv.set('streak', 7);
  first.store.close();

  const second = engineAt(file);
  second.store.open(expensesV1); // reopening an unchanged schema is identical → no DDL
  eq(second.store.records.list('Expenses'), [{ id, amount: 777, note: 'survive', spentAt: null }], 'records survive reopen');
  eq(second.store.kv.get('streak'), 7, 'kv survives reopen');
  second.store.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// §B  storage-schema-evolution spec scenarios
// ═══════════════════════════════════════════════════════════════════════════

test('§B rename over the same id serves existing data unchanged with zero DDL', () => {
  const { store, rec } = memEngine();
  store.open(expensesV1);
  const { id } = store.records.append('Expenses', { amount: 50, note: 'renamed-field test' });

  const v2: SchemaArtifact = {
    schemaVersion: 1,
    collections: {
      Expenses: { id: 'c1', tombstones: [], fields: { amount: { id: 'f1', type: 'int' }, memo: { id: 'f2', type: 'text' }, spentAt: { id: 'f3', type: 'date' } } },
    },
  };
  const mark = rec.mark();
  store.open(v2); // note → memo, same id f2
  const ddl = rec.log.slice(mark).filter(e => /^(CREATE|ALTER)/.test(e.sql));
  eq(ddl.length, 0, 'a rename emits zero DDL');
  const row = store.records.list('Expenses')[0];
  eq([row.id, row.memo], [id, 'renamed-field test'], 'the value is served under the new display name from the same column');
});

test('§B a type change on an existing id is rejected; the db is unmodified', () => {
  const { store } = memEngine();
  store.open(expensesV1);
  store.records.append('Expenses', { amount: 1, note: 'x' });
  const typeChanged: SchemaArtifact = {
    schemaVersion: 1,
    collections: { Expenses: { id: 'c1', tombstones: [], fields: { amount: { id: 'f1', type: 'float' }, note: { id: 'f2', type: 'text' }, spentAt: { id: 'f3', type: 'date' } } } },
  };
  const err = expectError('type_change', () => store.open(typeChanged));
  ok(err.detail.collection === 'Expenses' && err.detail.field === 'amount', 'error names the collection and field');
  eq(store.records.list('Expenses').length, 1, 'storage is unchanged after a refused open');
});

test('§B a new field without a default is rejected', () => {
  const { store } = memEngine();
  store.open(expensesV1);
  const noDefault: SchemaArtifact = {
    schemaVersion: 1,
    collections: { Expenses: { id: 'c1', tombstones: [], fields: { amount: { id: 'f1', type: 'int' }, note: { id: 'f2', type: 'text' }, spentAt: { id: 'f3', type: 'date' }, category: { id: 'f4', type: 'text' } } } },
  };
  expectError('missing_default', () => store.open(noDefault));
});

test('§B additive diff emits exactly one CREATE TABLE and one ALTER TABLE ADD COLUMN', () => {
  const { store, rec } = memEngine();
  store.open(expensesV1);
  const additive: SchemaArtifact = {
    schemaVersion: 1,
    collections: {
      Expenses: { id: 'c1', tombstones: [], fields: { amount: { id: 'f1', type: 'int' }, note: { id: 'f2', type: 'text' }, spentAt: { id: 'f3', type: 'date' }, category: { id: 'f4', type: 'text', default: 'uncategorized' } } },
      Budgets: { id: 'c2', tombstones: [], fields: { cap: { id: 'f1', type: 'int' } } },
    },
  };
  const mark = rec.mark();
  store.open(additive);
  const ddl = rec.log.slice(mark).map(e => e.sql).filter(s => /^(CREATE|ALTER)/.test(s));
  eq(ddl.filter(s => /^CREATE TABLE/.test(s)).length, 1, 'exactly one CREATE TABLE');
  eq(ddl.filter(s => /^ALTER TABLE/.test(s)).length, 1, 'exactly one ALTER TABLE ADD COLUMN');
  ok(/ADD COLUMN "f4" TEXT DEFAULT 'uncategorized'/.test(ddl.find(s => /^ALTER/.test(s))!), 'the ADD COLUMN carries the declared default');
  // the default backfills existing rows (SQLite semantics): a pre-existing row reads the default.
  const eng2 = memEngine();
  eng2.store.open(expensesV1);
  eng2.store.records.append('Expenses', { amount: 1, note: 'pre' });
  eng2.store.open(additive);
  eq(eng2.store.records.list('Expenses')[0].category, 'uncategorized', 'ADD COLUMN DEFAULT backfills old rows');
});

test('§B tombstone + display-name reuse: a fresh id, old column retained, no resurrection', () => {
  const { store } = memEngine();
  store.open(expensesV1);
  const { id } = store.records.append('Expenses', { amount: 1, note: 'original note value' });

  // Tombstone f2 (note), then declare a NEW field reusing the display name "note" with a fresh id f5.
  const reused: SchemaArtifact = {
    schemaVersion: 1,
    collections: { Expenses: { id: 'c1', tombstones: ['f2'], fields: { amount: { id: 'f1', type: 'int' }, note: { id: 'f5', type: 'text', default: '' }, spentAt: { id: 'f3', type: 'date' } } } },
  };
  store.open(reused);
  const row = store.records.list('Expenses')[0];
  eq([row.id, row.note], [id, ''], 'the reused display name reads its own (new, default) column, not the stale data');
  // reusing the RETIRED id f2 for a different-typed field is a tombstone violation
  const violation: SchemaArtifact = {
    schemaVersion: 1,
    collections: { Expenses: { id: 'c1', tombstones: [], fields: { amount: { id: 'f1', type: 'int' }, ghost: { id: 'f2', type: 'int', default: 0 }, spentAt: { id: 'f3', type: 'date' } } } },
  };
  expectError('tombstone_violation', () => store.open(violation));
});

test('§B rollback then roll-forward loses no data (older code preserves a newer field)', () => {
  const file = dbPath('rollfwd');
  const { store } = engineAt(file);
  store.open(expensesV1);
  const { id } = store.records.append('Expenses', { amount: 100, note: 'base' });

  // gen N+1 adds `category` and writes it
  const nPlus1: SchemaArtifact = {
    schemaVersion: 1,
    collections: { Expenses: { id: 'c1', tombstones: [], fields: { amount: { id: 'f1', type: 'int' }, note: { id: 'f2', type: 'text' }, spentAt: { id: 'f3', type: 'date' }, category: { id: 'f4', type: 'text', default: 'none' } } } },
  };
  store.open(nPlus1);
  store.records.update('Expenses', id, { category: 'travel' });

  // roll back to gen N (no `category`) and update an existing field
  const back = engineAt(file);
  back.store.open(expensesV1); // older-subset → accepted, zero DDL
  back.store.records.update('Expenses', id, { amount: 250 });

  // roll forward to gen N+1 again
  const fwd = engineAt(file);
  fwd.store.open(nPlus1); // columns already exist → identical, zero DDL
  const row = fwd.store.records.list('Expenses')[0];
  eq([row.amount, row.category], [250, 'travel'], 'older code preserved the newer field while editing its own');
});

test('§B a rollback-shaped (older-subset) open produces zero DDL', () => {
  const file = dbPath('subset-ddl');
  const a = engineAt(file);
  const withExtra: SchemaArtifact = {
    schemaVersion: 1,
    collections: { Expenses: { id: 'c1', tombstones: [], fields: { amount: { id: 'f1', type: 'int' }, note: { id: 'f2', type: 'text' }, spentAt: { id: 'f3', type: 'date' }, category: { id: 'f4', type: 'text', default: 'none' } } } },
  };
  a.store.open(withExtra);
  a.store.close();

  const b = engineAt(file);
  const mark = b.rec.mark();
  b.store.open(expensesV1); // expensesV1 is an older subset of withExtra
  const ddl = b.rec.log.slice(mark).filter(e => /^(CREATE TABLE "|ALTER TABLE)/.test(e.sql));
  eq(ddl.length, 0, 'older-subset open executes no collection DDL');
});

// ═══════════════════════════════════════════════════════════════════════════
// §C  ★ INJECTION INVARIANT BLOCK ★  (never-regress security invariant, §16.4)
//
//     The reason `npm run storage:test` is a per-push CI gate (D5a/D7). It proves there is
//     no code path by which caller-supplied text reaches a SQL statement string: values are
//     BOUND, identifiers are MAPPED through the schema or REJECTED, never interpolated.
//     Authored as security invariants, not feature tests — treat a regression here as
//     critical, on par with a sandbox-containment failure.
// ═══════════════════════════════════════════════════════════════════════════

const ADVERSARIAL = [
  `'); DROP TABLE c1;--`,
  `" OR "1"="1`,
  `'; DELETE FROM kv; --`,
  `; ATTACH DATABASE 'x' AS y; --`,
  `Robert'); DROP TABLE students;--`,
];

/** Validate that a recorded statement is one of the fixed host-authored templates — only
 *  burned-ID identifiers and `?` placeholders vary; no caller value is ever present. */
function isHostAuthored(sql: string): boolean {
  const ID = '"[a-z][0-9]+"';
  const patterns: RegExp[] = [
    /^(BEGIN|COMMIT|ROLLBACK)$/,
    /^CREATE TABLE IF NOT EXISTS "(_meta|kv)" \(k TEXT PRIMARY KEY, v TEXT\)$/,
    new RegExp(`^CREATE TABLE ${ID} \\("id" INTEGER PRIMARY KEY(, ${ID} (TEXT|INTEGER|REAL)( DEFAULT (NULL|'(''|[^'])*'|-?[0-9.]+))?)*\\)$`),
    new RegExp(`^ALTER TABLE ${ID} ADD COLUMN ${ID} (TEXT|INTEGER|REAL)( DEFAULT (NULL|'(''|[^'])*'|-?[0-9.]+))?$`),
    /^SELECT v FROM "(_meta|kv)" WHERE k = \?$/,
    /^INSERT OR REPLACE INTO "(_meta|kv)"\(k, v\) VALUES \(\?, \?\)$/,
    /^DELETE FROM "kv" WHERE k = \?$/,
    new RegExp(`^INSERT INTO ${ID} \\(${ID}(, ${ID})*\\) VALUES \\(\\?(, \\?)*\\)$`),
    new RegExp(`^INSERT INTO ${ID} DEFAULT VALUES$`),
    new RegExp(`^UPDATE ${ID} SET ${ID} = \\?(, ${ID} = \\?)* WHERE "id" = \\?$`),
    new RegExp(`^DELETE FROM ${ID} WHERE "id" = \\?$`),
  ];
  if (patterns.some(p => p.test(sql))) return true;
  return isSelectListTemplate(sql);
}

/** SELECT "id"(, "fX")* FROM "cX" [WHERE <preds>] [ORDER BY "fX" ASC|DESC] [LIMIT ?[ OFFSET ?]] */
function isSelectListTemplate(sql: string): boolean {
  const m = /^SELECT "id"(?:, "[a-z][0-9]+")* FROM "[a-z][0-9]+"( WHERE .+?)?( ORDER BY "[a-z][0-9]+" (?:ASC|DESC))?( LIMIT \?(?: OFFSET \?)?)?$/.exec(sql);
  if (!m) return false;
  if (m[1]) {
    const preds = m[1].replace(/^ WHERE /, '').split(' AND ');
    const predRe = /^"[a-z][0-9]+" (?:=|<|<=|>|>=) \?$|^"[a-z][0-9]+" IS NULL$/;
    if (!preds.every(p => predRe.test(p))) return false;
  }
  return true;
}

function injectionSchema(): SchemaArtifact {
  return {
    schemaVersion: 1,
    collections: { Notes: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'text' }, n: { id: 'f2', type: 'int' } } } },
  };
}

test('§C (a) SQL metacharacters in record values are inert and round-trip byte-identical', () => {
  const { store, rec } = memEngine();
  store.open(injectionSchema());
  for (const evil of ADVERSARIAL) {
    const { id } = store.records.append('Notes', { body: evil, n: 1 });
    const back = store.records.list('Notes', { where: { body: evil } });
    eq(back.length, 1, `the literal value matches itself via a where filter (${JSON.stringify(evil)})`);
    eq(back[0].body, evil, 'the value round-trips byte-identical');
    store.records.remove('Notes', id);
  }
  ok(rec.log.every(e => !ADVERSARIAL.some(a => e.sql.includes(a))), 'no adversarial value ever appears in a statement string');
  ok(rec.log.some(e => e.params.some(p => ADVERSARIAL.includes(p as string))), 'adversarial values travel only in the bound-parameter array');
});

test('§C (b) adversarial kv keys and values are bound, never interpolated', () => {
  const { store, rec } = memEngine();
  for (const evil of ADVERSARIAL) {
    store.kv.set(evil, evil);
    eq(store.kv.get(evil), evil, 'an adversarial key+value round-trips');
    store.kv.remove(evil);
  }
  ok(rec.log.every(e => !ADVERSARIAL.some(a => e.sql.includes(a))), 'no adversarial key/value appears in a statement string');
});

test('§C (c) adversarial where comparison values are bound', () => {
  const { store, rec } = memEngine();
  store.open(injectionSchema());
  for (const evil of ADVERSARIAL) store.records.list('Notes', { where: { body: evil } });
  ok(rec.log.every(e => !ADVERSARIAL.some(a => e.sql.includes(a))), 'no adversarial comparison value appears in a statement string');
});

test('§C (d) adversarial where/orderBy FIELD names are rejected with no SQL run', () => {
  const { store, rec } = memEngine();
  store.open(injectionSchema());
  for (const evil of ADVERSARIAL) {
    let mark = rec.mark();
    expectError('unknown_field', () => store.records.list('Notes', { where: { [evil]: 1 } }));
    eq(rec.log.length, mark, 'a bad where field executes no SQL');
    mark = rec.mark();
    expectError('unknown_field', () => store.records.list('Notes', { orderBy: { field: evil, direction: 'asc' } }));
    eq(rec.log.length, mark, 'a bad orderBy field executes no SQL');
    mark = rec.mark();
    expectError('unknown_field', () => store.records.append('Notes', { [evil]: 1 }));
    eq(rec.log.length, mark, 'a bad append field executes no SQL');
  }
});

test('§C (e) adversarial COLLECTION names are rejected with no SQL run', () => {
  const { store, rec } = memEngine();
  store.open(injectionSchema());
  for (const evil of ADVERSARIAL) {
    const mark = rec.mark();
    expectError('unknown_collection', () => store.records.append(evil, { body: 'x' }));
    expectError('unknown_collection', () => store.records.list(evil));
    eq(rec.log.length, mark, 'a bad collection name executes no SQL');
  }
});

test('§C every executed statement is a fixed host-authored template (full verb sweep)', () => {
  const { store, rec } = memEngine();
  store.open(injectionSchema());
  // Exercise every verb with adversarial keys/values/fields where they are accepted.
  for (const evil of ADVERSARIAL) {
    const { id } = store.records.append('Notes', { body: evil, n: 2 });
    store.records.update('Notes', id, { body: evil });
    store.records.list('Notes', { where: { body: evil, n: { gte: 0, lt: 9 } }, orderBy: { field: 'n', direction: 'desc' }, limit: 5, offset: 0 });
    store.records.remove('Notes', id);
    store.kv.set(evil, { evil });
    store.kv.get(evil);
    store.kv.remove(evil);
  }
  const offenders = rec.log.filter(e => !isHostAuthored(e.sql));
  eq(offenders.map(e => e.sql), [], 'the executed-statement set is exactly the fixed host-authored templates');
  const badDdl = rec.log.map(e => e.sql).filter(s => /^(CREATE|ALTER)/.test(s)).filter(s => !/^CREATE TABLE/.test(s) && !/^ALTER TABLE/.test(s));
  eq(badDdl, [], 'only CREATE TABLE / ALTER TABLE ADD COLUMN DDL forms are ever observed');
});

// ── verdict ──────────────────────────────────────────────────────────────────

fs.rmSync(TMP, { recursive: true, force: true });

console.log('');
if (failures.length === 0) {
  console.log(`✓ storage-engine acceptance: ${passed} checks passed`);
} else {
  console.error(`✗ storage-engine acceptance: ${failures.length} FAILED, ${passed} passed`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
