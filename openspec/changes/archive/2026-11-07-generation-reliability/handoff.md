# handoff: generation-reliability (orchestrator state)

Staging branch `integration/beta-2-fixes` (cut from main 899a2bbc, pushed to origin). Ledger: `progress.md`. Planning: `research.md`, `rc-58.md`, `proposal.md`, `design.md`, `tasks.md`, `chains.md`, `specs/`.

## Done
- #58 root cause (rc-58.md): a module-scope candidate throw aborts the bundle script before mount, so the probes never run and the run ended `run_unverified`. Reproduced with real Chromium (probe/rc-58 58b8df82, not for merge). Production: 17 generations, 0 terminal failures since 2026-10-07.
- chain-run-verdict (#58) merged ba91fad7; chain-wire (#66 wire, protocol level 2, `failure.cause`) merged 3c5884fd; regate after both PASS; chain-upstream (#57 plan resend, #66 classification + 503 on clarify/rewrite) merged 612c9de5.
- Parked issues filed: #273, #274, #275, #276.

## State at stop
- All chains merged (run-verdict, wire, upstream, breaker, fix1); tasks.md fully ticked; local gate-full PASS on dffaaf66.
- Draft PR #277 (integration/beta-2-fixes → main): checks SETTLED PASS (SonarCloud, isolation-suite, quality-gate).

## Left (top-level decides)
1. /git-cleanup on the staging branch, ready flip, merge.
2. Deploy the server first (`docs/deploy.md`); the alert policy is applied on deploy. Then an app build (protocol level 2) for the device side of #66.
3. /opsx:archive generation-reliability after merge.

## Gotchas
- brief-rules.md names `integration/beta-2`; this run uses `FIXLOOP_INTEGRATION_BRANCH=integration/beta-2-fixes`.
- `fixloop.sh redcheck` splits the test command on `--`: wrap it in a script. `server:test` runs tsc first, so a whole-file revert is a coarse (build) RED; builders show type-satisfying mutation reds.
- `deploy/lib.sh` `WHIM_SMOKE_PROTOCOL_LEVEL` must follow `PROTOCOL_LEVEL` (deploy-config pins it).
- Deploy order: server first (level 2 understood); old builds get the compat notice on the failure screen.
