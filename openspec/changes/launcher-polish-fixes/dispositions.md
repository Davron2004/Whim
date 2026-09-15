# Dispositions: launcher-polish-fixes

<!--
  Append-only run ledger, written by the orchestrator AS EACH disposition
  happens — never batched at the end, never rewritten (correct by appending).
  Initialized by the planner at plan time; nothing has been dispatched.

  Line shape: - <UTC time> <finding-id> <event> — <detail>
  Events: stale-ok | stale-skip
        | worktree-created (branch, BASE sha, path)
        | fix-reported | redcheck-red | redcheck-vacuous
        | integrity-<0|3|4|6> | verify-ok | verify-reject
        | gatefull-pass | gatefull-fail
        | merged (sha) | regate-pass | regate-fail (reverted)
        | parked (reason, wip/ branch) | escalated (why) | skipped (why)
  Exactly ONE terminal event per finding: merged | parked | escalated | skipped.

  Run-start reminders from plan.md: ledger F2 `skipped` (already fixed by
  platform-release-readiness chain-2). F1, F3, F4, F5, F7, F9 wait for
  store-launch-compliance chain-7 to merge; F6 and F8 are eligible at once.
-->

## Ledger
- 01:30 orchestrator pre-dispatch dispositions: F2 skipped (already fixed by platform chain-2); F7 skipped (contract-mirror.ts deleted in 075005e); F7's NUL-byte note is covered by fix-launcher-wiring (reviewer L2). F1, F3, F4, F5, F9 touch launcher files, so they wait for fix-launcher-wiring and fix-consent-retry; F6 and F8 are eligible now.
