# prompt-flow Specification

## Purpose
The on-device prompt-to-app UX: a two-stage flow (rewrite preview, then generation) that turns
a user's casual prompt into a delivered mini-app. Covers the editable rewrite preview gating
generation, stage-only progress rendering with no SDK/engineering internals exposed, honest
failure handling with a rephrase path, delivery routed by the target app's rewind state (new
entry / new snapshot on tip / silent shared continuation behind tip), the structured prompt
envelope tracked against every delivered snapshot, the persisted anonymous device identity
attached to every request, and clean cancellation of an in-flight generation.

## Requirements

### Requirement: The prompt flow is two-stage — rewrite preview before generation
Submitting a prompt SHALL first call the rewrite endpoint and present the rewritten text on a preview screen the user can edit before approving. The engineer generation request SHALL NOT be sent until the user explicitly approves the (possibly edited) preview text. No SDK-specific or engineering-internal detail SHALL be shown on the preview screen — only plain, user-legible text.

#### Scenario: Preview before generation
- **WHEN** the user submits a casual prompt
- **THEN** a rewrite request is sent, its response is shown on an editable preview screen, and no generation request is sent until the user approves

#### Scenario: User can edit the rewritten text
- **WHEN** the user edits a plan piece inline, in place on the plan step, and approves
- **THEN** the generation request carries the prompt assembled from the edited plan, not the original rewrite response

#### Scenario: Unedited plan builds from the rewrite response
- **WHEN** the user approves the plan without editing any piece of it
- **THEN** the generation request carries the rewrite response's own prompt, unchanged

### Requirement: Generation progress is shown without exposing internals
While a generation request streams, the UI SHALL render the current stage (plan, generate, check, run, or repair) from `stage` events. Raw `token` event text and raw `diagnostic.kind`/`diagnostic.symbol` values SHALL NOT be rendered to the user at any point during generation.

#### Scenario: Stage progress renders
- **WHEN** a `stage` event with `status: 'start'` arrives for `generate`
- **THEN** the progress screen shows a generate-stage indicator

#### Scenario: Token and diagnostic internals never render live
- **WHEN** `token` or `diagnostic` events arrive during generation
- **THEN** neither the token text nor the diagnostic's `kind`/`symbol` fields appear anywhere in the rendered UI

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
The prompt tracked against a delivered generation's snapshot SHALL be the JSON envelope `{v: 1, text: <the approved prompt text>}`.

#### Scenario: Envelope round-trips through history
- **WHEN** a generation is delivered and its app's history is later viewed
- **THEN** the tracked prompt parses as the envelope's `text` field, not a raw unparsed string

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
