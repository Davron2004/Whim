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
