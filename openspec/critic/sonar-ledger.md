# SonarCloud recurrence ledger

Append-only. One line per external SonarCloud finding per fix round, in the exact
grammar below. Never edit or remove an existing line — correct a mistake by appending
a new line, not by rewriting history.

```
- <YYYY-MM-DD> <run-id> <rule-id> <path>:<line>
```

- `<YYYY-MM-DD>` — the date the finding was addressed (the fix round's date), not the
  date SonarCloud originally raised it.
- `<run-id>` — the OpenSpec change id of the fix round (e.g. `2026-07-12-fix-sonarjs-gate`,
  `clear-sonarqube-warnings`). A re-run of the same round (same fix loop, re-pushed)
  reuses the same run-id — recurrence counting treats every line sharing a run-id as
  ONE run, never one per line/push. Counting "N distinct runs" for a rule/location means
  counting distinct run-ids, not distinct ledger lines.
- `<rule-id>` — SonarCloud form where known (e.g. `S2871`); the `sonarjs/<rule>` ESLint
  alias where the source names only the local mirror rule and no SonarCloud S-number.
- `<path>:<line>` — the file and 1-based line SonarCloud/the source cites. If a source
  names a rule without a line, record the line as `-` rather than inventing one.

This is NOT the `scripts/fixloop.sh` stale-evidence grammar (`## <path>` headers) —
do not conflate the two; this file is a flat historical log, not live findings state.

Lines backfilled from pre-ledger fix rounds (no ledger existed at the time) carry a
trailing ` (backfilled)` marker and were transcribed only from the two source documents
of that round — never reconstructed from memory.

## Entries

- 2026-07-12 2026-07-12-fix-sonarjs-gate sonarjs/cognitive-complexity server/src/pipeline.ts:53 (backfilled)
- 2026-07-12 2026-07-12-fix-sonarjs-gate sonarjs/cognitive-complexity src/host/storage-engine/schema.ts:96 (backfilled)
- 2026-07-12 2026-07-12-fix-sonarjs-gate sonarjs/cognitive-complexity src/host/storage-engine/schema.ts:184 (backfilled)
- 2026-07-12 2026-07-12-fix-sonarjs-gate sonarjs/cognitive-complexity src/host/version-store/device-acceptance.ts:62 (backfilled)
- 2026-07-12 2026-07-12-fix-sonarjs-gate sonarjs/no-nested-conditional src/host/version-store/engine.ts:273 (backfilled)
- 2026-07-12 2026-07-12-fix-sonarjs-gate sonarjs/no-nested-conditional src/host/version-store/fs/kv-fs.ts:73 (backfilled)
- 2026-07-12 2026-07-12-fix-sonarjs-gate sonarjs/no-nested-conditional src/host/version-store/fs/kv-fs.ts:88 (backfilled)
- 2026-07-12 2026-07-12-fix-sonarjs-gate sonarjs/no-nested-conditional src/host/version-store/fs/memory-fs.ts:185 (backfilled)
- 2026-07-12 2026-07-12-fix-sonarjs-gate sonarjs/no-nested-conditional src/sdk/index.tsx:470 (backfilled)
- 2026-07-12 2026-07-12-fix-sonarjs-gate sonarjs/no-unused-vars server/test/openrouter.suite.ts:108 (backfilled)
- 2026-07-12 2026-07-12-fix-sonarjs-gate sonarjs/no-gratuitous-expressions server/test/server-core.suite.ts:341 (backfilled)
- 2026-07-14 clear-sonarqube-warnings S2819 src/sdk/navigation.tsx:116 (backfilled)
