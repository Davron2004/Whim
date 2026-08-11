# prompt-flow Specification

## ADDED Requirements

### Requirement: Generation start writes a pending-build record and allocates the launcher id up front

When a generation request is sent, the prompt flow SHALL allocate the launcher id for the attempt before sending the request, and SHALL write a pending-build record carrying that id and a prompt-derived working title. This id allocation MUST happen for new-install attempts as well as edit/rebuild attempts.

#### Scenario: Id allocated before the request goes out

- **WHEN** the user approves the plan and the generation request is about to be sent
- **THEN** a launcher id has already been allocated for the attempt, and a pending-build record carrying that id exists before the request is sent

### Requirement: Successful delivery consumes the up-front allocated launcher id

On a `result` terminal event, the delivery step (install/update/fork) SHALL use the launcher id that was allocated at generation start, rather than allocating a new one at delivery time.

#### Scenario: Delivery reuses the id from generation start

- **WHEN** a generation succeeds and is delivered as a new installed app
- **THEN** the installed app's launcher id is the same id that was allocated when the generation started, not a newly minted one

### Requirement: Cancelling a generation deletes its pending-build record

In addition to aborting the underlying request, cancelling an in-flight generation SHALL delete the pending-build record for that attempt, so no ghost tile or failure record remains for a cancelled attempt.

#### Scenario: Cancel leaves no trace on the grid

- **WHEN** the user cancels an in-flight generation
- **THEN** the pending-build record for that attempt is deleted and no ghost tile remains for it

### Requirement: "Leave it running" leaves a visible building ghost

When the user chooses to leave a generation running in the background, the prompt flow SHALL keep the pending-build record in the `building` state and SHALL NOT delete or otherwise hide it. The home grid SHALL show the corresponding ghost tile for as long as the generation remains in flight.

#### Scenario: Leaving a build running shows a ghost on return to home

- **WHEN** the user chooses "Leave it running" and returns to the home screen while the generation is still in flight
- **THEN** the pending-build record is still `building`, and its ghost tile is visible on the grid

### Requirement: Tapping a building ghost tile reattaches to the build-progress screen

Tapping a ghost tile whose pending-build record is `building` SHALL return the user to the build-progress screen for that in-flight generation, without starting a new request.

#### Scenario: Tap to reattach

- **WHEN** the user taps a `building` ghost tile for a generation left running earlier
- **THEN** the build-progress screen opens showing that generation's current progress, and no new generation request is sent

### Requirement: Failure screens hydrate from the persisted failure payload

When the failure screen is opened from a `failed` or `interrupted` ghost tile rather than from a live terminal `failure` event, it SHALL be populated from the pending-build record's persisted failure payload, and SHALL offer Retry (start a new generation from the record's stored prompt, reusing the same launcher id) and Dismiss (delete the record).

#### Scenario: Reopening a failed ghost hydrates from the stored payload

- **WHEN** the user taps a `failed` ghost tile some time after the original failure
- **THEN** the failure screen shows the reason and diagnostics from the record's persisted failure payload, not a live stream

#### Scenario: Retry starts a fresh generation with the same id

- **WHEN** the user chooses Retry on a failure screen opened from a ghost tile
- **THEN** a new generation is started from the record's stored prompt, reusing the same launcher id

#### Scenario: Dismiss removes the record

- **WHEN** the user chooses Dismiss on a failure screen opened from a ghost tile
- **THEN** the pending-build record is deleted and its ghost tile no longer renders
