/**
 * Pure, Node-loadable guard extracted from `op-sqlite.ts` (D7). Kept dependency-free — no
 * import from `@op-engineering/op-sqlite` — so it can be exercised by the Node acceptance
 * suite, unlike the binding itself which requires the native module lazily and only runs
 * on-device.
 */
export function assertExecuteSyncAvailable(db: { executeSync?: unknown }): void {
  if (typeof db.executeSync !== 'function') {
    throw new TypeError('op-sqlite: executeSync not available — expected op-sqlite v16+ JSI build');
  }
}
