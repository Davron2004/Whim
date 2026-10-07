# Progress: health-probe-path

Ledger, appended as events happen.

- 2026-10-07T15:56:26Z run-start: runs on the ACTIVE staging branch integration/beta-1, not a new integration/health-probe-path. Reason: one active run at a time, and the owner wants this fix in the next beta-1 build (2026-10-07). BASE=4fdb562e57431211a081651fde683f50d278ffbc.
- 2026-10-07T15:56:28Z dispatched chain-1 BASE=4fdb562e57431211a081651fde683f50d278ffbc worktree=.claude/worktrees/health-probe-path-chain-1
- 2026-10-07T15:56:28Z dispatched chain-2 BASE=4fdb562e57431211a081651fde683f50d278ffbc worktree=.claude/worktrees/health-probe-path-chain-2
- 2026-10-07T16:09:46Z chain-2 report complete GATE PASS; integrity OK; merged
- 2026-10-07T16:12:37Z chain-2 regate-pass; tripwire candidate: pre-create @whim symlinks in EVERY chain worktree (server check fails without them even for app-only chains)
- 2026-10-07T16:13:06Z chain-1 report complete GATE PASS; integrity OK; merged
- 2026-10-07T16:15:47Z chain-1 regate-pass
- 2026-10-07T16:15:49Z dispatched chain-3 BASE=9c538749c01f9f06a2ad949b43eedf2b8b022375 worktree=.claude/worktrees/health-probe-path-chain-3
- 2026-10-07T16:33:53Z chain-3 report complete GATE PASS; integrity OK; merged
- 2026-10-07T16:36:33Z chain-3 regate-pass
- 2026-10-07T16:44:10Z reviewer verdict SHIP (0 high, 0 medium, 6 low); dispatched fix-1 for the low items BASE=44514ff0f6bfd3573e3e1dff82d30bb1c7272321
- 2026-10-07T16:48:44Z rollout 4.1: deployed server+site 44514ff0 (us-east4); live /health 200 commit 44514ff0, /healthz still Google 404 (expected); /v1/generate 400; privacy 200
- 2026-10-07T16:48:44Z rollout 4.2: uptime check path -> /health; 'Whim: API down' re-enabled; awaiting first passing results
- 2026-10-07T16:55:07Z rollout 4.2 confirmed: uptime check passes in usa-virginia, usa-oregon, eur-belgium on /health (16:53-16:54Z)
