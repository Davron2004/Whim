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
The contract SHALL define `ClarifyRequest` (`prompt`) and `ClarifyResponse` carrying `questions`: an ordered list of **at most three** entries, each `{ id, question, options, select, other }` where `options` is a non-empty list of answer strings the device renders as pills, `select` ∈ `one | many` says whether one or several options may be picked, and `other` (boolean) says whether the user may type their own answer, and an optional `limit`: `{ reason, alternative }`, plain-words text saying why the request can't be built as asked and the nearest thing that can. An empty `questions` list SHALL be valid and SHALL mean "nothing needs clarifying". A response carrying `limit` SHALL carry an empty `questions` list.

The exchange SHALL be unary request/response. No clarify event, clarify stage member, or second stream SHALL be added to `GenerationEvent`.

#### Scenario: Zero questions is a valid answer
- **WHEN** a `ClarifyResponse` with an empty `questions` list is parsed
- **THEN** it validates, and the client treats it as "no clarification needed" rather than as an error

#### Scenario: More than three questions is rejected
- **WHEN** a `ClarifyResponse` carrying four questions is parsed
- **THEN** parsing fails

#### Scenario: Multi-select question with a typed option
- **WHEN** a question with `select: 'many'` and `other: true` is parsed
- **THEN** it validates

#### Scenario: A limit carries no questions
- **WHEN** a `ClarifyResponse` carries both `limit` and a non-empty `questions` list
- **THEN** parsing fails

#### Scenario: The event union carries no clarification
- **WHEN** `GenerationEvent`'s members and its `stage` enum are inspected
- **THEN** neither mentions clarification

### Requirement: Generation request and rewrite shapes
The contract SHALL define `GenerateRequest` (`prompt`, optional `clarifications`, optional `app` carrying the current `source`, the
`manifest`, the `schema`, and the `appliedSchema` for the edit flow — full re-send per Model 1, never wire
diffs) and `RewriteRequest`/`RewriteResponse` (`prompt` plus optional `clarifications` and optional `app` in, `rewrittenPrompt` plus optional `plan` out).

`clarifications` SHALL be an optional list of `{ id, question, choices, other?, decide? }` entries — the answers the user gave to the clarify exchange's questions, carried by value so the server holds no per-device state between calls. `choices` is the list of picked options (at most one for a `select: 'one'` question), `other` is the user's typed answer (1–200 characters), and `decide: true` means the user asked Whim to decide that question. An entry SHALL carry either `decide: true` with no choices and no `other`, or at least one choice or an `other`. Its absence and an empty list SHALL both mean "the user answered nothing", which is a legitimate, common state.

`RewriteRequest.app` SHALL be an optional context object `{ name, collections? }`, where `name` is the app's current display name and `collections` is an optional list of `{ name, fields }` carrying collection and field **display names only**. Its presence means "this rewrite describes a change to an existing app"; its absence means a new app. It SHALL NOT carry source, bundle text, burned ids, applied schemas, record contents, or any device-side identity — the rewrite turn answers in the user's own words and needs no more than names, and the payload stays small enough to ride the unary request.

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
- **THEN** the request validates with each answered question's `id`, `question` and its `choices`, `other` or `decide` inside `clarifications`

#### Scenario: A delegated question carries nothing else
- **WHEN** a clarification carries `decide: true` together with a choice or an `other`
- **THEN** parsing fails

#### Scenario: A rewrite for an existing app validates with its context
- **WHEN** a client builds a `RewriteRequest` for a re-prompt of an installed app
- **THEN** the request validates with `app.name` and the app's collection and field display names inside `app.collections`

#### Scenario: A rewrite context carries no source and no ids
- **WHEN** a `RewriteRequest` carrying `app` is inspected
- **THEN** it has no source, no bundle, no burned collection or field ids, and no record contents

#### Scenario: A rewrite without app context still validates
- **WHEN** a `RewriteRequest` carrying only `prompt` is parsed
- **THEN** it validates, and the server treats it as a new-app rewrite

#### Scenario: A rewrite without plan rows still validates
- **WHEN** a `RewriteResponse` carrying only `rewrittenPrompt` is parsed
- **THEN** it validates, and a client renders the single row

### Requirement: SSE generation event stream schema
The contract SHALL define `GenerationEvent` as a discriminated union on `type` covering:
`stage` (stage ∈ plan|generate|check|run|repair; status ∈ start|done; optional attempt),
`token` (streamed generation text delta), `diagnostic` (carrying a `Diagnostic`), `usage`
(carrying a `Usage`), `queued` (carrying `position`, an integer ≥ 1, the number of generations
ahead plus one), `restart` (the current model turn is being sent again; tokens streamed for that
turn since its start are void), and the two terminal events `result` (carrying a `WireAppRecord`
and an optional `summary`) and `failure` (user-facing `reason` prose, `attempts`, accumulated
`diagnostics`). Every event SHALL also accept the optional `compat` envelope field. Every event a
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

#### Scenario: Unknown event type goes through the envelope
- **WHEN** a payload with an unrecognized `type` is decoded by a client
- **THEN** full parsing is not attempted and the client applies the payload's `compat.fallback`
  (or `fail` when absent), per the forward-compatibility envelope requirement

#### Scenario: Queued and restart validate
- **WHEN** a `queued` event with `position: 3` and a `restart` event are parsed
- **THEN** both validate and neither is terminal

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

The contract SHALL define `ApiError` = `{ error, hint, compat? }` where `error` is a machine-readable identifier,
`hint` is mandatory non-empty guidance, mirroring the diagnostics discipline, and `compat` is the optional
forward-compatibility envelope field. Every non-SSE error body a conforming server returns from a `/v1/*` route
SHALL validate against `ApiError`, so no route invents an ad-hoc error shape. Every error identifier introduced
above protocol level 1 SHALL carry `compat`. `DeviceIdError` remains the narrower, closed-enum specialization for
the identity middleware and SHALL stay assignable to `ApiError`.

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

### Requirement: Report request and response shapes
The contract SHALL define `ReportReason` as the closed set `offensive | harmful | broken | other`, `ReportRequest` as `{ reason: ReportReason, note?: string (at most 1000 characters), appName?: string (at most 200 characters), prompt?: string, source?: string }`, and `ReportResponse` as `{ reportId: string (non-empty) }`.

`prompt` and `source` carry no character bound in the schema. Their byte caps are a server admission concern answered with `413`, not a shape rule, because the cap is measured in UTF-8 bytes and is configurable. The shapes SHALL be zod values like every other product wire shape, and SHALL carry no device identity, since identity rides the `x-whim-device` header.

#### Scenario: A full report validates
- **WHEN** a `ReportRequest` with every field set within bounds is parsed
- **THEN** it validates

#### Scenario: Only the reason is required
- **WHEN** `{ reason: 'other' }` is parsed as `ReportRequest`
- **THEN** it validates

#### Scenario: Bounds and the closed reason set are enforced
- **WHEN** a `ReportRequest` with a 1001-character `note`, one with a 201-character `appName`, and one with `reason: 'spam'` are parsed
- **THEN** all three fail

#### Scenario: The response carries an id
- **WHEN** `{ reportId: '' }` and `{}` are parsed as `ReportResponse`
- **THEN** both fail, and a non-empty `reportId` validates

### Requirement: Service refusal codes are a closed vocabulary
The contract SHALL define `ServiceRefusalCode` as the closed set `payload_too_large | daily_limit | device_busy | server_busy | content_policy | policy_unavailable | budget_exhausted`: the `error` identifiers a conforming server uses for size, admission, content-policy, and operator-budget refusals.

`ApiError` itself SHALL remain unchanged, with an open `error` string and a mandatory non-empty `hint`. Every refusal body SHALL validate as `ApiError` with its `error` a member of `ServiceRefusalCode`. The vocabulary SHALL grow only additively, and no refusal SHALL introduce a second error shape.

`budget_exhausted` SHALL mean the operator's own provider credit is exhausted, as distinct from `daily_limit` (a device or global admission ceiling) and `policy_unavailable` (the content classifier down). A `budget_exhausted` refusal's `hint` SHALL say generation is unavailable for now without naming the provider or a dollar amount.

#### Scenario: The vocabulary is closed
- **WHEN** `rate_limited` is parsed with `ServiceRefusalCode`
- **THEN** parsing fails, and each of the seven listed identifiers validates

#### Scenario: ApiError is untouched
- **WHEN** an `ApiError` whose `error` is `invalid_request` is parsed
- **THEN** it still validates, because `ApiError.error` stays an open string

### Requirement: The client declares the protocol level it understands
Every `/v1` request from the app SHALL carry `x-whim-protocol: <integer>`, the highest wire protocol level the build understands, and the contract SHALL export the current level as a constant; the level SHALL increase by one whenever the wire gains a message, field meaning or refusal code that a client at the previous level would not understand. The server SHALL NOT send a client any message, field or code introduced above that client's declared level; where it has nothing the client can understand, it SHALL send that client's fallback instead.

#### Scenario: Server adapts to an older client
- **WHEN** a client declaring level N makes a request and the server's newest applicable message is level N+1
- **THEN** the server sends a level-N form of the response or its declared fallback, never the level-N+1 message

#### Scenario: Header missing
- **WHEN** a `/v1` request carries no `x-whim-protocol` header
- **THEN** the server treats the client as below every supported level and answers with `426 update_required`

### Requirement: Every wire message carries a forward-compatibility envelope with a closed fallback vocabulary
Every SSE event and every unary JSON body (success or `ApiError`) SHALL be decodable in two phases: first as an envelope `{ type or error: string, compat?: { min: integer, fallback: 'skip' | 'fail' | 'update', notice?: string ≤ 200 chars } }` that tolerates unknown extra fields, then, only when the client knows the type or code and `compat.min` (default 1) is at most its level, as the full schema. A client that cannot use a message SHALL apply its fallback: `skip` ignores it and continues, `fail` ends the current flow with the failure screen showing `notice` as plain text (or generic copy), `update` ends the flow with the update screen showing `notice`. An unknown message without `compat` SHALL be treated as `fail`, and an unknown fallback value SHALL be treated as `fail`. The set {skip, fail, update} SHALL never gain a member or change meaning. Known messages SHALL ignore unknown fields rather than reject them. A client SHALL read `null` on an optional field as the field left out, `compat` and `compat.notice` included (the contract reads those two the same way); `null` on a required field still fails: in `compat` (`min`, `fallback`) the client treats the message as `fail`, elsewhere the message fails its schema. A client SHALL drop an optional `result.summary` or rewrite `plan` that fails its shape and still use the message.

#### Scenario: Unknown non-essential event
- **WHEN** a client receives an SSE event of a type it does not know with `compat.fallback: 'skip'`
- **THEN** it ignores the event and the stream continues to its terminal event

#### Scenario: Unknown essential event
- **WHEN** a client receives an unknown event with `compat.fallback: 'update'` and a notice
- **THEN** it stops the flow and shows the update screen with the notice, and nothing is installed

#### Scenario: Unknown refusal code
- **WHEN** a unary request returns an `ApiError` whose `error` the client does not know and `compat.fallback: 'fail'`
- **THEN** the client shows the failure screen with the notice as plain text

#### Scenario: New field on a known message
- **WHEN** a known event arrives with an extra field the client's schema lacks
- **THEN** the event is used and the field is ignored

#### Scenario: Unknown message without compat
- **WHEN** an unknown event arrives with no `compat`
- **THEN** the client treats it as `fail`

#### Scenario: Null on an optional field reads as absent
- **WHEN** a message carries `null` on an optional field, such as `compat: null` or `compat.notice: null`
- **THEN** the client reads it as the field left out: a known message with `compat: null` is decoded as one with no `compat`, an unknown one is treated as `fail`, and a `compat` with a null `notice` applies its fallback with no notice

#### Scenario: A null compat min or fallback is unreadable
- **WHEN** a message's `compat` carries `fallback: null` or `min: null`
- **THEN** the client cannot read the `compat` and treats the message as `fail`, even when it knows the type

#### Scenario: A malformed optional summary or plan is dropped
- **WHEN** a `result` event's optional `summary` or a rewrite response's optional `plan` fails its shape
- **THEN** the client drops that field and still uses the message: the app installs with no summary, and the plan step shows the rewritten prompt as its one row

