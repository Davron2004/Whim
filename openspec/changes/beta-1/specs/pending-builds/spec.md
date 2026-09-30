## MODIFIED Requirements

### Requirement: A pending-build record has exactly one of three states

A pending-build record SHALL be in exactly one of three states: `building`, `failed`, or `interrupted`. The record's current state MUST reflect the true status known to PendingBuildStore. Persisted reads SHALL remain distinct from current views marked persisted or volatile. The store MAY retain a volatile failed record only from confirmed attempt completion after durable recovery fails, or a volatile interrupted record from cold-process recovery when demotion cannot persist. The persisted JSON schema SHALL remain unchanged; a volatile view SHALL NOT claim a successful write.

#### Scenario: A fresh record starts building

- **WHEN** a pending-build record is created at generation start
- **THEN** its state is `building`

#### Scenario: Known failure outlives a rejected terminal write in this process

- **WHEN** an attempt ends and terminal writes, sibling restoration, and a generic failed pending write cannot produce a verified persisted settlement
- **THEN** its current store view is volatile failed, raw persisted reads still describe the actual stored bytes, and the record is neither hidden nor deleted

#### Scenario: Journal and liveness hints cannot create a lifecycle transition

- **WHEN** a journal has terminal data or a live-ref entry is absent without confirmed completion for that attempt
- **THEN** neither fact changes the pending lifecycle state

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
- **THEN** the current pending record is persisted failed, independent of the unavailable journal, and no unverified terminal report is associated with it

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

### Requirement: A live building record is demoted to interrupted at launch

At app launch, the host SHALL demote any pending-build record still in the `building` state to `interrupted` before the first render. A `building` state MUST NOT be shown to the user across a process restart, because the process that owned the generation stream is gone and the state can no longer be truthful. Each demotion SHALL first attempt persistence; if its write fails, the store SHALL retain a volatile interrupted view and continue recovering the remaining records before Home is ready. Process-only failed payloads and attempt leases SHALL NOT survive a new process.

#### Scenario: Process death mid-build surfaces as interrupted

- **WHEN** the host process is killed while a pending-build record is `building`, and the host is relaunched
- **THEN** before the first render, that record's state is `interrupted`, not `building`

#### Scenario: A clean relaunch with no in-flight builds changes nothing

- **WHEN** the host relaunches with no pending-build record in the `building` state
- **THEN** no record's state is altered by the launch-time demotion step

#### Scenario: The outage survives a process restart

- **WHEN** a new process reads surviving building records and one or more demotion writes fail
- **THEN** each affected current record is volatile interrupted before Home is ready, the remaining records are still recovered, and no lost terminal failure payload is invented

## ADDED Requirements

### Requirement: An attempt lease fences terminal recovery and retention

After new pending and empty-journal setup is durably verified, PendingBuildStore SHALL activate an opaque process-only lease for that launcher ID and capture the started record. A later activation for the same ID SHALL supersede the old lease. Terminal settlement and recovery mutations SHALL verify ownership before writing, and volatile retention SHALL reject stale leases. Lease identity MUST NOT be derived from timestamps. Releasing a matching completed lease SHALL preserve any retained current failure; completed attempts MUST NOT accumulate active leases.

#### Scenario: An older attempt ends after the ID was reused

- **WHEN** a newer attempt has activated for an ID and an older completion tries to settle, restore, or retain that ID
- **THEN** the old lease cannot overwrite the newer attempt, even if their timestamps are equal

#### Scenario: Independent attempts remain independent

- **WHEN** one confirmed-ended attempt retains a failed view while another ID is still building
- **THEN** only the ended attempt changes state and the other remains live

### Requirement: Retry activates only after verified durable setup

A Retry SHALL retain its previous current entry until both new pending and empty-journal setup have succeeded and their required persisted state has been verified. Only then SHALL a new lease activate and the host send the generation request. Failed setup SHALL restore siblings independently, retain the old current entry, and send no HTTP generation request. Current reads SHALL never count as persisted verification.

#### Scenario: Retry remains blocked while writes fail

- **WHEN** Retry cannot persist and verify either new setup sibling
- **THEN** no new generation request is sent and the previous failed current entry remains available

#### Scenario: Writes recover before a later Retry

- **WHEN** Retry successfully verifies both setup siblings
- **THEN** the same launcher ID becomes a new building attempt, its old retained view clears, and one generation request is sent
