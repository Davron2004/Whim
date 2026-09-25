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
