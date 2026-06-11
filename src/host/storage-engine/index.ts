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
