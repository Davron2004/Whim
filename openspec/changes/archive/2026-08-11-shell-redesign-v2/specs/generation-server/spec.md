## ADDED Requirements

### Requirement: Clarify endpoint
`POST /v1/clarify` SHALL validate its body as `ClarifyRequest` (`400` + an `ApiError` body on failure) and respond with a `ClarifyResponse` JSON body carrying at most three questions, each with its answer options. It SHALL be unary — no SSE, no stream, no terminal-event semantics — and SHALL sit behind the same device-identity middleware as every other `/v1` route.

Returning zero questions SHALL be a first-class successful answer, not an error and not a degraded mode: a prompt that needs nothing clarified is the common case. When the endpoint is model-backed its usage SHALL be credited to the calling device through the same `UsageStore` as generation and rewrite. The stub selector SHALL make it deterministic, so the device flow can be exercised without spending tokens.

No `clarify` member SHALL be added to the `GenerationEvent` stage vocabulary, and the endpoint SHALL hold no per-device state between calls — the device carries the answers forward by value.

#### Scenario: Questions come back bounded
- **WHEN** a valid `ClarifyRequest` is posted with a device header
- **THEN** the response validates as `ClarifyResponse` and carries at most three questions

#### Scenario: Nothing to ask is a success
- **WHEN** the configured clarifier has nothing to ask about a prompt
- **THEN** the response is `200` with an empty `questions` list, not an error status

#### Scenario: Invalid body is rejected structurally
- **WHEN** the posted body fails `ClarifyRequest` validation
- **THEN** the server responds `400` with an `ApiError` JSON body

#### Scenario: The stub is deterministic
- **WHEN** the dev server is started with the stub selector set and the same prompt is posted twice
- **THEN** both responses are identical and no model call is made

## MODIFIED Requirements

### Requirement: Device-identity middleware
All `/v1/*` routes SHALL require the header `x-whim-device` containing a UUID (the device's
anonymous MMKV-stored ID — decision #42 identity; no accounts, no PII). A missing or
malformed header SHALL yield `400` with a structured JSON error body before any handler runs.
`GET /healthz` SHALL be exempt.

The gate SHALL be applied by path prefix rather than route by route, so a route added later is gated by construction and cannot be forgotten. The suite SHALL assert this over the server's whole `/v1` route table, not over an enumerated subset.

#### Scenario: Missing device header rejected
- **WHEN** a client calls `POST /v1/generate` without `x-whim-device`
- **THEN** the server responds `400` with a structured error body and no SSE stream opens

#### Scenario: Health check is anonymous
- **WHEN** a client calls `GET /healthz` with no headers
- **THEN** the server responds `200`

#### Scenario: Every /v1 route is gated, including new ones
- **WHEN** every route the server mounts under `/v1` is called without `x-whim-device`
- **THEN** each responds `400` with a structured error body before its handler runs, and the suite fails if any route is reachable unauthenticated

### Requirement: Rewrite endpoint over the real rewrite model

`POST /v1/rewrite` SHALL validate `RewriteRequest` and respond with a `RewriteResponse` JSON body whose
`rewrittenPrompt` is produced by a real call to the configured **rewrite model** through the injectable
model client — a small, fast model distinct from the engineer model, its id a caller parameter read from
the environment. The rewrite SHALL turn a casual prompt into a detailed one in the user's own terms; SDK or
engineering internals SHALL NOT appear in the returned text. Its token usage SHALL be credited to the
calling device through the same `UsageStore` as generation. A model failure SHALL yield a `502` with an
`ApiError` body — the endpoint SHALL NOT return the original prompt disguised as a rewrite. The endpoint
stays unary: no SSE, and no `rewrite` member is added to the `GenerationEvent` stage vocabulary.

When the request carries `clarifications`, the rewrite SHALL reflect those answers. The response MAY carry
`plan` rows — the labelled breakdown the device renders as its approval gate — and a response with no rows
SHALL remain conforming, because the device falls back to rendering `rewrittenPrompt` as a single row.

#### Scenario: Rewrite calls the configured small model

- **WHEN** a valid `RewriteRequest` is posted with a device header against a scripted model client
- **THEN** the response validates as `RewriteResponse`, the outgoing request carries the configured rewrite
  model id verbatim, and the engineer model is never invoked

#### Scenario: Rewrite is metered

- **WHEN** a device rewrites a prompt and then reads back its usage
- **THEN** the rewrite call's tokens are included in the device's totals

#### Scenario: A rewrite model failure is honest

- **WHEN** the model client raises a transport failure during a rewrite
- **THEN** the response is `502` with an `ApiError` body, and no `RewriteResponse` containing the unmodified
  input prompt is returned

#### Scenario: Clarify answers reach the rewrite

- **WHEN** a `RewriteRequest` carrying clarification answers is posted against a scripted model client
- **THEN** the answers appear in the outgoing model request, and the response validates as `RewriteResponse`

### Requirement: SSE generation endpoint over the real generation pipeline

`POST /v1/generate` SHALL validate its body as `GenerateRequest` (`400` + an `ApiError` body on failure) and
respond `text/event-stream`, emitting `GenerationEvent`s framed as SSE (`event:` = the event's `type`,
`data:` = its JSON, monotonically increasing `id:`, periodic comment keepalives at an injectable interval).
The events SHALL come from the **real generation pipeline** behind the unchanged `Pipeline` interface
(`run(request, signal?, trace?) → AsyncIterable<GenerationEvent>`), whose stages, bounds, and terminal
behaviour are the `generation-pipeline` capability's concern. `trace` is an optional mutable record the
pipeline appends each model call's provider generation id to, so the route can reconcile usage after an
abort; a pipeline that ignores it stays conforming.

The route SHALL frame whatever the pipeline emits without inspecting or rewriting it: a `result` event's
summary, when the pipeline produces one, crosses the wire unmodified, and the route SHALL NOT synthesize,
default, or strip it.

The stub pipeline SHALL remain available for LAN UI work behind an explicit opt-in (an environment
selector), so the device flow can be exercised without spending tokens; the default for the dev server
SHALL be the real pipeline. For a stream that runs to completion, exactly one terminal event SHALL be
emitted, after which the stream closes; a client-aborted stream ends without one.

#### Scenario: A real generation streams contract-valid events in order

- **WHEN** a valid `GenerateRequest` is posted with a device header against a pipeline driven by a scripted
  model
- **THEN** the client receives contract-valid events — each stage's `start` preceding its `done`, `token`
  events inside generate, then `usage`, then `result` — with strictly increasing `id:` values, and the
  stream then ends

#### Scenario: Invalid body never opens a stream

- **WHEN** the posted body fails `GenerateRequest` validation
- **THEN** the server responds `400` with an `ApiError` JSON body (not SSE) and no stream opens

#### Scenario: The stub stays reachable for UI work

- **WHEN** the dev server is started with the stub selector set
- **THEN** `/v1/generate` streams the canned stub sequence and makes no model call

#### Scenario: A summary crosses the wire unmodified

- **WHEN** the pipeline emits a `result` carrying a summary
- **THEN** the framed SSE event's parsed summary is byte-equal to what the pipeline emitted, marks included
