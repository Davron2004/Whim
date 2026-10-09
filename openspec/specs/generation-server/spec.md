# generation-server Specification

## Purpose
The generation server: a Node 22 Hono service exposing the SSE generation endpoint over the real
generation pipeline, the rewrite endpoint over the real rewrite model, device-identity middleware
behind an injectable verifier, admission control and content policy ahead of every model call, a
durable usage ledger plus user-sent reports as the only server state, and the model-agnostic
OpenRouter client wrapper mounted behind the model-client seam. The stub pipeline and canned
rewrite remain reachable behind an explicit environment opt-in for LAN UI work. In production the
service runs as the public server described by `server-deployment`, behind that deployment's TLS
front proxy, which terminates TLS and never buffers the SSE stream.
## Requirements
### Requirement: Server workspace and runtime
The repo SHALL provide an npm workspace `server/` (package `@whim/server`): a Node 22 HTTP service whose runtime dependencies are exactly `hono`, `@hono/node-server`, `pino`, `@whim/contract` (+`zod` via the contract), and the three packages the generation harness executes at run time: `esbuild` (candidate builds), `playwright` (the synthetic run's browser), and `typescript` (the static checker).

Those three SHALL be pinned to exactly the versions the lockfile resolves for the repo's root development dependencies, so the workspace and the root never carry two versions of any of them. `pino-pretty` SHALL be a dev dependency only, and the service SHALL run with structured JSON output when it is absent. The workspace MUST NOT depend on `react`, `react-dom`, or anything React-Native-adjacent (the workspace-hoist safety rule).

Dev/test execution SHALL follow the repo's esbuild-bundle-then-run idiom (`npm run server:dev`, `npm run server:test`) with no new test framework. Production execution SHALL use the prebuilt runtime tree defined by `server-deployment`, never the dev runner. The server SHALL bind `WHIM_SERVER_HOST` (default `0.0.0.0`) on `WHIM_SERVER_PORT` (default 8787), so LAN devices can reach the dev server. TLS is terminated by the deployment's front proxy, not by the service.

#### Scenario: LAN-reachable dev server
- **WHEN** `npm run server:dev` starts on the dev machine
- **THEN** a client on the same LAN can `GET /healthz` over plain HTTP and receive `200`

#### Scenario: Dependency budget enforced
- **WHEN** the suite inspects `server/package.json` and the lockfile
- **THEN** runtime deps are exactly the allowed set, `esbuild`, `playwright`, and `typescript` are pinned to the lockfile-resolved root versions, `pino-pretty` appears only under dev dependencies, and anything React-adjacent fails the test

#### Scenario: The service runs without the pretty printer
- **WHEN** the server starts in an environment where `pino-pretty` is not installed
- **THEN** it starts normally and emits structured JSON log lines

### Requirement: Device-identity middleware
All `/v1/*` routes SHALL require the header `x-whim-device` containing a UUID (the device's
anonymous MMKV-stored ID — decision #42 identity; no accounts, no PII). A missing or
malformed header SHALL yield `400` with a structured JSON error body before any handler runs.
`GET /health` and `GET /healthz` SHALL be exempt and SHALL answer the same body.

The gate SHALL be applied by path prefix rather than route by route, so a route added later is gated by construction and cannot be forgotten. The suite SHALL assert this over the server's whole `/v1` route table, not over an enumerated subset.

#### Scenario: Missing device header rejected
- **WHEN** a client calls `POST /v1/generate` without `x-whim-device`
- **THEN** the server responds `400` with a structured error body and no SSE stream opens

#### Scenario: Health check is anonymous
- **WHEN** a client calls `GET /healthz` with no headers
- **THEN** the server responds `200`

#### Scenario: Both health paths answer the same body
- **WHEN** a client calls `GET /health` and `GET /healthz` with no headers
- **THEN** both respond `200` with identical JSON bodies naming `service: "whim-server"`, the image's `commit` and both minimum builds

#### Scenario: Every /v1 route is gated, including new ones
- **WHEN** every route the server mounts under `/v1` is called without `x-whim-device`
- **THEN** each responds `400` with a structured error body before its handler runs, and the suite fails if any route is reachable unauthenticated

### Requirement: Clarify endpoint
`POST /v1/clarify` SHALL validate its body as `ClarifyRequest` (`400` + an `ApiError` body on failure) and respond with a `ClarifyResponse` JSON body carrying at most three questions, each with its answer options. It SHALL be unary — no SSE, no stream, no terminal-event semantics — and SHALL sit behind the same device-identity middleware as every other `/v1` route.

Returning zero questions SHALL be a first-class successful answer, not an error and not a degraded mode: a prompt that needs nothing clarified is the common case. When the endpoint is model-backed its usage SHALL be credited to the calling device through the same `UsageStore` as generation and rewrite. The stub selector SHALL make it deterministic, so the device flow can be exercised without spending tokens.

No `clarify` member SHALL be added to the `GenerationEvent` stage vocabulary, and the endpoint SHALL hold no per-device state between calls — the device carries the answers forward by value.

An HTTP `402` from the model provider on the clarify model call SHALL yield `503` with `error: 'budget_exhausted'` instead of a generic model-failure response, and SHALL invalidate the operator-credit cache (specs/server-admission-control "The server refuses admission when the operator's provider credit is exhausted") so the next request refuses up front.

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

#### Scenario: Exhausted provider credit is a distinct refusal
- **WHEN** the model client raises a `402` during a clarify call
- **THEN** the response is `503` with `error: 'budget_exhausted'`, and a following clarify request from any device is refused before any model call

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

An HTTP `402` from the model provider on the rewrite model call SHALL yield `503` with `error: 'budget_exhausted'` in place of the generic `502`, and SHALL invalidate the operator-credit cache (specs/server-admission-control "The server refuses admission when the operator's provider credit is exhausted") so the next request refuses up front.

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

#### Scenario: Exhausted provider credit is a distinct refusal
- **WHEN** the model client raises a `402` during a rewrite call
- **THEN** the response is `503` with `error: 'budget_exhausted'`, not `502`, and a following rewrite request from any device is refused before any model call

### Requirement: Client disconnect aborts the pipeline
When the client of `/v1/generate` disconnects or cancels the SSE stream, the server SHALL promptly abort the underlying pipeline run via an `AbortSignal` threaded through `Pipeline.run`.

On abort the pipeline SHALL stop emitting events and return without a terminal event. Pending inter-event timers are released, model streams and synthetic-run browser contexts opened on the stream's behalf are torn down, no work continues on the stream's behalf, and the abort MUST NOT surface as an unhandled error or rejection. Both cancellation surfaces the runtime may fire — the SSE `ReadableStream`'s `cancel()` and the request's own abort signal (`Request.signal`) — SHALL trigger the same per-request abort (aborting is idempotent). The device's generation slot and its global concurrency slot SHALL be released on this path.

This behavior SHALL be proven over a real TCP connection to a listening server, not only through an in-process request. Destroying the client socket mid-stream SHALL abort the model transport and release both admission slots within 5 seconds in the fast suite. In the browser-backed suite, it SHALL close the run's browser context within 5 seconds.

On abort the server SHALL additionally reconcile the run's **authoritative** upstream usage. For each provider generation id the pipeline recorded on the request's trace, it SHALL poll the provider's generation-stats endpoint through an injectable transport, with a bounded attempt count, a per-attempt timeout, and a total time budget. It SHALL credit the resolved token counts to the calling device once and record the resolved cost on the request's ledger row. Reconciliation SHALL fail quietly on exhaustion. Cancellation bookkeeping MUST NOT introduce any server-side persistence beyond the usage store; a stream cancelled before any model call was made credits nothing.

#### Scenario: Cancelling the stream stops the pipeline
- **WHEN** a generation with non-zero inter-event delay is started and the client cancels the stream after the first events arrive
- **THEN** the pipeline observes the abort and yields no further events (verified by instrumenting the event source), pending delay timers and browser contexts are released, and no terminal event is produced

#### Scenario: A real TCP disconnect tears down the model call
- **WHEN** a client opens a TCP connection to the listening server, starts a generation against a scripted model whose transport is mid-stream, reads the first event, and destroys its socket
- **THEN** within 5 seconds the scripted transport observes its abort signal, the pipeline emits nothing further, and the same device's next generation is admitted rather than refused as `device_busy`

#### Scenario: A real TCP disconnect closes the browser context
- **WHEN** in the browser-backed suite a client over a real TCP socket starts a generation whose candidate is held in the run stage and destroys its socket
- **THEN** within 5 seconds the synthetic-run session has no open browser context for that run and its concurrency slot is free

#### Scenario: A cancelled stream credits its reconciled usage
- **WHEN** a stream is cancelled after a model call started, the injected transport resolves authoritative counts for the recorded generation id, and the same device then runs a generation to completion
- **THEN** the cancelled run's reconciled counts and the completed run's usage are both credited, each exactly once

#### Scenario: A cancelled stream with no model call credits nothing
- **WHEN** a stream is cancelled before any model call is made
- **THEN** nothing is credited and no reconciliation request is issued

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

The wrapper SHALL send the caller's reasoning setting explicitly: `off` as `reasoning: { enabled: false }`,
`on` as `reasoning: { enabled: true }`, `low`, `medium` or `high` as `reasoning: { effort: <level> }`, and it
SHALL omit the `reasoning` field only for `default`. When the operator sets `WHIM_PROVIDER_SORT` to `price`,
`throughput` or `latency`, every request SHALL carry `provider: { sort: <value> }`; when it is unset no
provider preference SHALL be sent, and any other value SHALL fail configuration loading.

Every completion SHALL emit exactly one structured `model call` log line when its stream settles —
completed, failed or aborted — carrying the call's role, the model id, the upstream provider when the stream
reports one, the time to the first delta, the total duration, the prompt and completion token counts, the
reasoning and cached token counts when the usage reports them, the generation id, and the outcome. The line
SHALL carry no message content.

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

#### Scenario: The reasoning setting is explicit on the wire
- **WHEN** the wrapper runs completions with the settings `off`, `on`, `low` and `default` against a fake
  transport
- **THEN** the request bodies carry `reasoning: { enabled: false }`, `reasoning: { enabled: true }`,
  `reasoning: { effort: 'low' }`, and no `reasoning` field, respectively

#### Scenario: The provider preference follows the operator setting
- **WHEN** `WHIM_PROVIDER_SORT` is `throughput`
- **THEN** every request body carries `provider: { sort: 'throughput' }`, and with the variable unset no
  request body carries a `provider` field

#### Scenario: One timing line per call, whatever its outcome
- **WHEN** one completion streams recorded frames that report an upstream provider and reasoning tokens,
  and a second completion is aborted mid-stream
- **THEN** exactly one `model call` line is logged per completion: the first with its role, model,
  provider, time to first delta, duration, reasoning token count, generation id and a completed outcome,
  the second with an aborted outcome, and no message text from either request or reply appears in the log

### Requirement: Blocking server suite in CI
The deterministic server suite (`npm run server:test`) SHALL run the contract round-trip, middleware, metering, admission, content-policy, report, SSE-framing, pipeline-machine, stage, prompt-assembly, wrapper, production-build, and deploy-config tests. It SHALL use no external network and no browser; loopback sockets to a server the suite itself started are permitted. It SHALL include `tsc --noEmit` over `contract/` and `server/`, and SHALL be a blocking CI gate alongside the existing `build` + `invariants` gates (which it MUST NOT modify). It SHALL pass with `OPENROUTER_API_KEY` unset.

A second, **browser-backed** suite SHALL exercise the pipeline end to end against the real static checker, the real bundle build, and the real synthetic run harness, with a scripted model client. It SHALL also cover the production boot self-test and browser-context teardown on a real TCP disconnect. Because it needs Chromium it SHALL run in the full gate, never in the fast gate, and SHALL likewise make no live model call.

#### Scenario: Suite gates CI
- **WHEN** any server/contract test or type-check fails on a PR
- **THEN** CI fails, while the pre-existing `build` + `invariants` jobs remain unchanged

#### Scenario: The fast suite launches no browser
- **WHEN** the deterministic server suite runs
- **THEN** no browser is launched, no connection leaves the loopback interface, and the suite completes without the Chromium dependency being present

#### Scenario: The browser-backed suite proves the real path
- **WHEN** the full gate runs the browser-backed suite
- **THEN** an honest corpus-shaped candidate reaches a `result` through the real check, build, and run stages, and a candidate that attempts an escape ends in a containment `failure`

### Requirement: Server logging is structured and redacted at the serializer
Server logging SHALL go through one `pino` logger. The two ad-hoc `[whim-server]` console helpers
SHALL be removed, not wrapped: per-request logging and per-run pipeline breadcrumbs SHALL become
child loggers carrying their scope as a field, and each breadcrumb SHALL pass named fields rather
than a pre-formatted string.

The privacy floor SHALL be enforced by pino's `redact` configuration rather than by convention:
prompt text, generated mini-app source, the `x-whim-device` value, and the model-provider API key
SHALL be unreachable in emitted output even when a caller passes them, and SHALL be replaced with a
fixed marker. Redaction SHALL apply to the whole logger, so a new call site inherits it without
opting in.

In development the pretty transport SHALL be used for human reading; in its absence the logger
SHALL emit JSON. Logging SHALL NOT be added inside any response-path hot loop — SSE token emission
stays untouched.

#### Scenario: A request line carries fields
- **WHEN** a request completes
- **THEN** one record is emitted carrying method, path, status, and duration as named fields, and
  the SSE body's drain time is what the duration measures

#### Scenario: A sensitive field cannot be logged
- **WHEN** a caller passes prompt text, a device id, or the API key in a log payload
- **THEN** the serialized output carries the redaction marker in that field's place and the value
  appears nowhere in the output

#### Scenario: The old helpers are gone
- **WHEN** the server source is scanned for the retired `[whim-server]` console helpers
- **THEN** neither is defined nor called

#### Scenario: Token emission is not logged
- **WHEN** a generation streams many `token` events
- **THEN** no per-token record is emitted

### Requirement: A dev-only log-sink route persists batched device records
The server SHALL expose a log-sink route that accepts a batch of device log records and appends
them to a file, one JSON record per line, so device diagnostics survive logcat's ~4 KB truncation.

The route SHALL be **off by default** and SHALL exist only when explicitly enabled by environment
configuration; when disabled it SHALL NOT be mounted and a request to it SHALL yield `404`. It
SHALL NOT be mounted under `/v1`, so the invariant that every `/v1` route is gated by
`x-whim-device` is untouched and no ungated product surface is created. It SHALL bound the accepted
body size and the number of records per batch, rejecting an over-large batch with a structured
error rather than writing a partial file. A malformed batch SHALL be rejected without writing
anything.

Records SHALL be appended exactly as received, after the same redaction the server logger applies,
and the destination file SHALL be excluded from version control. A repo script SHALL tail that
file for a human reader.

#### Scenario: Disabled by default
- **WHEN** the server starts without the log-sink environment flag
- **THEN** a POST to the log-sink route returns `404` and no file is created

#### Scenario: A batch is appended
- **WHEN** the route is enabled and a valid batch of records is posted
- **THEN** the response is a success status with no body content, and the file gains one JSON line
  per record in the order they were sent

#### Scenario: The route is not under the device gate's prefix
- **WHEN** the route table is inspected
- **THEN** the log-sink path is not under `/v1`, and every `/v1` route still requires
  `x-whim-device`

#### Scenario: An over-large batch is refused whole
- **WHEN** a batch exceeding the configured record or byte bound is posted
- **THEN** the response is a structured error and the file is unchanged

#### Scenario: A malformed batch writes nothing
- **WHEN** a body that is not a valid record batch is posted
- **THEN** the response is a structured error and the file is unchanged

### Requirement: The health check identifies the service
`GET /healthz` SHALL respond `200` with a JSON body identifying the service, for example
`{ ok: true, service: 'whim-server' }`, rather than a bare string, so a caller can distinguish
"this is a Whim server" from any other process that happens to answer 200 on `/healthz` (measured
this cycle: multiple unrelated local listeners can 200 on that path). The route SHALL remain
outside the `/v1/*` prefix and exempt from the `x-whim-device` header gate, so it stays probeable
by a bare `curl` or browser request with no headers.

#### Scenario: Health check body identifies the service
- **WHEN** a client calls `GET /healthz` with no headers
- **THEN** the response is `200` with a JSON body whose fields identify it as the Whim server

#### Scenario: Health check stays anonymous and ungated
- **WHEN** a client calls `GET /healthz` with no `x-whim-device` header
- **THEN** the response is `200` (not `400`), unaffected by the device-identity middleware

### Requirement: Server state is the usage store and user-sent reports
The server SHALL keep its generation state in exactly two durable stores, in the backend the operator selects (`server-storage-backends`): `node:sqlite` databases under a gitignored `WHIM_DATA_DIR` (default `server/.data/`; `:memory:` in tests), opened in WAL mode so an operator command can read them while the server writes, or Firestore.

The first is the **usage store**. It holds the per-device token counter (`UsageStore`) and the content-free request ledger defined by `server-admission-control`. Every generation, stub included, SHALL credit its usage through this store, and the totals SHALL survive a server restart.

The second is the **report store** defined by `content-reports`. It holds only reports a user explicitly sent, for the configured retention period.

The beta waitlist store (`beta-waitlist`) lives in the same backend and holds only website signups; it never sees app traffic. No other server-side persistence of any kind SHALL exist. Outside the report store, prompts, clarifications, source, bundles, manifests, schemas, and app content are never stored (§4.7 Model 1, with the reports exception recorded in `docs/decisions.md`).

#### Scenario: Stub generation meters real state
- **WHEN** a device runs two stub generations and the server restarts
- **THEN** the device's accumulated token total equals the sum of both runs' `usage` events

#### Scenario: Nothing but the two stores persists
- **WHEN** the SQLite data directory is inspected after clarify, rewrite, generate, and report requests carrying distinctive marker text
- **THEN** it contains only the usage and report databases (with their SQLite sidecar files), the marker text appears only in the report database and only for the report request, and the usage database holds counters and ledger rows only

