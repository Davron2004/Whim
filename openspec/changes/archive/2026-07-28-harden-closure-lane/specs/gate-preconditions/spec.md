## MODIFIED Requirements

### Requirement: A partial success is never reported as success

Any harness command or documented procedure making a multi-step state change SHALL verify the change
actually landed before reporting success or passing control to a later verification step. Where an
underlying tool reports success despite partial failure, the harness SHALL NOT inherit that verdict.

An **absent** result SHALL be treated the same as a partial one: a step SHALL establish that the
verdict it is waiting on has actually been produced, and SHALL NOT read the absence of a failure
signal as success. This requirement binds runbook procedures as well as scripts — a step written in
markdown that an operator or orchestrator executes is subject to it exactly as shell code is.

#### Scenario: Underlying tool exits zero after a partial write

- **WHEN** a harness command runs an underlying tool that fails to write one or more target files but still exits `0`
- **THEN** the harness SHALL detect the incomplete result and fail with a non-zero exit, rather than proceeding as if the step succeeded

#### Scenario: Complete state change

- **WHEN** the state change applies in full
- **THEN** the harness SHALL proceed silently, adding no output to the success path

#### Scenario: Verdict has not been produced yet

- **WHEN** a step waits on an external verdict and the underlying tool reports that no verdict exists yet, exiting `0`
- **THEN** the step SHALL treat that as *not yet settled* and keep waiting within its bounded timeout, and SHALL NOT report success

#### Scenario: Procedure documented in a runbook

- **WHEN** a runbook step instructs a wait, a check, or a multi-step state change
- **THEN** it SHALL state the positive condition that must hold before proceeding, rather than a condition whose absence is taken to imply success
