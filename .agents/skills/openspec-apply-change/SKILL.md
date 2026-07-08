---
name: openspec-apply-change
description: Implement an OpenSpec change by dispatching it through the Whim build harness. Use when the user wants to start implementing, continue implementation, or work through tasks.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec (customized for the Whim harness — do not regenerate over this)
  version: "2.0"
  generatedBy: "1.3.1"
---

Implement an OpenSpec change through the Whim build harness. This skill is a router, not an implementation loop: the main thread NEVER implements change tasks inline.

Follow the runbook in `.claude/commands/opsx/apply.md` — read it now and execute it exactly. Summary of what it does (the runbook is authoritative where this summary is loose):

1. Select the change (argument → context inference → auto-select single → `openspec list --json` + AskUserQuestion).
2. Route by schema from `openspec status --change "<name>" --json`:
   - `whim-fixloop` → the /fix-loop orchestration (`.claude/commands/fix-loop.md`).
   - `whim-harness` → the worktree dispatch loop: one `implementer` subagent per context chain from chains.md, each in an orchestrator-created worktree branched from `main`, self-gated by `./scripts/gate.sh`, integrity-checked via `scripts/fixloop.sh`, serially merged with a post-merge regate, then `gate-full.sh` + a `reviewer` pass over the whole change.
   - anything else → stop and ask the user.

Architecture and rationale: docs/harness.md.

If a future `openspec update` regenerates this skill into an inline-implementation loop, that regeneration is WRONG for this repo — restore this router (the whim-harness schema's `apply.instruction` in `openspec/schemas/whim-harness/schema.yaml` records the same routing and survives regeneration).
