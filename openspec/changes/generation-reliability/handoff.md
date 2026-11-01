# handoff: generation-reliability (orchestrator state)

Staging branch `integration/beta-2-fixes` (cut from main 899a2bbc, pushed to origin). Ledger: `progress.md`. Planning: `research.md`, `rc-58.md`, `proposal.md`, `design.md`, `tasks.md`, `chains.md`, `specs/`.

## Done
- #58 root cause (rc-58.md): a module-scope candidate throw aborts the bundle script before mount, so the probes never run and the run ended `run_unverified`. Reproduced with real Chromium (probe/rc-58 58b8df82, not for merge). Production: 17 generations, 0 terminal failures since 2026-10-07.
- chain-run-verdict (#58) merged ba91fad7; chain-wire (#66 wire, protocol level 2, `failure.cause`) merged 3c5884fd; regate after both PASS; chain-upstream (#57 plan resend, #66 classification + 503 on clarify/rewrite) merged 612c9de5.
- Parked issues filed: #273, #274, #275, #276.

## In flight
- chain-breaker (tasks 4.1–4.6) in `.claude/worktrees/generation-reliability-breaker`, BASE 612c9de5.

## Left
1. chain-breaker: runner (gate.sh, integrity with scratch allowlist, ratchet, red-checks) → Opus review → fix → merge → tick 4.x.
2. `gate-full.sh` once on the staging tip (`capped-run.sh --mb 8192 --secs 3000`), one gate at a time.
3. Whole-change Opus review (b6a3b2d6..tip) with spec excerpts.
4. Push; PR `integration/beta-2-fixes` → main; poll `scripts/fixloop.sh checkverdict`; Sonar round if red (`node scripts/sonar-pr-issues.mjs --pr <n>`). STOP at PR green: no merge, no deploy, no /git-cleanup.

## Gotchas
- brief-rules.md names `integration/beta-2`; this run uses `FIXLOOP_INTEGRATION_BRANCH=integration/beta-2-fixes`.
- `fixloop.sh redcheck` splits the test command on `--`: wrap it in a script. `server:test` runs tsc first, so a whole-file revert is a coarse (build) RED; builders show type-satisfying mutation reds.
- `deploy/lib.sh` `WHIM_SMOKE_PROTOCOL_LEVEL` must follow `PROTOCOL_LEVEL` (deploy-config pins it).
- Deploy order: server first (level 2 understood); old builds get the compat notice on the failure screen.
