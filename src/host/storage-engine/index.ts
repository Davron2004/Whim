/**
 * mini-app-storage-engine — public API (Decision #40).
 *
 *   import { createStorageEngine } from './storage-engine';
 *   const store = createStorageEngine({ appId: 'tip-splitter', mode: 'persistent' });
 *   store.open(schemaArtifact);
 *   const { id } = store.records.append('Expenses', { amount: 1299, note: 'lunch' });
 *
 * On device this binds to op-sqlite (`storage/<appId>.db`, or an in-memory DB for
 * 'ephemeral'). The Node suite builds an engine over the node:sqlite binding directly via
 * `createEngine` (see ./bindings/node-sqlite). The `contract` types are the inter-change
 * seam the `capability-bridge` change imports verbatim (D8).
 */

export * from './contract';
export { createEngine } from './engine';
export type { SqlExecutor, SqlResult, SqlRow } from './sql-executor';
export { RecordingExecutor } from './sql-executor';
export type { AppliedSchema, SchemaDiff, DdlPlan } from './schema';
export { validateArtifact, diffSchemas, emptyApplied } from './schema';

import { CreateEngineOptions, StorageEngine } from './contract';
import { createEngine } from './engine';

/**
 * Device entrypoint: resolve the per-app database (op-sqlite) and return an engine bound
 * to it. The native module is required lazily inside the op-sqlite binding, so importing
 * this module off-device is safe — only calling `createStorageEngine` pulls op-sqlite in.
 */
export function createStorageEngine(opts: CreateEngineOptions): StorageEngine {
  const { createOpSqlExecutor } = require('./bindings/op-sqlite');
  const executor = createOpSqlExecutor({ appId: opts.appId, mode: opts.mode });
  return createEngine(executor, { kvSizeCapBytes: opts.kvSizeCapBytes });
}

/**
 * Delete an app's entire user-data store — the persistent SQLite db at `storage/<appId>.db`
 * (launcher-shell / #5 D2: delete leaves no per-app residue). op-sqlite's `db.delete()` removes
 * the underlying file. Device-only (the native module is required lazily) and acceptance-tested
 * on-device (task 7.2); off-device this is never called. Best-effort: an absent db is a no-op.
 */
export function deleteStorage(opts: { appId: string }): void {
  const { open } = require('@op-engineering/op-sqlite');
  const db = open({ name: `${opts.appId}.db`, location: 'storage' });
  db.delete();
}
