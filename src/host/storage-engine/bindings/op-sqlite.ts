/**
 * Device-side SqlExecutor binding over `@op-engineering/op-sqlite` (Decision #40, D1, task
 * 3.3). JSI/synchronous — the same toolchain generation as the MMKV v4 already shipped.
 * This is the AUTHORITATIVE acceptance dialect (D7); the Node binding is only the checkpoint.
 *
 * File layout: persistent → `storage/<appId>.db`; ephemeral → an in-memory DB. The native
 * module is required lazily so this file never breaks a Node/bundler path that doesn't run
 * on-device (only the on-device probe screen pulls it in).
 *
 * Not exercised by the Node suite — its acceptance is the on-device probe run (task 7).
 */

import { SqlBindValue } from '../marshal';
import { readAppliedSchema } from '../engine';
import { AppliedSchema } from '../schema';
import { runInTransaction, SqlExecutor, SqlResult, SqlRow } from '../sql-executor';
import { assertExecuteSyncAvailable } from './assert-executesync';

const TXN_CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK)/i;

export interface OpSqlExecutorOptions {
  appId: string;
  mode: 'persistent' | 'ephemeral';
}

export function createOpSqlExecutor(opts: OpSqlExecutorOptions): SqlExecutor {
  // Lazy require: keep the native module off any path that isn't the device.
  const { open } = require('@op-engineering/op-sqlite');

  const db =
    opts.mode === 'ephemeral'
      ? open({ name: ':memory:' })
      : open({ name: `${opts.appId}.db`, location: 'storage' });

  // Guard that the op-sqlite v16+ JSI build's executeSync is present. Extracted to
  // assertExecuteSyncAvailable so its throw is unit-testable under Node — this file
  // can't load outside React Native (it imports the native module).
  assertExecuteSyncAvailable(db);

  // op-sqlite v16+ JSI build: executeSync is always present and synchronous.
  const runOne = (sql: string, params: SqlBindValue[]): SqlResult => {
    const res = db.executeSync(sql, params);
    const raw = res?.rows;
    const rows: SqlRow[] = Array.isArray(raw) ? raw : (raw?._array ?? []);
    return {
      rows,
      lastInsertRowId: Number(res?.insertId ?? 0),
      changes: Number(res?.rowsAffected ?? 0),
    };
  };

  const executor: SqlExecutor = {
    execute(sql: string, params: SqlBindValue[] = []): SqlResult {
      if (TXN_CONTROL.test(sql)) {
        runOne(sql, []);
        return { rows: [], lastInsertRowId: 0, changes: 0 };
      }
      return runOne(sql, params);
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
 * Device-side "read-only peek" (task 3.2/3.5, #52-D5): reads an app's live database's
 * accumulated `_meta` union WITHOUT applying an artifact or running any DDL — `open()` never
 * runs, so no schema is validated/diffed. Known device-only limitation (not exercised by the
 * Node suite, like `createOpSqlExecutor` itself): the JS API here exposes no filesystem
 * existence check, so — unlike the Node-side `readAppliedSchemaFromFile` — connecting to a
 * brand-new app id's database may create an empty file as a side effect of op-sqlite's own
 * `open()`. The functional guarantees that matter (no artifact applied, no DDL, `emptyApplied()`
 * when nothing has ever been applied) hold regardless. */
export function readAppliedSchemaFromDevice(opts: { appId: string }): AppliedSchema {
  const executor = createOpSqlExecutor({ appId: opts.appId, mode: 'persistent' });
  try {
    return readAppliedSchema(executor);
  } finally {
    executor.close();
  }
}
