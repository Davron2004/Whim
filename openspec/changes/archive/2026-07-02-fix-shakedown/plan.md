# Plan: fix-shakedown

<!-- DONE specs produced by read-only planners; checklist ticked ONLY at terminal ledger events. -->

## Checklist

- [x] ST-1 — checkValue json/undefined → structured StorageError (behavioral) — merged
- [x] ST-3 — history() narrow bare catch to NotFoundError (behavioral) — merged
- [x] RT-2 — water-counter rollback-on-failure (structural-no-test) — merged (1 revision)
- [x] SRV-3 — DeviceIdError satisfies-wiring in app.ts (structural-no-test) — merged
- [x] HL-DOCS — WebViewHost fossils in CLAUDE.md/v1-roadmap/cue-backend (structural-no-test) — merged
- [x] D7-CONTROL — negative control: stale-skip at exit 7, as designed (terminal: skipped)

## ST-1

- reconciled: defect confirmed at HEAD (planner); stale check exit 0
- fix sketch: add `value === undefined` rejection at top of `checkValue` (uniform for every field type, flows through existing type_mismatch path via engine.ts assertValue); add explicit `value === undefined` guard in `kv.set` (byteLen's TextEncoder.encode default-arg coercion returns 0 for undefined, bypassing the size cap before the raw bind reaches the driver)
- allowlist: src/host/storage-engine/marshal.ts · src/host/storage-engine/engine.ts · src/host/storage-engine/test/acceptance.ts
- test-class: behavioral
- test: acceptance.ts asserts (a) records.append/update with undefined on a json field throws StorageEngineError kind type_mismatch (not a raw driver error); (b) kv.set(key, undefined) throws structured StorageError. `npm run storage:test`
- expected red-without: (a) no throw or unstructured throw; (b) raw SQLite bind error or silent success
- severity: low (planner; critic ranked the finding high — surfaced at APPROVE)
- class-1 grant: none
- evidence: $CLAUDE_JOB_DIR/tmp/ev-st1.txt (stale exit 0)

## ST-3

- reconciled: confirmed at HEAD; stale check exit 0
- fix sketch: bind the caught error; `err instanceof git.Errors.NotFoundError` → return [] (unborn HEAD); otherwise re-throw. Errors namespace confirmed on the existing `* as git` import; host-side Node/Hermes, no polyfill interaction with error classes.
- allowlist: src/host/version-store/engine.ts · src/host/version-store/test/acceptance.ts
- test-class: behavioral
- test: MemoryFs subclass (C1-test pattern, acceptance.ts:376-382) with poisoned readFile throwing a generic Error after HEAD exists → assert history() REJECTS; assert bare-repo path still resolves []. `npm run vstore:test`
- expected red-without: corrupted-read case resolves [] instead of rejecting → new assertion fails
- severity: med
- class-1 grant: none
- evidence: $CLAUDE_JOB_DIR/tmp/ev-st3.txt (stale exit 0)

## RT-2

- reconciled: confirmed at HEAD; stale check exit 0
- fix sketch: capture pre-add total before optimistic setTotal; revert in catch; count appends that actually landed and advance history by that count
- allowlist: fixtures/water-counter.app.tsx
- test-class: structural-no-test — only suite exercising the fixture is invariants bridge runner (owner territory) and it drives happy-path only; no Node suite executes fixture bundles. Regression = build + suites green; assurance = reviewer inspection.
- test: none (structural-no-test)
- severity: med
- class-1 grant: none
- evidence: $CLAUDE_JOB_DIR/tmp/ev-rt2.txt (stale exit 0)

## SRV-3

- reconciled: confirmed at HEAD; stale check exit 0
- fix sketch: import `type { DeviceIdError } from '@whim/contract'` in server/src/app.ts; annotate both 400-body literals `satisfies DeviceIdError` (zero runtime cost; strict tsc covers app.ts)
- allowlist: server/src/app.ts
- test-class: structural-no-test — tsc is the enforcing check
- test: none (structural-no-test); typecheck in gate
- severity: low
- class-1 grant: none
- evidence: $CLAUDE_JOB_DIR/tmp/ev-srv3.txt (stale exit 0)

## HL-DOCS

- reconciled: all three fossils confirmed at HEAD; WebViewHost.tsx absent; replacements per decisions.md #43 D6
- fix sketch: CLAUDE.md:64 → "`src/host/launcher/useMiniAppHost.ts` (via `MiniAppView`)"; v1-roadmap.md:200 → "`useMiniAppHost`/`MiniAppView` (one WebView == one realm == one app"; v1-roadmap.md:207 → `src/host/launcher/useMiniAppHost.ts`; cue-backend.ts:5 → "(`useMiniAppHost` injects it into `createDefaultRegistry`)"
- allowlist: CLAUDE.md · docs/v1-roadmap.md · src/host/cue-backend.ts
- test-class: structural-no-test — doc/comment only
- test: none (structural-no-test)
- severity: low
- class-1 grant: none
- evidence: $CLAUDE_JOB_DIR/tmp/ev-hldocs.txt (stale exit 0)

## D7-CONTROL

- reconciled: ALREADY-FIXED (planner: HEAD calls db.executeSync directly behind assertExecuteSyncAvailable) — AND deterministic stale check exit 7 (evidence missing at HEAD). TERMINAL: skipped (stale-skip). Negative control behaved exactly as designed; no worktree created.
