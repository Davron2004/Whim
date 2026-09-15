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
- 01:35 F6 fixed (comment points at ../platform/hermes-polyfills) and F8 fixed (the four probe screens root in a default-edges SafeAreaView; device check pending on the attended iPhone run), structural-no-test per plan.md · commit f8e78b2 · integrity OK · merged · regate-pass.
- 02:21 NEW F10 (orchestrator-found): src/host/launcher/test/{consent-options,error-reason,probe-gate,refusal-target,report-send}.suite.ts call h.eq(a, b) without the required msg argument (harness.ts:21 eq(a, b, msg)); failures would print no label; the IDE reports TS2554 because the gate typecheck does not cover these suites. Fix: add messages. Waits with the other launcher findings.
- 03:24 dispatching the remaining launcher findings with the store-launch-compliance re-review findings in two file-disjoint fix chains at BASE 68d9fb4: final-fixes-a (N1 N2 N4 N7b + F5 + F10) and final-fixes-b (N3 N5 N6 N7a + F1 F3 F4 F9).
