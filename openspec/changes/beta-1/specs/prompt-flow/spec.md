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
