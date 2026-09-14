## MODIFIED Requirements

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
All `/v1/*` routes SHALL require the header `x-whim-device` containing a UUID (the device's anonymous MMKV-stored ID — decision #42 identity; no accounts, no PII). A missing or malformed header SHALL yield `400` with a structured JSON error body before any handler runs. `GET /healthz` and `GET /healthz/sse` SHALL be exempt.

The gate SHALL be applied by path prefix rather than route by route, so a route added later is gated by construction and cannot be forgotten. The suite SHALL assert this over the server's whole `/v1` route table, not over an enumerated subset.

The decision SHALL be made by an injectable device verifier that receives the request headers and returns either a verified device id or a refusal carrying its status and `ApiError` body. The default verifier is today's UUID shape check. Routes, admission control, and metering SHALL read only the verified device id the middleware sets, never the raw header. A future verifier (for example Apple App Attest or Google Play Integrity) can then turn the shape check into a verified identity without changing any route.

#### Scenario: Missing device header rejected
- **WHEN** a client calls `POST /v1/generate` without `x-whim-device`
- **THEN** the server responds `400` with a structured error body and no SSE stream opens

#### Scenario: Health check is anonymous
- **WHEN** a client calls `GET /healthz` with no headers
- **THEN** the server responds `200`

#### Scenario: Every /v1 route is gated, including new ones
- **WHEN** every route the server mounts under `/v1` is called without `x-whim-device`
- **THEN** each responds `400` with a structured error body before its handler runs, and the suite fails if any route is reachable unauthenticated

#### Scenario: A substituted verifier gates every route with no route change
- **WHEN** the app is constructed with a test verifier that refuses one specific valid UUID with `403`
- **THEN** every `/v1` route answers that UUID with `403` and the verifier's `ApiError` body, and every other UUID is served as before

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

## REMOVED Requirements

### Requirement: Token metering — the only server state
**Reason**: A public server needs durable per-day admission counts, per-request cost, and user-sent reports. "Only a token counter" is no longer true, and the replacement requirement keeps the no-content rule everywhere except the reports store.
**Migration**: Replaced by "Server state is the usage store and user-sent reports" below. The existing `usage` table and `/v1/usage` readback are unchanged. New tables and files are additive, and no data migration is needed.

## ADDED Requirements

### Requirement: Server state is the usage store and user-sent reports
The server SHALL keep exactly two durable stores under a gitignored `WHIM_DATA_DIR` (default `server/.data/`; `:memory:` in tests), both `node:sqlite` databases opened in WAL mode so an operator command can read them while the server writes.

The first is the **usage store**. It holds the per-device token counter (`UsageStore`) and the content-free request ledger defined by `server-admission-control`. Every generation, stub included, SHALL credit its usage through this store, and the totals SHALL survive a server restart.

The second is the **report store** defined by `content-reports`. It holds only reports a user explicitly sent, for the configured retention period.

No other server-side persistence of any kind SHALL exist. Outside the report store, prompts, clarifications, source, bundles, manifests, schemas, and app content are never stored (§4.7 Model 1, with the reports exception recorded in `docs/decisions.md`).

#### Scenario: Stub generation meters real state
- **WHEN** a device runs two stub generations and the server restarts
- **THEN** the device's accumulated token total equals the sum of both runs' `usage` events

#### Scenario: Nothing but the two stores persists
- **WHEN** the data directory is inspected after clarify, rewrite, generate, and report requests carrying distinctive marker text
- **THEN** it contains only the usage and report databases (with their SQLite sidecar files), the marker text appears only in the report database and only for the report request, and the usage database holds counters and ledger rows only
