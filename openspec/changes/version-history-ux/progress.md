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

## FINDINGS / tripwire candidates
- **F1 (correctness, engine.ts — chain-1 merged code):** `timeline()` on a **non-diverged fork** (0 own snapshots since fork point → fork tip == shared fork point) surfaces the ORIGINAL lineage's later snapshots, because `isSameLine` is pure DAG-ancestry. Verified by chain-2 (probe, deleted). Violates MUST scenarios "Fork entry history" (app-launcher) and "Other lineages excluded" (mini-app-versioning). `rollback` shares the predicate → a fresh fork could restore onto the original's snapshot. Self-heals once the fork takes any snapshot. `history()` is safe but design mandates `timeline()` for roll-forward. Documented in `handoff/store-access-history.md`. **DISPOSITION: pending user decision (fix-in-run engine chain before chain-3 vs defer to follow-up change).**
