## ADDED Requirements

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

### Requirement: Every command a closure step instructs is a command the policy permits

Closure runbook steps SHALL instruct only command forms that the harness's own command policy allows
for the caller the step names. Where a step's purpose can be served by a permitted form, the runbook
SHALL specify that form. Documentation of the command policy SHALL match the policy's enforced
behaviour.

#### Scenario: A documented relaxation is not enforced

- **WHEN** documentation states that a command form is permitted for a caller and the policy denies it in practice
- **THEN** the discrepancy SHALL be resolved so the two agree, and any runbook step depending on the unenforced relaxation SHALL be rewritten to a permitted form

#### Scenario: Confirming the branch merges cleanly before the ready flip

- **WHEN** the closure phase must confirm the staging branch merges cleanly into the base branch before flipping the PR to ready
- **THEN** it SHALL use the hosting provider's own mergeability report for the pull request, rather than a local ancestry check that depends on a fetched ref

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
