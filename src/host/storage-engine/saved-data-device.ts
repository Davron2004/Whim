/**
 * `hasSavedData` over op-sqlite (copy-app-data task 3.0, ruling 40 revised). `open` creates a
 * missing file, so reading a store that was never written leaves a table-less file; it is never
 * deleted. That is harmless: the engine opens the same store before the app's first run (bridge
 * launch, D7) and creates its tables on it as on a missing file (`engine.ts`, `Engine`'s
 * constructor). `StoreAccess.hasSavedData` never calls this for an app that declares no storage.
 * The native module is required lazily, as in `bindings/op-sqlite.ts`.
 */

import { createOpSqlExecutorOver, OpSqlDb } from './bindings/op-sqlite';
import { storeFileName } from './copy';
import { readSavedData } from './saved-data';
import { SqlExecutor } from './sql-executor';

export function hasSavedData(opts: { appId: string }): boolean {
  const { open } = require('@op-engineering/op-sqlite');
  const db: OpSqlDb = open({ name: storeFileName(opts.appId), location: 'storage' });
  let sql: SqlExecutor;
  try {
    sql = createOpSqlExecutorOver(db);
  } catch (e) {
    db.close();
    throw e;
  }
  return readSavedData(sql);
}
