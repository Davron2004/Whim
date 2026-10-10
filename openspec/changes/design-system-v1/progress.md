# Progress ledger: design-system-v1

Chains 1–14 and 23 were merged before this ledger existed; their record is the merge commits on
`integration/beta-2` and `docs/handoff-2026-10-09.md`. Staging branch: `integration/beta-2`
(`FIXLOOP_INTEGRATION_BRANCH`). Entries are appended as they happen.

## 2026-10-10, shift 1 (chains 15 and 16)

- run-resume: staging tip `a579f6f8`, in sync with origin, main tree clean.
- decision (orchestrator, owner away): chain-15 introduces the shared question component
  `CopyQuestionSheet` for "Copy the data, or start fresh?". It is shown only when
  `StoreAccess.canCopyData` is true; when false, "Make a copy" makes a fresh copy at once (a
  one-option question is not asked). design.md D8 ("no question") is superseded by the RESOLVED
  note in tasks.md and the delta spec's Forking requirement. Skipping the question for an app that
  never saved data needs `hasSavedData`, which is copy-app-data task 3.0, not chain-15.
- decision: a failed "Copy the data" in chain-15 surfaces one generic failure toast and creates
  nothing; the per-kind copy and the "Start fresh" offer stay with copy-app-data task 3.3.
- dispatched: chain-15 (home), BASE `a579f6f8`, worktree `.claude/worktrees/design-system-v1-chain-15`, branch `chain/design-system-v1-chain-15`, implementer on sonnet.
- report: chain-15 STATUS complete, fast gate PASS, commit `627a8bfb` (48 files). Class-A deviations
  logged: out-of-scope edits to `consent-flow.ts`, `flow-skeletons.tsx`, `launcher/index.ts`,
  `checks/test/repo/design-system.suite.ts` (stale exemption dropped), `scripts/release/upgrade-check/seed.yaml`
  (selectors accept the old and new menu word) and three test helpers; `fork-ui.suite.tsx` rewritten
  instead of deleted; a busy tile opens no menu.
- integrity: `fixloop.sh integrity chain/design-system-v1-chain-15` exit 0.
- merged: `71bd7a6d` (--no-ff). gate-full on `71bd7a6d`: FULL GATE PASSED (fast gate, knip, guard:metro,
  three Chromium suites, openspec validate, codex mirror). Tasks 15.1–15.6 ticked.
- deferred from chain-15, each with its owner: M18 delete reflow → task 22.3; the stuck/"honest light"
  ember on tiles → task 22.2; Stop leaving a "Stopped" tile → chain-17 (Stop lives on the Making page);
  the plan's proposed name on a tile being made → chain-16 (`attemptName` is the one place to read it);
  the composer's draft state is a prop nobody passes yet → chain-16 (task 16.1).
- reviewer on `a579f6f8..627a8bfb`: VERDICT findings, no report-mismatch, no check weakened. One medium
  (the Undo toast pauses under a screen reader while the purge timer keeps running, so Undo can be
  offered after the purge started) and lows (list-mode skeleton padding, live Settings button on the
  skeleton, skeleton count before the purge sweep, unfloored `gridLayout` with its guard tests deleted,
  dead `AppBusyOp 'delete'` and `COPY.customizePreviewLabel`, stale comments). → fix chain 15b.
- decision: the Undo window belongs to the toast. The purge completes when the Undo toast ends
  (timeout, swipe or replacement), so Undo works for as long as it is offered; under a screen reader
  that is longer than 10 s (the toast pauses there by system.md §7.1). The launch sweep stays the backstop.
- decision: a changing or change-failed app's menu has no Delete, as system.md §3.2 lists; the spec's
  "Delete on every installed app" is met once the change is stopped or discarded. No requirement changed.
- dispatched: chain-15b (reviewer fixes for home), BASE `dbfebc71`, worktree `.claude/worktrees/design-system-v1-chain-15b`, branch `chain/design-system-v1-chain-15b`, implementer on sonnet.
- report: chain-15b STATUS complete, 7/7 fixes, fast gate PASS, commit `071b2901`. Class-A: `ToastSpec.onEnd`
  added (shell-surfaces contract updated); `PurgeWindows` lost its timers (`finish(kind, id)` runs the purge,
  Home gained `onSettleDelete`/`onSettleDiscard`, `onUndo*` return boolean, "Too late to undo." toast);
  `HomeHeader.tsx` and `AppTile.tsx` touched outside the listed scope; a degenerate grid width gets a 64 pt cell.
- integrity: exit 0 (INTEGRITY OK).
