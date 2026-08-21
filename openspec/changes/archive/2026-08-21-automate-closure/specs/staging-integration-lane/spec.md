# staging-integration-lane (delta)

## MODIFIED Requirements

### Requirement: Scoped push policy preserves human-gated remote writes

Human gating of remote writes SHALL be anchored at the protected state (`main`), enforced server-side by a GitHub ruleset (require PR before merging, block force pushes, restrict deletions, require status checks) that agents cannot edit. With that anchor in place, pushes of non-`main` refs (including `--force-with-lease` of `integration/*` refs) issued by the main thread SHALL be allowed without a prompt; every push naming `main` (including refspec forms targeting `main`) SHALL remain denied for all callers as local belt-and-braces; and subagents SHALL remain denied all pushes, unconditionally. Ref recognition SHALL live in the bash-policy hook (not in permission-matcher patterns). The orchestrator SHALL verify the ruleset exists and blocks direct pushes before entering closure, and SHALL refuse closure without it. Compound commands containing a push SHALL be judged by the compound-command-policy capability (worst-segment verdict), so a chained payload is auditable segment-by-segment rather than blanket-denied. The bash-policy regression suite SHALL cover: main-push denied (all callers), branch-push allowed (main thread), any-push denied (subagent), refspec smuggling (`integration/x:main`) denied, and compound push judgment per compound-command-policy.

#### Scenario: Sonar iteration push

- **WHEN** the main thread runs `git push origin integration/<run-id>` during closure
- **THEN** the push runs without a prompt and triggers PR re-analysis

#### Scenario: Subagent push attempt

- **WHEN** any subagent invokes `git push` with any arguments, including an `integration/*` ref
- **THEN** the policy denies it deterministically

#### Scenario: Ruleset missing at closure entry

- **WHEN** the closure precondition probe finds no ruleset protecting `main` from direct pushes
- **THEN** the orchestrator refuses to enter closure and surfaces the missing ruleset to the human

### Requirement: main receives only the final ratified merge

`main` SHALL receive exactly one merge per run, ratified by the human merging the pull request on GitHub (the merge click on the reviewed PR is the ratification act; the ruleset makes any other path to `main` impossible). The PR SHALL be mergeable only after all of the following hold on the staging branch: every chain/fix merged, `gate-full` green on the tip, the external PR quality gate (SonarCloud) green, history cleanup applied, and `main`'s current tip an ancestor of the staging tip (verified mechanically via `git merge-base --is-ancestor main integration/<run-id>` before the ready-for-review flip). Because of the ancestor condition, the merged tree is identical to the verified staging tip; no post-merge regate on `main` is required. Sonar-fix iteration commits SHALL NOT appear on `main` (they are folded into semantic commits by the pre-merge cleanup). Local `gh pr merge` SHALL remain denied for all callers — merging happens only through the GitHub UI.

#### Scenario: Premature merge attempt

- **WHEN** the staging branch's `gate-full` or PR quality gate is not green
- **THEN** the PR remains in draft, required checks block the merge server-side, and the staging branch remains the iteration target

#### Scenario: Diverged staging branch

- **WHEN** `main` has advanced such that it is not an ancestor of the staging tip at ready-flip time
- **THEN** the ancestor check fails and remediation happens on the staging branch (rebase or restart); `main` is not modified

### Requirement: External quality iteration happens on a draft PR from the staging branch

The orchestrator SHALL push the staging branch and open a draft PR against `main` (`gh pr create --draft`) so SonarCloud automatic analysis and the CI `pull_request` jobs run on every push. The orchestrator SHALL poll the PR's checks (`gh pr checks`) as the trigger and verdict; on a red quality gate it SHALL ingest findings via the sonar-issue-ingestion capability and dispatch a fix-loop round whose integration target is the staging branch, then re-push and re-poll until green. Draft status is the "not yet reviewable" signal: the PR SHALL be flipped to ready-for-review (`gh pr ready`) only after Sonar is green, history cleanup has been applied and force-pushed, and the post-cleanup re-analysis has reported green on the new SHAs. The flip SHALL notify the human that the PR is ready for their review. Closure SHALL run on the attended host (never the deny-egress container); the human's presence is required, their execution is not.

#### Scenario: Sonar findings round

- **WHEN** SonarCloud reports a red quality gate on the staging-branch PR
- **THEN** findings are ingested programmatically, run through the fix loop with `FIXLOOP_INTEGRATION_BRANCH=integration/<run-id>`, merged serially into the staging branch, and the branch is re-pushed for re-analysis — with no human transcription or push execution

#### Scenario: Ready flip gated on final green

- **WHEN** cleanup has been force-pushed and the re-analysis has not yet reported on the new SHAs
- **THEN** the PR stays in draft until the checks report green, and only then is flipped to ready-for-review

### Requirement: History cleanup targets the staging branch before the final merge

The git-cleanup lane SHALL be branch-parameterized: the grant records `target_branch`/`target_sha`/`target_tree`, the lane worktree derives its name from the target, and the tip-tree identity check compares against the recorded target tip. In the standard flow the target is the run's staging branch and cleanup runs after the branch is Sonar-clean and before the ready-for-review flip. On `CLEANUP GATE PASS` the orchestrator SHALL itself apply the ref move and force-push (`git push --force-with-lease origin integration/<run-id>`), with the pinned tree-identity check and the intact `backup/pre-cleanup-<id>` ref as the retained safety properties. Grouping SHALL fold Sonar-fix commits into the semantic commits whose code they touch; no standalone Sonar-fix commit survives cleanup. The cleaner SHALL still never name `main` as a write target; force-pushing `main` SHALL NOT be part of the standard flow.

#### Scenario: Pre-merge cleanup run

- **WHEN** the git-cleanup lane runs with target `integration/<run-id>` and produces `cleanup/<run-id>-squashed`
- **THEN** the check passes only if the cleanup tip's tree is byte-identical to the recorded staging tip's tree, and the orchestrator applies the reset and force-push to the staging branch, not to `main`

#### Scenario: Sonar-fix commits are folded

- **WHEN** the staging branch carries Sonar-fix commits from quality-iteration rounds at cleanup time
- **THEN** the rewritten history contains no standalone Sonar-fix commits; their content is absorbed into the semantic commits they touch, and the tip tree is unchanged

#### Scenario: Run closure

- **WHEN** the human has merged the PR on GitHub
- **THEN** the orchestrator performs teardown — deletes `integration/<run-id>` local and remote, and fast-forward-syncs local `main` from origin; a parked run instead keeps its branch under the `wip/*` convention
