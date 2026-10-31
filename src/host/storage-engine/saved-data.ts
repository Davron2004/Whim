/**
 * "Does this app's store hold any user data?" (copy-app-data task 3.0, product-owner rulings 3 and
 * 40 revised): true iff `kv` or any collection table holds a row. `_meta` is the engine's own
 * bookkeeping and never counts, and neither does an applied-but-empty schema: a store with nothing
 * in it has nothing to copy.
 *
 * Pure over a `SqlExecutor`, so it runs unchanged on the Node binding and on op-sqlite. It runs
 * only SELECTs and never deletes anything. Reaching the store may create its file (op-sqlite's
 * `open` creates a missing one, and so does node:sqlite): a store with no table at all reads as
 * holding nothing, and the engine's first open of it creates its tables as it would on a missing
 * file. Whether an app's store is read at all is `StoreAccess.hasSavedData`'s call: it never reads
 * the store of an app no version of which declared storage.
 */

import { SqlExecutor } from './sql-executor';

/** What a store holds: `data` has at least one user row; `empty` has none (no table at all, or only
 *  the engine's tables with no user row). */
export type StoreContents = 'empty' | 'data';

const META_TABLE = '_meta';

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

export function inspectStore(sql: SqlExecutor): StoreContents {
  const tables = sql
    .execute(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .rows.map(r => r.name as string)
    .filter(name => !name.startsWith('sqlite_'));
  for (const name of tables) {
    if (name === META_TABLE) continue;
    if (sql.execute(`SELECT 1 FROM ${quoteIdent(name)} LIMIT 1`).rows.length > 0) return 'data';
  }
  return 'empty';
}

/** Whether an opened store holds user data; the connection is closed afterwards, whether the read
 *  succeeded or threw (a throw is rethrown). */
export function readSavedData(sql: SqlExecutor): boolean {
  try {
    return inspectStore(sql) === 'data';
  } finally {
    sql.close();
  }
}
