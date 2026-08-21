## ADDED Requirements

### Requirement: A post-run summariser describes the completed run in one plain-words sentence

After a run produces a deliverable app record, the pipeline SHALL produce a summary of what changed and what was learned, and attach it to the run's `result` event. The summary SHALL carry: `text`, one plain-words sentence; `kind`, one member of the closed set the device groups history by (`Start`, `Added`, `Changed`, `Removed`, `Look`, `Fixed`); `touched`, plain-words names of the areas the change affected — areas, never file names, symbols, or diffs; and `marks`, at most one `chg` and at most one `hedge` per sentence of `text`.

`text` SHALL say what happened, not what the system did — the outcome the user can observe, never a commit identifier, a stage name, a model name, or an internal symbol. It SHALL be sentence case and SHALL contain no exclamation mark. It SHALL NOT acknowledge the same problem twice. Whimsy is permitted only as one vivid noun or verb inside an otherwise minimal sentence; if the playful phrasing is longer than the plain one it is padding and SHALL NOT be used.

The summariser SHALL be a distinct step that cannot change what is delivered: it reads the run's outcome and produces prose, and it SHALL NOT modify the app record, the manifest, the schema, or the bundle.

#### Scenario: A change lands with a summary

- **WHEN** a run completes and delivers a record
- **THEN** its `result` carries a summary whose `text` is one sentence, whose `kind` is a member of the closed set, and whose `marks` respect the one-`chg`-one-`hedge`-per-sentence budget

#### Scenario: The summary describes the outcome, not the mechanism

- **WHEN** a run that took two repair attempts is summarised
- **THEN** the text names what the app now does or no longer does, and contains no stage name, commit identifier, model name, or diagnostic `kind` string

#### Scenario: The summariser cannot alter the delivery

- **WHEN** the summariser's output is compared against the record assembled before it ran
- **THEN** the record's name, manifest, schema and bundle are unchanged

#### Scenario: A failing summariser does not fail the run

- **WHEN** the summariser errors or times out on a run that produced a deliverable record
- **THEN** the run still emits its `result` terminal event, with the summary absent, and the error is not surfaced as a failure

## MODIFIED Requirements

### Requirement: Exactly one terminal event per completed run

A run that completes SHALL emit exactly one terminal event as its last event: `result` carrying the
harness-validated `WireAppRecord` and, when the summariser produced one, the run's summary; or `failure` carrying user-facing prose, the attempt count,
and the accumulated diagnostics on any failure. `failure.reason` SHALL be product prose the device can
render directly; it SHALL NOT contain diagnostic `kind` strings, model output, stack traces, provider
names, or internal state names. A run aborted by the client SHALL emit no terminal event.

A summary SHALL never be delivered as its own event, before the terminal event, or on a run that produced no
record — it exists only as a field on `result`, so a truncated stream can never deliver a description of an
app that was not delivered.

In a failure that is staying broken, the prose SHALL contain zero whim-words: the sentence gets shorter, not
warmer.

#### Scenario: Failure prose is user-facing

- **WHEN** a run exhausts its repair budget
- **THEN** the `failure` event's `reason` is plain product prose, and every technical detail the client may
  choose to surface is carried in `diagnostics[].hint` instead

#### Scenario: An internal error is still one terminal event

- **WHEN** a stage throws an unexpected exception (a model transport error, a builder crash)
- **THEN** the run still ends with exactly one `failure` terminal event rather than an unhandled rejection
  or a truncated stream, and the exception's text does not appear in `reason`

#### Scenario: The summary never arrives on its own

- **WHEN** the full event sequence of a summarised run is inspected
- **THEN** the summary appears only inside the single terminal `result` event, and no separate summary event exists

#### Scenario: A staying-broken failure is plain

- **WHEN** a run ends without a working app and its `reason` is inspected
- **THEN** the prose is short, acknowledges the outcome once, and carries no playful word

### Requirement: The delivered app record is harness-validated

The `WireAppRecord` a run delivers SHALL be assembled only from harness outputs: `name`, `manifest`, and
`schema` SHALL come from the check report's statically extracted `defineApp` argument, and `bundle` and
`sourceMap` SHALL come from building the candidate under the production bundle contract. The pipeline SHALL
NOT re-parse the source for manifest data, ask the model to restate the manifest, or accept a manifest from
any other source — there is exactly one extraction. A record SHALL be delivered only for a candidate whose
check stage produced no error diagnostics and whose run report is green and untruncated.

An app's declared tile colour is manifest data and SHALL follow that same single extraction: it reaches the
record only from the literal `defineApp` argument the check stage already extracted, never from the model's
prose, never from a second parse, and never from anything the candidate reports about itself at run time. A
declared colour that is not a valid hex, or that collides with a reserved status hue, SHALL be dropped at
extraction rather than delivered for the host to reject.

#### Scenario: Manifest comes from extraction, not from the model

- **WHEN** the model's prose claims a capability the source does not declare
- **THEN** the delivered record's manifest reflects the source's `defineApp` argument, not the prose

#### Scenario: Bundle honours the production contract

- **WHEN** a delivered record's bundle is compared with the production build pipeline's output for the same
  source
- **THEN** they are byte-identical

#### Scenario: Nothing is delivered without a green run

- **WHEN** a candidate passes the check stage but its run report carries an error diagnostic
- **THEN** no `result` is emitted for that candidate

#### Scenario: The tile colour comes from the one extraction

- **WHEN** a candidate declares a tile colour in its `defineApp` argument
- **THEN** the delivered record's manifest carries exactly that value, and the source is not re-parsed for it

#### Scenario: A reserved or malformed colour is dropped

- **WHEN** a candidate declares a malformed colour, or one equal to a reserved status hue
- **THEN** the delivered manifest carries no tile colour, and the run is otherwise unaffected
