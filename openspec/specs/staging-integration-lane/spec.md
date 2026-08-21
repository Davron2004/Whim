# staging-integration-lane

## Purpose

Created by syncing the `staging-branch-integration` change. Defines the per-run staging-branch integration model for the coding harness: every run integrates on its own `integration/<run-id>` branch (never directly on `main`), `main` receives exactly one human-ratified merge per run, remote-write policy stays scoped and human-gated, the active staging branch is protected like `main` against subagent ref rewrites, external quality iteration (SonarCloud) happens on a draft PR from the staging branch, and history cleanup targets the staging branch before the final merge.

Extended by the `harden-closure-lane` change with the closure phase's own verdict discipline: the check poll must assert a positive verdict from every required check rather than infer one from the absence of a pending signal, every command a closure step instructs must be runnable by the caller it names *in the environment that caller runs in*, a staging run must be parkable by the documented tool, and teardown must state the residue a sandboxed branch deletion leaves behind.

Extended by the `automate-closure` change to remove human-in-the-loop steps that a server-side ruleset or a programmatic ingestion script can now perform safely: with a GitHub ruleset anchoring human gating at `main`, non-`main` pushes by the main thread (including staging force-pushes) no longer prompt; the human's merge click on the reviewed PR is the sole ratification act named directly, replacing the more general "performed by the human"; Sonar findings are ingested by the sonar-issue-ingestion capability instead of human transcription; and the orchestrator applies the cleanup lane's reset and force-push itself instead of the human doing so.

## Requirements

### Requirement: Every harness run integrates on a per-run staging branch, never on main

At run start the orchestrator SHALL cut a staging branch `integration/<run-id>` (run-id = the OpenSpec change id for the feature loop, the fix-batch id for the fix loop) from `main`'s current tip, record that tip SHA in the run ledger, and set it as the run's integration target (`FIXLOOP_INTEGRATION_BRANCH`). All chain/fix merges, post-merge regates, and the pre-merge `gate-full` for that run SHALL target the staging branch. Worktree BASE SHALL be recorded from the staging branch's tip and recovered as `git merge-base <branch> integration/<run-id>`. At most one staging branch SHALL be active at a time.

#### Scenario: Chain merge lands on the staging branch

- **WHEN** the dispatcher merges a completed chain during a run with staging branch `integration/x`
- **THEN** the merge commit is created on `integration/x`, the regate runs on its new tip, and `main`'s tip is unchanged

#### Scenario: Second concurrent run is refused

- **WHEN** a run is started while another run's staging branch is active
- **THEN** the orchestrator halts and surfaces the active run instead of cutting a second staging branch

### Requirement: main receives only the final ratified merge

`main` SHALL receive exactly one merge per run, ratified by the human merging the pull request on GitHub (the merge click on the reviewed PR is the ratification act; the ruleset makes any other path to `main` impossible). The PR SHALL be mergeable only after all of the following hold on the staging branch: every chain/fix merged, `gate-full` green on the tip, the external PR quality gate (SonarCloud) green, history cleanup applied, and `main`'s current tip an ancestor of the staging tip (verified mechanically via `git merge-base --is-ancestor main integration/<run-id>` before the ready-for-review flip). Because of the ancestor condition, the merged tree is identical to the verified staging tip; no post-merge regate on `main` is required. Sonar-fix iteration commits SHALL NOT appear on `main` (they are folded into semantic commits by the pre-merge cleanup). Local `gh pr merge` SHALL remain denied for all callers — merging happens only through the GitHub UI.

#### Scenario: Premature merge attempt

- **WHEN** the staging branch's `gate-full` or PR quality gate is not green
- **THEN** the PR remains in draft, required checks block the merge server-side, and the staging branch remains the iteration target

#### Scenario: Diverged staging branch

- **WHEN** `main` has advanced such that it is not an ancestor of the staging tip at ready-flip time
- **THEN** the ancestor check fails and remediation happens on the staging branch (rebase or restart); `main` is not modified

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

### Requirement: The active staging branch is protected like main against subagent ref rewrites

Subagent force-operations naming an `integration/*` ref (`branch -f/-D/-m`, `checkout -B`, `switch -C`, and equivalents) SHALL be denied by the same tier-1 mechanism that protects `main`, using a static glob pattern rather than per-run enumeration. Merges into the staging branch SHALL be orchestrator-only, exactly as merges into `main` are today.

#### Scenario: Subagent tries to move the staging branch

- **WHEN** a subagent runs `git branch -f integration/<run-id> <sha>` from any location
- **THEN** the bash policy denies the command

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

### Requirement: The cleanup lane's printed apply command is valid for the lane's own topology

The cleanup outcome check SHALL print an apply command that works for the topology in which the
target branch is actually checked out. Under the staging lane the target is normally checked out in
a run worktree, where a `git checkout <target>` in the primary tree is rejected by git. The check
SHALL resolve where the target is checked out and print a command valid for that location.

#### Scenario: Target checked out in a run worktree

- **WHEN** the cleanup gate passes and the target branch is checked out in a run worktree
- **THEN** the printed apply command SHALL operate on that worktree, and SHALL NOT instruct the operator to check the target out in the primary tree

#### Scenario: Target not checked out anywhere

- **WHEN** the cleanup gate passes and the target branch is not checked out in any working tree
- **THEN** the printed apply command MAY use the primary-tree checkout form, since it is valid in that topology

### Requirement: The closure poll requires a positive verdict from every required check

The closure phase's check poll SHALL continue waiting while any required check is pending **or**
while the underlying tool reports that no checks exist for the branch yet, and SHALL conclude only
when every required check has reported an explicit pass or fail. It SHALL NOT infer a passing state
from the absence of a pending one. The bounded timeout is retained: a poll that never reaches a
verdict SHALL park the run with that reason rather than proceeding.

#### Scenario: Checks have not registered yet

- **WHEN** the poll runs immediately after a push and the tool reports that no checks exist for the branch, exiting `0`
- **THEN** the poll SHALL treat the run as still pending and continue waiting, and SHALL NOT report the checks as green

#### Scenario: Every required check reports

- **WHEN** every required check has reported an explicit verdict
- **THEN** the poll SHALL conclude and surface those verdicts

#### Scenario: Timeout without a verdict

- **WHEN** the bounded timeout elapses and at least one required check has still produced no verdict
- **THEN** the run SHALL be parked with that reason, and the PR SHALL NOT be flipped to ready

### Requirement: Every command a closure step instructs is runnable by the caller it names

Closure runbook steps SHALL instruct only command forms that the harness's own command policy allows
for the caller the step names, **and that can execute in the environment that caller runs in**.
Documentation of the command policy SHALL match the policy's enforced behaviour, including the
conditions under which a stated relaxation does not apply. Where a runbook states an environmental
capability, that statement SHALL be measured rather than assumed.

#### Scenario: A documented relaxation is conditional

- **WHEN** documentation states that a command form is permitted for a caller, and the policy applies that permission only under conditions the documentation does not state
- **THEN** the conditions SHALL be documented alongside the permission, and any runbook step that instructs the form SHALL instruct it in a shape those conditions admit

#### Scenario: A denial names a cause other than its trigger

- **WHEN** a command is denied by a rule other than the one its message names, so the message misidentifies the cause
- **THEN** the actual trigger SHALL be documented where an operator meeting the denial will look, so the message is not read as evidence about a different component

#### Scenario: A runbook states an environmental capability

- **WHEN** a runbook step asserts that the execution environment supplies a capability its commands depend on, such as network egress or a credential path
- **THEN** that assertion SHALL be verified by measurement, and SHALL be corrected where the environment does not supply it, rather than carried forward as an assumption

#### Scenario: Confirming the branch merges cleanly before the ready flip

- **WHEN** the closure phase must confirm the staging branch merges cleanly into the base branch before flipping the PR to ready
- **THEN** it SHALL use a check that executes in the environment the step runs in, in preference to one that requires an elevated or overridden environment, and the reason for the choice SHALL be recorded so a later simplification does not reverse it

#### Scenario: A guard denies a command because of its content

- **WHEN** the command policy denies a command because text it carries — a heredoc body, a message, or a description — matches a protected pattern, rather than because the command itself performs a protected operation
- **THEN** the sanctioned workaround SHALL be documented alongside the policy, so the content is supplied through a file rather than reworded to avoid the guard

### Requirement: A staging run can be parked by the documented tool

The park operation SHALL accept the branch kinds the harness's own runbooks instruct it to park,
including a run's staging branch, renaming it under the `wip/*` convention and recording a reason
note. A parked staging run's note SHALL record what its closure will additionally require to resume.

#### Scenario: Parking a staging branch

- **WHEN** the park operation is invoked on a run's staging branch
- **THEN** it SHALL park it under the `wip/*` convention with a reason note, rather than refusing the branch kind

#### Scenario: Base branch has advanced past a parked run

- **WHEN** a staging run is parked and the base branch is no longer an ancestor of it
- **THEN** the note SHALL record that resuming closure requires reconciling with the base branch first, since the ancestry check would otherwise fail

### Requirement: Teardown states the expected residue of a sandboxed branch deletion

Closure teardown SHALL state that deleting a branch under the OS sandbox leaves a stale
configuration section behind while reporting success, so the outcome is recognised as expected
rather than investigated as a fault.

#### Scenario: Branch deleted under the sandbox

- **WHEN** a branch is deleted while sandboxed, the ref is removed, the configuration write is denied, and the command exits `0`
- **THEN** teardown documentation SHALL identify the surviving configuration section as expected and cosmetic, and SHALL note that it cannot be removed in-session because the configuration command is denied to every caller
