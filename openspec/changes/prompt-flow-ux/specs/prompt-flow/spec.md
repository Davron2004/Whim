## ADDED Requirements

### Requirement: The prompt flow is two-stage — rewrite preview before generation
Submitting a prompt SHALL first call the rewrite endpoint and present the rewritten text on a preview screen the user can edit before approving. The engineer generation request SHALL NOT be sent until the user explicitly approves the (possibly edited) preview text. No SDK-specific or engineering-internal detail SHALL be shown on the preview screen — only plain, user-legible text.

#### Scenario: Preview before generation
- **WHEN** the user submits a casual prompt
- **THEN** a rewrite request is sent, its response is shown on an editable preview screen, and no generation request is sent until the user approves

#### Scenario: User can edit the rewritten text
- **WHEN** the user edits the previewed text and approves
- **THEN** the generation request carries the edited text, not the original rewrite response

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

#### Scenario: Terminal failure event
- **WHEN** the stream ends with a `failure` event
- **THEN** the failure screen shows `reason` and each diagnostic's `hint`, and offers to rephrase

#### Scenario: Stream error before any terminal event
- **WHEN** the SSE stream ends or errors without a terminal event (not due to a user-initiated cancel)
- **THEN** the same honest failure screen is shown rather than the UI hanging or crashing

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
