## ADDED Requirements

### Requirement: Request bodies and prompts are size-capped before any work
The server SHALL refuse an over-sized request with HTTP `413` and an `ApiError` body whose `error` is `payload_too_large`, before any JSON parsing of an over-sized body, any model call, or any stream opens.

Two caps apply. A raw body byte cap is enforced per route while the body is read, whether or not the client sent `Content-Length`, so a chunked body is counted as it arrives and never buffered past the cap: `/v1/clarify` and `/v1/rewrite` 64 KiB, `/v1/generate` 1 MiB, `/v1/report` 512 KiB. After the body validates, a UTF-8 byte cap of 16 KiB applies to the `prompt` field of every route that carries one. Both caps SHALL be environment-configurable.

The hint SHALL be a user-facing sentence saying the request was too long. It SHALL NOT name a field, a byte count, or an internal limit name.

#### Scenario: An over-sized body is refused unread
- **WHEN** a client posts a 2 MiB body to `/v1/generate` with a valid device header
- **THEN** the response is `413` with `error: 'payload_too_large'`, no model call is made, and no SSE stream opens

#### Scenario: A chunked body without Content-Length is still capped
- **WHEN** a client streams a chunked body larger than the `/v1/clarify` cap without a `Content-Length` header
- **THEN** the response is `413` and the server stops reading once the cap is exceeded

#### Scenario: A long prompt inside a small body is refused
- **WHEN** a valid `RewriteRequest` whose `prompt` is 20 KiB of UTF-8 is posted
- **THEN** the response is `413` with `error: 'payload_too_large'` and no model call is made

#### Scenario: A request under every cap proceeds
- **WHEN** a valid `ClarifyRequest` with a 2 KiB prompt is posted
- **THEN** no size refusal occurs and the request continues to the next admission check

### Requirement: A device runs at most one generation at a time
The server SHALL refuse `/v1/generate` with HTTP `429` and `error: 'device_busy'` when the calling device already holds a running generation, and the refusal SHALL carry no `Retry-After` header.

The generation slot SHALL be held from admission until the stream ends, and released exactly once on every ending path: a terminal event, a client cancel, a TCP disconnect, a server error, the run's wall-clock budget, or a drain abort. A refused, failed, or policy-rejected admission SHALL release any slot it took before responding.

#### Scenario: A second concurrent generation is refused
- **WHEN** a device has a generation streaming and posts a second `/v1/generate`
- **THEN** the second response is `429` with `error: 'device_busy'` and no `Retry-After` header, and the first stream is unaffected

#### Scenario: A finished generation frees the device
- **WHEN** a device's generation emits its terminal event and the device immediately posts another generation
- **THEN** the new generation is not refused as `device_busy`

#### Scenario: A policy refusal frees the slot
- **WHEN** a device's generation is refused by the content policy
- **THEN** the device's next generation request is not refused as `device_busy`

### Requirement: Global concurrency caps protect the server
The server SHALL refuse admission with HTTP `429` and `error: 'server_busy'` when the number of running generations has reached the configured global generation cap, or the number of in-flight clarify/rewrite requests has reached the configured global unary cap.

These refusals SHALL carry no `Retry-After` header, because no retry time is knowable. A request refused by a cap SHALL consume no daily-limit unit.

#### Scenario: The generation cap is reached
- **WHEN** the global generation cap is 3, three generations from three devices are running, and a fourth device posts `/v1/generate`
- **THEN** the fourth response is `429` with `error: 'server_busy'`, no `Retry-After` header, and the fourth device's daily count is unchanged

#### Scenario: Capacity returns when a generation ends
- **WHEN** one of the three running generations ends and the fourth device retries
- **THEN** the retry is admitted past the concurrency check

### Requirement: Per-device daily limits reset at UTC midnight
The server SHALL count each device's admitted requests per kind (`generate`, `clarify`, `rewrite`, `report`) per UTC calendar day, and SHALL refuse a request whose device has reached that kind's daily limit with HTTP `429`, `error: 'daily_limit'`, and a `Retry-After` header.

`Retry-After` SHALL be the whole number of seconds until the next 00:00 UTC, and at least 1. A unit SHALL be consumed atomically at admission, so two concurrent requests cannot both take the last unit. A consumed unit SHALL be refunded only when the content policy check could not run (`policy_unavailable`). A unit is not refunded on a policy refusal, a pipeline failure, a client cancel, or a disconnect. Counts SHALL be durable and survive a server restart.

#### Scenario: The limit is enforced with a knowable retry time
- **WHEN** a device with a daily generation limit of 15 has 15 admitted generations today and posts another at 22:00:00 UTC
- **THEN** the response is `429` with `error: 'daily_limit'` and `Retry-After: 7200`

#### Scenario: The day rolls over
- **WHEN** the same device posts a generation at 00:00:01 UTC the next day
- **THEN** it is not refused as `daily_limit`

#### Scenario: Counts survive a restart
- **WHEN** a device reaches its daily clarify limit and the server restarts
- **THEN** the device's next clarify request the same UTC day is refused as `daily_limit`

#### Scenario: An unavailable policy check refunds the unit
- **WHEN** a generation is admitted, its policy check returns `policy_unavailable`, and the device retries after the check recovers
- **THEN** the refused attempt did not reduce the device's remaining daily generations

#### Scenario: The last unit cannot be taken twice
- **WHEN** a device with one clarify unit left today sends two clarify requests concurrently
- **THEN** exactly one of the two is admitted and the other is refused as `daily_limit`

### Requirement: Global daily ceilings bound total spend
The server SHALL refuse `/v1/generate` with HTTP `429`, `error: 'server_busy'`, and a `Retry-After` header set to the whole seconds until the next 00:00 UTC, once the configured global number of admitted generations for the current UTC day has been reached. The same rule SHALL apply to `/v1/report` with its own global ceiling.

The global ceiling SHALL be checked in the same atomic admission step as the device limit, so it can never be overshot by concurrent requests. When both the device limit and the global ceiling are exhausted, the device limit's `daily_limit` refusal SHALL win.

#### Scenario: The global ceiling closes the day for everyone
- **WHEN** the global daily generation ceiling is 400 and 400 generations were admitted today across many devices
- **THEN** a device with unused daily allowance receives `429`, `error: 'server_busy'`, and a `Retry-After` equal to the seconds until 00:00 UTC

#### Scenario: Rotating device ids does not bypass the ceiling
- **WHEN** a client sends generations under 500 freshly minted device UUIDs on one UTC day with the ceiling at 400
- **THEN** no more than 400 generations are admitted that day

### Requirement: The server refuses admission when the operator's provider credit is exhausted
The server SHALL check the operator's OpenRouter key credit before any model work on `/v1/clarify`, `/v1/rewrite`, and `/v1/generate`, placed immediately after the size and device-identity checks and before drain state, concurrency, and daily-unit accounting. It SHALL query `GET https://openrouter.ai/api/v1/key` and read `data.limit_remaining` (`null` meaning the key carries no limit), caching the result in memory for a configurable TTL (`WHIM_CREDIT_CACHE_TTL_MS`, default 60000) so the lookup is not made on every request.

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
For `/v1/clarify`, `/v1/rewrite`, and `/v1/generate` the server SHALL apply its checks in this order and stop at the first refusal: device identity (`400`), raw body cap (`413`), body validation (`400`), prompt byte cap (`413`), operator credit (`503 budget_exhausted`), drain state (`429 server_busy`), device generation exclusivity (`429 device_busy`, generate only), global concurrency cap (`429 server_busy`), daily units (`429 daily_limit`, then `429 server_busy` for a global ceiling), content policy (`422 content_policy` / `503 policy_unavailable`), then the route's work.

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

### Requirement: Every refusal is a structured, user-facing ApiError
Every `413`, `422`, `429`, and `503` body produced by admission control or the content policy SHALL validate as `ApiError`, its `error` SHALL be a member of the contract's `ServiceRefusalCode`, and its `hint` SHALL be one user-facing sentence.

The hint SHALL contain no internal identifiers, limit names, environment variable names, model names, or policy category names. `Retry-After`, when present, SHALL be an integer number of seconds. It SHALL be present exactly on refusals whose retry time is knowable: `daily_limit` and a global-ceiling `server_busy`.

#### Scenario: Every refusal body validates
- **WHEN** each refusal the admission and policy suites can provoke is parsed with `ApiError` and its `error` with `ServiceRefusalCode`
- **THEN** every body validates and every hint is non-empty and free of internal identifiers

#### Scenario: Retry-After appears only when knowable
- **WHEN** a `device_busy` refusal, a concurrency `server_busy` refusal, and a `daily_limit` refusal are inspected
- **THEN** only the `daily_limit` refusal carries `Retry-After`

### Requirement: Admission limits are environment-configurable with public-beta defaults
Every admission limit SHALL be read once at startup from the environment through one typed configuration module, SHALL default to the public-beta value below when unset, and SHALL fail startup with an error naming the variable when set to anything other than a positive integer, except `WHIM_MIN_CREDIT_USD`, which SHALL be a non-negative decimal USD amount.

| Variable | Default |
|---|---|
| `WHIM_LIMIT_GENERATIONS_PER_DEVICE_DAY` | 15 |
| `WHIM_LIMIT_GENERATIONS_PER_DAY` | 400 |
| `WHIM_MAX_CONCURRENT_GENERATIONS` | 3 |
| `WHIM_SYNTHRUN_CONCURRENCY` | 2 |
| `WHIM_LIMIT_CLARIFY_PER_DEVICE_DAY` | 60 |
| `WHIM_LIMIT_REWRITE_PER_DEVICE_DAY` | 60 |
| `WHIM_MAX_CONCURRENT_UNARY` | 16 |
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

The time source used for UTC-day arithmetic SHALL be injectable, so tests can cross midnight without waiting.

#### Scenario: Defaults apply when unset
- **WHEN** the configuration module loads an environment that sets none of the variables
- **THEN** every limit equals its default in the table

#### Scenario: A bad value fails startup by name
- **WHEN** `WHIM_LIMIT_GENERATIONS_PER_DAY` is set to `lots`
- **THEN** configuration loading throws an error naming `WHIM_LIMIT_GENERATIONS_PER_DAY`, and no server starts

### Requirement: Unary model calls have a bounded lifetime
The server SHALL abort a clarify or rewrite model call that has not completed within `WHIM_UNARY_MODEL_TIMEOUT_MS`, and SHALL answer it with that route's existing honest failure (`502` + `ApiError`), never with a partial or fabricated result.

A timed-out call SHALL release its global unary slot, and its provider generation id SHALL still reach usage resolution, so its cost is recorded.

#### Scenario: A stalled rewrite times out honestly
- **WHEN** the scripted model client never completes a rewrite stream and the timeout elapses
- **THEN** the response is `502` with an `ApiError` body, the transport observed the abort, and the global unary in-flight count is back to its prior value

### Requirement: The usage store keeps a content-free request ledger with resolved cost
The usage store SHALL record one ledger row per admitted request, holding only: a server-generated request id, the device id, the request kind, the UTC day, start and end timestamps, the outcome, prompt and completion token counts, the resolved cost in USD (or an explicit unresolved state), and a refunded flag.

The ledger SHALL live in the same durable store as the per-device token counter. It SHALL be the only source daily limits are enforced from. It SHALL NOT hold prompt text, clarification text, source, bundles, manifests, schemas, or any other request or response content.

Cost SHALL be resolved after the request ends, from the provider's generation-stats data for every provider generation id the request recorded. This includes the policy classification call, model calls of a cancelled or timed-out request, and every model call of a generation run. Resolution SHALL use a bounded number of attempts, a per-attempt timeout, and a total time budget. It SHALL mark the row unresolved on exhaustion rather than guessing. It SHALL never block or delay the response. Ledger rows older than `WHIM_LEDGER_RETENTION_DAYS` (default 90) SHALL be purged. The cumulative per-device token counter SHALL keep its existing semantics and its `/v1/usage` readback.

#### Scenario: A generation's cost is recorded
- **WHEN** a generation completes whose run made three model calls, and the injected stats transport returns `total_cost` 0.012, 0.030 and 0.004 for their ids
- **THEN** that request's ledger row carries cost 0.046 and outcome `delivered`, and the device's token counter was credited exactly once

#### Scenario: A cancelled generation still gets its cost
- **WHEN** a generation is cancelled after two model calls started and the stats transport resolves both ids
- **THEN** the ledger row's outcome is `aborted`, its cost is the sum of both, and the reconciled tokens are credited once

#### Scenario: Unresolvable cost is explicit
- **WHEN** the stats transport never returns a record within the resolution budget
- **THEN** the row is marked unresolved, no cost is invented, and no client-visible error occurs

#### Scenario: The ledger holds no content
- **WHEN** the usage database is inspected after clarify, rewrite, generate and report requests carrying distinctive marker text
- **THEN** no marker appears anywhere in the usage database file

### Requirement: The operator can read cost per generation, per device and per day
The server package SHALL provide an operator command that reads the usage store directly and prints, for a chosen number of recent UTC days: per-day admitted counts and total resolved cost by kind, the top devices by cost, and per-generation cost statistics (count, mean, median, 95th percentile, maximum, and the number of rows with unresolved cost). The output SHALL be available as plain text and as JSON.

The command SHALL run inside the production container while the server is running, without stopping it or corrupting the store. It SHALL print device ids only in the operator's own terminal and never write them to server logs.

#### Scenario: A usage summary over recent days
- **WHEN** the operator runs the usage command for the last 7 days against a store holding generations with resolved and unresolved costs
- **THEN** the output lists daily totals, the top devices by cost, and per-generation cost statistics, and it counts the unresolved rows separately

#### Scenario: Reading while the server writes
- **WHEN** the usage command runs while the server is admitting requests
- **THEN** the command completes and the server's concurrent admissions succeed
