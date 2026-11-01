# fix1 runner verdict (tip 500567e3, BASE cae360d2) — 2026-10-31

Overall: PASS

| Step | Result |
|---|---|
| 1 fast gate (23:24-23:29) | exit 0, "FAST GATE PASSED" (fix1-gate.log) |
| 2 server:e2e (-23:31:43) | exit 0 (fix1-e2e.log) |
| 3 integrity (FIXLOOP_INTEGRATION_BRANCH=integration/beta-2-fixes) | exit 0, INTEGRITY OK; 23 changed files, all in allowlist |
| 4 removal ratchet | exit 0, PASS, no drops (8 verification files compared) |
| 5 red-check provider-breaker,machine vs reverted provider-breaker.ts + machine.ts | RED (exit 0). Cause: tsc BUILD failure (provider-breaker.suite.ts TS2554 "Expected 2 arguments, got 3", 6 sites), not an assertion failure. Weak as a behavioral red: it proves the signature changed, not that the assertions bite. (fix1-redcheck.log) |
| 6 openspec 1.4.1 --strict / 1.14.1 | both exit 0, valid |
| 7 attribution in git log cae360d2..tip | none |

Worktree untouched (only untracked .gitkeep pre-existing). Nothing committed.
