# beta-1: progress ledger

- 2026-09-25 run-start: staging `integration/beta-1` cut from MAIN_TIP `06ab2007a3ac4f3f04febf8f6ca35b3ff192848f` (origin/main); the approved proposal branch `proposal/beta-1` (`ae84263d`: artifacts, readiness doc, handoff) merged onto it as `f847b1cd`. Nine chains, one at a time, in chains.md order. Section 10 attended by the orchestrator.

## Decisions (orchestrator)

- R1. Local `main` was one commit ahead of `origin/main` (`eaf2dade`, the readiness doc, also on `proposal/beta-1`). Moved local `main` back to `origin/main` so MAIN_TIP is the published tip and the post-merge `pull --ff-only` works after a rebase-merge. Nothing lost: the commit arrives through the proposal merge.
- R2. The untracked `openspec/changes/beta-waitlist/findings-sonar-1.md` (PR #116 Sonar round 1, 0 issues) is committed on the staging branch with this ledger so the primary tree is clean for the gates.
- R3. Implementer models: Opus for chain-1 (the oldest reader every later server must serve), chain-2 (a concurrent FIFO with abort) and chain-4 (the prompt-flow state machine); Sonnet for the rest. One chain at a time, so never more than one Opus agent running.

- R4. Flowbench (10.3) runs against production, before now (production image `0fb65d51` has the same server code as the pre-change staging tip) and after the beta-1 deploy, so both runs share one machine and roster (owner's pick after the local-server probes were denied). Cases: `evals/sets/visible` (22) plus `flowbench/limits` (4 new cases: 2 weather, 2 roommate-ping; the weather cases carry the placeholder slug `habit-tracker` because the tier-0 corpus has no weather slug and flowbench doesn't score by slug). Reports: `flowbench/{before,after}-{visible,limits}.json`.
- R5. Chain-block notes decided ahead of dispatch: chain-2 updates the load-test driver's expectations for the line (`devices > cap` now queues, and only `devices > cap + WHIM_QUEUE_MAX` refuses); chain-3 makes flowbench record a clarify `limit` as its own outcome (not a failure) and thread the new answer shape.

## Ledger
- 13:09 chain-1 dispatched: BASE `9a7a69d9a628be58e2877c0bde41de11d1892eaa`, worktree `.claude/worktrees/beta-1-1`, branch `chain/beta-1-1`, @whim symlinks pre-created, model Opus.
