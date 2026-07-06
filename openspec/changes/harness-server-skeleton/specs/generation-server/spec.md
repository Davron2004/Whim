# generation-server — delta

## ADDED Requirements

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

### Requirement: SSE generation endpoint over a stub pipeline
`POST /v1/generate` SHALL validate its body as `GenerateRequest` (`400` + structured error on
failure) and respond `text/event-stream`, emitting `GenerationEvent`s framed as SSE
(`event:` = the event's `type`, `data:` = its JSON, monotonically increasing `id:`, periodic
comment keepalives at an injectable interval). In this change the events come from a **stub
pipeline** behind the real `Pipeline` interface (`run(request) → AsyncIterable
<GenerationEvent>`): canned stage start/done pairs for plan → generate (including `token`
deltas) → check → run, then `usage`, then a `result` carrying a small fixed `WireAppRecord`.
A designated magic prompt token SHALL drive the `failure` terminal path instead. Inter-event
delay SHALL be injectable (LAN-realistic by default, zero in tests). Exactly one terminal
event SHALL be emitted, after which the stream closes.

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

### Requirement: Rewrite endpoint (canned)
`POST /v1/rewrite` SHALL validate `RewriteRequest` and respond with a `RewriteResponse` JSON
body. In this change the rewrite is canned (a deterministic transform of the input prompt —
no model call); the real rewrite stage replaces the internals behind the same endpoint later.

#### Scenario: Canned rewrite round-trips
- **WHEN** a valid `RewriteRequest` is posted with a device header
- **THEN** the response validates as `RewriteResponse` and `rewrittenPrompt` is a
  deterministic function of the input prompt

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
The server SHALL include a model-agnostic OpenRouter client (OpenAI-compatible
chat-completions over SSE): the model id is always a caller parameter (never embedded —
#42 strong-first/downgrade-by-eval), responses stream as an async iterable of text deltas,
the final usage chunk is captured as a contract `Usage`, and auth/rate-limit/network failures
normalize to typed errors. The transport (`fetch`) SHALL be injectable; tests run against a
fake transport replaying recorded SSE frames. In this change no route invokes the wrapper,
no live-network test exists, and `OPENROUTER_API_KEY` is read from the environment only
(gitignored `.env`; never required by the suite).

#### Scenario: Streaming completion against a fake transport
- **WHEN** the wrapper runs a streaming completion against recorded SSE frames
- **THEN** deltas arrive in order, the captured usage validates as `Usage`, and the requested
  model id appears verbatim in the outgoing request

#### Scenario: Failures are typed
- **WHEN** the fake transport replays a 401 and a 429
- **THEN** the wrapper raises distinct typed errors (auth vs rate-limit), not generic throws

### Requirement: Blocking server suite in CI
The deterministic server suite (`npm run server:test`) SHALL run the contract round-trip,
middleware, metering, SSE-framing, stub-pipeline, and wrapper tests in-process (no network),
include `tsc --noEmit` over `contract/` and `server/`, and SHALL be a blocking CI gate
alongside the existing `build` + `invariants` gates (which it MUST NOT modify).

#### Scenario: Suite gates CI
- **WHEN** any server/contract test or type-check fails on a PR
- **THEN** CI fails, while the pre-existing `build` + `invariants` jobs remain unchanged
