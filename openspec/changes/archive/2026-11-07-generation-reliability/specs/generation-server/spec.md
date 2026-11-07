## MODIFIED Requirements

### Requirement: Clarify endpoint
`POST /v1/clarify` SHALL validate its body as `ClarifyRequest` (`400` + an `ApiError` body on failure) and respond with a `ClarifyResponse` JSON body carrying at most three questions, each with its answer options. It SHALL be unary — no SSE, no stream, no terminal-event semantics — and SHALL sit behind the same device-identity middleware as every other `/v1` route.

Returning zero questions SHALL be a first-class successful answer, not an error and not a degraded mode: a prompt that needs nothing clarified is the common case. When the endpoint is model-backed its usage SHALL be credited to the calling device through the same `UsageStore` as generation and rewrite. The stub selector SHALL make it deterministic, so the device flow can be exercised without spending tokens.

No `clarify` member SHALL be added to the `GenerationEvent` stage vocabulary, and the endpoint SHALL hold no per-device state between calls — the device carries the answers forward by value.

An HTTP `402` from the model provider on the clarify model call SHALL yield `503` with `error: 'budget_exhausted'` instead of a generic model-failure response, and SHALL invalidate the operator-credit cache (specs/server-admission-control "The server refuses admission when the operator's provider credit is exhausted") so the next request refuses up front.

An upstream failure of the clarify model call ("An upstream failure is exactly a server, rate-limit, network or timeout failure"), the server's own per-call timeout included, SHALL yield `503` with `error: 'provider_unavailable'` and no `Retry-After` instead of a generic model-failure response, and the ledger row SHALL record `provider_unavailable`.

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

#### Scenario: An upstream clarify failure is a provider-unavailable refusal
- **WHEN** the model client raises a `503` stream error during a clarify call
- **THEN** the response is `503` with `error: 'provider_unavailable'` and the provider hint, not `502 model_failure`

### Requirement: Rewrite endpoint over the real rewrite model
`POST /v1/rewrite` SHALL validate `RewriteRequest` and respond with a `RewriteResponse` JSON body whose
`rewrittenPrompt` is produced by a real call to the configured **rewrite model** through the injectable
model client — a small, fast model distinct from the engineer model, its id a caller parameter read from
the environment. The rewrite SHALL turn a casual prompt into a detailed one in the user's own terms; SDK or
engineering internals SHALL NOT appear in the returned text. Its token usage SHALL be credited to the
calling device through the same `UsageStore` as generation. A model failure that is not upstream SHALL yield a `502` with an
`ApiError` body — the endpoint SHALL NOT return the original prompt disguised as a rewrite. The endpoint
stays unary: no SSE, and no `rewrite` member is added to the `GenerationEvent` stage vocabulary.

When the request carries `clarifications`, the rewrite SHALL reflect those answers. The response MAY carry
`plan` rows — the labelled breakdown the device renders as its approval gate — and a response with no rows
SHALL remain conforming, because the device falls back to rendering `rewrittenPrompt` as a single row.

An HTTP `402` from the model provider on the rewrite model call SHALL yield `503` with `error: 'budget_exhausted'` in place of the generic `502`, and SHALL invalidate the operator-credit cache (specs/server-admission-control "The server refuses admission when the operator's provider credit is exhausted") so the next request refuses up front.

An upstream failure of the rewrite model call that remains after the endpoint's existing retries ("An upstream failure is exactly a server, rate-limit, network or timeout failure"), the server's own per-call timeout included, SHALL yield `503` with `error: 'provider_unavailable'` and no `Retry-After` in place of the generic `502`, and the ledger row SHALL record `provider_unavailable`.

#### Scenario: Rewrite calls the configured small model
- **WHEN** a valid `RewriteRequest` is posted with a device header against a scripted model client
- **THEN** the response validates as `RewriteResponse`, the outgoing request carries the configured rewrite
  model id verbatim, and the engineer model is never invoked

#### Scenario: Rewrite is metered
- **WHEN** a device rewrites a prompt and then reads back its usage
- **THEN** the rewrite call's tokens are included in the device's totals

#### Scenario: A rewrite model failure is honest
- **WHEN** the model client raises an auth failure (`401`) during a rewrite
- **THEN** the response is `502` with an `ApiError` body, and no `RewriteResponse` containing the unmodified
  input prompt is returned

#### Scenario: Clarify answers reach the rewrite
- **WHEN** a `RewriteRequest` carrying clarification answers is posted against a scripted model client
- **THEN** the answers appear in the outgoing model request, and the response validates as `RewriteResponse`

#### Scenario: Exhausted provider credit is a distinct refusal
- **WHEN** the model client raises a `402` during a rewrite call
- **THEN** the response is `503` with `error: 'budget_exhausted'`, not `502`, and a following rewrite request from any device is refused before any model call

#### Scenario: An upstream rewrite failure is a provider-unavailable refusal
- **WHEN** every rewrite attempt fails with a transport (network) failure
- **THEN** the response is `503` with `error: 'provider_unavailable'`, not `502`, and no `RewriteResponse` is returned

## ADDED Requirements

### Requirement: A failed model call is classified and logged with its status and error kind
The server SHALL give every model call that does not complete one closed `errorKind`: `server` (HTTP 5xx), `rate_limit` (429), `network` (transport or stream failure without status), `timeout` (signal aborted with a `TimeoutError` reason), `auth` (401), `credit` (402), `client` (other 4xx), `cancelled` (signal aborted otherwise) or `other`. Its `model call` line SHALL carry `errorKind` and the HTTP `status` when there was one, and still no message content.

#### Scenario: A mid-stream 503 frame
- **WHEN** a fake transport streams a few deltas and then a `data: {"error":{"code":503}}` frame
- **THEN** the `model call` line has outcome failed, `errorKind: 'server'` and `status: 503`

#### Scenario: Auth and credit failures carry their status
- **WHEN** the transport answers `401`, and separately `402`
- **THEN** the lines carry `errorKind: 'auth'` with `status: 401` and `errorKind: 'credit'` with `status: 402`

### Requirement: An upstream failure is exactly a server, rate-limit, network or timeout failure
A model call SHALL count as an upstream failure exactly when its `errorKind` is `server`, `rate_limit`, `network` or `timeout`: a client disconnect, the run-wide deadline (`cancelled`), `auth`, `credit`, `client` and `other` SHALL NOT. One shared function SHALL make this decision for the `model call` line, the pipeline's resend rule, the clarify and rewrite routes and the provider breaker, so they can never disagree.

#### Scenario: A client disconnect is not upstream
- **WHEN** a completion is aborted by its caller's signal with no timeout reason
- **THEN** the line has outcome aborted and `errorKind: 'cancelled'`, and the call is not upstream

#### Scenario: A per-call timeout is upstream
- **WHEN** a completion's signal is an `AbortSignal.timeout` that fires mid-stream
- **THEN** the line carries `errorKind: 'timeout'` and the call is upstream

#### Scenario: Auth and credit failures are not upstream
- **WHEN** a call fails with `401`, and another with `402`
- **THEN** neither is upstream, and a `503` and a `429` both are
