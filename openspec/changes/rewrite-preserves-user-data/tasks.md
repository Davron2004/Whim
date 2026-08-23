## 1. Diagnostic vocabulary and the shared storage scanner

- [x] 1.1 Add `schema_identity_drift`, `storage_surface_drift`, `storage_surface_dynamic` and the six verb-time storage kinds (`type_mismatch`, `unknown_collection`, `unknown_field`, `unknown_record`, `unqueryable_field`, `kv_too_large`) to `DIAGNOSTIC_KINDS` in `checks/contract.ts`, with a comment stating that `not_open`/`corrupt_storage` are excluded as host faults — test: `checks/test/acceptance.ts` kind self-check (`npm run checks:test`); gate: `./scripts/gate.sh`
- [x] 1.2 Author `checks/storage-surface.ts`: `StorageSurface` + `scanStorageSurface(source)` collecting kv-key and record-collection string literals passed to `storage.kv.*` / `storage.records.*`, plus the non-literal call sites, each with line/column — test: `checks/test/acceptance.ts` §storage surface (`npm run checks:test`); gate: `./scripts/gate.sh`
- [x] 1.3 Export the scanner and its types from `checks/index.ts` so the server can import them without the pass — test: `checks/test/acceptance.ts` (`npm run checks:test`); gate: `./scripts/gate.sh`
- [x] 1.4 Scanner acceptance: literal kv keys, literal collections, computed arguments recorded as dynamic, aliased-facade case explicitly asserted as NOT collected (documents the known limit) — test: `checks/test/acceptance.ts` (`npm run checks:test`); gate: `./scripts/gate.sh`
- [x] 1.5 Write `handoff/storage-surface.md`: the `StorageSurface` type verbatim, the scanner signature, the new kind strings, and the host-fault exclusion rule — gate: `./scripts/gate.sh`

## 2. Continuity check passes

- [x] 2.1 Extend `checks/passes/schema-check.ts` with identity continuity: an applied-schema collection id the candidate omits, or an active field id it neither declares nor tombstones, yields a `schema_identity_drift` error whose hint names the id — test: `checks/test/acceptance.ts` §schema identity (`npm run checks:test`); gate: `./scripts/gate.sh`
- [x] 2.2 Author `checks/passes/storage-continuity.ts`: superset rule over the candidate's scanned surface vs `ctx.previousSurface`, `storage_surface_dynamic` warning per non-literal argument, drift suppressed for a facade whose candidate usage is dynamic — test: `checks/test/acceptance.ts` §storage continuity (`npm run checks:test`); gate: `./scripts/gate.sh`
- [x] 2.3 Thread `previousSurface` through `runStaticChecks` options and `buildContext`/`CheckContext`, and register the new pass in `PASSES` — test: `checks/test/acceptance.ts` (`npm run checks:test`); gate: `./scripts/gate.sh`
- [x] 2.4 Red-check both guards: delete the identity rule → 2.1's test fails; delete the superset rule → 2.2's test fails; restore. Confirm the few-shot fixtures still produce zero diagnostics — test: `checks/test/acceptance.ts` + `server/test/prompts.suite.ts` few-shot tripwire (`npm run checks:test && npm run server:test`); gate: `./scripts/gate.sh`
- [x] 2.5 Write `handoff/check-options.md`: the widened `runStaticChecks` option object and `CheckContext` field, plus the exact diagnostic shapes the two passes emit — gate: `./scripts/gate.sh`

## 3. The edit turn

- [x] 3.1 Render `Current source:` in `buildGenerateMessages` when the pre-flighted `app.source` is present, and make `requestEditSection`'s claim true (no claim when absent) — test: `server/test/prompts.suite.ts` §generate (edit) (`npm run server:test`); gate: `./scripts/gate.sh`
- [x] 3.2 Add the identity-continuity instruction (keep the name unless a rename was asked for; keep existing burned ids for existing concepts) to the edit turn — test: `server/test/prompts.suite.ts` (`npm run server:test`); gate: `./scripts/gate.sh`
- [x] 3.3 Add `storageSurface` to the generate/plan/repair turn contexts and render the location list with the "keep reading these, add don't replace" instruction — test: `server/test/prompts.suite.ts` (`npm run server:test`); gate: `./scripts/gate.sh`
- [x] 3.4 In `machine.ts`, call `scanStorageSurface` once per run on the pre-flighted source; feed the rendered list to the prompts and the surface itself to the check stage options (`stages/check.ts` passes it into `runStaticChecks`) — test: `server/test/machine.suite.ts` + `server/test/prompts.suite.ts` (`npm run server:test`); gate: `./scripts/gate.sh`
- [x] 3.5 Rewrite `schemaContextFor`: per-collection numeric floors from `burnedIdFloor`, "keep existing ids for existing concepts; allocate NEW ids strictly above the floor", dropping "do not reuse them" — test: `server/test/prompts.suite.ts` §schema context (`npm run server:test`); gate: `./scripts/gate.sh`
- [x] 3.6 Write `handoff/prompt-context.md`: the turn-context shapes (`GenerateTurnContext`/`PlanTurnContext`/`RepairTurnContext`) and the section helpers, so the rewrite work can extend the same file without re-reading it — gate: `./scripts/gate.sh`

## 4. Rewrite carries the app

- [x] 4.1 Add optional `app: { name, collections?: [{ name, fields: string[] }] }` to `RewriteRequest` in `contract/src/index.ts`, with the "names only" doc comment — test: `server/test/contract.suite.ts` (`npm run server:test`); gate: `./scripts/gate.sh`
- [x] 4.2 Teach `REWRITE_SYSTEM` and `buildRewriteMessages` that a request carrying `app` describes a change to an existing app: keep its name unless a rename is asked for, keep its existing concepts, describe only the change — test: `server/test/prompts.suite.ts` §rewrite (`npm run server:test`); gate: `./scripts/gate.sh`
- [x] 4.3 Pass the context through `server/src/routes/rewrite.ts` unchanged (validation only; the stub short-circuit stays) — test: `server/test/server-core.suite.ts` (`npm run server:test`); gate: `./scripts/gate.sh`
- [x] 4.4 Add a pure `buildRewriteAppContext(editing)` to `src/host/launcher/generation-request.ts` (type-only contract import) reading name from the manifest and display names from the entry's schema artifact — test: `src/host/launcher/test/generation-request.suite.ts` (`npm run launcher:test`); gate: `./scripts/gate.sh`
- [x] 4.5 Send it: `rewritePrompt` takes the optional context and puts it in the body; `LauncherRoot.openPlan` supplies it from `plan.editing` and omits it for a new app — test: `src/host/launcher/test/generation-client.suite.ts` (`npm run launcher:test`); gate: `./scripts/gate.sh`

## 5. Verb-time storage denials become diagnostics

- [x] 5.1 In `synthrun/report.ts`, extract the denial→diagnostic mapping into a pure function and let the six verb-time kinds through the closed-vocabulary filter with the engine's method and hint — test: `synthrun/test/acceptance.ts` §denial diagnostics (`npm run synthrun:test`); gate: `./scripts/gate.sh` then `npm run synthrun:test`
- [x] 5.2 Exclude `not_open`/`corrupt_storage` from diagnostics with a comment naming them host faults, and assert they stay in `report.trace` — test: `synthrun/test/acceptance.ts` (`npm run synthrun:test`); gate: `./scripts/gate.sh` then `npm run synthrun:test`
- [x] 5.3 Behavioural acceptance: a candidate that writes a date string into a `date` field produces a `type_mismatch` error diagnostic and a not-`ok` report — test: `synthrun/test/acceptance.ts` (`npm run synthrun:test`); gate: `./scripts/gate.sh` then `npm run synthrun:test`
- [x] 5.4 Pipeline assertion that an error-severity run diagnostic of kind `type_mismatch` routes the candidate to repair and delivers no record — test: `server/test/machine.suite.ts` §repair context (`npm run server:test`); gate: `./scripts/gate.sh`

## 6. Documentation and the engine-level regression

- [ ] 6.1 Document the schema artifact in `docs/sdk-reference.md` §5: collections/fields keyed by display name over burned ids, the six field types, `tombstones`, and `date` as an epoch-millisecond integer with a worked `Date.now()` example — test: `server/test/prompts.suite.ts` §sdk reference tripwire (`npm run server:test`); gate: `./scripts/gate.sh`
- [ ] 6.2 Disambiguate `Chart`'s `DayPoint.date` in §2 as a `YYYY-MM-DD` chart label unrelated to the storage `date` field type — test: `server/test/prompts.suite.ts` (`npm run server:test`); gate: `./scripts/gate.sh`
- [ ] 6.3 Extend the SDK-reference tripwire to fail when the schema-artifact section, any of the six field types, or the epoch-millisecond statement is missing — test: `server/test/prompts.suite.ts` (`npm run server:test`); gate: `./scripts/gate.sh`
- [ ] 6.4 Engine regression for the orphaning invariant: applying an artifact that replaces a collection id leaves the old table and rows byte-identical; an artifact omitting a field leaves its column untouched across an update — test: `src/host/storage-engine/test/acceptance.ts` (`npm run storage:test`); gate: `./scripts/gate.sh`
- [ ] 6.5 Full gate before hand-off: `./scripts/gate-full.sh` (adds the Chromium suites, `guard:metro`, knip and `openspec validate`) — gate: `./scripts/gate-full.sh`
