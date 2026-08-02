# generation-server Specification

## Purpose
The harness server: a Node 22 Hono service exposing the SSE generation endpoint over the real
generation pipeline, the rewrite endpoint over the real rewrite model, device-UUID identity
middleware, durable per-device token metering (the only server state), usage readback, and the
model-agnostic OpenRouter client wrapper mounted behind the model-client seam. The stub pipeline
and canned rewrite remain reachable behind an explicit environment opt-in for LAN UI work. LAN
dev only — no deployment or TLS yet.

## Requirements

### Requirement: Server workspace and runtime
The repo SHALL provide an npm workspace `server/` (package `@whim/server`): a Node 22 HTTP
service whose runtime dependencies are exactly `hono`, `@hono/node-server`, and
`@whim/contract` (+`zod` via the contract). It MUST NOT depend on `react`, `react-dom`, or
anything React-Native-adjacent (the workspace-hoist safety rule). Dev/test execution SHALL
follow the repo's esbuild-bundle-then-run idiom (`npm run server:dev`, `npm run server:test`)
with no new test framework. The dev server SHALL bind `0.0.0.0` on `WHIM_SERVER_PORT`
(default 8787) so LAN devices can reach it; TLS and deployment are out of scope.

#### Scenario: LAN-reachable dev server
- **WHEN** `npm run server:dev` starts on the dev machine
- **THEN** a client on the same LAN can `GET /healthz` over plain HTTP and receive `200`

#### Scenario: Dependency budget enforced
- **WHEN** the suite inspects `server/package.json`
- **THEN** runtime deps are exactly the allowed set, and anything React-adjacent fails the test

### Requirement: Device-identity middleware
All `/v1/*` routes SHALL require the header `x-whim-device` containing a UUID (the device's
anonymous MMKV-stored ID — decision #42 identity; no accounts, no PII). A missing or
malformed header SHALL yield `400` with a structured JSON error body before any handler runs.
`GET /healthz` SHALL be exempt.

#### Scenario: Missing device header rejected
- **WHEN** a client calls `POST /v1/generate` without `x-whim-device`
- **THEN** the server responds `400` with a structured error body and no SSE stream opens

#### Scenario: Health check is anonymous
- **WHEN** a client calls `GET /healthz` with no headers
- **THEN** the server responds `200`

### Requirement: SSE generation endpoint over the real generation pipeline

`POST /v1/generate` SHALL validate its body as `GenerateRequest` (`400` + an `ApiError` body on failure) and
respond `text/event-stream`, emitting `GenerationEvent`s framed as SSE (`event:` = the event's `type`,
`data:` = its JSON, monotonically increasing `id:`, periodic comment keepalives at an injectable interval).
The events SHALL come from the **real generation pipeline** behind the unchanged `Pipeline` interface
(`run(request, signal?, trace?) → AsyncIterable<GenerationEvent>`), whose stages, bounds, and terminal
behaviour are the `generation-pipeline` capability's concern. `trace` is an optional mutable record the
pipeline appends each model call's provider generation id to, so the route can reconcile usage after an
abort; a pipeline that ignores it stays conforming.

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

### Requirement: Rewrite endpoint over the real rewrite model

`POST /v1/rewrite` SHALL validate `RewriteRequest` and respond with a `RewriteResponse` JSON body whose
`rewrittenPrompt` is produced by a real call to the configured **rewrite model** through the injectable
model client — a small, fast model distinct from the engineer model, its id a caller parameter read from
the environment. The rewrite SHALL turn a casual prompt into a detailed one in the user's own terms; SDK or
engineering internals SHALL NOT appear in the returned text. Its token usage SHALL be credited to the
calling device through the same `UsageStore` as generation. A model failure SHALL yield a `502` with an
`ApiError` body — the endpoint SHALL NOT return the original prompt disguised as a rewrite. The endpoint
stays unary: no SSE, and no `rewrite` member is added to the `GenerationEvent` stage vocabulary.

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

### Requirement: Client disconnect aborts the pipeline
When the client of `/v1/generate` disconnects or cancels the SSE stream, the server SHALL promptly abort the
underlying pipeline run via an `AbortSignal` threaded through `Pipeline.run`. On abort the pipeline SHALL
stop emitting events and return without a terminal event; pending inter-event timers are released, model
streams and synthetic-run browser contexts opened on the stream's behalf are torn down, no work continues
on the stream's behalf, and the abort MUST NOT surface as an unhandled error or rejection. Both cancellation
surfaces the runtime may fire — the SSE `ReadableStream`'s `cancel()` and the request's own abort signal
(`Request.signal`) — SHALL trigger the same per-request abort (aborting is idempotent).

On abort the server SHALL additionally reconcile the run's **authoritative** upstream usage: for each
provider generation id the pipeline recorded on the request's trace, it SHALL poll the provider's
generation-stats endpoint through an injectable transport, with a bounded attempt count and total time
budget, and credit the resolved counts to the calling device. Reconciliation SHALL fail quietly on
exhaustion. Cancellation bookkeeping MUST NOT introduce any server-side persistence beyond the existing
per-device counter (§4.7 Model 1); a stream cancelled before any model call was made credits nothing.

#### Scenario: Cancelling the stream stops the pipeline
- **WHEN** a generation with non-zero inter-event delay is started and the client cancels the stream after
  the first events arrive
- **THEN** the pipeline observes the abort and yields no further events (verified by instrumenting the
  event source), pending delay timers and browser contexts are released, and no terminal event is produced

#### Scenario: A cancelled stream credits its reconciled usage
- **WHEN** a stream is cancelled after a model call started, the injected transport resolves authoritative
  counts for the recorded generation id, and the same device then runs a generation to completion
- **THEN** the cancelled run's reconciled counts and the completed run's usage are both credited, each
  exactly once

#### Scenario: A cancelled stream with no model call credits nothing
- **WHEN** a stream is cancelled before any model call is made
- **THEN** nothing is credited and no reconciliation request is issued

### Requirement: Token metering — the only server state
The server SHALL keep one durable store: a per-device-ID token counter (`UsageStore`
interface; `node:sqlite` implementation writing under a gitignored `WHIM_DATA_DIR`, default
`server/.data/`; `:memory:` in tests). Every generation — stub included — SHALL credit its
usage through this store, and the totals SHALL survive a server restart. No other server-side
persistence of any kind SHALL exist (§4.7 Model 1: prompts, source, and bundles are never
stored).

#### Scenario: Stub generation meters real state
- **WHEN** a device runs two stub generations and the server restarts
- **THEN** the device's accumulated token total equals the sum of both runs' `usage` events

#### Scenario: Nothing but the counter persists
- **WHEN** the data directory is inspected after a generation
- **THEN** it contains device-ID→counter rows only — no prompt, source, bundle, or app
  content anywhere

### Requirement: Usage readback
`GET /v1/usage` SHALL return the calling device's accumulated `Usage` totals (per the
contract's `Usage` shape), scoped strictly to the `x-whim-device` ID making the request. An
ID with no recorded usage SHALL read back as zeros, not an error.

#### Scenario: Readback matches metered usage
- **WHEN** a device requests `/v1/usage` after its generations
- **THEN** the totals equal what the metering store recorded for that ID alone

### Requirement: OpenRouter client wrapper
The server SHALL include a model-agnostic OpenRouter client (OpenAI-compatible chat-completions over SSE):
the model id is always a caller parameter (never embedded — #42 strong-first/downgrade-by-eval), responses
stream as an async iterable of text deltas, the final usage chunk is captured as a contract `Usage`, and
auth/rate-limit/network failures normalize to typed errors. The wrapper SHALL accept an optional
`AbortSignal` forwarded to the injected transport, so a caller can abort a live completion mid-stream, and
SHALL capture the generation `id` from the first SSE chunk and expose it on the stream result — the handle
for post-abort usage reconciliation against OpenRouter's generation-stats endpoint. The transport (`fetch`)
SHALL be injectable; tests run against a fake transport replaying recorded SSE frames.

The wrapper SHALL be reached by the pipeline only through the model-client interface it adapts, so no
pipeline stage depends on the provider directly. `OPENROUTER_API_KEY` is read from the environment only
(gitignored `.env`); the deterministic suites SHALL NOT require it and SHALL make no live network call.

#### Scenario: Streaming completion against a fake transport
- **WHEN** the wrapper runs a streaming completion against recorded SSE frames
- **THEN** deltas arrive in order, the captured usage validates as `Usage`, and the requested model id
  appears verbatim in the outgoing request

#### Scenario: Failures are typed
- **WHEN** the fake transport replays a 401 and a 429
- **THEN** the wrapper raises distinct typed errors (auth vs rate-limit), not generic throws

#### Scenario: Abort reaches the transport and the generation id is captured
- **WHEN** a streaming completion runs against a fake transport and the caller aborts mid-stream
- **THEN** the abort signal is observed by the transport (the fetch request-init carries it and iteration
  stops promptly), and the generation `id` parsed from the first chunk is available on the stream result

#### Scenario: The provider is reachable only behind the model-client seam
- **WHEN** the pipeline sources are inspected for imports of the OpenRouter wrapper
- **THEN** only the adapter module imports it, and every stage depends on the model-client interface instead

### Requirement: Blocking server suite in CI
The deterministic server suite (`npm run server:test`) SHALL run the contract round-trip, middleware,
metering, SSE-framing, pipeline-machine, stage, prompt-assembly, and wrapper tests in-process (no network,
no browser), include `tsc --noEmit` over `contract/` and `server/`, and SHALL be a blocking CI gate
alongside the existing `build` + `invariants` gates (which it MUST NOT modify). It SHALL pass with
`OPENROUTER_API_KEY` unset.

A second, **browser-backed** suite SHALL exercise the pipeline end to end against the real static checker,
the real bundle build, and the real synthetic run harness, with a scripted model client. Because it needs
Chromium it SHALL run in the full gate, never in the fast gate, and SHALL likewise make no live model call.

#### Scenario: Suite gates CI
- **WHEN** any server/contract test or type-check fails on a PR
- **THEN** CI fails, while the pre-existing `build` + `invariants` jobs remain unchanged

#### Scenario: The fast suite launches no browser
- **WHEN** the deterministic server suite runs
- **THEN** no browser is launched and the suite completes without the Chromium dependency being present

#### Scenario: The browser-backed suite proves the real path
- **WHEN** the full gate runs the browser-backed suite
- **THEN** an honest corpus-shaped candidate reaches a `result` through the real check, build, and run
  stages, and a candidate that attempts an escape ends in a containment `failure`
