# Proposal: staging-branch-integration

## Why

Both harness loops merge directly into `main`, but SonarCloud — the one check that only runs post-push — then drags its entire iteration loop onto the published branch: Sonar-fix commits pollute `main`, the git-cleaner must rewrite `main`, and the human must force-push `main`, the single most dangerous git operation in a system whose trust model is "nothing rewrites main." `docs/harness.md` §9 already records the staging-branch tier as a deliberate future upgrade; this change builds it.

## What Changes

- **BREAKING (harness workflow):** the integration target for both loops moves from `main` to a per-run staging branch `integration/<run-id>`, cut from `main`'s tip by the orchestrator at run start. All serialized chain/fix merges, regates, and the pre-merge `gate-full` happen on the staging branch. (`fixloop.sh` already reads `FIXLOOP_INTEGRATION_BRANCH`; the runbooks and cleanup lane do not — research.md.)
- SonarCloud iteration moves to a draft PR opened from the staging branch: push → automatic analysis → findings fixed via `/fix-loop` with `FIXLOOP_INTEGRATION_BRANCH=integration/<run-id>` → repeat until clean. `main` no longer hosts Sonar-fix churn.
- The git-cleanup lane becomes branch-parameterized and runs against the staging branch *before* the final merge — semantic-commit history is produced on the branch; `main` is never force-pushed again in the standard flow.
- `main` receives exactly one human-ratified `--no-ff` merge per run, only after the staging branch passed `gate-full`, is Sonar-clean, is history-cleaned, and contains `main`'s current tip (so the merged tree is byte-identical to the verified staging tip — no post-merge regate needed by construction).
- The push policy gains one scoped relaxation: `git push` of `integration/*` refs from the **main thread** downgrades from hard-deny to `ask` (human approves each push at the prompt). Pushes naming `main` stay hard-denied for everyone; subagents stay fully denied for all pushes. The invariant "nothing reaches a shared remote without a human" is preserved literally.
- Tier-1 branch-protection deny patterns extend to cover the active staging branch against subagent force-ops, mirroring the existing `main`/`dev/v1` patterns.
- Docs updated: `docs/harness.md` §3/§4/§8/§9, `CLAUDE.md` harness summary.

## Capabilities

### New Capabilities
- `staging-integration-lane`: the per-run staging branch lifecycle — creation from `main`, merge/regate semantics on the branch, scoped push policy, draft-PR Sonar iteration, pre-merge history cleanup, the single final merge into `main`, and the one-active-run constraint.

### Modified Capabilities
<!-- none — no existing spec in openspec/specs/ covers the coding harness's integration process; static-checks and harness-diagnostics cover the mini-app checking pipeline, not this. -->

## Impact

- **Class 2 (human-ratified edits — most of this change):** `scripts/fixloop.sh` (generalize `gatefull`'s "main tree" wording; keep `INTEGRATION_BRANCH` the single seam), `scripts/git-cleanup-check.sh` (target-parameterized grant: `main_sha`/`main_tree` → `target_sha`/`target_tree`), `.claude/hooks/bash-policy.sh` (scoped push `ask`, staging-branch protection patterns), `.claude/settings.json` (permissions mirror), `.claude/commands/opsx/apply.md`, `.claude/commands/fix-loop.md`, `.claude/commands/git-cleanup.md`, `.claude/agents/git-cleaner.md` (+ `sync-codex --write` regeneration).
- **Unprotected:** `docs/harness.md`, `CLAUDE.md`, the bash-policy regression suite cases for the new push patterns.
- **No CI config change:** the existing `pull_request` trigger in `invariants.yml` already fires on the draft PR; pushes to `main` still trigger the push job (research.md: `invariants.yml:16-19`).
- **Not touched:** product code, gates' check content, the Class-1/Class-2 partition itself.
