## MODIFIED Requirements

### Requirement: A terminal entry is always written immediately, bypassing the aggregate throttle

The host SHALL append a `terminal` journal entry the instant the stream ends — on a `result`
event, a `failure` event, or a stream error with no terminal event — regardless of how recently an
`aggregate` entry was last written. If the backend rejects a failed or unexplained-ended attempt's terminal write, the host SHALL
log the failure through the existing redacted boundary and attempt safe pending/journal recovery
independently under the pending record's durable association guard. This adds no successful-delivery or live-cancellation write-fault recovery. No journal or report association SHALL claim an unverified terminal write.
A current volatile pending failure does not satisfy this persistence requirement; backend
failure is an explicit durability limit. A `failure` terminal entry SHALL carry the failure detail
(`reason` and available diagnostics); a `result` terminal entry SHALL carry no failure field.

#### Scenario: Failure writes a terminal entry immediately

- **WHEN** the stream ends with a `failure` event and the journal write succeeds
- **THEN** a `terminal` journal entry is appended immediately, carrying the failure's `reason` and
  available diagnostics, independent of the aggregate throttle

#### Scenario: A stream error with no terminal event still journals a terminal entry

- **WHEN** the SSE stream ends or errors without a terminal event, other than a user-initiated
  cancel, and the journal write succeeds
- **THEN** a `terminal` journal entry is appended immediately, carrying the mapped failure detail

### Requirement: On failure or interruption, the journal persists alongside the ghost

The host SHALL leave the journal in place at `journal:<launcherId>` when a generation ends in a
terminal `failure` event, or the stream errors before any terminal event, readable alongside the
now-`failed`/`interrupted` pending-build record when persistence succeeds. A missing, stale, or
unverified terminal journal after a write failure SHALL NOT determine pending lifecycle and
SHALL NOT be associated as that attempt's verified report. Verified pending recovery SHALL remain
useful even when journal recovery fails.

#### Scenario: A failed run's journal survives for the failure screen

- **WHEN** a pending-build record's state becomes `failed` and its journal writes succeeded
- **THEN** its journal at `journal:<launcherId>` still exists and is readable

#### Scenario: Pending recovery succeeds without a terminal journal

- **WHEN** the generic failed pending fallback is persisted and verified but its terminal journal cannot be verified
- **THEN** the failed record remains usable and its failure screen claims no terminal journal/report association, including after Back, reopening, launcher remount and process restart, because the generic pending write also persisted `journalUnavailable: true`

#### Scenario: Neither sibling can be recovered durably

- **WHEN** every relevant terminal and recovery write fails
- **THEN** the store SHALL retain its confirmed failed current view, no journal/report is claimed for it, and no durable terminal state or old-pair restoration is asserted

### Requirement: Dismissing a ghost deletes its journal

When the user dismisses a `failed` or `interrupted` pending-build record, the host SHALL delete
its journal at `journal:<launcherId>` in the same user operation that deletes the record. For a retained entry, removal of each
sibling SHALL be attempted independently. The operation SHALL verify pending-key absence, pending-order
exclusion, and journal absence before clearing the retained entry or reporting success. A
non-throwing native removal that leaves a key SHALL count as an incomplete removal. No new
cross-key atomicity guarantee is made for process death during removal.

#### Scenario: Dismiss removes the journal with the record

- **WHEN** the user dismisses a `failed` or `interrupted` pending-build record and removal succeeds
- **THEN** both the pending-build record and its journal at `journal:<launcherId>` are deleted

#### Scenario: One removal cannot skip its sibling

- **WHEN** retained Discard encounters a thrown pending removal or an unsuccessful journal removal
- **THEN** it still attempts the other sibling independently, preserves the current entry until all readbacks verify removal, and reports only the established generic failure

### Requirement: A journal is never a second source of truth for the pending-build record's state

A journal entry SHALL NOT be read to determine a pending-build record's `state`
(`building`/`failed`/`interrupted`). The journal is a diagnostic history; PendingBuildStore's current pending record
remains the sole authority for lifecycle state.
The optional pending `journalUnavailable: true` metadata SHALL guard report association across
processes, but SHALL NOT produce a failed/interrupted/building transition or replace attempt
ownership evidence. An in-memory unavailable-journal Set alone is insufficient.

#### Scenario: Journal absence does not affect record state

- **WHEN** a journal is unreadable or missing for a launcher id that still has a pending-build
  record
- **THEN** the current record's own `state` field, not the journal, determines what the grid and failure
  screen show


## ADDED Requirements

### Requirement: Report eligibility survives interrupted setup and partial rollback

The pending record's durable journal-unavailability marker SHALL suppress any unverified report even when its raw journal bytes remain readable. Journal schema SHALL remain unchanged. New empty-journal setup, recovery journal resets, verified current terminal settlement and exact old-pair restoration SHALL follow the pending-builds association guard and marker-clear rules. Reading a raw journal, matching timestamps, restarting a launcher or restoring bytes for an already-unavailable old record SHALL NOT establish report eligibility.

#### Scenario: Generic fallback keeps the old journal without borrowing it

- **WHEN** recovery preserves the exact old raw journal but persists a new generic failed record
- **THEN** the pending write includes true unless a matching current terminal journal was verified, and the old raw journal stays unavailable as that new failure's report after a fresh launcher instance

#### Scenario: Crash between guarded journal restore and pending restore

- **WHEN** the old journal has been restored under a durably guarded pending record and the process ends before pending restoration completes
- **THEN** restart preserves the guard during any building-to-interrupted demotion and cannot attach the old journal as the new attempt's report
