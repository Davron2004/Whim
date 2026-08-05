## ADDED Requirements

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

Each plan row SHALL be tappable, and tapping SHALL re-open the compose step prefilled with that row's text. When the plan arrives as structured rows they SHALL render one row per entry with its label; when it arrives as a single rewritten string it SHALL render as one row. No SDK-specific or engineering-internal detail SHALL appear on this step.

#### Scenario: Nothing is generated before approval
- **WHEN** the plan step is showing
- **THEN** no generation request has been sent, and none is sent until the user takes the `Build it` action

#### Scenario: Tapping a row returns to compose
- **WHEN** the user taps a plan row
- **THEN** the compose step opens with that row's text prefilled

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: The prompt flow is two-stage — rewrite preview before generation

**Reason**: Replaced by the five-step machine above. The rewrite-preview screen — an editable text box showing the rewritten prompt — becomes the `plan` step, which presents the same approval gate as labelled rows rather than as one block of rewritten text, and is now preceded by the `clarify` exchange. The guarantees the old requirement carried are preserved verbatim in their new homes: nothing is generated before the user approves (see "The plan step is the approval gate before generation"), and no SDK or engineering internal appears on the approval surface.

**Migration**: None. `POST /v1/rewrite` is unchanged in shape; the device continues to call it before generation, now sending the clarify answers with it and rendering rows when the response carries them.
