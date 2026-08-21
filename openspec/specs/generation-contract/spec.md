# generation-contract Specification

## Purpose
The shared wire contract between the Whim device and the harness server: zod schemas
(TS-source-only) for the generation/rewrite requests, the SSE generation event stream, the
diagnostics envelope, the wire app record, and usage shapes. It is the single source of truth
for every shape crossing the device↔server wire — consumed by the server now, and by the device
prompt flow (#7), the static checks (#9), and evals (#12) later.

## Requirements

### Requirement: Shared wire-contract package
The repo SHALL provide an npm workspace `contract/` (package `@whim/contract`) that is the
single source of truth for every shape crossing the device↔server wire. Schemas SHALL be zod
values with static types derived via `z.infer` (no hand-maintained parallel types). The
package SHALL depend on `zod` only and MUST NOT depend on `react`, `react-dom`, React Native,
or any server framework. It SHALL ship TypeScript source directly (entry points resolve to
`src/`), with no build step and no generated `dist/`.

Exactly one exception to the zod-only rule SHALL exist: the dev-only log-envelope module, which
declares plain TypeScript types and no zod value. The exception SHALL be limited to that module,
SHALL carry no `/v1` route, and SHALL NOT be extended to any product wire shape. Any future
exception SHALL be argued in its own change, not absorbed into this one.

#### Scenario: One source of truth
- **WHEN** the server validates a request body or emits an SSE event
- **THEN** the schema used is imported from `@whim/contract`, and a payload that fails the
  schema's `parse` is a bug in the emitter, not the contract

#### Scenario: Dependency budget enforced
- **WHEN** `contract/package.json` is inspected at test time
- **THEN** its only runtime dependency is `zod`, and the suite fails if anything
  React-adjacent or framework-specific appears

#### Scenario: The exception stays one module wide
- **WHEN** the contract package's modules are scanned for exported types with no corresponding zod
  schema
- **THEN** only the dev-log module is found

### Requirement: Clarify request and response shapes
The contract SHALL define `ClarifyRequest` (`prompt`) and `ClarifyResponse` carrying `questions`: an ordered list of **at most three** entries, each `{ id, question, options }` where `options` is a non-empty list of answer strings the device renders as single-select pills. An empty `questions` list SHALL be valid and SHALL mean "nothing needs clarifying".

The exchange SHALL be unary request/response. No clarify event, clarify stage member, or second stream SHALL be added to `GenerationEvent`.

#### Scenario: Zero questions is a valid answer
- **WHEN** a `ClarifyResponse` with an empty `questions` list is parsed
- **THEN** it validates, and the client treats it as "no clarification needed" rather than as an error

#### Scenario: More than three questions is rejected
- **WHEN** a `ClarifyResponse` carrying four questions is parsed
- **THEN** parsing fails

#### Scenario: The event union is untouched
- **WHEN** `GenerationEvent`'s members and its `stage` enum are inspected
- **THEN** neither mentions clarification, and both are unchanged by this change

### Requirement: Generation request and rewrite shapes
The contract SHALL define `GenerateRequest` (`prompt`, optional `clarifications`, optional `app` carrying the current `source`, the
`manifest`, the `schema`, and the `appliedSchema` for the edit flow — full re-send per Model 1, never wire
diffs) and `RewriteRequest`/`RewriteResponse` (`prompt` plus optional `clarifications` in, `rewrittenPrompt` plus optional `plan` out).

`clarifications` SHALL be an optional list of `{ id, question, answer }` entries — the answers the user gave to the clarify exchange's questions, carried by value so the server holds no per-device state between calls. Its absence and an empty list SHALL both mean "the user answered nothing", which is a legitimate, common state.

`RewriteResponse.plan` SHALL be an optional ordered list of `{ label, text }` rows — the plan the device renders as its approval gate. When it is absent the device renders `rewrittenPrompt` as a single row, so a server that returns no rows stays conforming.

Within `app`, `source` SHALL be **optional**: it carries the app's original TypeScript when the device has
it, and is absent for a pre-existing install whose snapshots predate source tracking. Its absence means
exactly "the device has no original source for this app", and a conforming server SHALL regenerate under
the supplied `manifest`/`appliedSchema` rather than treat compiled output as source. `manifest` and
`schema` remain required within `app`.

`app.appliedSchema` SHALL be an optional record carrying the **accumulated** applied-schema union of the
database the app writes to — the storage group's `_meta` union, not the app's own snapshot artifact
(decision #52 D5). It is the diff baseline the harness's schema checks run against and the source of the
burned-ID allocation floor; when it is absent the baseline is the empty applied schema.

#### Scenario: Edit flow carries full source
- **WHEN** a client builds a `GenerateRequest` for editing an existing app whose original source it holds
- **THEN** the schema accepts the complete current source text (not a diff) inside `app`

#### Scenario: Edit flow without tracked source still validates
- **WHEN** a client builds a `GenerateRequest` for an app whose snapshots carry no original source
- **THEN** the request validates with `app.source` absent, and `app.manifest` and `app.schema` still present

#### Scenario: Applied schema is a distinct field from the app's own schema
- **WHEN** `GenerateRequest` is inspected
- **THEN** `app.schema` (the app's declared artifact) and `app.appliedSchema` (the database's accumulated
  union) are separate optional-vs-required fields that can legitimately differ

#### Scenario: A generation carries the answers the user gave
- **WHEN** a client builds a `GenerateRequest` after a clarify exchange the user answered
- **THEN** the request validates with each answered question's `id`, `question` and `answer` inside `clarifications`

#### Scenario: A rewrite without plan rows still validates
- **WHEN** a `RewriteResponse` carrying only `rewrittenPrompt` is parsed
- **THEN** it validates, and a client renders the single row

### Requirement: SSE generation event stream schema
The contract SHALL define `GenerationEvent` as a discriminated union on `type` covering:
`stage` (stage ∈ plan|generate|check|run|repair; status ∈ start|done; optional attempt),
`token` (streamed generation text delta), `diagnostic` (carrying a `Diagnostic`), `usage`
(carrying a `Usage`), and the two terminal events `result` (carrying a `WireAppRecord` and an optional
`summary`) and `failure` (user-facing `reason` prose, `attempts`, accumulated `diagnostics`). Every event a
conforming server emits SHALL validate against this union, and every stream that runs to
completion SHALL contain exactly one terminal event as its last event. A stream aborted by
the client (disconnect or cancellation) ends without a terminal event — the terminal-event
invariant applies only to streams the server runs to completion, and a truncated stream is
not a conformance violation.

`result.summary` SHALL be `{ text, kind, touched, marks }`: the post-run summariser's one-sentence
plain-words description, the change's kind (the closed set the device groups history by), the plain-words
areas the change touched, and the producer-side `chg`/`hedge` marks. It SHALL be **optional**, so the stub
pipeline and any server that produces no summary remain conforming, and so a device is never blocked on its
presence. The `stage` enum SHALL NOT be widened by this change.

#### Scenario: Round-trip validation
- **WHEN** each event of a canned stub-pipeline run is serialized and re-parsed with
  `GenerationEvent.parse`
- **THEN** every event validates, and exactly one terminal event appears, last

#### Scenario: Unknown event type rejected
- **WHEN** a payload with an unrecognized `type` is parsed
- **THEN** parsing fails (clients can trust the union is closed at any given contract version)

#### Scenario: A client-aborted stream is not a conformance violation
- **WHEN** a client disconnects mid-stream and the server aborts the generation
- **THEN** every event emitted before the abort validates against the union, and the absence
  of a terminal event on the truncated stream is expected, not an emitter defect

#### Scenario: A result with a summary validates
- **WHEN** a `result` event carrying a summary with marks is parsed
- **THEN** it validates, and it is still the stream's single terminal event

#### Scenario: A result without a summary validates
- **WHEN** a `result` event carrying no summary is parsed
- **THEN** it validates, and the absence is a legitimate state rather than an emitter defect

### Requirement: Summary marks are bounded and resolvable against the summary text
A summary's `marks` SHALL each be `{ cls, start, end }` where `cls` is `chg` or `hedge` and `start`/`end` are character offsets into the summary's own `text`. Offsets SHALL be within the text's bounds and SHALL NOT overlap another mark. Per sentence of `text`, at most one `chg` and at most one `hedge` SHALL be emitted.

This is the producer-side cap. It is a budget, not the guarantee: the renderer enforces the display caps independently, so a conforming client stays correct against a producer that violates this requirement.

#### Scenario: Offsets resolve
- **WHEN** a summary's marks are applied to its `text`
- **THEN** every mark's range lies inside the text and no two ranges overlap

#### Scenario: One of each per sentence
- **WHEN** a summary whose text is two sentences is inspected
- **THEN** neither sentence carries more than one `chg` or more than one `hedge`

### Requirement: Diagnostics envelope
The contract SHALL define `Diagnostic` as the §8.1 envelope `{ kind, symbol?, line?, hint }`
where `hint` is mandatory non-empty text shaped like the right SDK answer. `kind` SHALL be an
open string at this change (the static-check change narrows it into the catalog inside this
same package).

#### Scenario: Hint is mandatory
- **WHEN** a `Diagnostic` is constructed without a non-empty `hint`
- **THEN** schema validation fails (§8.1: every diagnostic carries a fix hint)

### Requirement: Wire app record
The contract SHALL define `WireAppRecord` = `{ name, source, bundle, sourceMap?, manifest,
schema }` — the verified-bundle payload a generation delivers. It MUST NOT contain device-side
identity or install state (ids, install timestamps, launcher position): the stored record is
the launcher's concern, the wire record is this contract's.

An app's declared tile colour SHALL ride inside `manifest` — the same statically extracted structure that
already carries capabilities — and SHALL NOT become a second top-level field, because manifest data has
exactly one source. The manifest remains an untyped record on the wire; the host validates the colour where
it consumes it.

#### Scenario: Wire record is install-state-free
- **WHEN** `WireAppRecord` is inspected
- **THEN** it has no app-id or install-state fields, and a `result` event validates with only
  generation outputs

#### Scenario: The tile colour has one home
- **WHEN** a delivered record for an app that declared a tile colour is inspected
- **THEN** the colour appears inside `manifest` and nowhere else on the record

### Requirement: Usage shape
The contract SHALL define `Usage` = `{ promptTokens, completionTokens, totalTokens }` (integer
token counts), used identically by SSE `usage` events, the usage-readback endpoint, and the
OpenRouter wrapper's captured usage.

#### Scenario: One usage shape everywhere
- **WHEN** the suite compares the schema used by the `usage` SSE event, the usage endpoint
  response, and the OpenRouter wrapper
- **THEN** all three are the same `Usage` schema by identity, not three lookalikes

### Requirement: Metro-safe device consumption
The contract package SHALL be consumable by the RN app through Metro with the stock RN config:
it lives inside the Metro project root, resolves via the standard workspace symlink, and a
repo-level guard script (`npm run guard:metro`) SHALL prove the Android JS bundle still
resolves after workspace-ification. The guard SHALL run in CI as a blocking gate.

#### Scenario: Bundle guard catches resolution breakage
- **WHEN** `npm run guard:metro` runs after `npm install`
- **THEN** a release-mode Metro bundle of `index.js` completes, and any workspace-induced
  resolution failure exits non-zero (failing CI)

### Requirement: Structured API error body

The contract SHALL define `ApiError` = `{ error, hint }` where `error` is a machine-readable identifier and
`hint` is mandatory non-empty guidance, mirroring the diagnostics discipline. Every non-SSE error body a
conforming server returns from a `/v1/*` route SHALL validate against `ApiError`, so no route invents an
ad-hoc error shape. `DeviceIdError` remains the narrower, closed-enum specialization for the identity
middleware and SHALL stay assignable to `ApiError`.

#### Scenario: Every route error validates
- **WHEN** each `4xx`/`5xx` JSON body a conforming server can return from a `/v1/*` route is parsed with
  `ApiError`
- **THEN** every one validates, and each carries a non-empty `hint`

#### Scenario: Device-identity errors remain a specialization
- **WHEN** a `DeviceIdError` value is parsed with `ApiError`
- **THEN** it validates, and parsing it with `DeviceIdError` still rejects an unrecognized `error` value

### Requirement: The dev log envelope is a type-only contract module
The contract package SHALL declare the device→host dev log record and its batch envelope as plain
TypeScript types in a module of their own. That module SHALL export no runtime value, so importing
it can never pull `zod` — or any other value — into a consumer's module graph.

The device SHALL import it `import type` only, matching the discipline every existing device-side
contract import already follows. The module SHALL also be where the log-sink route's path is
declared as the single written statement both sides implement, so the device does not derive it and
the server does not invent it.

Runtime validation of an incoming batch is the **server's** obligation and SHALL be performed by a
hand-written structural guard on the server side. The absence of a zod schema SHALL NOT be read as
permission to trust the body.

#### Scenario: The module has no runtime footprint
- **WHEN** the dev-log contract module is compiled
- **THEN** it emits no runtime exports, and a consumer importing it adds no module to its bundle

#### Scenario: The device import is type-only
- **WHEN** device source importing the dev-log envelope is inspected
- **THEN** every import of it is an `import type`, and `zod` does not appear in the Metro bundle's
  module graph as a result

#### Scenario: The server still validates
- **WHEN** the server receives a batch whose records do not match the declared shape
- **THEN** the batch is rejected, and the absence of a zod schema has not caused an unvalidated
  write
