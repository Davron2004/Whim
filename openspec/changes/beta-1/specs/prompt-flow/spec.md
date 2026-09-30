## ADDED Requirements

### Requirement: The build screen shows the user's place in line
While the stream's latest event is `queued`, the build screen SHALL show that the generation is waiting its turn and how many generations are ahead, SHALL keep Cancel and "Leave it running" available, and SHALL switch to normal progress at the first `stage` event.

#### Scenario: Waiting behind two builds
- **WHEN** a `queued` event with `position: 3` arrives
- **THEN** the build screen says the build is in line with 2 ahead

#### Scenario: Turn comes
- **WHEN** a `stage` event arrives after `queued` events
- **THEN** the in-line message is replaced by normal progress

### Requirement: A request Whim can't build is answered before any build
When a clarify response carries `limit`, the prompt flow SHALL show the reason and the alternative in plain words, SHALL offer to continue with the alternative as the request, and SHALL offer to change the idea; it SHALL NOT start a generation on its own.

#### Scenario: Weather app
- **WHEN** clarify answers a weather-app request with a `limit`
- **THEN** the user sees why live weather isn't possible and a one-tap option to build the suggested alternative, or goes back to edit

### Requirement: A restarted model turn resets the turn's visible activity
On a `restart` event the build screen SHALL discard the activity signals counted from the current turn's streamed tokens and continue as the same build, without showing a failure.

#### Scenario: Provider drop mid-turn
- **WHEN** a `restart` event arrives after 1,200 characters were written in the current turn
- **THEN** the character count for the turn restarts from zero and the build continues

### Requirement: Messages the app can't use follow their fallback
The prompt flow SHALL apply the forward-compatibility fallback of any stream event or unary response it cannot use: continue on `skip`, end on the failure screen on `fail`, end on the update screen on `update`; `notice` text SHALL be rendered as plain text only, and no fallback SHALL install or update an app.

#### Scenario: Update fallback mid-build
- **WHEN** a build stream carries an event with `compat.fallback: 'update'` that the app can't use
- **THEN** the build ends, its pending record resolves as failed, and the update screen shows the notice

## MODIFIED Requirements

### Requirement: Clarifying questions are a pre-stream exchange, never a generation stage

Between compose and plan the device SHALL make one request/response call to the clarify endpoint and render the returned questions — at most three — each as a set of answer pills that allows one pick for a `select: 'one'` question and several for `select: 'many'`, plus a typed "Other" answer when the question allows it, plus a "Decide for me" choice on every question that clears any picks and delegates that question to Whim. The step SHALL be skippable with zero answers and SHALL carry the helper line `Skip these and Whim will pick sensible answers.`; there SHALL be no validation gate on the questions. For exactly two questions the headline SHALL read `Two quick things`, and the same counted construction SHALL be used for one or three.

The user's submitted prompt SHALL be echoed on this step as the user's own words. Collected answers SHALL be threaded into the subsequent requests. This exchange SHALL NOT emit or consume any `GenerationEvent`, and no `clarify` member SHALL be added to the stage vocabulary.

#### Scenario: Skipping answers nothing
- **WHEN** the user taps the primary action on the clarify step with no answers selected
- **THEN** the flow proceeds and the request carries no answers

#### Scenario: Answers reach generation
- **WHEN** the user answers a clarifying question and the app is later generated
- **THEN** the generation request carries that question's identifier and the chosen answer

#### Scenario: Several picks
- **WHEN** the user picks two options on a `select: 'many'` question
- **THEN** both are carried as that question's `choices`

#### Scenario: Typed answer
- **WHEN** the user types an answer into a question's "Other" field
- **THEN** the request carries it as that question's `other`, and the field stays above the keyboard while typing

#### Scenario: Decide for me
- **WHEN** the user taps "Decide for me" on a question
- **THEN** its picks and typed answer clear and the request carries `decide: true` for it

#### Scenario: The stage vocabulary is untouched
- **WHEN** the generation event stream for a run that began with clarifying questions is inspected
- **THEN** every `stage` event's stage is one of the ratified members and none names clarification


### Requirement: A stall heartbeat visibly reports when the stream goes quiet

The build screen SHALL track the time since the last `token`, `stage`, `queued` or `restart` event arrived. When that
quiet period exceeds a threshold of approximately 8 seconds, the screen SHALL visibly report that
the stream has gone quiet, stating how long it has been quiet (e.g. "quiet for Ns"). The heartbeat
SHALL clear its quiet indication as soon as a new `token`, `stage`, `queued` or `restart` event arrives.

#### Scenario: A stalled stream shows a quiet indication

- **WHEN** more than approximately 8 seconds pass with no `token`, `stage`, `queued` or `restart` event arriving
- **THEN** the build screen shows a quiet indication stating the elapsed quiet duration

#### Scenario: A resumed stream clears the quiet indication

- **WHEN** a quiet indication is showing and a new `token`, `stage`, `queued` or `restart` event arrives
- **THEN** the quiet indication clears immediately

#### Scenario: A healthy stream shows no quiet indication

- **WHEN** `token`, `stage`, `queued` or `restart` events keep arriving within the ~8 second threshold
- **THEN** no quiet indication is shown


### Requirement: Failure screens hydrate from the persisted failure payload

When the failure screen is opened from a `failed` or `interrupted` ghost tile rather than from a live terminal `failure` event, it SHALL be populated from PendingBuildStore's current record: the persisted failure payload when verified, its retained generic failed payload during a documented write outage, or the existing interruption explanation for a current interrupted record, and SHALL offer three actions: Retry (start a new generation from the record's stored prompt, reusing the same launcher id only after verified durable pending/journal setup and its provenance-based marker-clear write), a non-destructive Back (return to the launcher leaving the record, its ghost tile, and its run journal untouched), and Discard (delete the record). A retained entry SHALL remain available when Discard cannot verify removal, with the established generic failure and Back. A volatile failure SHALL carry no saved-record or journal/report identity; its current-entry ID MAY be used for actions. Unverified terminal journals SHALL remain unassociated across Back, reopening, launcher remount and process restart through the pending record's durable `journalUnavailable: true` metadata, even if a generic pending fallback itself was persisted. Report entry points SHALL recheck that marker and SHALL NOT rely solely on a process-local ref or a stale screen journal ID. The Discard action's label SHALL state that it discards the attempt; it MUST NOT be labeled as plain navigation. The hardware back gesture on the failure screen SHALL perform the non-destructive Back, never Discard.

#### Scenario: Reopening a failed ghost hydrates from the stored payload

- **WHEN** the user taps a `failed` ghost tile whose failure payload was persisted
- **THEN** the failure screen shows the reason and diagnostics from the record's persisted failure payload, not a live stream

#### Scenario: Retry starts a fresh generation with the same id

- **WHEN** the user chooses Retry on a failure screen opened from a ghost tile and new pending/journal setup is durably verified
- **THEN** a new generation is started from the record's stored prompt, reusing the same launcher id

#### Scenario: Back leaves the record in place

- **WHEN** the user chooses the non-destructive Back on a failure screen opened from a ghost tile
- **THEN** the launcher is shown again, the current pending entry and ghost remain, and Back has changed no pending or journal data

#### Scenario: Discard removes the record

- **WHEN** the user chooses Discard on a failure screen opened from a ghost tile and removal is verified
- **THEN** the pending-build record is deleted and its ghost tile no longer renders

#### Scenario: Back and reopen during a terminal write outage

- **WHEN** a confirmed-ended attempt has a volatile failed current view and the user chooses Back then opens its ghost
- **THEN** the generic failure and Retry/Back/Discard remain reachable without a new request, native error text, or an unverified journal/report association

#### Scenario: Discard cannot complete

- **WHEN** Discard of the retained attempt fails to verify complete removal
- **THEN** the generic failure remains with Back available, and returning Home keeps the current entry

#### Scenario: Fresh launcher does not inherit an old report

- **WHEN** a new LauncherShell reads the same MMKV state containing a generic failed record with true journal-unavailability metadata and the prior attempt's raw journal
- **THEN** reopening its ghost shows the generic failure without attaching the old report, even though the new shell has no remembered unavailable-journal Set

#### Scenario: Retry setup dies before verified journal replacement

- **WHEN** Retry leaves a persisted flagged building record after failed setup/rollback and a new process recovers it
- **THEN** the interrupted failure screen withholds the old journal and Retry remains subject to fully verified setup before HTTP

### Requirement: Live failure screens offer Discard only when an attempt was settled

A failure screen shown from a live failure SHALL offer the Discard action only when a settled current pending-build record exists for the failed attempt, including an explicitly volatile failed record, and choosing it SHALL delete that record (and its run journal) exactly as the ghost-opened screen's Discard does, retaining an entry whose removal cannot be verified. A failure screen for a failure that precedes any generation attempt (such as a clarify or rewrite failure) SHALL NOT render a Discard action, because there is no record to discard. The non-destructive Back SHALL be offered in every case.

#### Scenario: A live terminal failure's Discard deletes the settled record

- **WHEN** a generation fails with a live terminal failure and the user chooses Discard on the resulting failure screen and removal is verified
- **THEN** the settled pending-build record and its run journal are deleted and no ghost tile renders for that attempt

#### Scenario: A pre-attempt failure offers no Discard

- **WHEN** a clarify or rewrite step fails before any generation attempt started
- **THEN** the failure screen renders no Discard action, and Back returns to the launcher
