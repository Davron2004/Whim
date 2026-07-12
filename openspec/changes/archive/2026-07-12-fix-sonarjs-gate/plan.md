# Plan: fix-sonarjs-gate

Per-finding DONE specs (planner digests; full evidence blocks live in the orchestrator's
temp files and were verified by `scripts/fixloop.sh stale` = exit 0 for every finding).
All findings are lint-driven, behavior-preserving refactors: **class structural-no-test**
across the board — no new tests, no source-grep assertions; the assurance is the existing
Node suites + reviewer inspection + gate. Baseline caveat given to every worker: main is
transiently lint-RED with the batch's other findings, so a worker's full-gate lint step may
fail on files outside its allowlist — expected, not theirs to fix; their own file must lint
clean.

## Checklist (tick only at TERMINAL ledger events)

- [x] F1 server/src/pipeline.ts:53 cognitive-complexity 19 — extract emitStage/emitTerminal async-gen helpers; `yield*` delegation; abort contract + exactly-one-terminal invariant preserved. Allowlist: server/src/pipeline.ts. Severity med. Net: server:test.
- [x] F2 src/host/storage-engine/schema.ts:96+184 cognitive-complexity 46/39 — decompose validateArtifact into validateCollectionShape/validateCollectionId/validateTombstones/validateField (shared errors[] by reference, original push order); diffSchemas → planNewCollection + diffExistingFields; remove obsolete NOSONAR comments. Allowlist: src/host/storage-engine/schema.ts. Severity HIGH (user ratifies merge). Net: storage:test.
- [x] F3 src/host/version-store/device-acceptance.ts:62 cognitive-complexity 23 — extract per-section helpers (hermes-load/lifecycle/compaction/reliability/persistence); DeviceVerdict shape unchanged. Allowlist: src/host/version-store/device-acceptance.ts. Severity low. Net: vstore:test (indirect; probe is on-device).
- [x] F4 src/host/version-store/engine.ts:273 no-nested-conditional — extract changeStatusOf(aOid,bOid) if/else helper. Allowlist: src/host/version-store/engine.ts. Severity low. Net: vstore:test.
- [x] F5 src/host/version-store/fs/kv-fs.ts:73+88 no-nested-conditional ×2 — extract nodeFromSerialized + serializedFromNode helpers. Allowlist: src/host/version-store/fs/kv-fs.ts. Severity low. Net: vstore:test.
- [x] F6 src/host/version-store/fs/memory-fs.ts:185 no-nested-conditional — extract sizeOf(node) helper. Allowlist: src/host/version-store/fs/memory-fs.ts. Severity low. Net: vstore:test.
- [x] F7 src/sdk/index.tsx:470 no-nested-conditional — extract buttonOpacity helper (0.5/0.8/1 exact); MUST `npm run build` and commit regenerated src/runtime/generated/* in the same commit; build/generated/* must NOT diff (PARK signal if it does). Allowlist: src/sdk/index.tsx, src/runtime/generated/*. Severity low. Net: build + gate suites.
- [x] F8 server/test/openrouter.suite.ts:108 no-unused-vars — rewrite drain() to consume without a bound loop variable (iterator .next() while-loop) and drop the now-dead eslint-disable comment. Allowlist: server/test/openrouter.suite.ts. Severity low. Net: server:test.
- [x] F9 server/test/server-core.suite.ts:341 no-gratuitous-expressions — delete the dead `if (false) yield …` line in the neverYields test double (planner confirmed NOT a vacuous-assertion bug; the test's checks have their own non-vacuity guard). Allowlist: server/test/server-core.suite.ts. Severity low. Net: server:test.
