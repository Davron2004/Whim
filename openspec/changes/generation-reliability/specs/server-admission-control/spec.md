## MODIFIED Requirements

### Requirement: The server refuses admission when the operator's provider credit is exhausted
The server SHALL check the operator's OpenRouter key credit before any model work on `/v1/clarify`, `/v1/rewrite`, and `/v1/generate`, placed immediately after the provider breaker check (which itself follows the size and device-identity checks) and before drain state, concurrency, and daily-unit accounting. It SHALL query `GET https://openrouter.ai/api/v1/key` and read `data.limit_remaining` (`null` meaning the key carries no limit), caching the result in memory for a configurable TTL (`WHIM_CREDIT_CACHE_TTL_MS`, default 60000) so the lookup is not made on every request.

When the cached remaining credit is a number below a configurable floor (`WHIM_MIN_CREDIT_USD`, default 0.50), the server SHALL refuse with HTTP `503`, `error: 'budget_exhausted'`, and no `Retry-After` header, because the refill time is unknowable. A `budget_exhausted` refusal SHALL consume no daily-limit unit.

When the credit lookup itself fails — a transport error, a non-2xx response, or a malformed body — the server SHALL admit the request and log a warning, deliberately failing open. This is a departure from the content-policy check's fail-closed default (specs/content-policy): the provider's own `402` on the model call is the real backstop, so an unreachable credit lookup costs availability, not spend, if it fails open.

#### Scenario: Exhausted credit refuses before any model work
- **WHEN** the cached `limit_remaining` is `0.10` and `WHIM_MIN_CREDIT_USD` is `0.50`, and a device posts a valid `GenerateRequest`
- **THEN** the response is `503` with `error: 'budget_exhausted'`, no `Retry-After` header, no daily unit consumed, and no model or policy call made

#### Scenario: A key with no limit never refuses on budget
- **WHEN** the key lookup returns `data.limit_remaining: null`
- **THEN** no request is ever refused as `budget_exhausted`

#### Scenario: A lookup within the cache TTL is not repeated
- **WHEN** two admissions occur for different devices inside `WHIM_CREDIT_CACHE_TTL_MS` of each other
- **THEN** the key endpoint is queried once and both admissions use the cached value

#### Scenario: A failed lookup fails open with a warning
- **WHEN** the key endpoint call errors or returns an unparseable body
- **THEN** the request is admitted, a warning is logged, and no `budget_exhausted` refusal occurs for that request

### Requirement: Admission checks run in a fixed order before any model work
For `/v1/clarify`, `/v1/rewrite`, and `/v1/generate` the server SHALL apply its checks in this order and stop at the first refusal: device identity (`400`), raw body cap (`413`), body validation (`400`), prompt byte cap (`413`), provider breaker (`503 provider_unavailable`), operator credit (`503 budget_exhausted`), drain state (`429 server_busy`), device generation exclusivity (`429 device_busy`, generate only), global concurrency cap (`429 server_busy`), daily units (`429 daily_limit`, then `429 server_busy` for a global ceiling), content policy (`422 content_policy` / `503 policy_unavailable`), then the route's work.

For `/v1/report` the order SHALL be: device identity, raw body cap, body validation, prompt and source byte caps, drain state, daily units, then storage. No check after body validation SHALL be skipped for any route, and no model call or stream SHALL begin before the last check passes.

#### Scenario: Validation failures consume nothing
- **WHEN** a device posts a `GenerateRequest` that fails schema validation
- **THEN** the response is `400`, no daily unit is consumed, and no slot is held

#### Scenario: A busy device is not charged
- **WHEN** a device with a running generation posts another valid generation
- **THEN** the response is `429 device_busy` and the device's daily generation count is unchanged

#### Scenario: No model call precedes admission
- **WHEN** any refusal in the ordered list is returned
- **THEN** the scripted model client records no call for that request, including no policy classification call when the refusal precedes the policy step

#### Scenario: Exhausted credit is checked before concurrency and daily accounting
- **WHEN** the operator's credit is exhausted while the global concurrency cap and every device's daily allowance still have room
- **THEN** the refusal is `budget_exhausted`, not `server_busy` or `daily_limit`, and no slot is acquired

#### Scenario: An open breaker is checked before the credit lookup
- **WHEN** the provider breaker is open and the cached operator credit has expired
- **THEN** the refusal is `provider_unavailable`, the credit endpoint is not queried, no daily unit is consumed and no slot is acquired

### Requirement: Every refusal is a structured, user-facing ApiError
Every `413`, `422`, `429`, and `503` body produced by admission control or the content policy SHALL validate as `ApiError`, its `error` SHALL be a member of the contract's `ServiceRefusalCode`, and its `hint` SHALL be one user-facing sentence.

The hint SHALL contain no internal identifiers, limit names, environment variable names, model names, or policy category names. `Retry-After`, when present, SHALL be an integer number of seconds. It SHALL be present exactly on refusals whose retry time is knowable: `daily_limit`, a global-ceiling `server_busy`, and a `provider_unavailable` refused by an open provider breaker, where it is the seconds left in the breaker's cooldown, rounded up.

#### Scenario: Every refusal body validates
- **WHEN** each refusal the admission and policy suites can provoke is parsed with `ApiError` and its `error` with `ServiceRefusalCode`
- **THEN** every body validates and every hint is non-empty and free of internal identifiers

#### Scenario: Retry-After appears only when knowable
- **WHEN** a `device_busy` refusal, a concurrency `server_busy` refusal, and a `daily_limit` refusal are inspected
- **THEN** only the `daily_limit` refusal carries `Retry-After`

#### Scenario: An open-breaker refusal says when to retry
- **WHEN** the breaker opened 20 seconds ago with a 60-second cooldown and a generate request arrives
- **THEN** the `provider_unavailable` refusal carries `Retry-After: 40`, while a mid-call `provider_unavailable` from clarify carries none

### Requirement: Unary model calls have a bounded lifetime
The server SHALL abort a clarify or rewrite model call that has not completed within `WHIM_UNARY_MODEL_TIMEOUT_MS`, and SHALL answer it as an upstream failure (`503` + `ApiError` with `error: 'provider_unavailable'`), never with a partial or fabricated result.

A timed-out call SHALL release its global unary slot, and its provider generation id SHALL still reach usage resolution, so its cost is recorded.

#### Scenario: A stalled rewrite times out honestly
- **WHEN** the scripted model client never completes a rewrite stream and the timeout elapses
- **THEN** the response is `503` with an `ApiError` body whose `error` is `provider_unavailable`, the transport observed the abort, and the global unary in-flight count is back to its prior value

### Requirement: Admission limits are environment-configurable with public-beta defaults
Every admission limit SHALL be read once at startup from the environment through one typed configuration module, SHALL default to the public-beta value below when unset, and SHALL fail startup with an error naming the variable when set to anything other than a positive integer, except `WHIM_MIN_CREDIT_USD`, which SHALL be a non-negative decimal USD amount, and `WHIM_PROVIDER_BREAKER_FAILURES`, which SHALL be a non-negative integer where `0` disables the provider breaker.

| Variable | Default |
|---|---|
| `WHIM_LIMIT_GENERATIONS_PER_DEVICE_DAY` | 15 |
| `WHIM_LIMIT_GENERATIONS_PER_DAY` | 400 |
| `WHIM_MAX_CONCURRENT_GENERATIONS` | 3 |
| `WHIM_SYNTHRUN_CONCURRENCY` | 2 |
| `WHIM_LIMIT_CLARIFY_PER_DEVICE_DAY` | 60 |
| `WHIM_LIMIT_REWRITE_PER_DEVICE_DAY` | 60 |
| `WHIM_LIMIT_UNARY_PER_DAY` | 2000 |
| `WHIM_MAX_CONCURRENT_UNARY` | 16 |
| `WHIM_LIMIT_PROBE_CONCURRENCY` | 2 |
| `WHIM_LIMIT_REPORTS_PER_DEVICE_DAY` | 10 |
| `WHIM_LIMIT_REPORTS_PER_DAY` | 300 |
| `WHIM_MAX_BODY_BYTES_UNARY` | 65536 |
| `WHIM_MAX_BODY_BYTES_GENERATE` | 1048576 |
| `WHIM_MAX_BODY_BYTES_REPORT` | 524288 |
| `WHIM_MAX_PROMPT_BYTES` | 16384 |
| `WHIM_MAX_REPORT_SOURCE_BYTES` | 262144 |
| `WHIM_UNARY_MODEL_TIMEOUT_MS` | 60000 |
| `WHIM_GENERATION_MAX_MS` | 600000 |
| `WHIM_MIN_CREDIT_USD` | 0.50 |
| `WHIM_CREDIT_CACHE_TTL_MS` | 60000 |
| `WHIM_PROVIDER_BREAKER_FAILURES` | 4 |
| `WHIM_PROVIDER_BREAKER_WINDOW_MS` | 180000 |
| `WHIM_PROVIDER_BREAKER_COOLDOWN_MS` | 60000 |

The time source used for UTC-day arithmetic SHALL be injectable, so tests can cross midnight without waiting.

#### Scenario: Defaults apply when unset
- **WHEN** the configuration module loads an environment that sets none of the variables
- **THEN** every limit equals its default in the table

#### Scenario: A bad value fails startup by name
- **WHEN** `WHIM_LIMIT_GENERATIONS_PER_DAY` is set to `lots`
- **THEN** configuration loading throws an error naming `WHIM_LIMIT_GENERATIONS_PER_DAY`, and no server starts

#### Scenario: Zero disables the breaker, a negative count fails
- **WHEN** `WHIM_PROVIDER_BREAKER_FAILURES` is `0`, and separately `-1`
- **THEN** the first loads with the breaker disabled, and the second throws an error naming `WHIM_PROVIDER_BREAKER_FAILURES`

## ADDED Requirements

### Requirement: The provider breaker counts consecutive upstream failures
The server SHALL keep one in-memory provider breaker per process, fed with the outcome of every model call made through the one model client all roles share (policy, clarify, rewrite, plan, generate, repair, summary). A completed call SHALL reset the consecutive-failure count and close an open breaker; an upstream failure (specs/generation-server "An upstream failure is exactly a server, rate-limit, network or timeout failure") SHALL add one; any other outcome SHALL change nothing.

#### Scenario: A success in between resets the count
- **WHEN** three calls fail upstream, one completes, and three more fail upstream
- **THEN** the breaker stays closed

#### Scenario: Failures that are not upstream do not count
- **WHEN** four calls fail with `401`, `402`, a client cancel and a `400`
- **THEN** the breaker stays closed

### Requirement: The provider breaker opens for a cooldown and says so in the log
The breaker SHALL open when `WHIM_PROVIDER_BREAKER_FAILURES` consecutive upstream failures fall within `WHIM_PROVIDER_BREAKER_WINDOW_MS` of the first, and stay open for `WHIM_PROVIDER_BREAKER_COOLDOWN_MS`, on an injectable clock. Opening SHALL log one `provider breaker open` warning with the count, window, cooldown and last `errorKind` and `status`; closing SHALL log one `provider breaker closed` info line with how long it was open; neither SHALL carry content.

#### Scenario: Four upstream failures open it
- **WHEN** four model calls fail with `503` within three minutes and nothing completes in between
- **THEN** the breaker is open and one `provider breaker open` warning is logged, carrying no prompt, message, device id or model output

#### Scenario: Failures spread beyond the window do not open it
- **WHEN** four upstream failures arrive, the fourth more than `WHIM_PROVIDER_BREAKER_WINDOW_MS` after the first
- **THEN** the breaker stays closed

#### Scenario: A zero threshold disables it
- **WHEN** `WHIM_PROVIDER_BREAKER_FAILURES` is `0` and twenty calls fail upstream
- **THEN** the breaker never opens and no request is refused as `provider_unavailable` at admission

### Requirement: An open provider breaker refuses admission
While the provider breaker is open, `/v1/generate`, `/v1/clarify` and `/v1/rewrite` SHALL refuse at the breaker step with `503`, `error: 'provider_unavailable'`, the provider hint and `Retry-After` set to the seconds left in the cooldown, rounded up, consuming no daily unit, acquiring no slot and making no model or credit call.

#### Scenario: An outage is refused at once
- **WHEN** the breaker is open and a device posts a valid generation
- **THEN** the response is an immediate `503 provider_unavailable` with `Retry-After`, the device's daily count is unchanged, no slot is held and the scripted model client records no call

### Requirement: A lazy probe decides when the provider breaker closes
Once the cooldown has passed, the next admission SHALL start one probe: a call to the engineer model with one output token, reasoning off and a 10-second timeout, logged as its own `model call` line and credited to no device. Admissions arriving meanwhile SHALL await the same probe. A completed probe SHALL close the breaker and let them continue through admission; a failed one SHALL re-open it for another cooldown, log `provider probe failed` with its `errorKind` and `status`, and refuse them.

#### Scenario: A successful probe closes the breaker
- **WHEN** the cooldown has passed, a clarify request arrives, and the probe completes
- **THEN** one probe call is made to the engineer model with one output token and reasoning off, `provider breaker closed` is logged, and the clarify request is answered normally

#### Scenario: A failed probe re-opens the breaker
- **WHEN** the cooldown has passed and the probe fails with a `502`
- **THEN** the request is refused with `provider_unavailable` and a `Retry-After` equal to the full cooldown, and `provider probe failed` is logged

#### Scenario: Concurrent admissions share one probe
- **WHEN** three admissions arrive after the cooldown while the probe is still in flight
- **THEN** exactly one probe call is made and all three admissions follow its result
