# Review: copy-app-data 3a (Opus high, shift 4) — ACCEPT with findings

Device create-then-delete acceptable on op-sqlite 16.2.0 source: open always READWRITE|CREATE, no URI mode, native
file_exists not exposed, no fs module (adding one = dependency add, owner approval); no connection cache; only a
table-less file is deleted and the engine creates _meta + kv in the same sync turn, so a real store is never deleted;
a crash between create and delete leaves a harmless zero-byte file. "Any collection row" correct (all sqlite_master
tables except sqlite_* and _meta; LIMIT 1). Failure → true. Tests discriminate.
- MEDIUM saved-data-device.ts:16-27 never runs in tests → add RUN_STORAGE_PROBE steps (never-opened id → false and no
  <id>.db* left in getDbPath()'s dir; kv-only → true; schema-only → false, file kept). → 3b writes the probe steps,
  chain-5 runs them on device.
- MEDIUM tasks.md:67 "must NOT create the file" vs "never leaves a file" → asked the PO (default: amend, PO-accepted).
- LOW saved-data.suite.ts:99-104 Node keeps a zero-byte file, device deletes it (comment or align).
- LOW index.ts:61 barrel export uncalled until 3b → 3a and 3b land together before any gate-full (don't silence knip).
- LOW contract: a hot rollback journal makes the read roll back (a write) — add a clause.
