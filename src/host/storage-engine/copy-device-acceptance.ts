/**
 * On-device probe for the data copy (copy-app-data, task 1.5; design D2 Durability, D7, D8). It
 * settles, on a real op-sqlite runtime, what the Node suite cannot:
 *
 *   - secondConnection: a copy opens its own connection to a store an engine already holds open,
 *     and snapshots it while that engine keeps writing (are those writes refused meanwhile?);
 *   - paths: what `getDbPath()` reports under `location: 'storage'`, where the copy is written;
 *   - large: a store of at least 50 MiB copied, timed against the 5 s budget, and verified;
 *   - durability: a copy written on the previous launch, read back after the process was killed
 *     right after it was written (that copy is the last step: kill the app the moment the verdict
 *     appears, then relaunch; `durability.priorCopyFound` is 'n/a' until a launch has reached it).
 *
 * `pass` is every section green. `DataCopyProbeScreen` renders the verdict in full (logcat
 * truncates at ~4 KB, so the screen is the record).
 */

import { createStorageEngine, deleteStorage } from './index';
import { createEngine } from './engine';
import { createOpSqlExecutor } from './bindings/op-sqlite';
import { copyStorage } from './copy-device';
import { storeFileName } from './copy';
import { SchemaArtifact } from './contract';

const MIB = 1024 * 1024;
const LARGE_BYTES = 50 * MIB;
const BUDGET_MS = 5000;
const ROW_TEXT = 'x'.repeat(1024);
const DURABLE_ROWS = 500;

const blobs: SchemaArtifact = {
  schemaVersion: 1,
  collections: { Blobs: { id: 'c1', tombstones: [], fields: { body: { id: 'f1', type: 'text' }, n: { id: 'f2', type: 'int' } } } },
};

export interface DataCopyVerdict {
  binding: 'op-sqlite';
  sqliteVersion: string;
  journalMode: string;
  paths: { sourceDbPath: string; copyDbPath: string | null };
  secondConnection: {
    copied: boolean;
    rowsAtStart: number;
    copiedRows: number | null;
    sourceRowsAfter: number | null;
    writesDuringCopy: number;
    failedWrites: number;
    writeErrors: string[];
    copyQuickCheck: string | null;
    ms: number | null;
  };
  large: { sourceBytes: number; copyBytes: number | null; ms: number | null; withinBudget: boolean; copyQuickCheck: string | null };
  durability: { priorCopyFound: boolean | 'n/a'; priorCopyRows: number | null; priorCopyQuickCheck: string | null; expectedRows: number; writtenThisLaunch: boolean };
  failures: string[];
  pass: boolean;
}

interface RawDb {
  executeSync(sql: string, params: unknown[]): { rows?: Record<string, unknown>[] | { _array?: Record<string, unknown>[] } } | undefined;
  getDbPath(): string;
  close(): void;
}

function openRaw(appId: string): RawDb {
  const { open } = require('@op-engineering/op-sqlite');
  return open({ name: storeFileName(appId), location: 'storage' });
}

function scalar(db: RawDb, sql: string): unknown {
  const res = db.executeSync(sql, []);
  const raw = res?.rows;
  const rows = Array.isArray(raw) ? raw : (raw?._array ?? []);
  const row = rows[0] ?? {};
  return row[Object.keys(row)[0]];
}

/** Row count of the probe collection, integrity check and size of a store (null where unreadable). */
function inspect(appId: string): { rows: number | null; quickCheck: string | null; bytes: number; dbPath: string } {
  const db = openRaw(appId);
  try {
    let rows: number | null = null;
    try {
      rows = Number(scalar(db, 'SELECT count(*) FROM "c1"'));
    // eslint-disable-next-line no-restricted-syntax -- intentional: a store without the probe collection reports rows: null
    } catch {
      rows = null;
    }
    let quickCheck: string | null;
    try {
      quickCheck = String(scalar(db, 'PRAGMA quick_check'));
    } catch (err) {
      quickCheck = `threw: ${(err as Error).message}`;
    }
    const bytes = Number(scalar(db, 'PRAGMA page_count')) * Number(scalar(db, 'PRAGMA page_size'));
    return { rows, quickCheck, bytes, dbPath: db.getDbPath() };
  } finally {
    db.close();
  }
}

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** A store holding `rows` probe rows, written through the engine in one transaction per 1000. */
function seed(appId: string, rows: number): void {
  const sql = createOpSqlExecutor({ appId, mode: 'persistent' });
  const store = createEngine(sql);
  store.open(blobs);
  for (let start = 0; start < rows; start += 1000) {
    sql.transaction(() => {
      for (let i = start; i < Math.min(rows, start + 1000); i++) store.records.append('Blobs', { body: ROW_TEXT, n: i });
    });
  }
  store.close();
}

type Check = (cond: boolean, msg: string) => void;

const DURABLE_SRC = 'data-copy-durable-src';
const DURABLE = 'data-copy-durable';

/** Read back the copy the previous launch wrote. The durable source is written only just before
 *  that copy, so finding it means a previous launch reached the copy. */
function readPriorDurableCopy(check: Check): Omit<DataCopyVerdict['durability'], 'writtenThisLaunch'> {
  const priorRun = inspect(DURABLE_SRC).rows === DURABLE_ROWS;
  const prior = inspect(DURABLE);
  if (priorRun) {
    check(prior.rows === DURABLE_ROWS, `durability: the prior copy has ${prior.rows} rows, expected ${DURABLE_ROWS}`);
    check(prior.quickCheck === 'ok', `durability: the prior copy's quick_check is ${prior.quickCheck}`);
  }
  deleteStorage({ appId: DURABLE });
  return {
    priorCopyFound: priorRun ? prior.rows !== null : 'n/a',
    priorCopyRows: prior.rows,
    priorCopyQuickCheck: prior.quickCheck,
    expectedRows: DURABLE_ROWS,
  };
}

/** Write this launch's durable copy; the probe screen shows the verdict once it is written. */
async function writeDurableCopy(check: Check): Promise<boolean> {
  if (inspect(DURABLE_SRC).rows !== DURABLE_ROWS) {
    deleteStorage({ appId: DURABLE_SRC });
    seed(DURABLE_SRC, DURABLE_ROWS);
  }
  deleteStorage({ appId: DURABLE });
  try {
    await copyStorage({ from: DURABLE_SRC, to: DURABLE });
    return true;
  } catch (err) {
    check(false, `durability: this launch's copy rejected: ${messageOf(err)}`);
    return false;
  }
}

function sqliteFacts(appId: string): { sqliteVersion: string; journalMode: string; dbPath: string } {
  const db = openRaw(appId);
  try {
    return { sqliteVersion: String(scalar(db, 'SELECT sqlite_version()')), journalMode: String(scalar(db, 'PRAGMA journal_mode')), dbPath: db.getDbPath() };
  } finally {
    db.close();
  }
}

/** Snapshot a store an engine holds open, while that engine keeps writing on the JS thread. */
async function copyWhileWriting(check: Check): Promise<{ second: DataCopyVerdict['secondConnection']; facts: ReturnType<typeof sqliteFacts>; copyDbPath: string | null }> {
  const SRC = 'data-copy-src';
  const COPY = 'data-copy-src__copy';
  const ROWS_AT_START = 2000;
  deleteStorage({ appId: SRC });
  deleteStorage({ appId: COPY });
  const live = createStorageEngine({ appId: SRC, mode: 'persistent' });
  live.open(blobs);
  for (let i = 0; i < ROWS_AT_START; i++) live.records.append('Blobs', { body: ROW_TEXT, n: i });
  const facts = sqliteFacts(SRC);

  const second: DataCopyVerdict['secondConnection'] = {
    copied: false,
    rowsAtStart: ROWS_AT_START,
    copiedRows: null,
    sourceRowsAfter: null,
    writesDuringCopy: 0,
    failedWrites: 0,
    writeErrors: [],
    copyQuickCheck: null,
    ms: null,
  };
  let settled = false;
  const pending = copyStorage({ from: SRC, to: COPY })
    .then(
      report => {
        second.copied = true;
        second.ms = report.ms;
      },
      err => check(false, `secondConnection: the copy rejected: ${messageOf(err)}`),
    )
    .then(() => {
      settled = true;
    });
  while (!settled) {
    try {
      live.records.append('Blobs', { body: 'during copy', n: -1 });
      second.writesDuringCopy++;
    } catch (err) {
      second.failedWrites++;
      if (second.writeErrors.length < 5) second.writeErrors.push(messageOf(err));
    }
    await tick();
  }
  await pending;
  live.close();

  second.sourceRowsAfter = inspect(SRC).rows;
  check(second.failedWrites === 0, `secondConnection: ${second.failedWrites} writes to the open store failed during the copy`);
  let copyDbPath: string | null = null;
  if (second.copied) {
    const info = inspect(COPY);
    copyDbPath = info.dbPath;
    second.copiedRows = info.rows;
    second.copyQuickCheck = info.quickCheck;
    const n = info.rows ?? -1;
    check(info.quickCheck === 'ok', `secondConnection: the copy's quick_check is ${info.quickCheck}`);
    check(n >= ROWS_AT_START && n <= (second.sourceRowsAfter ?? 0), `secondConnection: the copy has ${n} rows, outside [${ROWS_AT_START}, ${second.sourceRowsAfter}]`);
  }
  deleteStorage({ appId: COPY });
  return { second, facts, copyDbPath };
}

/** Copy a store of at least 50 MiB (kept across launches) and time it against the budget. */
async function copyLarge(check: Check): Promise<DataCopyVerdict['large']> {
  const BIG = 'data-copy-large';
  const BIG_COPY = 'data-copy-large__copy';
  deleteStorage({ appId: BIG_COPY });
  if (inspect(BIG).bytes < LARGE_BYTES) {
    deleteStorage({ appId: BIG });
    seed(BIG, Math.ceil(LARGE_BYTES / ROW_TEXT.length));
  }
  const sourceBytes = inspect(BIG).bytes;
  check(sourceBytes >= LARGE_BYTES, `large: the source is ${sourceBytes} bytes, under 50 MiB`);
  const large: DataCopyVerdict['large'] = { sourceBytes, copyBytes: null, ms: null, withinBudget: false, copyQuickCheck: null };
  try {
    const report = await copyStorage({ from: BIG, to: BIG_COPY });
    large.copyBytes = report.bytes;
    large.ms = report.ms;
    large.withinBudget = report.ms <= BUDGET_MS;
    large.copyQuickCheck = inspect(BIG_COPY).quickCheck;
    check(large.withinBudget, `large: the copy took ${report.ms} ms, over ${BUDGET_MS} ms`);
    check(large.copyQuickCheck === 'ok', `large: the copy's quick_check is ${large.copyQuickCheck}`);
  } catch (err) {
    check(false, `large: the copy rejected: ${messageOf(err)}`);
  }
  deleteStorage({ appId: BIG_COPY });
  return large;
}

export async function runDataCopyDeviceAcceptance(): Promise<DataCopyVerdict> {
  const failures: string[] = [];
  const check: Check = (cond, msg) => {
    if (!cond) failures.push(msg);
  };
  await tick(); // let the probe screen paint its spinner before the synchronous setup below

  const prior = readPriorDurableCopy(check);
  const { second, facts, copyDbPath } = await copyWhileWriting(check);
  const large = await copyLarge(check);
  const writtenThisLaunch = await writeDurableCopy(check);

  return {
    binding: 'op-sqlite',
    sqliteVersion: facts.sqliteVersion,
    journalMode: facts.journalMode,
    paths: { sourceDbPath: facts.dbPath, copyDbPath },
    secondConnection: second,
    large,
    durability: { ...prior, writtenThisLaunch },
    failures,
    pass: failures.length === 0,
  };
}
