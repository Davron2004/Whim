## MODIFIED Requirements

### Requirement: A pending-build record is deleted on delivery, cancel, or dismiss
The host SHALL delete a pending-build record when its generation is successfully delivered, when the user cancels the in-flight generation, when the user dismisses a `failed`/`interrupted` record, or when its app was deleted before delivery. A successfully deleted record MUST NOT reappear on any later render. For a retained volatile entry, Discard SHALL attempt pending and journal removal independently and verify pending-key absence, pending-order exclusion, and journal absence before clearing the retained entry. A thrown removal or a non-throwing removal that leaves a key SHALL retain the current entry and MUST NOT be reported as successful deletion. This correction makes no new atomicity guarantee for process death during multi-key removal or for cancellation/delivery write faults.

#### Scenario: Successful delivery removes the record

- **WHEN** a generation's terminal `result` event is delivered and installed
- **THEN** the pending-build record for that attempt is deleted

#### Scenario: Cancel removes the record

- **WHEN** the user cancels an in-flight generation
- **THEN** the pending-build record for that attempt is deleted

#### Scenario: Dismiss removes the record

- **WHEN** the user dismisses a `failed` or `interrupted` record and removal succeeds
- **THEN** the record is deleted and no longer renders on the grid

#### Scenario: A late delivery for a deleted app removes the record

- **WHEN** a generation's `result` is delivered for an app the launcher index no longer holds
- **THEN** nothing is written to the app, and the pending-build record and its journal for that attempt are deleted, not left as a failed record

#### Scenario: Rejected or partial retained Discard preserves the entry

- **WHEN** Discard of a retained entry removes only some required data, throws, or returns without removing a required key
- **THEN** the current entry remains listed exactly once and available for another Discard, even if its raw pending key or order membership has already been removed

#### Scenario: Recovered Discard finishes removal

- **WHEN** a later Discard verifies the pending key and journal absent and the ID excluded from pending order
- **THEN** the retained entry is cleared and subsequent refreshes do not restore it

### Requirement: Terminal failure or a stream error sets the record to failed with a persisted payload
When a generation ends in a terminal `failure` event, or the stream errors before any terminal event arrives, the host SHALL set the pending-build record's state to `failed` and persist the failure payload (reason and available diagnostics) on the record. The record MUST NOT be deleted on failure; dropping a record whose app was deleted before delivery is not a failure. If these writes fail, the host SHALL attempt independent sibling restoration and a generic failed pending fallback as appropriate. A persisted readback SHALL decide whether that fallback was saved. If no usable saved settlement can be verified, the owning store SHALL retain the confirmed-ended attempt as a volatile generic failed record for this process; it SHALL NOT call that record interrupted or assert durability. This exception applies to failed persistence, not to healthy writes.

#### Scenario: Terminal failure event persists the record as failed

- **WHEN** a generation's stream ends with a `failure` event and the required storage writes succeed
- **THEN** the pending-build record's state becomes `failed`, its failure payload is persisted, and the record is not deleted

#### Scenario: A stream error with no terminal event still persists as failed

- **WHEN** the SSE stream ends or errors without a terminal event, other than a user-initiated cancel, and the required storage writes succeed
- **THEN** the pending-build record's state becomes `failed` and its failure payload is persisted

#### Scenario: Selective failure still permits a saved generic record

- **WHEN** terminal journal/restoration writes fail but a later generic failed pending write succeeds and is read back
- **THEN** the current pending record is persisted failed with `journalUnavailable: true` in that same write, independent of the unavailable journal, and no unverified terminal report is associated with it after navigation, remount or process restart

### Requirement: A crash inside delivery degrades to interrupted, never a lost app

The pending-build record for an attempt SHALL be deleted only after its delivery (install/update to `AppIndex` and the version store) completes successfully, except that a record whose app was deleted before delivery SHALL be removed without a delivery (`AppGoneError`). If the process dies after delivery begins but before it completes, the record MUST remain and, per the launch-time demotion rule, surface as `interrupted` — the attempt is never silently lost.

#### Scenario: Death mid-delivery leaves a recoverable trace

- **WHEN** the host process dies after a `result` event arrives but before delivery (install/update) finishes, and the host relaunches
- **THEN** the pending-build record still exists and its state is `interrupted`, not deleted and not `building`

#### Scenario: An app deleted before delivery is removed without a delivery

- **WHEN** delivery finds that the launcher index no longer holds the app (`AppGoneError`)
- **THEN** no delivery happens and the pending-build record is removed, not left as `interrupted`
