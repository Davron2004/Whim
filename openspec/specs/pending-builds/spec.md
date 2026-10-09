# pending-builds Specification

## Purpose
The persisted record of an in-flight, failed, or interrupted generation attempt — the
launcher's account of a mini-app build that has not yet been delivered, or that ended badly.
A pending-build record is created the moment a generation request starts, before any terminal
event arrives, carrying the launcher id allocated up front for the attempt and a prompt-derived
working title; re-prompting an existing installed app instead carries that app's `editingAppId`
and spawns no separate ghost tile. The record holds exactly one of three states —
`building` while the attempt is in flight, `failed` once a terminal `failure` event or an
unexplained stream error has persisted a failure payload, and `interrupted`, the state any
still-`building` record is demoted to at launch so a killed or crashed host process can never
leave a stale `building` claim standing across a cold start. The record is resolved — deleted —
only on successful delivery, on user cancel, or on the user dismissing a `failed`/`interrupted`
record; a crash after delivery begins but before it completes must not delete the record either,
so it survives to be demoted to `interrupted` rather than silently losing the attempt.
Throughout, the hard invariant holds: a pending-build record lives in its own keyspace, is never
an `InstalledApp` and never convertible into one, and none of its writes ever read or touch the
version store.
## Requirements
### Requirement: A pending-build record is created at generation start

The host SHALL write a persisted pending-build record the moment a generation request starts, before any terminal event arrives. The record MUST carry the up-front launcher id allocated for the attempt and a working title derived from the user's prompt.

#### Scenario: Starting a generation writes a record

- **WHEN** the user approves the plan and a generation request is sent
- **THEN** a pending-build record exists carrying the launcher id allocated for this attempt and a prompt-derived working title, before any `stage`, `result`, or `failure` event has arrived

### Requirement: A pending-build record has exactly one of three states

A pending-build record SHALL be in exactly one of three states: `building`, `failed`, or `interrupted`. The record's current state MUST reflect the true status known to PendingBuildStore. Persisted reads SHALL remain distinct from current views marked persisted or volatile. The store MAY retain a volatile failed record only from confirmed attempt completion after durable recovery fails, or a volatile interrupted record from cold-process recovery when demotion cannot persist. The only persisted JSON addition SHALL be optional `journalUnavailable: true`, governing diagnostic association without changing lifecycle. Existing records without the field SHALL remain readable. A volatile view SHALL NOT claim a successful write.

#### Scenario: A fresh record starts building

- **WHEN** a pending-build record is created at generation start
- **THEN** its state is `building`

#### Scenario: Known failure outlives a rejected terminal write in this process

- **WHEN** an attempt ends and terminal writes, sibling restoration, and a generic failed pending write cannot produce a verified persisted settlement
- **THEN** its current store view is volatile failed, raw persisted reads still describe the actual stored bytes, and the record is neither hidden nor deleted

#### Scenario: Journal and liveness hints cannot create a lifecycle transition

- **WHEN** a journal has terminal data or a live-ref entry is absent without confirmed completion for that attempt
- **THEN** neither fact changes the pending lifecycle state

### Requirement: A pending-build record is deleted on delivery, cancel, or dismiss

The host SHALL delete a pending-build record when its generation is successfully delivered, when the user cancels the in-flight generation, or when the user dismisses a `failed`/`interrupted` record. A successfully deleted record MUST NOT reappear on any later render. For a retained volatile entry, Discard SHALL attempt pending and journal removal independently and verify pending-key absence, pending-order exclusion, and journal absence before clearing the retained entry. A thrown removal or a non-throwing removal that leaves a key SHALL retain the current entry and MUST NOT be reported as successful deletion. This correction makes no new atomicity guarantee for process death during multi-key removal or for cancellation/delivery write faults.

#### Scenario: Successful delivery removes the record

- **WHEN** a generation's terminal `result` event is delivered and installed
- **THEN** the pending-build record for that attempt is deleted

#### Scenario: Cancel removes the record

- **WHEN** the user cancels an in-flight generation
- **THEN** the pending-build record for that attempt is deleted

#### Scenario: Dismiss removes the record

- **WHEN** the user dismisses a `failed` or `interrupted` record and removal succeeds
- **THEN** the record is deleted and no longer renders on the grid

#### Scenario: Rejected or partial retained Discard preserves the entry

- **WHEN** Discard of a retained entry removes only some required data, throws, or returns without removing a required key
- **THEN** the current entry remains listed exactly once and available for another Discard, even if its raw pending key or order membership has already been removed

#### Scenario: Recovered Discard finishes removal

- **WHEN** a later Discard verifies the pending key and journal absent and the ID excluded from pending order
- **THEN** the retained entry is cleared and subsequent refreshes do not restore it

### Requirement: Terminal failure or a stream error sets the record to failed with a persisted payload

When a generation ends in a terminal `failure` event, or the stream errors before any terminal event arrives, the host SHALL set the pending-build record's state to `failed` and persist the failure payload (reason and available diagnostics) on the record. The record MUST NOT be deleted on failure. If these writes fail, the host SHALL attempt independent sibling restoration and a generic failed pending fallback as appropriate. A persisted readback SHALL decide whether that fallback was saved. If no usable saved settlement can be verified, the owning store SHALL retain the confirmed-ended attempt as a volatile generic failed record for this process; it SHALL NOT call that record interrupted or assert durability. This exception applies to failed persistence, not to healthy writes.

#### Scenario: Terminal failure event persists the record as failed

- **WHEN** a generation's stream ends with a `failure` event and the required storage writes succeed
- **THEN** the pending-build record's state becomes `failed`, its failure payload is persisted, and the record is not deleted

#### Scenario: A stream error with no terminal event still persists as failed

- **WHEN** the SSE stream ends or errors without a terminal event, other than a user-initiated cancel, and the required storage writes succeed
- **THEN** the pending-build record's state becomes `failed` and its failure payload is persisted

#### Scenario: Selective failure still permits a saved generic record

- **WHEN** terminal journal/restoration writes fail but a later generic failed pending write succeeds and is read back
- **THEN** the current pending record is persisted failed with `journalUnavailable: true` in that same write, independent of the unavailable journal, and no unverified terminal report is associated with it after navigation, remount or process restart

### Requirement: A live building record is demoted to interrupted at launch

At app launch, the host SHALL demote any pending-build record still in the `building` state to `interrupted` before the first render. A `building` state MUST NOT be shown to the user across a process restart, because the process that owned the generation stream is gone and the state can no longer be truthful. Each demotion SHALL preserve `journalUnavailable: true` when present and first attempt persistence; if its write fails, the store SHALL retain a volatile interrupted view and continue recovering the remaining records before Home is ready. Process-only failed payloads and attempt leases SHALL NOT survive a new process.

#### Scenario: Process death mid-build surfaces as interrupted

- **WHEN** the host process is killed while a pending-build record is `building`, and the host is relaunched
- **THEN** before the first render, that record's state is `interrupted`, not `building`

#### Scenario: A clean relaunch with no in-flight builds changes nothing

- **WHEN** the host relaunches with no pending-build record in the `building` state
- **THEN** no record's state is altered by the launch-time demotion step

#### Scenario: The outage survives a process restart

- **WHEN** a new process reads surviving building records and one or more demotion writes fail
- **THEN** each affected current record is volatile interrupted before Home is ready, the remaining records are still recovered, and no lost terminal failure payload is invented

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

### Requirement: An attempt lease fences terminal recovery and retention

After new pending and empty-journal setup and the provenance-based marker clear are durably verified, PendingBuildStore SHALL activate an opaque process-only lease for that launcher ID and capture the started record. A later activation for the same ID SHALL supersede the old lease. Terminal settlement and recovery mutations SHALL verify ownership before writing, and volatile retention SHALL reject stale leases. Lease identity MUST NOT be derived from timestamps. Releasing a matching completed lease SHALL preserve any retained current failure; completed attempts MUST NOT accumulate active leases.

#### Scenario: An older attempt ends after the ID was reused

- **WHEN** a newer attempt has activated for an ID and an older completion tries to settle, restore, or retain that ID
- **THEN** the old lease cannot overwrite the newer attempt, even if their timestamps are equal

#### Scenario: Independent attempts remain independent

- **WHEN** one confirmed-ended attempt retains a failed view while another ID is still building
- **THEN** only the ended attempt changes state and the other remains live

### Requirement: Retry activates only after verified durable setup

A Retry SHALL retain its previous current entry until new pending setup has written `journalUnavailable: true`, the new empty journal has been verified, and a subsequent pending write clearing the marker has been verified. The marker SHALL NOT be cleared by merely recreating a building record. Only then SHALL a new lease activate and the host send the generation request. Failed setup SHALL attempt independent safe sibling recovery under the journal-association guard below, retain the old current entry, and send no HTTP generation request. Current reads SHALL never count as persisted verification.

#### Scenario: Retry remains blocked while writes fail

- **WHEN** Retry cannot persist and verify either new setup sibling
- **THEN** no new generation request is sent and the previous failed current entry remains available

#### Scenario: Writes recover before a later Retry

- **WHEN** Retry successfully verifies both setup siblings and the provenance-based marker clear
- **THEN** the same launcher ID becomes a new building attempt, its old retained view clears, and one generation request is sent

### Requirement: Journal unavailability is durable metadata on the pending record

PendingBuildRecord SHALL support only the additive optional `journalUnavailable: true` field for this association policy. True SHALL suppress record-driven journal/report attachment across navigation, fresh launcher instances and process restart; absence SHALL retain legacy eligibility. The field SHALL NOT determine pending lifecycle. Persisted reads SHALL read it from the stored record, not reconstruct it from journal contents, timestamps or an in-memory ref. Legacy records without the field SHALL remain readable, without a migration or retroactive identity guess.

Every new or reused building record SHALL be persisted with true before journal setup. The marker MAY be cleared only after verification of a new empty journal, a matching current terminal journal with its pending settlement, or an exact restored old pair whose original marker was absent. Marker clearance SHALL itself be written and verified before setup activates or report availability is claimed. A generic failed fallback without a verified current journal SHALL write its failure payload and true atomically in one pending write and verify both. Merely restoring journal bytes SHALL NOT clear an original true marker.

#### Scenario: Generic failed record survives a fresh launcher instance

- **WHEN** a generic failure is saved without its verified terminal journal while an old raw journal remains, and a new launcher instance opens the same stored record
- **THEN** the saved true marker still withholds that old journal/report without depending on an in-memory Set

#### Scenario: Failed Retry setup cannot expose the old report

- **WHEN** Retry recreates building, empty-journal setup or marker clearance fails, and old pending restoration also fails
- **THEN** no generation request is sent, surviving building metadata remains true whenever it was durably created/guarded, and cold interruption recovery preserves its report suppression

#### Scenario: Verified replacement journal becomes available

- **WHEN** a Retry verifies its new empty journal and its subsequent pending marker-clear write
- **THEN** activation may send one request and that attempt may expose its own journal under the existing journal rules

### Requirement: Snapshot recovery guards durable journal association

Before replacing or resetting a journal beneath a current pending record, including a generic fallback reset, recovery SHALL durably mark that record unavailable and verify the marker, unless the exact desired journal bytes/absence are already verified and no association-changing write is needed. If this prerequisite fails, recovery SHALL NOT introduce an unassociated old or reset journal, but SHALL still attempt safe independent pending recovery and generic fallback. An old pending snapshot may regain its original marker only after its exact corresponding journal bytes/absence are verified; otherwise its restored data SHALL carry true. A verified exact old pair SHALL preserve its original marker semantics. A generic failed-plus-true pending write MAY establish this guard before its generic journal reset; if that write cannot establish the guard, no reset is permitted. No operation SHALL create an unflagged mixed pair merely because sibling writes are best-effort.

#### Scenario: Pending restoration fails after journal restoration

- **WHEN** rollback verifies the durable guard, restores old journal bytes, then cannot restore the old pending record
- **THEN** the surviving pending record remains flagged, including across a crash before later fallback writes, and any saved generic fallback also carries true unless its own current journal is verified

#### Scenario: Association guard cannot persist

- **WHEN** the current pending record cannot be durably marked unavailable and the desired old journal differs from the current journal
- **THEN** rollback leaves the current journal unchanged and still attempts safe pending recovery without claiming an old-pair restoration

#### Scenario: Exact prior pair is recoverable

- **WHEN** both original sibling values can be restored and verified
- **THEN** the original pending marker is preserved, including true when the old report was already unavailable, and no current report is invented

#### Scenario: Generic journal reset also requires the guard

- **WHEN** generic recovery cannot durably guard the pending record and would replace its journal
- **THEN** it leaves that journal unchanged, attempts only safe pending recovery, and claims neither a generic terminal pair nor restored pair

