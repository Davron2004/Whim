/**
 * The ~3-method adapter the engine core speaks to (Decision #40, D1). The core is pure
 * TypeScript; the device binding (op-sqlite) and the test binding (node:sqlite) implement
 * this same seam, so the Node suite exercises real SQL semantics and the binding stays
 * swappable (the `react-native-nitro-sqlite` fallback never touches engine code).
 *
 * The conservative SQL subset the engine is allowed to emit — kept boring on purpose so
 * the two SQLite builds cannot drift on it (D1 caveat). The complete fixed template set:
 *
 *   CREATE TABLE [IF NOT EXISTS] "<id>" ( … )       -- infra (_meta, kv) + collections
 *   ALTER TABLE "<id>" ADD COLUMN "<id>" <T> DEFAULT <lit>
 *   BEGIN | COMMIT | ROLLBACK
 *   INSERT INTO "<id>" ( … ) VALUES ( ?, … ) | INSERT INTO "<id>" DEFAULT VALUES
 *   INSERT OR REPLACE INTO "<id>"(k,v) VALUES (?, ?)
 *   SELECT … FROM "<id>" [WHERE …] [ORDER BY "<id>" ASC|DESC] [LIMIT ? OFFSET ?]
 *   UPDATE "<id>" SET "<id>" = ?, … WHERE "id" = ?
 *   DELETE FROM "<id>" WHERE … = ?
 *
 * No JSON1, no upsert exotica (INSERT OR REPLACE only), no partial indexes, no triggers,
 * no expressions in WHERE beyond `=`/`<`/`<=`/`>`/`>=`. The only variable parts of any
 * statement are burned-ID identifiers (validated `[a-z][0-9]+`, structurally metacharacter-
 * free) and `?` placeholders; every caller value travels in the params array (D5a).
 */

import { SqlBindValue } from './marshal';

export type SqlRow = Record<string, unknown>;

export interface SqlResult {
  /** Result rows for a query; [] for a mutation/DDL. */
  rows: SqlRow[];
  /** rowid of the last INSERT (0 when not an insert). */
  lastInsertRowId: number;
  /** rows affected by the last mutation (0 for a query/DDL). */
  changes: number;
}

export interface SqlExecutor {
  /** Run one statement. `params` are bound, never interpolated. */
  execute(sql: string, params?: SqlBindValue[]): SqlResult;
  /** Run `fn` inside BEGIN/COMMIT, rolling back (and re-throwing) on any error. */
  transaction<T>(fn: () => T): T;
  close(): void;
}

/** Build a transaction wrapper from a raw `execute`, so BEGIN/COMMIT/ROLLBACK flow through
 *  the SAME execute path every other statement does (and are recorded identically). */
export function runInTransaction<T>(execute: (sql: string) => void, fn: () => T): T {
  execute('BEGIN');
  try {
    const result = fn();
    execute('COMMIT');
    return result;
  } catch (err) {
    try {
      execute('ROLLBACK');
    } catch {
      /* the original error is what matters */
    }
    throw err;
  }
}

/**
 * A SqlExecutor decorator that records every executed statement's text and bound params,
 * then delegates to an inner executor (D7/D8). The Node suite wraps the node:sqlite binding
 * with this so tests can assert WHAT SQL actually ran — the core of the injection invariant.
 * Transaction control is re-implemented here (not delegated) so BEGIN/COMMIT/ROLLBACK are
 * captured too.
 */
export class RecordingExecutor implements SqlExecutor {
  readonly log: { sql: string; params: SqlBindValue[] }[] = [];
  constructor(private readonly inner: SqlExecutor) {}

  execute(sql: string, params: SqlBindValue[] = []): SqlResult {
    this.log.push({ sql, params });
    return this.inner.execute(sql, params);
  }

  transaction<T>(fn: () => T): T {
    return runInTransaction(s => {
      this.execute(s);
    }, fn);
  }

  close(): void {
    this.inner.close();
  }

  /** Every DDL statement seen so far, for the "only two DDL forms" assertion. */
  ddlStatements(): string[] {
    return this.log.map(e => e.sql).filter(s => /^\s*(CREATE TABLE|ALTER TABLE)/i.test(s));
  }

  /** Snapshot the current statement count (tests slice the log around an operation). */
  mark(): number {
    return this.log.length;
  }
}
