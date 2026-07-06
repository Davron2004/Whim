# generation-server delta — server-cancellation

## ADDED Requirements

### Requirement: Client disconnect aborts the pipeline
When the client of `/v1/generate` disconnects or cancels the SSE stream, the server SHALL
promptly abort the underlying pipeline run via an `AbortSignal` threaded through
`Pipeline.run`. On abort the pipeline SHALL stop emitting events and return without a
terminal event; pending inter-event timers are released, no work continues on the stream's
behalf, and the abort MUST NOT surface as an unhandled error or rejection. Both cancellation
surfaces the runtime may fire — the SSE `ReadableStream`'s `cancel()` and the request's own
abort signal (`Request.signal`) — SHALL trigger the same per-request abort (aborting is
idempotent). Cancellation bookkeeping MUST NOT introduce any server-side persistence beyond
the existing per-device counter (§4.7 Model 1); a stream cancelled before its `usage` event
credits nothing.

#### Scenario: Cancelling the stream stops the stub pipeline
- **WHEN** a stub generation with non-zero inter-event delay is started and the client
  cancels the stream after the first events arrive
- **THEN** the pipeline observes the abort and yields no further events (verified by
  instrumenting the event source), pending delay timers are released, and no terminal event
  is produced

#### Scenario: A cancelled stream does not corrupt metering
- **WHEN** a stream is cancelled before its `usage` event, and the same device then runs a
  generation to completion
- **THEN** the cancelled run credits nothing and the completed run's usage is credited
  normally

## MODIFIED Requirements

### Requirement: SSE generation endpoint over a stub pipeline
`POST /v1/generate` SHALL validate its body as `GenerateRequest` (`400` + structured error on
failure) and respond `text/event-stream`, emitting `GenerationEvent`s framed as SSE
(`event:` = the event's `type`, `data:` = its JSON, monotonically increasing `id:`, periodic
comment keepalives at an injectable interval). In this change the events come from a **stub
pipeline** behind the real `Pipeline` interface (`run(request, signal?) → AsyncIterable
<GenerationEvent>`, where `signal` is an optional `AbortSignal` honored by every
implementation, stub included): canned stage start/done pairs for plan → generate (including
`token` deltas) → check → run, then `usage`, then a `result` carrying a small fixed
`WireAppRecord`. A designated magic prompt token SHALL drive the `failure` terminal path
instead. Inter-event delay SHALL be injectable (LAN-realistic by default, zero in tests).
For a stream that runs to completion, exactly one terminal event SHALL be emitted, after
which the stream closes; a client-aborted stream ends without one.

#### Scenario: Canned happy path streams in order
- **WHEN** a valid `GenerateRequest` is posted with a device header
- **THEN** the client receives contract-valid events — each stage's `start` preceding its
  `done`, `token` events inside generate, then `usage`, then `result` — with strictly
  increasing `id:` values, and the stream then ends

#### Scenario: Canned failure path
- **WHEN** the prompt contains the designated failure token
- **THEN** the stream ends with a single `failure` event whose `reason` is user-facing prose
  and which is preceded by a `usage` event

#### Scenario: Invalid body never opens a stream
- **WHEN** the posted body fails `GenerateRequest` validation
- **THEN** the server responds `400` JSON (not SSE) with a structured error

### Requirement: OpenRouter client wrapper
The server SHALL include a model-agnostic OpenRouter client (OpenAI-compatible
chat-completions over SSE): the model id is always a caller parameter (never embedded —
#42 strong-first/downgrade-by-eval), responses stream as an async iterable of text deltas,
the final usage chunk is captured as a contract `Usage`, and auth/rate-limit/network failures
normalize to typed errors. The wrapper SHALL accept an optional `AbortSignal` forwarded to
the injected transport, so a caller can abort a live completion mid-stream, and SHALL capture
the generation `id` from the first SSE chunk and expose it on the stream result — the handle
for post-abort usage reconciliation against OpenRouter's generation-stats endpoint (the
reconciliation itself is wired when a route mounts the wrapper, #11). The transport (`fetch`)
SHALL be injectable; tests run against a fake transport replaying recorded SSE frames. In
this change no route invokes the wrapper, no live-network test exists, and
`OPENROUTER_API_KEY` is read from the environment only (gitignored `.env`; never required by
the suite).

#### Scenario: Streaming completion against a fake transport
- **WHEN** the wrapper runs a streaming completion against recorded SSE frames
- **THEN** deltas arrive in order, the captured usage validates as `Usage`, and the requested
  model id appears verbatim in the outgoing request

#### Scenario: Failures are typed
- **WHEN** the fake transport replays a 401 and a 429
- **THEN** the wrapper raises distinct typed errors (auth vs rate-limit), not generic throws

#### Scenario: Abort reaches the transport and the generation id is captured
- **WHEN** a streaming completion runs against a fake transport and the caller aborts
  mid-stream
- **THEN** the abort signal is observed by the transport (the fetch request-init carries it
  and iteration stops promptly), and the generation `id` parsed from the first chunk is
  available on the stream result
