# generation-run-journal Specification

## Purpose
A compact persisted per-attempt run journal — a bounded diagnostic history of a generation
attempt, written single-writer alongside the pending-build record it accompanies. The journal
records stage transitions and throttled output-growth aggregates while an attempt is in flight,
carries the terminal outcome, and on success moves to a per-app last-run report; it is never a
second source of truth for the pending-build record's own lifecycle state.
## Requirements
### Requirement: A run journal is created alongside its pending-build record

The host SHALL create a persisted, empty run journal at the same moment it creates a pending-build
record for a generation attempt, keyed `journal:<launcherId>` on the same store, written by the
same single writer that owns the pending-build record.

#### Scenario: Starting a generation creates a journal

- **WHEN** a pending-build record is created at generation start
- **THEN** a run journal exists at `journal:<launcherId>` for the same launcher id, initially empty

### Requirement: Journal entries carry the wire stage vocabulary, never display steps

Every journal entry of kind `stage` SHALL record one of the wire protocol's stage names
(`'plan'`, `'generate'`, `'check'`, `'run'`, `'repair'`). Entries MUST NOT record the build
screen's four display-step labels or any other display-layer mapping of stages.

#### Scenario: A stage transition is journaled with the wire name

- **WHEN** a `stage` event with `status: 'start'` arrives for `generate`
- **THEN** a journal entry of kind `stage` is appended carrying `stage: 'generate'`, not a
  display-step label

### Requirement: Every stage transition writes a journal entry immediately

The host SHALL append a `stage` journal entry for every `stage` event on the stream, at the time
it arrives, without throttling.

#### Scenario: Each stage transition is captured

- **WHEN** the stream emits `stage` events for `plan`, then `generate`, then `check`
- **THEN** the journal contains three `stage` entries in arrival order, one per transition

### Requirement: Aggregate entries are throttled to at most one per ~5 seconds and never per token

The host SHALL NOT append a journal entry for every `token` event. Instead, it SHALL coalesce
token arrivals into at most one `aggregate` journal entry per ~5 seconds of wall time, each
carrying the cumulative counts `{ chars, tokens }` observed so far, not a per-tick delta.

#### Scenario: A burst of tokens produces one aggregate entry

- **WHEN** dozens of `token` events arrive within a 2-second window
- **THEN** the journal gains at most one `aggregate` entry for that window, carrying the
  cumulative character and token counts observed up to that point

#### Scenario: No entry is written per token

- **WHEN** the journal is inspected after a stream with many `token` events
- **THEN** the number of `aggregate` entries is bounded by elapsed time divided by ~5 seconds, not
  by the number of `token` events received

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

### Requirement: Journal entries never carry raw token text or raw diagnostic internals

An `aggregate` entry SHALL carry only numeric counts (`chars`, `tokens`), never token text. A
`terminal` entry's failure detail SHALL carry only the same fields already permitted on the
failure screen (`reason`, each diagnostic's `hint`) — never a diagnostic's `kind`, `symbol`, or raw
`message`.

#### Scenario: Aggregate entries carry only counts

- **WHEN** any `aggregate` journal entry is inspected
- **THEN** it contains only numeric `chars`/`tokens` fields and no token text

#### Scenario: Terminal failure entries carry only permitted fields

- **WHEN** a `terminal` journal entry with failure detail is inspected
- **THEN** it contains `reason` and diagnostic `hint` strings only — no `kind`, `symbol`, or raw
  `message` value

### Requirement: The journal is capped at ~200 entries; aggregate entries are dropped first

The host SHALL bound a journal to approximately 200 entries. When appending a new entry would
exceed the cap, the host SHALL evict the oldest `aggregate` entry before appending. `stage` and
`terminal` entries SHALL NOT be evicted to make room.

#### Scenario: An aggregate entry is evicted to make room

- **WHEN** a journal already holds ~200 entries including at least one `aggregate` entry, and a
  new `aggregate` entry is appended
- **THEN** the oldest `aggregate` entry is dropped and the journal size stays at the cap

#### Scenario: Stage and terminal entries survive eviction

- **WHEN** a journal is at its cap and every remaining entry is a `stage` or `terminal` entry
- **THEN** appending a new `stage` entry does not evict any existing `stage` or `terminal` entry

### Requirement: On success, the journal moves to a per-app last-run report

When a generation's terminal `result` event is delivered and installed, the host SHALL move the
journal from `journal:<launcherId>` to `lastrun:<appId>`, where `appId` is the launcher id the
delivered app now has. The move SHALL overwrite any existing `lastrun:<appId>` entry for that app.
The source key `journal:<launcherId>` MUST NOT remain after the move.

#### Scenario: A successful delivery moves the journal to the last-run key

- **WHEN** a generation's terminal `result` event is delivered and installed for app id `appId`
- **THEN** the journal that was at `journal:<launcherId>` is now readable at `lastrun:<appId>`, and
  `journal:<launcherId>` no longer exists

#### Scenario: A rebuild overwrites the previous last-run report

- **WHEN** an app with an existing `lastrun:<appId>` report is rebuilt and the rebuild also
  succeeds
- **THEN** `lastrun:<appId>` holds only the newer run's journal; the prior run's journal is gone

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

### Requirement: Report eligibility survives interrupted setup and partial rollback

The pending record's durable journal-unavailability marker SHALL suppress any unverified report even when its raw journal bytes remain readable. Journal schema SHALL remain unchanged. New empty-journal setup, recovery journal resets, verified current terminal settlement and exact old-pair restoration SHALL follow the pending-builds association guard and marker-clear rules. Reading a raw journal, matching timestamps, restarting a launcher or restoring bytes for an already-unavailable old record SHALL NOT establish report eligibility.

#### Scenario: Generic fallback keeps the old journal without borrowing it

- **WHEN** recovery preserves the exact old raw journal but persists a new generic failed record
- **THEN** the pending write includes true unless a matching current terminal journal was verified, and the old raw journal stays unavailable as that new failure's report after a fresh launcher instance

#### Scenario: Crash between guarded journal restore and pending restore

- **WHEN** the old journal has been restored under a durably guarded pending record and the process ends before pending restoration completes
- **THEN** restart preserves the guard during any building-to-interrupted demotion and cannot attach the old journal as the new attempt's report

