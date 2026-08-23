## ADDED Requirements

### Requirement: Verb-time storage denials are candidate diagnostics; host faults are not

Every storage denial the production dispatcher returns for a verb-time error — `type_mismatch`, `unknown_collection`, `unknown_field`, `unknown_record`, `unqueryable_field`, `kv_too_large` — SHALL appear in the run report as an **error** diagnostic carrying the engine's own kind string verbatim, the method that was denied, and the engine's own hint, even when the candidate swallowed the rejected promise.

A denial whose kind is a host fault (`not_open`, `corrupt_storage`) SHALL NOT be reported as a candidate diagnostic, because it describes the harness's engine rather than the candidate's code; it SHALL remain in the report's trace verbatim so the exclusion is visible rather than silent. No denial SHALL be dropped from both the diagnostics and the trace.

#### Scenario: A bad date write fails the run

- **WHEN** a candidate writes a formatted date string into a `date` field and ignores the rejected promise
- **THEN** the run report is not `ok`, and it contains a `type_mismatch` error diagnostic naming the denied method and carrying the engine's hint

#### Scenario: An error run diagnostic reaches repair

- **WHEN** the pipeline's run stage returns a report carrying a `type_mismatch` error diagnostic
- **THEN** the candidate goes to repair with that diagnostic in the repair prompt, and no record is delivered for it

#### Scenario: A host fault is excluded but visible

- **WHEN** a denial carrying a host-fault kind is recorded during a run
- **THEN** the report's diagnostics contain no entry for it and the report's trace contains the denial verbatim
