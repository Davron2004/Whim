## ADDED Requirements

### Requirement: The client declares the protocol level it understands
Every `/v1` request from the app SHALL carry `x-whim-protocol: <integer>`, the highest wire protocol level the build understands, and the contract SHALL export the current level as a constant; the level SHALL increase by one whenever the wire gains a message, field meaning or refusal code that a client at the previous level would not understand. The server SHALL NOT send a client any message, field or code introduced above that client's declared level; where it has nothing the client can understand, it SHALL send that client's fallback instead.

#### Scenario: Server adapts to an older client
- **WHEN** a client declaring level N makes a request and the server's newest applicable message is level N+1
- **THEN** the server sends a level-N form of the response or its declared fallback, never the level-N+1 message

#### Scenario: Header missing
- **WHEN** a `/v1` request carries no `x-whim-protocol` header
- **THEN** the server treats the client as below every supported level and answers with `426 update_required`

### Requirement: Every wire message carries a forward-compatibility envelope with a closed fallback vocabulary
Every SSE event and every unary JSON body (success or `ApiError`) SHALL be decodable in two phases: first as an envelope `{ type or error: string, compat?: { min: integer, fallback: 'skip' | 'fail' | 'update', notice?: string ≤ 200 chars } }` that tolerates unknown extra fields, then, only when the client knows the type or code and `compat.min` (default 1) is at most its level, as the full schema. A client that cannot use a message SHALL apply its fallback: `skip` ignores it and continues, `fail` ends the current flow with the failure screen showing `notice` as plain text (or generic copy), `update` ends the flow with the update screen showing `notice`. An unknown message without `compat` SHALL be treated as `fail`, and an unknown fallback value SHALL be treated as `fail`. The set {skip, fail, update} SHALL never gain a member or change meaning. Known messages SHALL ignore unknown fields rather than reject them.

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

## MODIFIED Requirements

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

### Requirement: Clarify request and response shapes
The contract SHALL define `ClarifyRequest` (`prompt`) and `ClarifyResponse` carrying `questions`: an ordered list of **at most three** entries, each `{ id, question, options }` where `options` is a non-empty list of answer strings the device renders as single-select pills, and an optional `limit`: `{ reason, alternative }`, plain-words text saying why the request can't be built as asked and the nearest thing that can. An empty `questions` list SHALL be valid and SHALL mean "nothing needs clarifying". A response carrying `limit` SHALL carry an empty `questions` list.

The exchange SHALL be unary request/response. No clarify event, clarify stage member, or second stream SHALL be added to `GenerationEvent`.

#### Scenario: Zero questions is a valid answer
- **WHEN** a `ClarifyResponse` with an empty `questions` list is parsed
- **THEN** it validates, and the client treats it as "no clarification needed" rather than as an error

#### Scenario: More than three questions is rejected
- **WHEN** a `ClarifyResponse` carrying four questions is parsed
- **THEN** parsing fails

#### Scenario: A limit carries no questions
- **WHEN** a `ClarifyResponse` carries both `limit` and a non-empty `questions` list
- **THEN** parsing fails

#### Scenario: The event union carries no clarification
- **WHEN** `GenerationEvent`'s members and its `stage` enum are inspected
- **THEN** neither mentions clarification

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
