## MODIFIED Requirements

### Requirement: Failure screens hydrate from the persisted failure payload

When the failure screen is opened from a `failed` or `interrupted` ghost tile rather than from a live terminal `failure` event, it SHALL be populated from the pending-build record's persisted failure payload, and SHALL offer three actions: Retry (start a new generation from the record's stored prompt, reusing the same launcher id), a non-destructive Back (return to the launcher leaving the record, its ghost tile, and its run journal untouched), and Discard (delete the record). The Discard action's label SHALL state that it discards the attempt; it MUST NOT be labeled as plain navigation. The hardware back gesture on the failure screen SHALL perform the non-destructive Back, never Discard.

#### Scenario: Reopening a failed ghost hydrates from the stored payload

- **WHEN** the user taps a `failed` ghost tile some time after the original failure
- **THEN** the failure screen shows the reason and diagnostics from the record's persisted failure payload, not a live stream

#### Scenario: Retry starts a fresh generation with the same id

- **WHEN** the user chooses Retry on a failure screen opened from a ghost tile
- **THEN** a new generation is started from the record's stored prompt, reusing the same launcher id

#### Scenario: Back leaves the record in place

- **WHEN** the user chooses the non-destructive Back on a failure screen opened from a ghost tile
- **THEN** the launcher is shown again and the pending-build record, its ghost tile, and its run journal all still exist

#### Scenario: Discard removes the record

- **WHEN** the user chooses Discard on a failure screen opened from a ghost tile
- **THEN** the pending-build record is deleted and its ghost tile no longer renders

## ADDED Requirements

### Requirement: Live failure screens offer Discard only when an attempt was settled

A failure screen shown from a live failure SHALL offer the Discard action only when a settled pending-build record exists for the failed attempt, and choosing it SHALL delete that record (and its run journal) exactly as the ghost-opened screen's Discard does. A failure screen for a failure that precedes any generation attempt (such as a clarify or rewrite failure) SHALL NOT render a Discard action, because there is no record to discard. The non-destructive Back SHALL be offered in every case.

#### Scenario: A live terminal failure's Discard deletes the settled record

- **WHEN** a generation fails with a live terminal failure and the user chooses Discard on the resulting failure screen
- **THEN** the settled pending-build record and its run journal are deleted and no ghost tile renders for that attempt

#### Scenario: A pre-attempt failure offers no Discard

- **WHEN** a clarify or rewrite step fails before any generation attempt started
- **THEN** the failure screen renders no Discard action, and Back returns to the launcher
