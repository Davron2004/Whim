## MODIFIED Requirements

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
