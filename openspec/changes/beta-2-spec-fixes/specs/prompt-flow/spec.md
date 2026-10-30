## MODIFIED Requirements

### Requirement: A stall heartbeat visibly reports when the stream goes quiet

The build screen SHALL track the time since the last progress event arrived on the generation stream. Every stream event counts as progress (`token`, `stage`, `queued`, `restart`, `thinking`, `diagnostic`, `usage`, and the terminal events); the server's keepalive comment frame does not. A keepalive is liveness: it proves the connection is alive, keeps the transport open, and SHALL NOT reset this clock. When that period exceeds 40 seconds (`STALL_MS` in `src/host/launcher/prompt-flow.ts`), the screen SHALL visibly report that nothing new has arrived, stating for how long (e.g. "Nothing has arrived for Ns"). The indication SHALL clear as soon as any new progress event arrives.

#### Scenario: A stalled stream shows a quiet indication

- **WHEN** more than 40 seconds pass in which the server's keepalive frames keep arriving but no stream event does
- **THEN** the build screen shows a quiet indication stating the elapsed quiet duration, and the attempt is not ended

#### Scenario: A resumed stream clears the quiet indication

- **WHEN** a quiet indication is showing and a new stream event arrives
- **THEN** the quiet indication clears immediately

#### Scenario: A keepalive alone does not clear the quiet indication

- **WHEN** a quiet indication is showing and a keepalive frame arrives
- **THEN** the quiet indication stays, with its elapsed duration still counting from the last progress event

#### Scenario: A healthy stream shows no quiet indication

- **WHEN** stream events keep arriving within the 40-second threshold
- **THEN** no quiet indication is shown

### Requirement: Messages the app can't use follow their fallback
The prompt flow SHALL apply the forward-compatibility fallback of any stream event or unary response it cannot use: continue on `skip`, end on the failure screen on `fail`; on `update`, end a run in progress on the Failure page in its needs-a-newer-Whim kind (actions Update Whim and Not now), and end a flow that has no run (a clarify, rewrite or report response) on the update screen. `notice` text SHALL be rendered as plain text only, and no fallback SHALL install or update an app.

#### Scenario: Update fallback mid-build
- **WHEN** a build stream carries an event with `compat.fallback: 'update'` that the app can't use
- **THEN** the build ends, its pending record resolves as failed with an update remedy and the notice as its reason, the Making sheet shows the Failure page ("Finishing this needs the latest Whim.") with Update Whim and Not now, and no update screen opens

#### Scenario: Update fallback outside a run
- **WHEN** a clarify response carries `compat.fallback: 'update'` that the app can't use
- **THEN** the update screen shows the notice, and no pending record exists

## ADDED Requirements

### Requirement: A slow step on a live connection never ends the attempt as a lost connection

Once any byte of the `POST /v1/generate` response has arrived, keepalive comment frames included, no step of the run, however slow, SHALL end the attempt as a lost connection. Only a transport error, an abort, or the stream's own terminal event SHALL end it. The connect/first-event timeout of "A hung connection to the generation stream is surfaced honestly" SHALL count a keepalive frame as the first byte.

#### Scenario: A first step slower than the connect window

- **WHEN** the server accepts a generation, sends its opening frame at once, and its first pipeline event arrives 20 seconds later
- **THEN** the attempt continues to that event and no network failure is shown

#### Scenario: A later step slower than the stall window

- **WHEN** a step between two events takes 35 seconds and keepalive frames arrive throughout
- **THEN** the attempt continues, the Making page does not report a lost connection, and the next event arrives normally
