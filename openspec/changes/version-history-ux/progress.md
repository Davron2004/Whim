# Progress ledger: version-history-ux

## Run
- **run-start** 2026-07-18 — staging branch `integration/version-history-ux`, MAIN_TIP
  `17fad5bf17810d425ce467128c653fee5df083f6` (main tip after sdk-charts local-main ratification,
  commit 17fad5b). Dispatcher = main thread. Remote flow deferred (local-main workflow per user
  directive); closure will ratify into **local** main, mirroring sdk-charts.

## Chain DAG (strictly linear — contracts force serial)
chain-1 store-timeline → chain-2 launcher-store-surface → chain-3 history-screen-ui →
chain-4 docs-decision (`after: chain-3`). Task 5.2 (on-device acceptance) is attended/human-run;
it closes the change after chain-4 merges. No Class-2 config touched by any chain.

## Dispositions (append as they happen)
- **dispatched** chain-1 store-timeline — BASE `17fad5bf17810d425ce467128c653fee5df083f6` (= staging tip = MAIN_TIP), worktree `.claude/worktrees/version-history-ux-1`, branch `chain/version-history-ux-1`, built OK. Tasks 1.1, 2.1–2.2. Writes contract `handoff/timeline-verb.md`.
- **report** chain-1 — STATUS complete, GATE PASS (vstore 98/98), commit `4fcb1cd`, 0 deviations. Added `timeline(appId,{limit?})` to engine.ts + 7 §timeline tests. `index.ts` needed no new export (VersionStore re-exported wholesale). Handoff `timeline-verb.md` (64 lines). Shape-parity with `history` confirmed on undivergent line.
- **integrity** chain-1 — exit 0, INTEGRITY OK. 3 files vs BASE, all in scope (engine.ts, test/acceptance.ts, handoff).
- **merged** chain-1 → `integration/version-history-ux` @ `053ec08` (`--no-ff`). Ticked tasks 1.1/2.1/2.2.
- **regate-pass** chain-1 — FAST GATE PASSED on merged tip. Cleaned up worktree + branch. Committed bookkeeping `7387930`.
- **dispatched** chain-2 launcher-store-surface — BASE `7387930b7a8f5ea0b0cb3fc04dc39a2e4d3c7d7b` (staging tip post chain-1), worktree `.claude/worktrees/version-history-ux-2`, branch `chain/version-history-ux-2`, built OK. Tasks 1.2, 3.1–3.2. Reads `handoff/timeline-verb.md`. Writes contract `handoff/store-access-history.md`.
- **report** chain-2 — STATUS complete, GATE PASS (launcher:test 884), commit `fb903aa`. 7 StoreAccess wrappers + `fork(entry, versionId?)` + `prompt-envelope.ts`. Class-A: test-only monotonic clock in store-access.suite harness (mirrors vstore clock; fixes second-granularity ordering flakiness). Verified re-pin = **moves** (git.tag force:true), no normalize layer needed → resolves D8.
- **integrity** chain-2 — exit 0, INTEGRITY OK. 7 files vs BASE, all in launcher layer + handoff.
- **merged** chain-2 → `integration/version-history-ux` @ `3ce28b7` (`--no-ff`). Ticked tasks 1.2/3.1/3.2.
- **regate-pass** chain-2 — FAST GATE PASSED on merged tip.

- **dispatched** chain-3 history-screen-ui — BASE `8aefd211c8aeddb6364a0316a737513c9b1ab751` (staging tip post chain-2), worktree `.claude/worktrees/version-history-ux-3`, branch `chain/version-history-ux-3`, built OK. Tasks 1.3, 4.1–4.6. Reads `handoff/store-access-history.md`. Includes the F1 UI guard. Writes no contract.
- **report** chain-3 — STATUS complete, GATE PASS (launcher:test 1164/1164), commit `6a96ebf`, 6/6 tasks. New `HistoryScreen.tsx` + RN-free `history-logic.ts` + 20 behavioral tests. F1 guard = **history()-for-all-forks** (no cheap divergence signal without new store state), timeline() for primary lineage, interim comment at listing site, F1-repro acceptance test. Class-A: imports `diffSchemas`/`emptyApplied` from storage-engine `schema.ts`+`contract.ts` submodules (not the index barrel — barrel statically requires op-sqlite, breaks esbuild Node bundling). Extended product-verbs guard to cover new `addedFieldsLine` copy (strengthens, not weakens).
- **integrity** chain-3 — exit 0, INTEGRITY OK. 9 files vs BASE, all launcher layer + tests.
- **merged** chain-3 → `integration/version-history-ux` @ `f09d16b` (`--no-ff`). Ticked tasks 1.3, 4.1–4.6.
- **regate-pass** chain-3 — FAST GATE PASSED on merged tip.
- **MEMORY candidate (chain-3):** any Node-test-bundled module needing `diffSchemas`/`emptyApplied`/storage-engine schema types must import from `src/host/storage-engine/schema.ts`+`contract.ts` directly, never the `index.ts` barrel (barrel's `createStorageEngine`/`deleteStorage` statically `require()` op-sqlite/better-sqlite3, which esbuild eagerly resolves even for unused exports → breaks Node suites). → apply at closure.

- **dispatched** chain-4 docs-decision — BASE `934e5b08b6d155a1df410fca243cc43b77a6a45c` (staging tip post chain-3), worktree `.claude/worktrees/version-history-ux-4`, branch `chain/version-history-ux-4`, built OK. Task 5.1 (docs-only, `docs/decisions.md`). Writes no contract.
- **report** chain-4 — STATUS complete, GATE PASS, commit `42341f7`, 0 deviations. Decision **#48** appended (D1/D2/D4 + honest F1 limitation + deferral to linked-apps-data-model). As-built guard confirmed: `listVersions = app.storeId != null ? history(app) : timeline(app)`.
- **integrity** chain-4 — exit 0, INTEGRITY OK. Only `docs/decisions.md`.
- **merged** chain-4 → `integration/version-history-ux` @ `4d68248` (`--no-ff`). Ticked task 5.1. (5.2 on-device acceptance = attended/human-run, left open.)
- **regate-pass** chain-4 — FAST GATE PASSED on merged tip. All 4 chains merged.

## FINDINGS / tripwire candidates
- **F1 (correctness, engine.ts — chain-1 merged code):** `timeline()` on a **non-diverged fork** (0 own snapshots since fork point → fork tip == shared fork point) surfaces the ORIGINAL lineage's later snapshots, because `isSameLine` is pure DAG-ancestry. Verified by chain-2 (probe, deleted). Violates MUST scenarios "Fork entry history" (app-launcher) and "Other lineages excluded" (mini-app-versioning). `rollback` shares the predicate → a fresh fork could restore onto the original's snapshot. Self-heals once the fork takes any snapshot. `history()` is safe but design mandates `timeline()` for roll-forward. Documented in `handoff/store-access-history.md`. **DISPOSITION: user chose FIX-IN-RUN before chain-3 (2026-07-18); researcher then found NO state-free correct fix exists → re-escalated.**
- Researcher conclusion (verified): lineage == a git branch ref; snap tags are GLOBAL (`whim/snap/gN`); commits carry no lineage stamp; engine reads no reflog. So "roll-forward target of mine" is temporal and structurally indistinguishable from "sibling fork's descendant sharing my tip" using current DAG + branch-tips alone. Bug is BROADER than non-diverged forks (any lineage whose tip is an ancestor of another lineage's snapshots, e.g. main rolled-back-to-A with a diverged fork off B). Cites: engine.ts isSameLine 331-336, timeline 271-294, fork 389-402, SNAP_TAG/nextSnapId 59/142-149; design.md:29 (D2 furthest-tip rejection).
- Correct fix = version-store DATA-MODEL change (per-snapshot lineage stamp OR per-lineage reflog) + rollback re-gating + legacy-unstamped handling → belongs with **linked-apps-data-model** (next change), not this UX change. Single-lineage rollback/roll-forward flow (the primary UX, no forks) is CORRECT as-is; only multi-lineage fork interactions over-include.
- **RE-ESCALATED to user for path decision (data-model-fix-in-run vs defer-to-linked-apps + UI guard vs ship-documented).**
- **RESOLVED (user, 2026-07-18): DEFER correct fix to linked-apps-data-model; add a UI guard in chain-3 now.**
  Guard: History lists the PRIMARY lineage via `timeline()` (roll-forward); **fork entries list via the always-safe `history()`** (own line only, never foreign) — optionally `timeline()` for *diverged* forks IF a cheap divergence signal already exists, else `history()` for all forks. Safety rule: never show/restore another lineage's versions. Acceptance test must cover the F1 repro (fresh fork → only its own line). Residual gaps (diverged-fork roll-forward; original rolled back past a fork point) documented, fixed by the lineage-stamp data-model change.
- **CARRY-FORWARD → linked-apps-data-model:** implement per-snapshot lineage stamping (or per-lineage reflog) so `timeline`/`rollback` are lineage-correct; retire the chain-3 UI guard then. Surface to user at that change's proposal (may need a proposal amendment — F1 is not yet in linked-apps' artifacts).
