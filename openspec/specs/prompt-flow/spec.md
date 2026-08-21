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

### Requirement: Generation progress is shown without exposing internals
While a generation request streams, the UI SHALL render progress as four named steps in order — `Reading your plan`, `Writing the app`, `Checking it runs safely`, `Putting it on your home screen` — derived from `stage` events, under the title `Making it` and the subhead `This takes about a minute. You can leave and come back.` A step SHALL read as not-started, in-progress, or passed; passed steps SHALL stay passed.

Alongside the steps the screen SHALL show one plain-words sentence at a time describing the current action, in the user's terms. Raw `token` event text and raw `diagnostic.kind`/`diagnostic.symbol` values SHALL NOT be rendered to the user at any point during generation, and no raw log, terminal panel, or engineering trace SHALL be shown. Arriving text SHALL NOT be faded in or typed in per character.

The screen SHALL offer `Leave it running`, which returns the user to the shell without cancelling the run.

#### Scenario: Stage progress renders
- **WHEN** a `stage` event with `status: 'start'` arrives for `generate`
- **THEN** the `Writing the app` step reads as in-progress and the steps before it read as passed

#### Scenario: Token and diagnostic internals never render live
- **WHEN** `token` or `diagnostic` events arrive during generation
- **THEN** neither the token text nor the diagnostic's `kind`/`symbol` fields appear anywhere in the rendered UI, and no raw log panel is present

#### Scenario: Leaving does not cancel
- **WHEN** the user takes the `Leave it running` action mid-build
- **THEN** the shell is shown, the run continues, and its result is still delivered

#### Scenario: Prose does not animate in
- **WHEN** the current-action sentence changes
- **THEN** the new sentence appears without a fade or per-character typing animation

### Requirement: Failure is shown honestly, never as a crash
A `failure` terminal event, or a client-side stream error, SHALL produce a failure screen stating the reason and offering to rephrase (returning to the prompt screen with the user's text preserved). Diagnostic detail shown on this screen SHALL be limited to each diagnostic's `hint` string.

The screen SHALL be rendered to design `3b` and SHALL resolve every colour, radius, type face, and size from the shell's v2 design tokens — no numeric style literal and no hex value in its own stylesheet:

- a screen title at the display size the token scale defines for it, whose colour is **dynamic**: the failure hue when the run ended badly, the success hue when a repair recovered it;
- a sub-line under the title, in plain words, saying what happens next;
- an **attempt-progress row** of equal segments, one per permitted repair attempt — segments for spent attempts in the failure hue, the current attempt in the accent, the remainder in the neutral border tone — under a small uppercase mono label reading how many attempts were used. The row SHALL be shown only when the device actually observed repair attempts on the stream, and SHALL be hidden otherwise; a count SHALL NOT be invented for a run that never reached the repair stage;
- a bordered panel with the large radius, filled and outlined by the run's outcome tone, containing a **checklist** of rows. Each row carries a ring/mark icon and its text: a completed check with a filled ring and a check mark, a failed check with a filled ring and an alert mark, an in-flight check with a ring outline and no mark, and a waiting or advisory row with a muted ring outline, no mark, and muted text.

Checklist rows SHALL be built only from data the screen already receives — each diagnostic's `hint`, and copy-table strings. A row SHALL NOT carry a diagnostic's `kind`, `symbol`, or `message`; the hint-only discipline is unchanged by the redesign.

Every failure that reaches this screen SHALL also be recorded through the logging seam with the error class, message, stack, and the taxonomy the on-screen text deliberately scrubs — the screen stays plain-English while the detail becomes recoverable.

#### Scenario: Terminal failure event
- **WHEN** the stream ends with a `failure` event
- **THEN** the failure screen shows `reason` and each diagnostic's `hint`, and offers to rephrase

#### Scenario: Stream error before any terminal event
- **WHEN** the SSE stream ends or errors without a terminal event (not due to a user-initiated cancel)
- **THEN** the same honest failure screen is shown rather than the UI hanging or crashing

#### Scenario: Attempts are shown only when they happened
- **WHEN** the run reached the repair stage twice before failing
- **THEN** the attempt-progress row renders with two spent segments and a label naming the attempts used
- **AND WHEN** the run failed on a transport error before any stage arrived
- **THEN** no attempt-progress row is rendered

#### Scenario: The checklist reads as checks, not bullets
- **WHEN** the failure screen renders with diagnostics
- **THEN** each row carries its outcome icon and its hint text inside the bordered panel, and no row is prefixed with a bullet character

#### Scenario: No engineering detail leaks into the redesign
- **WHEN** any row of the checklist is inspected
- **THEN** its text is a diagnostic `hint` or a copy-table string, and no `kind`, `symbol`, or `message` value appears

#### Scenario: The failure is recoverable from the log
- **WHEN** the failure screen is shown
- **THEN** a record on the generation channel carries the error class, message, stack, and mapped error kind, none of which is rendered on screen

#### Scenario: Styling comes from tokens
- **WHEN** the failure screen's stylesheet is inspected
- **THEN** it contains no hex colour and no numeric font-size or radius literal

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

### Requirement: The prompt flow is a five-step machine — compose, clarify, plan, build, done

The on-device flow SHALL be a single machine with five steps: `compose` → `clarify` → `plan` → `build` → `done`. Compose SHALL show the headline `What should it do?`, the user's prompt in a field that is never live-highlighted, the helper line `Plain words are enough. Whim will ask if something is unclear.`, and suggestion chips under the eyebrow `Or start from` — tapping a chip SHALL fill the prompt and SHALL NOT advance the flow.

Forward movement SHALL be gated by an explicit primary action at the bottom of the screen: full width, 52–56px tall, card radius. Its label SHALL be `Continue` on compose and clarify, `Build it` on plan, and `One moment` while a step's request is in flight. A busy primary action SHALL always keep plain words — a bare spinner with no label SHALL NOT ship. Backward movement (clarify → compose, plan → clarify, compose → home) SHALL be immediate, with no busy state.

When the clarify step has no questions to ask, the flow SHALL move from compose directly to plan without rendering an empty clarify step.

#### Scenario: The flow advances only on the primary action
- **WHEN** the user taps a suggestion chip on the compose step
- **THEN** the prompt field is filled with that chip's text and the flow stays on compose

#### Scenario: Busy states keep their words
- **WHEN** any forward step is waiting on its request
- **THEN** the primary action reads `One moment` and no bare-spinner-only control is rendered

#### Scenario: Back is immediate
- **WHEN** the user goes back from plan to clarify, or from clarify to compose
- **THEN** the previous step renders immediately with its state preserved and no busy delay

#### Scenario: No questions skips the step
- **WHEN** the clarify exchange returns zero questions
- **THEN** the flow renders the plan step next and the clarify step is never shown

### Requirement: Clarifying questions are a pre-stream exchange, never a generation stage

Between compose and plan the device SHALL make one request/response call to the clarify endpoint and render the returned questions — at most three — each as a single-select set of answer pills. The step SHALL be skippable with zero answers and SHALL carry the helper line `Skip these and Whim will pick sensible answers.`; there SHALL be no validation gate on the questions. For exactly two questions the headline SHALL read `Two quick things`, and the same counted construction SHALL be used for one or three.

The user's submitted prompt SHALL be echoed on this step as the user's own words. Collected answers SHALL be threaded into the subsequent requests. This exchange SHALL NOT emit or consume any `GenerationEvent`, and no `clarify` member SHALL be added to the stage vocabulary.

#### Scenario: Skipping answers nothing
- **WHEN** the user taps the primary action on the clarify step with no answers selected
- **THEN** the flow proceeds and the request carries no answers

#### Scenario: Answers reach generation
- **WHEN** the user answers a clarifying question and the app is later generated
- **THEN** the generation request carries that question's identifier and the chosen answer

#### Scenario: The stage vocabulary is untouched
- **WHEN** the generation event stream for a run that began with clarifying questions is inspected
- **THEN** every `stage` event's stage is one of the ratified members and none names clarification

### Requirement: The plan step is the approval gate before generation

Before any generation request is sent, the device SHALL show a plan step headed `Here's the plan` with the subhead `Tap anything to change it before building.`, the plan rendered as labelled rows, and the footer `Nothing here is final — you can keep changing the app after it's built.` Generation SHALL NOT start until the user takes the `Build it` action.

Each plan row SHALL be tappable, and tapping SHALL open an inline editor on the plan step itself — one row at a time, with Save and Cancel — and SHALL NOT re-open the compose step. An unedited plan's build prompt SHALL be the rewrite response's `rewritten` string byte-identical; once any row is hand-edited, the build prompt SHALL instead be deterministically assembled from the current rows, and SHALL stay on that path for every subsequent edit even if the row's text is reverted to the model's original wording. When the plan arrives as structured rows they SHALL render one row per entry with its label; when it arrives as a single rewritten string it SHALL render as one row. No SDK-specific or engineering-internal detail SHALL appear on this step.

#### Scenario: Nothing is generated before approval
- **WHEN** the plan step is showing
- **THEN** no generation request has been sent, and none is sent until the user takes the `Build it` action

#### Scenario: Tapping a row opens an inline editor on the plan step
- **WHEN** the user taps a plan row
- **THEN** an inline editor opens on the plan step for that row, and the compose step is not re-opened

#### Scenario: A hand-edited plan's rows become the build prompt
- **WHEN** the user edits a plan piece inline, in place on the plan step, and approves
- **THEN** the generation request carries the prompt assembled from the edited plan, not the original rewrite response

#### Scenario: Unedited plan builds from the rewrite response
- **WHEN** the user approves the plan without editing any piece of it
- **THEN** the generation request carries the rewrite response's own prompt, unchanged

#### Scenario: An unstructured plan still renders
- **WHEN** the plan arrives as a single rewritten string with no rows
- **THEN** the step renders it as one row and remains approvable

### Requirement: The done step offers two distinct destinations

On successful delivery the flow SHALL show a done step carrying the new app's tile in its own colour, the title `<App name> is ready`, and the body `It's on your home screen. Open it, or tell Whim what to change.` It SHALL offer `Open it` as the primary action and `Back to your apps` as the secondary one, and the two SHALL lead to different places: `Open it` SHALL launch the delivered app, and `Back to your apps` SHALL return to the home grid.

#### Scenario: Open launches the app
- **WHEN** the user takes the `Open it` action
- **THEN** the newly delivered mini-app is launched full-screen

#### Scenario: Back to your apps goes home
- **WHEN** the user takes the `Back to your apps` action
- **THEN** the home grid is shown with the new app's tile on it, and no mini-app is launched

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
