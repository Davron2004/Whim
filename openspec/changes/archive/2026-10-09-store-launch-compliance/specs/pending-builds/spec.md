## MODIFIED Requirements

### Requirement: A pending-build record is deleted on delivery, cancel, or dismiss

The host SHALL delete a pending-build record when its generation is successfully delivered, when the user cancels the in-flight generation, when the user dismisses a `failed`/`interrupted` record, or when the server refuses a fresh plan-started attempt with a service refusal (see `service-refusals`) while that attempt's build screen is still showing. A refused attempt SHALL be deleted exactly as a cancel deletes it, together with its run journal, because no generation took place. A deleted record MUST NOT reappear on any later render.

#### Scenario: Successful delivery removes the record

- **WHEN** a generation's terminal `result` event is delivered and installed
- **THEN** the pending-build record for that attempt is deleted

#### Scenario: Cancel removes the record

- **WHEN** the user cancels an in-flight generation
- **THEN** the pending-build record for that attempt is deleted

#### Scenario: Dismiss removes the record

- **WHEN** the user dismisses a `failed` or `interrupted` record
- **THEN** the record is deleted and no longer renders on the grid

#### Scenario: A refused fresh attempt leaves nothing behind

- **WHEN** the user taps `Build it` and the generate request is refused with a service refusal while the build screen is still showing
- **THEN** the attempt's pending-build record and run journal are deleted, and no ghost tile renders for it

### Requirement: Terminal failure or a stream error sets the record to failed with a persisted payload

When a generation ends in a terminal `failure` event, or the stream errors before any terminal event arrives, the host SHALL set the pending-build record's state to `failed` and persist the failure payload (reason and available diagnostics) on the record. The record MUST NOT be deleted on failure. A service refusal SHALL count as such an error, with the refusal's hint as the persisted reason, in every case except the fresh plan-started attempt still on its build screen, which is deleted instead. That covers a refused Retry and a refusal that arrives after the user left the build screen.

#### Scenario: Terminal failure event persists the record as failed

- **WHEN** a generation's stream ends with a `failure` event
- **THEN** the pending-build record's state becomes `failed`, its failure payload is persisted, and the record is not deleted

#### Scenario: A stream error with no terminal event still persists as failed

- **WHEN** the SSE stream ends or errors without a terminal event, other than a user-initiated cancel
- **THEN** the pending-build record's state becomes `failed` and its failure payload is persisted

#### Scenario: A refused retry keeps its record

- **WHEN** a Retry on a failed record is refused with a service refusal
- **THEN** the record stays, its state is `failed`, and its persisted reason is the refusal's hint
