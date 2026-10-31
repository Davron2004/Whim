/**
 * How long a connection waits for another connection's lock before a statement fails with
 * "database is locked" (SQLITE_BUSY). Stores run in rollback-journal mode, so a copy's snapshot
 * (copy-app-data, design D7/D8) holds a read lock on the source for its whole run, and a write
 * on the live engine's connection could not commit meanwhile. With this timeout that write waits
 * out the snapshot instead of throwing.
 *
 * Set on every connection to a store: the engine's, the copy's and each executor the bindings
 * build. At least design D7's copy budget (50 MB in 5 s), so a snapshot within budget never
 * outlasts it.
 */
export const BUSY_TIMEOUT_MS = 5000;
