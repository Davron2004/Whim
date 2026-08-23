# generation-pipeline Specification

## Purpose
The real, bounded generation state machine behind the unchanged `Pipeline` seam: plan → generate →
check → run with a budgeted repair loop, the OpenRouter-backed model seam, one-extraction
app-record assembly, and post-abort usage reconciliation, replacing the stub for both
`/v1/generate` and `/v1/rewrite`. Covers stage narration over the existing `GenerationEvent`
contract, the model-client and API-key seams, prompt assembly's single sources of truth, plan
validation, the check/run gates (including the burned-ID allocation floor), the repair loop's
diagnostics-in-context contract, harness-only app-record assembly, honest no-source regeneration,
and cancellation semantics at every boundary.

## Requirements

### Requirement: The pipeline is a bounded state machine

The generation pipeline SHALL be a state machine over the stages `plan → generate → check → run`, with a
`repair` loop that re-enters `generate`'s successor states. It SHALL enforce two independent bounds: at
most **2 plan attempts** (an initial plan plus one re-ask after a validation failure) and at most **3
repair attempts** (so at most 4 candidate sources are produced in one run). Both bounds SHALL be
constructor-injectable parameters with those defaults, so tests can drive exhaustion cheaply. A run SHALL
leave the machine in exactly one of three outcomes — delivered, failed, or aborted — and SHALL NOT be able
to loop indefinitely for any model output, including a model that returns identical text every attempt.

#### Scenario: Repair cap is honoured

- **WHEN** a scripted model returns a candidate that fails the check stage on every attempt
- **THEN** the run emits exactly 3 `repair` stage pairs, produces 4 candidates in total, and ends with a
  single `failure` terminal event whose `attempts` equals 4

#### Scenario: Successful repair stops the loop

- **WHEN** the first candidate fails the check stage and the first repair produces a clean candidate that
  also passes the run stage
- **THEN** exactly one `repair` stage pair is emitted, no further repair is attempted, and the run ends
  with a `result` terminal event

#### Scenario: Plan re-ask is bounded

- **WHEN** the model returns a plan that fails validation twice in a row
- **THEN** exactly two `plan` stage pairs are emitted, no `generate` stage begins, and the run ends with a
  single `failure` terminal event

### Requirement: Stage events narrate the machine over the existing contract

Every state transition SHALL be reported with the contract's existing vocabulary and no additions: a
`stage` event with `status: 'start'` before the stage's work and `status: 'done'` after it, for
`stage ∈ plan|generate|check|run|repair`. On repair round *n* (1-based) the `repair` event and every
subsequent `check` and `run` event of that round SHALL carry `attempt: n`; events of the initial round
SHALL omit `attempt`. Model text produced during `generate` and during a repair SHALL stream as `token`
events. Every diagnostic the pipeline observes SHALL be forwarded as a `diagnostic` event as it is
observed, so no finding reaches the client only inside the terminal event. Exactly one `usage` event SHALL
be emitted immediately before the terminal event, carrying the run's accumulated token totals across all
model calls. The rewrite stage SHALL NOT appear in this stream — it stays a separate unary endpoint, and
the `GenerationEvent.stage` enum SHALL NOT be widened.

#### Scenario: Attempt numbering is visible

- **WHEN** a run needs two repair attempts before succeeding
- **THEN** the stream contains `repair` start/done with `attempt: 1`, then `check`/`run` events with
  `attempt: 1`, then the same with `attempt: 2`, and the initial round's `check`/`run` events carry no
  `attempt`

#### Scenario: One usage event, before the terminal

- **WHEN** any run completes, whether delivered or failed
- **THEN** the stream contains exactly one `usage` event, it is the second-to-last event, and its totals
  equal the sum of every model call the run made

#### Scenario: Diagnostics stream as they are found

- **WHEN** the check stage produces three diagnostics on the first candidate
- **THEN** three `diagnostic` events appear before the `check` stage's `done` event, and the same
  diagnostics also appear in the terminal `failure` event's accumulated list if the run ultimately fails

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

### Requirement: Every model call goes through an injectable client

The pipeline SHALL reach a language model only through a `ModelClient` interface supplied at construction:
streaming text deltas, a resolved `Usage`, and the provider's generation id. The OpenRouter wrapper SHALL be
one adapter behind that interface, and the deterministic test suites SHALL run a scripted client that
replays recorded turns. No test in any gate SHALL make a live API call: the suites SHALL install a
transport that fails loudly if any request to the provider host is attempted, and SHALL pass with
`OPENROUTER_API_KEY` absent from the environment. Model ids SHALL be caller parameters read from the
environment per role (rewrite model, engineer model) and SHALL NOT be hard-coded into any call site.

#### Scenario: The gate never reaches the network

- **WHEN** the deterministic server suite runs with `OPENROUTER_API_KEY` unset and a transport that throws
  on any request to the provider host
- **THEN** every pipeline test passes and the throwing transport is never invoked

#### Scenario: The model id is a parameter

- **WHEN** the roster is configured with a given engineer model id and a generation runs
- **THEN** that id appears verbatim in the outgoing request the adapter builds, and no other model id
  appears anywhere in the pipeline source

#### Scenario: A model failure is an honest failure

- **WHEN** the scripted client raises the wrapper's auth error mid-generate
- **THEN** the run ends with a single `failure` terminal event whose `reason` is user-facing prose, the
  stream closes cleanly, and no credential or provider detail is leaked into the stream

### Requirement: The API key is environment-held

The OpenRouter API key SHALL be read from the process environment only, at pipeline construction, and SHALL
NOT appear in any tracked file, fixture, recorded response, log line, or emitted event. Constructing a
live-model pipeline without the key SHALL fail immediately with a typed, actionable error naming the
environment variable, rather than failing later inside a user's generation.

#### Scenario: Missing key fails at construction

- **WHEN** a live-model pipeline is constructed with no `OPENROUTER_API_KEY` in the environment
- **THEN** construction throws a typed error naming the variable, and no route mounts a pipeline that would
  fail mid-stream

#### Scenario: The key never leaves the process

- **WHEN** a generation runs and its events, logs, and recorded fixtures are inspected
- **THEN** no key-shaped value appears in any of them

### Requirement: Prompt assembly has one source of truth per input

The engineer prompt SHALL be assembled from three inputs, each with exactly one source: the SDK reference
(read from `docs/sdk-reference.md` at run time, never transcribed into source), the token vocabulary that
document already defines, and a curated list of few-shot examples read from the repo's real
`fixtures/*.app.tsx`. Two tripwires SHALL gate this in CI: every runtime value export of `vc-sdk` SHALL
appear in the SDK reference, and every curated few-shot fixture SHALL produce a zero-diagnostic
`CheckReport` — the harness SHALL NOT teach the model a shape its own checker rejects. `latency-probe.app.tsx`
SHALL NOT be a few-shot example (it deliberately bypasses the SDK).

#### Scenario: An undocumented SDK export fails the build

- **WHEN** a new value export is added to the `vc-sdk` barrel and not documented in the SDK reference
- **THEN** the prompt suite fails naming the missing export

#### Scenario: A few-shot example that the checker rejects fails the build

- **WHEN** a curated few-shot fixture produces any diagnostic of any severity
- **THEN** the prompt suite fails naming the fixture and the diagnostic

#### Scenario: The reference is not duplicated

- **WHEN** the assembled system prompt is compared with the SDK reference document
- **THEN** the reference content in the prompt is the document's own text, and no second copy of it exists
  in the source tree

### Requirement: The plan is structured and validated against the request

Before any code is generated the pipeline SHALL obtain a structured plan naming the app's screens, its
initial screen, its state, its capabilities, and its storage keys, and SHALL validate it before proceeding.
Validation SHALL be structural and mechanical, never a judgement call: the initial screen SHALL name a
declared screen; screen names SHALL be unique and non-empty; declared capabilities SHALL be members of the
harness's known capability set; storage keys SHALL be declared only when the storage capability is; and for
an edit the plan SHALL NOT drop a capability the supplied applied schema requires. A plan that fails
validation SHALL be re-asked once, with the specific validation failures fed back, and SHALL fail the run
on a second failure. The plan SHALL NOT cross the wire — it is pipeline-internal context, and no plan
payload is added to the event union.

#### Scenario: A capability the request needs but the plan omits

- **WHEN** the request asks for something that stores data and the returned plan declares storage keys
  without the storage capability
- **THEN** validation fails naming that inconsistency, the plan is re-asked once with that reason, and no
  `generate` stage begins until a plan validates

#### Scenario: A dangling initial screen

- **WHEN** the plan's initial screen names no declared screen
- **THEN** validation fails naming the unresolved screen and the declared screen list

#### Scenario: The plan stays internal

- **WHEN** every event of a run is inspected
- **THEN** no event carries plan content, and the only evidence of the plan stage is its `stage` event pair

### Requirement: The check stage gates before anything executes

Every candidate SHALL pass through the pure static checker before any execution is attempted, with the
device-supplied applied schema as the diff baseline when one is present and the empty applied schema when
it is not. Any **error**-severity diagnostic SHALL send the candidate to repair without ever running it.
Warning-severity diagnostics SHALL also be repaired — the zero-warning steady state is the target — but a
candidate whose diagnostics are **all** warnings SHALL consume at most **one** repair attempt, and if the
budget is exhausted with zero error diagnostics and a green run report, the pipeline SHALL deliver and
forward the residual warnings as `diagnostic` events rather than fail an otherwise-working app on a
cosmetic finding. Residual warnings SHALL never be silently dropped.

#### Scenario: An error candidate is never executed

- **WHEN** the first candidate contains a forbidden-global reference
- **THEN** the run stage is not entered for that candidate, and a repair is attempted instead

#### Scenario: A warnings-only candidate gets one repair, then ships

- **WHEN** a candidate produces a single `unused_capability` warning, the one warning-repair attempt does
  not clear it, and the candidate's run report is green
- **THEN** the run delivers a `result`, and the residual warning was emitted as a `diagnostic` event

#### Scenario: The applied schema is the diff baseline

- **WHEN** the request carries an applied schema and the candidate's schema conflicts with it
- **THEN** the conflict is reported with the storage engine's own kind and hint, and the candidate goes to
  repair

### Requirement: The run stage is the synthetic harness, and containment failure is terminal

The run stage SHALL execute the candidate through the synthetic run harness against the built bundle, and
SHALL derive its verdict only from the harness's report. Error-severity runtime diagnostics SHALL send the
candidate to repair. A run report whose containment verdict is negative SHALL end the run **immediately
with a `failure` terminal event, consuming no repair attempt and feeding nothing back to the model** — the
loop does not iterate on escape attempts. A truncated run SHALL be reported as such rather than treated as
a pass. The pipeline SHALL NOT reimplement, approximate, or relax any part of the harness's containment,
gate, or page assembly.

A run report whose containment verdict is **unobserved** — the harness heard no authenticated verdict at
all — SHALL also end the run immediately with a `failure` terminal event, consuming no repair attempt and
feeding nothing back to the model, and SHALL NOT be treated as contained under any circumstance: not after
any number of attempts, not as a fallback, and not on a last attempt. It SHALL be a distinct outcome from a
negative verdict, carrying its own user-facing reason and the harness's own named unobserved-verdict
diagnostic; the pipeline SHALL NOT report it as a containment failure. Its reason SHALL say that the app
could not be verified, and SHALL NOT assert that the app was unsafe or that a breach was observed. An
unobserved verdict SHALL NOT be automatically re-run: the candidate is not rebuilt, re-executed, or
re-prompted, and the device's existing retry affordance remains the recovery path.

No detail of a rejected forgery — its payload, its count, or the fact of it — SHALL reach any model-facing
path, because a diagnostic the candidate authored and the repair loop consumed would be a prompt-injection
channel.

#### Scenario: Containment failure short-circuits

- **WHEN** a candidate's run report reports a negative containment verdict
- **THEN** the run ends with a single `failure` terminal event, no repair prompt is built, and no candidate
  source or diagnostic derived from the escape attempt is sent back to the model

#### Scenario: An unobserved verdict short-circuits with its own reason

- **WHEN** a candidate's run report carries an unobserved containment verdict
- **THEN** the run ends with a single `failure` terminal event whose `reason` is
  "We couldn't verify this app ran safely. Please try again." — distinct from the containment-failure
  reason, stating that the app could not be verified rather than that it was unsafe — and no repair
  prompt is built

#### Scenario: An unobserved verdict consumes no repair attempt and is never delivered

- **WHEN** a run's first candidate returns an unobserved containment verdict
- **THEN** the terminal `failure` event's attempt count reflects that no repair attempt was spent, no
  `result` is emitted, and the candidate is not re-run

#### Scenario: A runtime throw is repaired

- **WHEN** a candidate mounts and then throws in a handler during the sweep
- **THEN** the run-observed diagnostic is forwarded and a repair attempt is made with it in context

#### Scenario: Truncation is not a pass

- **WHEN** a candidate's run exceeds the harness's total budget and the report is marked truncated
- **THEN** the run does not deliver on that candidate

#### Scenario: Forgery detail never reaches the model

- **WHEN** a candidate's run report records rejected forgeries and the run ends
- **THEN** no prompt the pipeline builds contains the forgery count, the forged payload, or any reference
  to the rejection

### Requirement: Repair asks for a minimal diff with the diagnostics in context

A repair attempt SHALL prompt the model with the original request, the validated plan, the current
candidate source, and the accumulated diagnostics of that round — errors before warnings — and SHALL ask
for a minimal change rather than a rewrite. Each repair SHALL produce a full candidate source that
re-enters the check stage; the pipeline SHALL NOT apply model-produced patches to the previous candidate
itself. Diagnostics fed back SHALL be the harness's structured diagnostics verbatim, including their
mandatory hints.

#### Scenario: The repair prompt carries the diagnostics verbatim

- **WHEN** a repair is prompted after a check failure
- **THEN** the prompt contains each diagnostic's kind, position, and hint unmodified, ordered errors first

#### Scenario: Repair output is re-checked, not trusted

- **WHEN** a repair returns a candidate
- **THEN** that candidate goes through the full check and run stages exactly as the initial candidate did

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

### Requirement: Generation allocates burned field IDs above the accumulated floor

For a request carrying an applied schema, the pipeline SHALL communicate the per-collection burned-ID floor
(the maximum ordinal among the accumulated union's active and retired columns) to the model as a hard
constraint, and SHALL rely on the static checker to reject any new field ID at or below that floor. The
floor SHALL be computed from the applied schema the request carries — never from the candidate's own schema
artifact, and never re-derived from the app's stored snapshot.

The floor SHALL be **stated numerically per collection**, computed with the storage engine's exported
`burnedIdFloor` and never re-derived locally. The same context SHALL instruct the model to KEEP the
existing ids for the concepts that already have them and to allocate NEW ids only for genuinely new
concepts, strictly above the floor. It SHALL NOT instruct the model to avoid the existing ids as such:
an existing id is what the user's data is stored under, and only a *reallocation* of a retired or
occupied id is forbidden.

#### Scenario: The floor reaches the model

- **WHEN** a request carries an applied schema whose highest ordinal in a collection is 7
- **THEN** the generate and repair prompts state that new field IDs in that collection start above 7

#### Scenario: Existing concepts keep their ids

- **WHEN** a request carries an applied schema
- **THEN** the prompt instructs the model to reuse the existing collection and field ids for the concepts
  that already exist, and contains no instruction to avoid those ids

#### Scenario: An under-floor allocation is repaired, not shipped

- **WHEN** a candidate allocates a new field ID at or below the floor
- **THEN** the check stage reports it, the candidate goes to repair, and no record is delivered carrying
  that allocation

### Requirement: The edit turn sees the app it is changing

The generate turn for a request carrying `app` SHALL render the pre-flighted `app.source` verbatim under a `Current source:` block, and the prompt SHALL NOT state that source is included when it is not.

The same turn SHALL carry three continuity instructions:

- the app SHALL keep its current name unless the user's request asks for a rename;
- every concept that already exists SHALL keep the burned collection and field ids it already has, because the user's rows live under those ids and a new id is a new, empty table or column;
- the storage locations the current source reads and writes — the kv keys and record collections named in it — SHALL be listed, with the instruction to keep reading and writing them and to add locations rather than replace them.

When `app.source` is absent or failed pre-flight, no `Current source:` block and no storage-location list SHALL be rendered, and the honest-regeneration path SHALL be unchanged. A request with no `app` SHALL carry none of these instructions.

#### Scenario: The edit turn contains the current source it claims to contain

- **WHEN** the generate messages are built for a request whose `app.source` is present
- **THEN** the user message contains a `Current source:` block holding that source verbatim

#### Scenario: The edit turn asks for identity continuity

- **WHEN** the generate messages are built for an edit request
- **THEN** the user message instructs the model to keep the app's existing name unless a rename was asked for, and to keep the existing burned collection and field ids for concepts that already exist

#### Scenario: The edit turn names the locations the data lives under

- **WHEN** the generate messages are built for an edit whose current source reads a kv key `habitCompletionHistory` and a collection `Completions`
- **THEN** the user message names both locations and instructs the model to keep reading and writing them, adding locations rather than replacing them

#### Scenario: A new-app turn carries no continuity instructions

- **WHEN** the generate messages are built for a request with no `app`
- **THEN** the user message contains no `Current source:` block, no storage-location list, and no identity-continuity instruction

### Requirement: The storage-surface instruction and the drift check read one scanner

The set of storage locations rendered into the edit turn and the baseline the static checker compares a candidate against SHALL be produced by the same exported scanner, invoked once per run on the pre-flighted source.

The pipeline SHALL NOT re-derive either value by a second scan, by hand-maintained lists, or by parsing the source a second time in a different module.

#### Scenario: One scanner, two consumers

- **WHEN** a run builds an edit turn and then checks the candidate it produced
- **THEN** the prompt's location list and the checker's baseline come from the same scanner result, and no second storage-name extractor exists in the pipeline's sources

### Requirement: The SDK reference documents the storage schema artifact

The SDK reference the prompt feeds the model verbatim SHALL document the storage schema artifact: collections keyed by display name over a burned `id`, fields keyed by display name over a burned `id` and one of the six field types, the `tombstones` list, and that a `date` field is an epoch-millisecond **integer**, never a formatted date string.

It SHALL also state that `Chart`'s `DayPoint.date` is a `YYYY-MM-DD` label string belonging to the chart component and unrelated to the storage `date` field type. A tripwire in the prompt suite SHALL fail when the schema-artifact section is missing, when any of the six field types is unnamed, or when the epoch-millisecond statement is absent.

#### Scenario: An undocumented schema shape fails the build

- **WHEN** the SDK reference carries no schema-artifact section naming all six field types
- **THEN** the prompt suite fails naming what is missing

#### Scenario: The two dates are disambiguated

- **WHEN** the SDK reference is read for the word `date`
- **THEN** the storage field type is documented as an epoch-millisecond integer and the chart's `DayPoint.date` is explicitly marked as a label string that is not that type

### Requirement: An edit without original source regenerates honestly

The pipeline SHALL regenerate an app from the request's prompt under the constraints of the supplied
manifest and applied schema whenever the request's `app` is present but carries no source (a pre-existing
install with no tracked TypeScript), and SHALL NOT present anything to the model as "your current code".
Any supplied source SHALL be pre-flighted through the checker's parse gate and through the presence of a
default-exported `defineApp` call; a supplied source that fails that pre-flight SHALL be treated exactly as
absent. The pipeline SHALL NOT feed compiled bundle output to the model as source under any circumstances.

#### Scenario: Legacy install regenerates under its own constraints

- **WHEN** an edit request carries a manifest and applied schema but no source
- **THEN** generation proceeds, the prompt states the existing manifest and schema constraints, and the
  delivered record's schema remains compatible with the applied schema

#### Scenario: Compiled source is treated as absent

- **WHEN** an edit request's `app.source` is compiled bundle text rather than TypeScript
- **THEN** the pre-flight rejects it, the run proceeds on the no-source path, and the compiled text never
  appears in any prompt

### Requirement: Cancellation aborts the pipeline at every boundary

The pipeline SHALL accept an `AbortSignal` and honour it at every state boundary and inside every waiting
operation: the model transport SHALL receive the signal, the synthetic run SHALL receive it and dispose its
browser context promptly, and the machine SHALL stop without emitting a terminal event. An abort SHALL NOT
surface as an unhandled error or rejection, SHALL leave no timer, browser context, or model stream running
on the aborted run's behalf, and SHALL be idempotent.

#### Scenario: Abort during generate stops the model stream

- **WHEN** the signal fires while the generate stage is streaming deltas
- **THEN** the transport observes the abort, no further `token` events are emitted, and no terminal event
  is produced

#### Scenario: Abort during run releases the harness

- **WHEN** the signal fires while the run stage is driving a candidate
- **THEN** the run is abandoned, its browser context and page are disposed, its concurrency slot is
  released, and no terminal event is produced

#### Scenario: Abort is idempotent and quiet

- **WHEN** the signal fires twice, once before and once after a stage boundary
- **THEN** the run ends once, with no unhandled rejection and no duplicate cleanup

### Requirement: Aborted runs reconcile their authoritative usage

Because a cancelled generation may still have been billed upstream, the server SHALL record the provider's
generation id for every model call a run makes and, on abort, SHALL reconcile authoritative post-abort
token counts from the provider's generation-stats endpoint and credit them to the calling device. The
reconciliation SHALL use an injectable transport, SHALL retry with a bounded number of attempts and a
bounded total time budget because the record resolves asynchronously upstream, SHALL give up quietly on
exhaustion rather than failing anything user-visible, and SHALL introduce no server-side persistence beyond
the existing per-device counter.

#### Scenario: Cancelled run credits the reconciled usage

- **WHEN** a run is cancelled after its model call started and the injected transport returns
  authoritative counts for the recorded generation id
- **THEN** those counts are credited to the calling device and are visible in the usage readback

#### Scenario: Reconciliation gives up quietly

- **WHEN** the transport never resolves a record within the retry budget
- **THEN** nothing is credited, no error surfaces to any client, and no new state is persisted

#### Scenario: No double counting

- **WHEN** a run completes normally and emits its `usage` event
- **THEN** the completed run's usage is credited exactly once and no reconciliation is attempted for it
