/**
 * Test-side SqlExecutor binding over Node 22+'s built-in `node:sqlite` (Decision #40, D1,
 * task 3.2). Zero new devDependency, real SQLite — so the Node acceptance suite exercises
 * genuine SQL semantics and parameter binding, not a mock. The device authority remains
 * op-sqlite on-device (D7); this is the fast checkpoint.
 *
 * A file path gives an on-disk database (so the "separate files on disk" isolation scenario
 * is testable off-device); ':memory:' gives an ephemeral one (no file is created).
 */

import * as fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { SqlBindValue } from '../marshal';
import { readAppliedSchema } from '../engine';
import { AppliedSchema, emptyApplied } from '../schema';
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

/**
 * The Node-side "read-only peek" (task 3.2 / storage-schema-evolution "accumulated schema is
 * readable without applying anything"): reads a database's accumulated `_meta` union WITHOUT
 * creating the file when it does not exist yet. `DatabaseSync`'s own constructor creates the
 * underlying file the instant it connects — even before any statement runs — so existence must
 * be checked BEFORE that connection is ever made; ':memory:' never touches disk and is exempt
 * from the check (never a real filename to test for). Delegates the actual read to
 * `readAppliedSchema`, which performs no DDL. */
export function readAppliedSchemaFromFile(filename: string): AppliedSchema {
  if (filename !== ':memory:' && !fs.existsSync(filename)) return emptyApplied();
  const executor = createNodeSqlExecutor(filename);
  try {
    return readAppliedSchema(executor);
  } finally {
    executor.close();
  }
}
