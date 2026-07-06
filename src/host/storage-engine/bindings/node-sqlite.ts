/**
 * Test-side SqlExecutor binding over Node 22+'s built-in `node:sqlite` (Decision #40, D1,
 * task 3.2). Zero new devDependency, real SQLite — so the Node acceptance suite exercises
 * genuine SQL semantics and parameter binding, not a mock. The device authority remains
 * op-sqlite on-device (D7); this is the fast checkpoint.
 *
 * A file path gives an on-disk database (so the "separate files on disk" isolation scenario
 * is testable off-device); ':memory:' gives an ephemeral one (no file is created).
 */

import { DatabaseSync } from 'node:sqlite';
import { SqlBindValue } from '../marshal';
import { runInTransaction, SqlExecutor, SqlResult, SqlRow } from '../sql-executor';

const TXN_CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK)/i;
const QUERY = /^\s*(SELECT|PRAGMA|WITH)/i;

export function createNodeSqlExecutor(filename = ':memory:'): SqlExecutor {
  const db = new DatabaseSync(filename);
  // Conservative, portable pragmas only; the device build is the authoritative dialect.
  db.exec('PRAGMA foreign_keys = OFF');

  const executor: SqlExecutor = {
    execute(sql: string, params: SqlBindValue[] = []): SqlResult {
      if (TXN_CONTROL.test(sql)) {
        db.exec(sql);
        return { rows: [], lastInsertRowId: 0, changes: 0 };
      }
      const stmt = db.prepare(sql);
      if (QUERY.test(sql)) {
        const rows = stmt.all(...(params as never[])) as SqlRow[];
        return { rows, lastInsertRowId: 0, changes: 0 };
      }
      const info = stmt.run(...(params as never[]));
      return { rows: [], lastInsertRowId: Number(info.lastInsertRowid), changes: Number(info.changes) };
    },
    transaction<T>(fn: () => T): T {
      return runInTransaction(s => {
        executor.execute(s);
      }, fn);
    },
    close(): void {
      db.close();
    },
  };
  return executor;
}
