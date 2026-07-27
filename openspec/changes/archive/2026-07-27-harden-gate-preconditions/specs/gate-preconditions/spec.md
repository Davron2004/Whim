## ADDED Requirements

### Requirement: A partial success is never reported as success

Any harness command that performs a multi-file or multi-step state change SHALL verify the change
actually landed before reporting success or passing control to a later verification step. Where an
underlying tool reports success despite partial failure, the harness SHALL NOT inherit that
verdict.

#### Scenario: Underlying tool exits zero after a partial write

- **WHEN** a harness command runs an underlying tool that fails to write one or more target files but still exits `0`
- **THEN** the harness SHALL detect the incomplete result and fail with a non-zero exit, rather than proceeding as if the step succeeded

#### Scenario: Complete state change

- **WHEN** the state change applies in full
- **THEN** the harness SHALL proceed silently, adding no output to the success path

### Requirement: A harness checkout is verified to have fully applied

`gatefull` SHALL verify, after checking the target branch into the working tree, that the working
tree's tracked content matches the target commit. If it does not, the command SHALL fail and the
message SHALL name the paths that did not update and identify an incomplete checkout as the cause.
It SHALL NOT allow a partially-applied tree to reach the gate, where the difference would be
reported as a verification-config mismatch.

#### Scenario: Checkout cannot write protected paths

- **WHEN** the checkout cannot write one or more tracked files and the resulting tree differs from the target commit
- **THEN** `gatefull` SHALL fail identifying an incomplete checkout and naming the affected paths, and the gate's tamper tripwire SHALL NOT be the reporting mechanism

#### Scenario: Checkout applies completely

- **WHEN** the working tree's tracked content matches the target commit after checkout
- **THEN** `gatefull` SHALL proceed to run the full gate

### Requirement: Verification runs assert their preconditions

`gatefull` SHALL verify before running that it is executing in the primary working tree and that
the target branch is related to the configured integration branch. A run whose baseline cannot be
established correctly SHALL fail with that reason stated, rather than proceeding to produce a
verdict against a wrong baseline.

#### Scenario: Invoked from a linked worktree

- **WHEN** `gatefull` is invoked from a linked worktree rather than the primary working tree
- **THEN** it SHALL refuse with that reason, rather than failing later with an unrelated dependency-resolution error

#### Scenario: Target branch unrelated to the integration branch

- **WHEN** the target branch has no ancestry relationship with the configured integration branch, so the derived baseline would not reflect the change under test
- **THEN** `gatefull` SHALL refuse and state that the baseline could not be established

### Requirement: Diagnostic signal is preserved, and failure messages name the actual cause

The harness SHALL NOT discard the error output of commands whose failure it can report. A failure
message SHALL identify the condition that actually occurred rather than a downstream symptom, and
SHALL NOT report a failure when the operation succeeded.

#### Scenario: Underlying command emits diagnostics on failure

- **WHEN** a command invoked by the harness writes diagnostics to standard error while failing
- **THEN** those diagnostics SHALL reach the operator rather than being redirected to `/dev/null`

#### Scenario: Working tree restored successfully

- **WHEN** `gatefull` restores the working tree to its starting ref and the restore succeeds
- **THEN** it SHALL NOT emit a restore-failure warning

### Requirement: The precondition behaviour is locked by a non-vacuous suite

A suite SHALL assert these behaviours and run in the fast gate. It SHALL assert on failure-message
content, not solely on exit status, because a correct refusal stating the wrong cause is the defect
being prevented. It SHALL include a negative control proving the assertions do not fire on a valid
run.

#### Scenario: Correct refusal with the wrong stated cause

- **WHEN** the harness refuses correctly but attributes the failure to the wrong cause
- **THEN** the suite SHALL fail, because exit status alone does not distinguish the two

#### Scenario: Negative control

- **WHEN** the suite runs against a complete, valid checkout
- **THEN** every precondition assertion SHALL pass, demonstrating the suite is not vacuously failing

### Requirement: The sandbox constraint on control-plane paths is documented as measured

Harness documentation SHALL describe the sandbox's treatment of control-plane paths as measured
rather than as assumed, and SHALL NOT claim that a per-command sandbox exclusion grants write
access to those paths. Where the distinction between documented behaviour, inference, and
unresolved question exists, the documentation SHALL preserve it.

#### Scenario: Documentation describes the carve-out

- **WHEN** harness documentation explains how commands needing control-plane writes or network access are run
- **THEN** it SHALL state that operations writing under the control-plane path require an attended explicit sandbox override or the container, and SHALL NOT attribute that capability to a per-command exclusion list
