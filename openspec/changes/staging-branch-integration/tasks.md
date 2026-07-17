# Tasks: staging-branch-integration

## 1. Scripts parameterization (Class 2 — human-applied)

- [x] 1.1 `scripts/fixloop.sh`: generalize `gatefull`'s "main tree" prose/`die` messages to "primary checkout / integration tree"; audit that no subcommand assumes the checked-out branch is literally `main` beyond `$INTEGRATION_BRANCH` (research.md flags `:181-204`); keep `INTEGRATION_BRANCH` the single seam.
- [x] 1.2 `scripts/git-cleanup-check.sh`: generalize the grant schema `main_sha`/`main_tree` → `target_branch`/`target_sha`/`target_tree`; resolve `refs/heads/$target_branch`; derive backup-ref and printed apply commands from the target; printed apply text force-pushes the target branch with `--force-with-lease`, never `main`.
- [x] 1.3 Verify legacy compatibility: a grant naming `target_branch: main` still works (pre-existing-history cleanup mode), and the check refuses a grant whose target branch does not exist.

## 2. Push + ref policy (Class 2 — human-applied)

- [x] 2.1 `.claude/hooks/bash-policy.sh`: add main-thread-only `ask` fall-through for `git push` whose ref args match `integration/*` (ref parsing in the hook, GIT_C-normalizer precedent); pushes naming `main` and all subagent pushes stay denied; compound commands keep falling through to a prompt.
- [x] 2.2 `.claude/hooks/bash-policy.sh`: extend the tier-1 force-op deny patterns (`branch -f/-D/-m`, `checkout -B`, `switch -C`) with an `integration/*` glob alongside the literal `main`/`dev/v1` patterns.
- [x] 2.3 `.claude/settings.json`: narrow the blanket `Bash(git push:*)` deny just enough that the hook's `ask` is reachable for the scoped case; document in the run ledger which matcher form was verified to work.
- [x] 2.4 Extend the tracked bash-policy regression suite with the spec'd cases: main-push denied (all callers), integration-push asks (main thread), integration-push denied (subagent), refspec-smuggling denied, compound-command-with-push denied. Red-check: the behavioral case must fail against the pre-change hook. (Done — 17/17 vs new hook; red vs e3d6674 hook at the ask case.)

## 3. Loop runbooks (Class 2 — human-applied)

- [x] 3.1 `.claude/commands/opsx/apply.md`: add the run-start step (cut `integration/<change-id>` from `main`'s recorded tip, set `FIXLOOP_INTEGRATION_BRANCH`, record in ledger; refuse if another staging branch is active); rewrite the cited literal-`main` lines (`:8,:24,:33,:42,:45,:46` per research.md) to target the run's staging branch.
- [x] 3.2 `.claude/commands/opsx/apply.md`: replace the post-gate-full closing steps with the staging closure sequence — draft-PR Sonar iteration (fix-loop rounds on the staging branch), git-cleanup on the staging branch, ancestor check, human final merge into `main`, branch/PR cleanup.
- [x] 3.3 `.claude/commands/fix-loop.md`: same rewrite for the fix loop (`:1,:14,:21,:24,:38,:44` per research.md) — standalone fix-loop runs cut `integration/<batch-id>` at start and close with the same sequence; nested runs (inside a change's Sonar iteration) reuse the active staging branch instead of cutting one.
- [x] 3.4 `.claude/commands/git-cleanup.md` + `.claude/agents/git-cleaner.md`: thread the target-branch parameter through the lane (worktree/branch names derived from target; grant fields per task 1.2); keep the cleaner's "never name `main` as a write target" rule verbatim; run `node scripts/sync-codex.mjs --write` after the agent edit.

## 4. Documentation (dispatchable)

- [ ] 4.1 `docs/harness.md`: rewrite §3 trust model (staging branch is the single-writer integration target; `main` is the published branch receiving one ratified merge per run), update §4's SonarCloud row and §8's push sentence to describe the scoped `ask`, move the §9 staging-tier bullet from future to current stance, and add the attended-only push gotcha to §11.
- [ ] 4.2 `CLAUDE.md`: update the build-harness summary paragraph (integration branch wording, git-cleanup targeting, Sonar iteration location) to match harness.md.
- [ ] 4.3 `docs/coding-harness-diagram.md`: update the pipeline diagrams' merge-target and closure-phase arrows for the staging lane.
