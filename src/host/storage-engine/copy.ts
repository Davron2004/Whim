/**
 * One-time copy of an app's whole user-data store into a new store (copy-app-data, design D1).
 *
 * The copy is a single `VACUUM INTO` run on a connection to the source: one read transaction, so
 * it captures one committed state of every table — each collection with its retired columns,
 * `kv`, `_meta` byte for byte — and keeps every row id (`INTEGER PRIMARY KEY`). It writes a new
 * file and runs no statement that writes the source. The new file is then opened and verified
 * (`PRAGMA quick_check` is `ok`, and its `_meta` holds every identity of the source's accumulated
 * schema read just before the snapshot) before the copy resolves. Any failure deletes the file
 * the copy wrote and rejects with a `DataCopyError`.
 *
 * This module is the only place in `src/` that may contain the SQL keyword for that statement
 * (the storage suite scans for it). The engine's two-DDL-forms rule is about what the engine runs
 * against a live store; this runs no DDL and lives outside `Engine` for that reason.
 *
 * Pure over an injected opener: `copy-device.ts` (op-sqlite) and `copy-node.ts` (node:sqlite).
 */

import { BUSY_TIMEOUT_MS } from './busy-timeout';
import { readAppliedSchema } from './engine';
import { SqlBindValue } from './marshal';
import { AppliedSchema } from './schema';
import { SqlExecutor } from './sql-executor';
import { CopyReport, DataCopyError, DataCopyErrorKind, isSupersetSchema } from './copy-contract';

/** One connection to one store file. */
export interface CopyConnection {
  /** Synchronous statements: reads and per-connection pragmas. */
  readonly sql: SqlExecutor;
  /** The directory holding this connection's file; a copy is written beside its source. */
  readonly dir: string;
  /** Run one statement, off the JS thread where the binding can (op-sqlite's async `execute`). */
  runAsync(statement: string, params: SqlBindValue[]): Promise<void>;
}

export interface CopyOpener {
  /** Connect to appId's store. Throws when the store cannot be opened. */
  open(appId: string): CopyConnection;
  /** Delete appId's store file. A store that does not exist is a no-op. */
  remove(appId: string): void;
}

/** The file name a store has in the storage directory; both bindings use this form. */
export function storeFileName(appId: string): string {
  return `${appId}.db`;
}

// SQLite primary result codes the classification reads (sqlite3.h).
const SQLITE_CORRUPT = 11;
const SQLITE_FULL = 13;
const SQLITE_NOTADB = 26;

/** SQLite's own message for each code (`sqlite3ErrStr`). op-sqlite exposes only the message, so
 *  the code is recovered from it; node:sqlite exposes the code as `errcode`. */
const ERRSTR_CODES: ReadonlyArray<[string, number]> = [
  ['database or disk is full', SQLITE_FULL],
  ['database disk image is malformed', SQLITE_CORRUPT],
  ['file is not a database', SQLITE_NOTADB],
];

/** SQLite's message when `VACUUM INTO` finds a non-empty file at its target. */
const TARGET_EXISTS = 'output file already exists';

function sqliteCode(err: unknown): number | undefined {
  const errcode = (err as { errcode?: unknown } | null)?.errcode;
  if (typeof errcode === 'number') return errcode % 256; // the primary code of an extended one
  const message = err instanceof Error ? err.message : String(err);
  return ERRSTR_CODES.find(([text]) => message.includes(text))?.[1];
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Phase = 'source' | 'snapshot' | 'verify';

/** The kind a failure in `phase` reports. Running out of space is `no_space` wherever it happens;
 *  a source found corrupt while it is being read is `source_unreadable`. */
function classify(err: unknown, phase: Phase): DataCopyError {
  if (err instanceof DataCopyError) return err;
  const code = sqliteCode(err);
  let kind: DataCopyErrorKind;
  if (code === SQLITE_FULL) kind = 'no_space';
  else if (phase === 'source') kind = 'source_unreadable';
  else if (phase === 'verify') kind = 'verify_failed';
  else if (code === SQLITE_CORRUPT || code === SQLITE_NOTADB) kind = 'source_unreadable';
  else kind = 'io';
  return new DataCopyError(kind, `data copy failed (${phase}): ${messageOf(err)}`, err);
}

/** A store id becomes a file name: it must not be able to name another directory. */
function assertStoreId(appId: string): void {
  if (!appId || appId === '.' || appId === '..' || /[/\\\0]/.test(appId)) {
    throw new DataCopyError('io', `data copy refused: "${appId}" is not a store id`);
  }
}

function firstValue(sql: SqlExecutor, statement: string): unknown {
  const row = sql.execute(statement).rows[0] ?? {};
  return row[Object.keys(row)[0]];
}

/** Delete what a failed copy wrote, keeping the failure that caused it as the rejection. */
function removeQuietly(opener: CopyOpener, appId: string): void {
  try {
    opener.remove(appId);
  // eslint-disable-next-line no-restricted-syntax -- intentional: the copy's own failure is the error to report; a leftover file is still deleted by the launcher's copy-journal sweep
  } catch {
    /* the original failure is what matters */
  }
}

/** Open the copy, check it, close it; returns its size in bytes. */
function verify(opener: CopyOpener, to: string, sourceSchema: AppliedSchema): number {
  const target = opener.open(to);
  try {
    const check = firstValue(target.sql, 'PRAGMA quick_check');
    if (check !== 'ok') throw new DataCopyError('verify_failed', `data copy failed verification: quick_check returned ${String(check)}`);
    if (!isSupersetSchema(readAppliedSchema(target.sql), sourceSchema)) {
      throw new DataCopyError('verify_failed', 'data copy failed verification: the copy lacks part of the source schema');
    }
    return Number(firstValue(target.sql, 'PRAGMA page_count')) * Number(firstValue(target.sql, 'PRAGMA page_size'));
  } finally {
    target.sql.close();
  }
}

/**
 * Copy store `from` into a new store `to`. A target that already holds data is refused with `io`
 * and left as it is. Every other failure deletes whatever the copy wrote before rejecting.
 */
export async function copyStore(opener: CopyOpener, args: { from: string; to: string }): Promise<CopyReport> {
  const started = Date.now();
  assertStoreId(args.from);
  assertStoreId(args.to);
  if (args.from === args.to) throw new DataCopyError('io', 'data copy refused: source and target are the same store');

  let source: CopyConnection;
  let sourceSchema: AppliedSchema;
  try {
    source = opener.open(args.from);
  } catch (err) {
    throw classify(err, 'source');
  }

  let wroteTarget = false;
  try {
    try {
      // A read that throws for an unreadable file (readAppliedSchema treats any failure as "no
      // schema yet", which would hide a corrupt source).
      firstValue(source.sql, 'SELECT count(*) FROM sqlite_master');
      sourceSchema = readAppliedSchema(source.sql);
    } catch (err) {
      throw classify(err, 'source');
    }

    // Connection settings only; neither writes the source. FULL syncs the copy before the
    // statement returns (design D2, Durability); the timeout rides out a writer's brief commit.
    source.sql.execute('PRAGMA synchronous = FULL');
    source.sql.execute(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);

    const target = `${source.dir}/${storeFileName(args.to)}`;
    wroteTarget = true;
    try {
      await source.runAsync('VACUUM INTO ?', [target]);
    } catch (err) {
      if (messageOf(err).includes(TARGET_EXISTS)) {
        wroteTarget = false;
        throw new DataCopyError('io', `data copy refused: a store already exists under "${args.to}"`, err);
      }
      throw classify(err, 'snapshot');
    }

    let bytes: number;
    try {
      bytes = verify(opener, args.to, sourceSchema);
    } catch (err) {
      throw classify(err, 'verify');
    }
    return { bytes, ms: Date.now() - started };
  } catch (err) {
    if (wroteTarget) removeQuietly(opener, args.to);
    throw err instanceof DataCopyError ? err : classify(err, 'snapshot');
  } finally {
    source.sql.close();
  }
}
