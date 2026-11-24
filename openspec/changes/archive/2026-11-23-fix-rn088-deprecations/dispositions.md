# Dispositions: fix-rn088-deprecations

Standalone /fix-loop on `integration/fix-rn088-deprecations` (cut from main @ 6341757f). Two lanes, one worktree
each: gh-281 (diagnostics, Node-testable) and gh-310 (iOS Done bar, needs an iOS simulator pass in light + dark).

Line shape: - <UTC time> <finding-id> <event> — <detail>

## Ledger
- 2026-11-23T22:18:31Z batch run-start — integration/fix-rn088-deprecations @ 6341757f; planners dispatched for gh-281 and gh-310
- 2026-11-23T22:20:00Z gh-281 stale-ok — evidence present at HEAD (fixloop.sh stale rc=0); orchestrator call: unhandled → console.error, handled → console.warn
- 2026-11-23T22:20:08Z gh-281 worktree-created — fix/gh-281, BASE 3447e83a, .claude/worktrees/gh-281; fix-worker dispatched
- 2026-11-23T22:22:00Z gh-310 stale-ok — evidence present at HEAD (rc=0); KeyboardStickyView chosen over KeyboardToolbar/native button label (plan.md)
- 2026-11-23T22:22:02Z gh-310 worktree-created — fix/gh-310, BASE a64b9af8, .claude/worktrees/gh-310; fix-worker dispatched
- 2026-11-23T22:33:09Z gh-281 fix-reported — fix/gh-281 8ea34d51; behavioral; worker gate PASS (worker shell ran node v22; full gate re-runs on v26)
- 2026-11-23T22:33:09Z gh-281 integrity-0 — 3 files, all in allowlist; removal ratchet PASS
- 2026-11-23T22:33:09Z gh-281 redcheck-red — coarse: reverting crash-capture.ts removes the new devRejectionTracking export, suite fails to build ("No matching export"); assertion non-vacuity left to the reviewer by inspection. Two false runs first: a test FILE as the test arg (Permission denied → reported RED) and an unquoted `--` inside the test command (split into prod files)
- 2026-11-23T22:34:26Z gh-281 verify-reject — code APPROVE-worthy; revision 1: doc overstates RN parity (pretty-format), header rewrap, sink doc 'messages' + test reuses exported sink type
- 2026-11-23T22:40:24Z gh-281 verify-approve — revision 1 e3a1b988 (comments + test type only) addresses all three defects; checked by orchestrator against the reviewer's list; worker gate PASS on node v26
- 2026-11-23T22:55:49Z gh-281 gatefull-pass — fix/gh-281 e3a1b988, node v26
- 2026-11-23T23:00:37Z gh-281 merged — c91666f8 on integration/fix-rn088-deprecations; regate-pass; worktree + branch removed
- 2026-11-23T23:12:44Z gh-310 fix-reported — revision 1 dad0ec52; worker gate PASS; deviations: bar rides down with the keyboard after blur (kept, avoids mid-slide pop); drag-dismiss catches 44pt lower than BASE (KeyboardGestureArea offset rejected: re-adds an invisible inputAccessoryView + delays resignFirstResponder) — orchestrator accepts both, surfaced to owner
- 2026-11-23T23:13:01Z gh-310 redcheck-red — prod reverted: 280 pass / 40 fail; coarse (most throw on the removed Keyboard.addListener mock), assertion-level non-vacuity covered by the worker's mutation checks + reviewer; round-2 reviewer dispatched
- 2026-11-23T23:16:21Z gh-310 verify-reject — round 2: all 10 round-1 items fixed; revision 2 (fresh Sonnet worker, test-only): pin box-none + scrim outside modal, rename whim-sheet-ui sheetCard→sheetModal, commit-body correction of dad0ec52's escape description
- 2026-11-23T23:22:17Z gh-310 verify-approve — revision 2 420f3ea8 (test-only) addresses round-2 defects 1-4; both new assertions red-checked by the worker (fail without box-none / with scrim inside); integrity 0 (9 files); ratchet PASS
- 2026-11-23T23:37:02Z gh-310 gatefull-pass — fix/gh-310 420f3ea8
- 2026-11-23T23:41:44Z gh-310 merged — 036964b3 on integration/fix-rn088-deprecations; regate-pass; worktree + branch removed
- 2026-11-23T23:51:33Z batch e2e-pass — integrated tip a2e91b28, iOS 27 sim debug, light+dark: no LogBox toast at launch or on the Whim-menu field, zero console warn/error, Done bar look + Done dismiss correct (scratchpad e2e-shots/)
