# SonarJS gate findings — 2026-07-12

Source: `npm run lint` after commit 57412bb enabled `plugin:sonarjs/recommended-legacy`.
Red check for every finding: `npx eslint <file>` errors on the cited rule BEFORE the fix and is clean AFTER. Behavior must be preserved — these are lint-driven refactors, not feature changes; the existing Node suites are the behavioral net.

Same-file findings are grouped into one finding each (parallel workers must never share files).

## F1 — server/src/pipeline.ts:53 — sonarjs/cognitive-complexity
Function at line 53 has cognitive complexity 19 (allowed 15). Decompose into helpers without changing behavior. Behavioral net: `npm run server:test`.

## F2 — src/host/storage-engine/schema.ts:96 and :184 — sonarjs/cognitive-complexity
Two functions: complexity 46 (line 96) and 39 (line 184), allowed 15. This is core validated storage-engine code (decisions #38/#40 — closed field-type set, burned field IDs, additive-only evolution). Decompose into well-named helpers; DO NOT change any validation semantics, error kinds/messages, or the accumulated-`_meta` behavior. Behavioral net: `npm run storage:test` (must stay 100% green).

## F3 — src/host/version-store/device-acceptance.ts:62 — sonarjs/cognitive-complexity
Function at line 62 has complexity 23 (allowed 15). This is the on-device acceptance probe (RUN_VSTORE_PROBE). Decompose without changing probe output shape. Behavioral net: typecheck + `npm run vstore:test`.

## F4 — src/host/version-store/engine.ts:273 — sonarjs/no-nested-conditional
Extract the nested ternary at 273:56 into an independent statement/helper. Behavioral net: `npm run vstore:test`.

## F5 — src/host/version-store/fs/kv-fs.ts:73 and :88 — sonarjs/no-nested-conditional
Extract both nested ternaries. Behavioral net: `npm run vstore:test`.

## F6 — src/host/version-store/fs/memory-fs.ts:185 — sonarjs/no-nested-conditional
Extract the nested ternary at 185:61. Behavioral net: `npm run vstore:test`.

## F7 — src/sdk/index.tsx:470 — sonarjs/no-nested-conditional
Extract the nested ternary at 470:35. NOTE: `src/sdk/` feeds the generated runtime — after editing, run `npm run build` and commit the regenerated `src/runtime/generated/*` / `build/generated/*` alongside (never hand-edit them). Behavioral net: build + the gate's suites.

## F8 — server/test/openrouter.suite.ts:108 — sonarjs/no-unused-vars
Remove the unused `_item` declaration at 108:20 (adjust the destructuring/loop accordingly). Behavioral net: `npm run server:test`.

## F9 — server/test/server-core.suite.ts:341 — sonarjs/no-gratuitous-expressions
Expression at 341:13 always evaluates falsy. FIRST understand the test's intent — an always-falsy condition in a test can hide a vacuous assertion (a real bug). Fix the logic so the test genuinely exercises what its name claims; if it was asserting correctly via another path, simplify honestly. Behavioral net: `npm run server:test`.
