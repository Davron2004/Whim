# pending-builds Specification

## ADDED Requirements

### Requirement: A pending-build record is created at generation start

The host SHALL write a persisted pending-build record the moment a generation request starts, before any terminal event arrives. The record MUST carry the up-front launcher id allocated for the attempt and a working title derived from the user's prompt.

#### Scenario: Starting a generation writes a record

- **WHEN** the user approves the plan and a generation request is sent
- **THEN** a pending-build record exists carrying the launcher id allocated for this attempt and a prompt-derived working title, before any `stage`, `result`, or `failure` event has arrived

### Requirement: A pending-build record has exactly one of three states

A pending-build record SHALL be in exactly one of three states: `building`, `failed`, or `interrupted`. The record's state MUST reflect the true, current status of the generation attempt it represents.

#### Scenario: A fresh record starts building

- **WHEN** a pending-build record is created at generation start
- **THEN** its state is `building`

### Requirement: A pending-build record is deleted on delivery, cancel, or dismiss

The host SHALL delete a pending-build record when its generation is successfully delivered, when the user cancels the in-flight generation, or when the user dismisses a `failed`/`interrupted` record. A deleted record MUST NOT reappear on any later render.

#### Scenario: Successful delivery removes the record

- **WHEN** a generation's terminal `result` event is delivered and installed
- **THEN** the pending-build record for that attempt is deleted

#### Scenario: Cancel removes the record

- **WHEN** the user cancels an in-flight generation
- **THEN** the pending-build record for that attempt is deleted

#### Scenario: Dismiss removes the record

- **WHEN** the user dismisses a `failed` or `interrupted` record
- **THEN** the record is deleted and no longer renders on the grid

### Requirement: Terminal failure or a stream error sets the record to failed with a persisted payload

When a generation ends in a terminal `failure` event, or the stream errors before any terminal event arrives, the host SHALL set the pending-build record's state to `failed` and persist the failure payload (reason and available diagnostics) on the record. The record MUST NOT be deleted on failure.

#### Scenario: Terminal failure event persists the record as failed

- **WHEN** a generation's stream ends with a `failure` event
- **THEN** the pending-build record's state becomes `failed`, its failure payload is persisted, and the record is not deleted

#### Scenario: A stream error with no terminal event still persists as failed

- **WHEN** the SSE stream ends or errors without a terminal event, other than a user-initiated cancel
- **THEN** the pending-build record's state becomes `failed` and its failure payload is persisted

### Requirement: A live building record is demoted to interrupted at launch

At app launch, the host SHALL demote any pending-build record still in the `building` state to `interrupted` before the first render. A `building` state MUST NOT be shown to the user across a process restart, because the process that owned the generation stream is gone and the state can no longer be truthful.

#### Scenario: Process death mid-build surfaces as interrupted

- **WHEN** the host process is killed while a pending-build record is `building`, and the host is relaunched
- **THEN** before the first render, that record's state is `interrupted`, not `building`

#### Scenario: A clean relaunch with no in-flight builds changes nothing

- **WHEN** the host relaunches with no pending-build record in the `building` state
- **THEN** no record's state is altered by the launch-time demotion step

### Requirement: A pending-build record is never an InstalledApp and never writes the version store

A pending-build record SHALL live in its own keyspace, distinct from `AppIndex`. It MUST NOT be represented as, or convertible into, an `InstalledApp` record, and creating, updating, or deleting a pending-build record MUST NOT read or write the version store.

#### Scenario: A pending record never appears as an installed app

- **WHEN** a pending-build record exists in any state
- **THEN** it is absent from `AppIndex.list()` and no `InstalledApp` record exists for its launcher id until a successful delivery installs one

#### Scenario: Pending-record writes touch no version-store state

- **WHEN** a pending-build record is created, updated, or deleted
- **THEN** no version-store snapshot, repo, or lineage operation occurs as part of that write

### Requirement: Rebuild and edit attempts carry editingAppId and spawn no ghost

When a generation is started by re-prompting an existing installed app, its pending-build record SHALL carry the `editingAppId` of the app being edited. Such a record MUST NOT cause a new ghost tile to appear on the grid.

#### Scenario: Re-prompting an existing app records editingAppId

- **WHEN** the user re-prompts an existing installed app and the generation starts
- **THEN** the pending-build record for that attempt carries `editingAppId` set to the app's launcher id

#### Scenario: An edit attempt produces no separate ghost tile

- **WHEN** a pending-build record carries `editingAppId`
- **THEN** the grid shows no additional ghost tile for that record; only the existing installed tile it edits is affected

### Requirement: A crash inside delivery degrades to interrupted, never a lost app

The pending-build record for an attempt SHALL be deleted only after its delivery (install/update to `AppIndex` and the version store) completes successfully. If the process dies after delivery begins but before it completes, the record MUST remain and, per the launch-time demotion rule, surface as `interrupted` — the attempt is never silently lost.

#### Scenario: Death mid-delivery leaves a recoverable trace

- **WHEN** the host process dies after a `result` event arrives but before delivery (install/update) finishes, and the host relaunches
- **THEN** the pending-build record still exists and its state is `interrupted`, not deleted and not `building`
