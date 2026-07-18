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
- **regate-pass** chain-1 — FAST GATE PASSED on merged tip.
