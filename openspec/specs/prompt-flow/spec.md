# prompt-flow Specification

## Purpose
The on-device prompt-to-app UX: a five-step machine (compose → clarify → plan → build → done)
that turns a user's casual prompt into a delivered mini-app. Covers clarifying questions as a
pre-stream exchange that never becomes a generation stage, the plan step as the approval gate
with inline per-row editing (a hand-edited plan's rows become the build prompt's source of
truth), stage-only progress rendering with no SDK/engineering internals exposed, honest failure
handling with a rephrase path, the done step's two distinct destinations, delivery routed by the
target app's rewind state (new entry / new snapshot on tip / silent shared continuation behind
tip), the structured prompt envelope tracked against every delivered snapshot, the persisted
anonymous device identity attached to every request, and clean cancellation of an in-flight
generation.
## Requirements
### Requirement: Successful generation is delivered per the app's rewind state
On a `result` terminal event, the generated app SHALL be delivered as follows: a new launcher entry when no existing app is being edited; a new snapshot on the same lineage when editing an app that is at the tip of its own history; a silently created new launcher entry sharing the original's storage group, with no share/fresh question asked, when editing an app that has been restored to a version behind its own tip.

#### Scenario: New app delivery
- **WHEN** a generation started from the home screen's create affordance succeeds
- **THEN** a new launcher entry is installed from the delivered app

#### Scenario: Edit at tip delivers in place
- **WHEN** a generation started by re-prompting an app that is at the tip of its own history succeeds
- **THEN** the same launcher entry gains a new snapshot; no new entry is created

#### Scenario: Edit behind tip delivers as a silent shared continuation
- **WHEN** a generation started by re-prompting an app whose active version is behind its own tip succeeds
- **THEN** a new launcher entry is created sharing the original's storage group, without asking the user whether to share

### Requirement: Every delivered generation is tracked with a structured prompt envelope
The prompt tracked against a delivered generation's snapshot SHALL be the JSON envelope `{v: 2, text: <the approved prompt text>, summary?: <the run's summary>}`. `text` SHALL remain the verbatim approved prompt, so the user's own words can be echoed rather than reconstructed. `summary` SHALL be present when the run's terminal event carried one and absent otherwise.

Every reader SHALL accept a `v1` envelope (`{v: 1, text}`) and a raw non-envelope string unchanged; neither is an error, and neither requires a migration. The lineage stamp remains a commit trailer outside the envelope and SHALL NOT be written into it.

#### Scenario: Envelope round-trips through history
- **WHEN** a generation is delivered and its app's history is later viewed
- **THEN** the tracked prompt parses as the envelope's `text` field, not a raw unparsed string

#### Scenario: A summary rides with the prompt
- **WHEN** a run whose terminal event carried a summary is delivered
- **THEN** the stored envelope carries both the verbatim prompt text and that summary

#### Scenario: Older envelopes still read
- **WHEN** a snapshot stored before this change, or a seeded raw-string prompt, is read
- **THEN** it parses to its prompt text with no summary, and nothing errors or requires migration

### Requirement: Every server request carries a persisted anonymous device identity
The device SHALL generate and persist a UUID-shaped identifier on first use and attach it as the `x-whim-device` header on every rewrite and generation request.

#### Scenario: Device id persists across requests
- **WHEN** two separate prompt flows are run on the same device
- **THEN** both requests carry the same `x-whim-device` value, generated once and reused

### Requirement: Leaving generation cancels the in-flight request cleanly
Navigating away from the progress screen before a terminal event arrives SHALL abort the underlying request. No app SHALL be installed or updated from a cancelled generation.

#### Scenario: Cancel mid-stream
- **WHEN** the user backs out of the progress screen before `result` or `failure` arrives
- **THEN** the request is aborted and no launcher entry is created or modified

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

### Requirement: Tapping a building ghost tile reattaches to the build-progress screen

Tapping a ghost tile whose pending-build record is `building` SHALL return the user to the build-progress screen for that in-flight generation, without starting a new request.

#### Scenario: Tap to reattach

- **WHEN** the user taps a `building` ghost tile for a generation left running earlier
- **THEN** the build-progress screen opens showing that generation's current progress, and no new generation request is sent

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

### Requirement: A stall heartbeat visibly reports when the stream goes quiet

The build screen SHALL track the time since the last progress event arrived on the generation stream. Every stream event counts as progress (`token`, `stage`, `queued`, `restart`, `thinking`, `diagnostic`, `usage`, and the terminal events); the server's keepalive comment frame does not. A keepalive is liveness: it proves the connection is alive, keeps the transport open, and SHALL NOT reset this clock. When that period exceeds 40 seconds (`STALL_MS` in `src/host/launcher/prompt-flow.ts`), the screen SHALL visibly report that the make has not progressed, stating for how long (e.g. "No progress for 40 s"), without claiming the connection is silent. The indication SHALL clear as soon as any new progress event arrives.

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

### Requirement: The failure screen includes a what-happened timeline section

The failure screen SHALL include a "what happened" section rendering the failed attempt's run
timeline as a readable list — stage transitions with durations, output growth, and the failure
detail already permitted on this screen (`reason` and each diagnostic's `hint`). This section is
in addition to, not a replacement for, the existing checklist panel.

#### Scenario: A failure's timeline is shown on the failure screen

- **WHEN** the failure screen renders for a `failed` or `interrupted` pending-build record
- **THEN** a "what happened" section shows the recorded stage transitions, their durations, and
  output growth, alongside the existing checklist

#### Scenario: The timeline section carries no engineering detail beyond what the screen already permits

- **WHEN** the "what happened" section is inspected
- **THEN** every piece of failure detail it shows is a `reason` string or a diagnostic `hint`, and
  no `kind`, `symbol`, or raw `message` value appears

### Requirement: Dev mode adds diagnostics and repair-attempt counts to the run timeline

The run timeline SHALL additionally show the number of diagnostics observed and the number of
repair attempts observed for the attempt when the host's explicit developer-diagnostics flag is
enabled (the project's `__DEV__ || <explicit flag>` convention — never a bare `__DEV__` check).
This additional detail SHALL NOT appear when the flag is disabled.

#### Scenario: Dev mode shows additional counts

- **WHEN** the developer-diagnostics flag is enabled and the run timeline is shown
- **THEN** it additionally shows the diagnostics count and the repair-attempts count observed for
  that attempt

#### Scenario: Non-dev builds show no additional counts

- **WHEN** the developer-diagnostics flag is disabled
- **THEN** the run timeline shows no diagnostics count and no repair-attempts count

### Requirement: A response to a request the user has left cannot move the screen
Applying a clarify or rewrite response to on-screen state SHALL be guarded by the current screen
still being the one that started the request. A response that resolves after the user has
navigated elsewhere SHALL be discarded rather than applied.

#### Scenario: A late clarify response cannot hijack navigation
- **WHEN** the user backs out of the compose step to Home while a clarify exchange is in flight,
  and the clarify response resolves afterward
- **THEN** the resolved response is discarded and the user remains on Home; no screen change is
  forced

#### Scenario: A late rewrite response after leaving the plan step is discarded
- **WHEN** the user navigates away from the plan step while a rewrite request is in flight, and
  the response resolves afterward
- **THEN** the resolved response is discarded and does not alter the screen the user is now on

### Requirement: A hung connection to the generation stream is surfaced honestly
Opening the `POST /v1/generate` stream SHALL be bounded by a connect/first-event timeout. If no
first byte or event is observed within that window, the attempt SHALL be classified and shown as
a network failure, not left rendering as in-progress. Once the first event has been observed, no
further timeout SHALL apply to the remainder of the stream — a long-running generation SHALL be
allowed to continue indefinitely.

#### Scenario: A hung connect surfaces as a failure, not a stall
- **WHEN** the server accepts the TCP connection but never sends a first byte of the
  `/v1/generate` response within the connect timeout window
- **THEN** the build step shows the honest failure screen with a network-classified reason,
  rather than remaining on the first stage indefinitely

#### Scenario: A long but active stream is never timed out
- **WHEN** the stream has already delivered at least one event and continues running well beyond
  the connect-timeout duration
- **THEN** the stream is not aborted for exceeding any duration limit

#### Scenario: The timeout applies on both transports
- **WHEN** the runtime uses the `fetch`-based transport or the `XMLHttpRequest`-based transport
  to open the generation stream
- **THEN** a hung connect on either transport is classified as a network failure within the same
  connect-timeout window

### Requirement: A rewrite for an edit carries the app it is changing

When the plan step opens for a re-prompt of an installed app, the device SHALL send that app's context with the rewrite request: its current display name and the display names of its collections and their fields, read from the entry's own stored record.

It SHALL send no app context when the flow is composing a new app. The context SHALL be assembled by a pure, Node-testable function outside the shell component, SHALL carry no source, no burned ids and no record contents, and SHALL be built through type-only contract imports so no zod value enters the Metro bundle graph. The plan step's user-visible copy, its rows, and its approval gate SHALL be unchanged.

#### Scenario: A re-prompt tells the rewrite what it is changing

- **WHEN** the user re-prompts an installed app called `Habit Tracker` whose schema declares a `Completions` collection
- **THEN** the rewrite request body carries `app.name` of `Habit Tracker` and `Completions` among `app.collections`

#### Scenario: Composing a new app sends no context

- **WHEN** the plan step opens from a compose step with no app being edited
- **THEN** the rewrite request body carries no `app` field

#### Scenario: Only names leave the device

- **WHEN** a re-prompt's rewrite request body is inspected
- **THEN** it contains display names only — no source, no bundle, no burned ids, no stored records

### Requirement: The compose entry point shows a server-unreachable notice without blocking generation
The prompt flow's entry point SHALL show a "server unreachable" notice when the session connectivity state is offline. The notice SHALL be advisory only: it SHALL NOT prevent the user from submitting a prompt, and a submission that succeeds SHALL proceed exactly as it would if the notice were absent (per `server-connectivity`'s "a real generation succeeding counts as the session's first success"). Because the compose step opens only with AI-data consent granted and a server address always exists (an override or the compiled-in default), no "set an address in Settings" message SHALL be shown.

#### Scenario: Notice shown while offline
- **WHEN** the user opens the prompt entry point while the connectivity state is offline
- **THEN** the screen shows a "server unreachable" notice

#### Scenario: Submitting while offline is still permitted
- **WHEN** the connectivity state is offline and the user submits a prompt
- **THEN** the request is sent exactly as it would be online, and the notice does not gate submission

#### Scenario: No address message ever
- **WHEN** the user opens the prompt entry point with no server override saved
- **THEN** no "set an address in Settings" message is shown, and the connectivity notice follows the session state alone

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
The prompt flow SHALL apply the forward-compatibility fallback of any stream event or unary response it cannot use: continue on `skip`, end on the failure screen on `fail`; on `update`, end a run in progress on the Failure page in its needs-a-newer-Whim kind (actions Update Whim and Not now), and end a flow that has no run (a clarify, rewrite or report response) on the update screen. `notice` text SHALL be rendered as plain text only, and no fallback SHALL install or update an app.

#### Scenario: Update fallback mid-build
- **WHEN** a build stream carries an event with `compat.fallback: 'update'` that the app can't use
- **THEN** the build ends, its pending record resolves as failed with an update remedy and the notice as its reason, the Making sheet shows the Failure page ("Finishing this needs the latest Whim.") with Update Whim and Not now, and no update screen opens

#### Scenario: Update fallback outside a run
- **WHEN** a clarify response carries `compat.fallback: 'update'` that the app can't use
- **THEN** the update screen shows the notice, and no pending record exists

### Requirement: A slow step on a live connection never ends the attempt as a lost connection

Once any byte of the `POST /v1/generate` response has arrived, keepalive comment frames included, no step of the run, however slow, SHALL end the attempt as a lost connection. Only a transport error, an abort, or the stream's own terminal event SHALL end it. The connect/first-event timeout of "A hung connection to the generation stream is surfaced honestly" SHALL count a keepalive frame as the first byte.

#### Scenario: A first step slower than the connect window

- **WHEN** the server accepts a generation, sends its opening frame at once, and its first pipeline event arrives 20 seconds later
- **THEN** the attempt continues to that event and no network failure is shown

#### Scenario: A later step slower than the stall window

- **WHEN** a step between two events takes 35 seconds and keepalive frames arrive throughout
- **THEN** the attempt continues, the Making page does not report a lost connection, and the next event arrives normally

### Requirement: The making flow is one sheet with four pages

Making or changing an app SHALL happen in one large sheet over the current screen with the pages Describe, Plan, Making and Ready (or Failure), with no step indicator; each page SHALL start its headline at the same height. Forward movement SHALL be gated by one bottom action: `Continue` on Describe, `Make it` (or `Make the change`) on Plan, both `ember`. Back on Plan SHALL return to Describe with the text and answers kept. A busy action SHALL keep plain words, never a bare spinner. The sheet SHALL be keyed by the run's own journal id, so a page never shows another run's progress.

#### Scenario: Two runs never cross

- **WHEN** two runs are in flight and the user opens the second run's tile
- **THEN** the Making page shows only that run's steps, time and queue position

#### Scenario: Describe opens with the keyboard

- **WHEN** the user taps the composer
- **THEN** the sheet shows "What should it do?" with the field focused and Continue above the keyboard

### Requirement: The plan page shows the questions and the plan together

Continue SHALL send one clarify request and show the Plan page: "Here's the plan", the person's words quoted as the hero, then "A few choices" (the clarify questions, at most three, as soon as they land) and "What I'll make" (the plan rows, with skeleton rows until they land). Every question SHALL end with "Decide for me", selected by default and exclusive in multi-select (picking it clears the others; picking another clears it). A question whose options are all 20 characters or fewer SHALL show wrapping chips; otherwise every option SHALL be a full-width radio (single) or checkbox (multi) row. An answered question scrolled out of view SHALL collapse to one line with its answer, and tapping it SHALL reopen it. Answers SHALL travel to generation as `clarifications`; the plan rows SHALL NOT restate them. The exchange SHALL emit no `GenerationEvent`.

#### Scenario: Making without touching a choice

- **WHEN** the user taps Make it without changing any question
- **THEN** every question is sent as delegated (`decide: true`)

#### Scenario: Long options become rows

- **WHEN** one option of a question is 34 characters long
- **THEN** that question renders every option as a full-width row, not chips

### Requirement: The plan page is the approval gate before making

No generation request SHALL be sent before the user takes `Make it`. Each plan row SHALL edit in place on the Plan page, one at a time, with Save and Cancel at full targets; an edited row SHALL show the person's words and an "Edited" label. An unedited plan's build prompt SHALL be the rewrite response's `rewritten` string byte-identical; once any row is hand-edited the build prompt SHALL be assembled deterministically from the current rows, and SHALL stay on that path even if the text is reverted. A plan that arrives as one string SHALL render as one row. No SDK or engineering detail SHALL appear on the page. A server notice SHALL show above `Make it`.

#### Scenario: Nothing is made before approval

- **WHEN** the Plan page is showing
- **THEN** no generation request has been sent

#### Scenario: A hand-edited plan's rows become the build prompt

- **WHEN** the user edits a row and taps Make it
- **THEN** the build prompt is assembled from the current rows

### Requirement: The Making page shows honest progress without internals

While a run streams the Making page SHALL show the 128 pt ember (working, stuck after 40 s with no progress event, following the stream's activity), "Making <name>" (or "Changing <name>"), the person's words, the four steps (`Reading your plan`, `Writing the app`, `Checking it runs safely`, `Putting it on your home screen`) with done, current (elapsed time on it) and waiting states, one time line from `system.md` §8 chosen by elapsed time, stall and queue position, and Stop. A `repair` event SHALL add "Fixing a problem · try N of M" under the current step and move the marker down to it. Raw `token` text, raw diagnostic fields, transport wording and output-size counters SHALL NOT render. Stop SHALL end the run at once and leave a stopped tile.

#### Scenario: A slow run says so honestly

- **WHEN** 80 seconds have passed and the run is still writing
- **THEN** the time line reads "Taking longer than most. Still going."

#### Scenario: Waiting in line

- **WHEN** a `queued` event with two runs ahead arrives
- **THEN** the page reads "2 ahead of you.", the ember is still and dim, and Stop is available

#### Scenario: Stop after a typo costs one tap

- **WHEN** the user taps Stop right after Make it
- **THEN** the run ends and a stopped tile they can change, retry or discard is on Home

### Requirement: Leaving the making sheet keeps the run and the draft

Closing the sheet (close button, back, drag or scrim) SHALL never cancel a run: on Making it SHALL collapse into the run's tile, which keeps its ember and reopens the page. Closing on Describe or Plan SHALL abort any in-flight clarify or rewrite request and keep the draft: the composer SHALL read "Continue "<start of the text>"" and reopening SHALL restore the text, the answers and any plan edits.

#### Scenario: A closed plan comes back

- **WHEN** the user answers two questions, closes the sheet and taps the composer again
- **THEN** the Plan page returns with the same text and answers, and the abandoned rewrite was aborted

### Requirement: The Ready page opens the app or returns home

When a run delivers with the sheet open, the Ready page SHALL show the 96 pt tile, the app's name, the person's words, "It's on your home screen." (after a change, "It opens with your change."), `Open it` in the app's tint and `Done` (plain). `Open it` SHALL launch the app; `Done` SHALL return to Home. When it delivers with the sheet closed, Home SHALL show the toast "<name> is ready · Open", or over a running app the orb SHALL get its `ember` dot. Ready SHALL NOT run the app before it is opened.

#### Scenario: Open launches the app

- **WHEN** the user takes `Open it`
- **THEN** the delivered app opens from its tile

#### Scenario: Ready after a change

- **WHEN** a change to an app on the home screen delivers with the sheet open
- **THEN** the Ready page reads "It opens with your change." in place of "It's on your home screen."

### Requirement: Failure is shown by kind, honestly, never as a crash

A `failure` terminal event or a stream error SHALL show the Failure page: the ember out, "Couldn't make this", one sentence and actions chosen by failure kind as in `system.md` §8 (couldn't run with or without a rewording hint, server refused for now, needs a newer Whim, stopped when Whim closed, connection dropped), "Your other apps are untouched" (or "Your current version still works" when changing), a collapsed "What happened" timeline, and Discard in the body with a 6 s Undo. A dropped connection SHALL never suggest rewording. A connection problem before any run (clarify or rewrite unreachable) SHALL NOT open this page; the current page SHALL show a notice with Try again. A service refusal SHALL be presented as `service-refusals` specifies. Diagnostic detail SHALL be limited to each diagnostic's `hint`; no failure reason SHALL be a transport message, and an unknown reason SHALL show the server's text.

#### Scenario: Offline mid-run

- **WHEN** the stream drops because the phone went offline
- **THEN** the page reads "I lost the connection to the server partway through." and Try again enables when the phone is back online

### Requirement: Details of a run are reachable from its tile and its failure

The menu of a tile being made SHALL offer Details, which reopens that run's Making page. The Failure page SHALL offer "What happened", which shows the run's timeline as a readable list, each row its own accessibility element, without raw `token` text or raw diagnostic `kind`, `symbol` or `message` values.

#### Scenario: Details from a tile being made

- **WHEN** the user long-presses a tile being made and taps Details
- **THEN** that run's Making page opens

#### Scenario: What happened is readable by VoiceOver

- **WHEN** a VoiceOver user expands "What happened" on the Failure page
- **THEN** each timeline row is focusable on its own

