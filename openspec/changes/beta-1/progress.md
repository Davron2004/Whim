# beta-1: progress ledger

- 2026-09-25 run-start: staging `integration/beta-1` cut from MAIN_TIP `06ab2007a3ac4f3f04febf8f6ca35b3ff192848f` (origin/main); the approved proposal branch `proposal/beta-1` (`ae84263d`: artifacts, readiness doc, handoff) merged onto it as `f847b1cd`. Nine chains, one at a time, in chains.md order. Section 10 attended by the orchestrator.

## Decisions (orchestrator)

- R1. Local `main` was one commit ahead of `origin/main` (`eaf2dade`, the readiness doc, also on `proposal/beta-1`). Moved local `main` back to `origin/main` so MAIN_TIP is the published tip and the post-merge `pull --ff-only` works after a rebase-merge. Nothing lost: the commit arrives through the proposal merge.
- R2. The untracked `openspec/changes/beta-waitlist/findings-sonar-1.md` (PR #116 Sonar round 1, 0 issues) is committed on the staging branch with this ledger so the primary tree is clean for the gates.
- R3. Implementer models: Opus for chain-1 (the oldest reader every later server must serve), chain-2 (a concurrent FIFO with abort) and chain-4 (the prompt-flow state machine); Sonnet for the rest. One chain at a time, so never more than one Opus agent running.

## Ledger
