# staging-integration-lane — delta spec

## ADDED Requirements

### Requirement: Every harness run integrates on a per-run staging branch, never on main

At run start the orchestrator SHALL cut a staging branch `integration/<run-id>` (run-id = the OpenSpec change id for the feature loop, the fix-batch id for the fix loop) from `main`'s current tip, record that tip SHA in the run ledger, and set it as the run's integration target (`FIXLOOP_INTEGRATION_BRANCH`). All chain/fix merges, post-merge regates, and the pre-merge `gate-full` for that run SHALL target the staging branch. Worktree BASE SHALL be recorded from the staging branch's tip and recovered as `git merge-base <branch> integration/<run-id>`. At most one staging branch SHALL be active at a time.

#### Scenario: Chain merge lands on the staging branch

- **WHEN** the dispatcher merges a completed chain during a run with staging branch `integration/x`
- **THEN** the merge commit is created on `integration/x`, the regate runs on its new tip, and `main`'s tip is unchanged

#### Scenario: Second concurrent run is refused

- **WHEN** a run is started while another run's staging branch is active
- **THEN** the orchestrator halts and surfaces the active run instead of cutting a second staging branch

### Requirement: main receives only the final ratified merge

`main` SHALL receive exactly one merge per run, performed by the human, only after all of the following hold on the staging branch: every chain/fix merged, `gate-full` green on the tip, the external PR quality gate (SonarCloud) green, history cleanup applied, and `main`'s current tip is an ancestor of the staging tip (verified mechanically via `git merge-base --is-ancestor main integration/<run-id>`). Because of the ancestor condition, the merged tree is identical to the verified staging tip; no post-merge regate on `main` is required. Sonar-fix iteration commits SHALL NOT appear on `main` (they are consolidated by the pre-merge cleanup).

#### Scenario: Premature merge attempt

- **WHEN** a final merge into `main` is attempted while the staging branch's `gate-full` or PR quality gate is not green
- **THEN** the run closure checklist refuses the merge step and the staging branch remains the iteration target

#### Scenario: Diverged staging branch

- **WHEN** `main` has advanced such that it is not an ancestor of the staging tip at final-merge time
- **THEN** the ancestor check fails and remediation happens on the staging branch (rebase or restart); `main` is not modified

### Requirement: Scoped push policy preserves human-gated remote writes

Pushes of `integration/*` refs issued by the main thread SHALL fall through to a permission prompt (`ask`) that a human answers; every push naming `main` SHALL remain denied for all callers, and subagents SHALL remain denied all pushes. Ref recognition SHALL live in the bash-policy hook (not in permission-matcher patterns). The bash-policy regression suite SHALL cover: main-push denied, integration-push prompts (main thread), integration-push denied (subagent), and compound commands containing a push falling through to a prompt.

#### Scenario: Sonar iteration push

- **WHEN** the main thread runs `git push origin integration/<run-id>` during an attended run
- **THEN** the human sees a prompt and the push proceeds only on approval

#### Scenario: Subagent push attempt

- **WHEN** any subagent invokes `git push` with any arguments, including an `integration/*` ref
- **THEN** the policy denies it deterministically

### Requirement: The active staging branch is protected like main against subagent ref rewrites

Subagent force-operations naming an `integration/*` ref (`branch -f/-D/-m`, `checkout -B`, `switch -C`, and equivalents) SHALL be denied by the same tier-1 mechanism that protects `main`, using a static glob pattern rather than per-run enumeration. Merges into the staging branch SHALL be orchestrator-only, exactly as merges into `main` are today.

#### Scenario: Subagent tries to move the staging branch

- **WHEN** a subagent runs `git branch -f integration/<run-id> <sha>` from any location
- **THEN** the bash policy denies the command

### Requirement: External quality iteration happens on a draft PR from the staging branch

The staging branch SHALL be pushed (human-approved) and a draft PR opened against `main` so SonarCloud automatic analysis and the CI `pull_request` jobs run on every push. External findings SHALL be fixed in fix-loop rounds whose integration target is the staging branch. This iteration phase is attended-only: an unattended run proceeds up to the first push prompt and waits.

#### Scenario: Sonar findings round

- **WHEN** SonarCloud reports findings on the staging-branch PR
- **THEN** the findings are run through the fix loop with `FIXLOOP_INTEGRATION_BRANCH=integration/<run-id>`, merged serially into the staging branch, and the branch is re-pushed for re-analysis

### Requirement: History cleanup targets the staging branch before the final merge

The git-cleanup lane SHALL be branch-parameterized: the grant records `target_branch`/`target_sha`/`target_tree`, the lane worktree derives its name from the target, and the tip-tree identity check compares against the recorded target tip. In the standard flow the target is the run's staging branch, cleanup runs after the branch is Sonar-clean and before the final merge, and the rewritten branch is force-pushed (`--force-with-lease`) to the PR by the human. The cleaner SHALL still never name `main` as a write target; force-pushing `main` SHALL NOT be part of the standard flow.

#### Scenario: Pre-merge cleanup run

- **WHEN** the git-cleanup lane runs with target `integration/<run-id>` and produces `cleanup/<run-id>-squashed`
- **THEN** the check passes only if the cleanup tip's tree is byte-identical to the recorded staging tip's tree, and the human applies the reset and force-push to the staging branch, not to `main`

#### Scenario: Run closure

- **WHEN** the final merge into `main` has landed
- **THEN** the closure checklist deletes `integration/<run-id>` (local and remote) and closes the PR; a parked run instead keeps its branch under the `wip/*` convention
