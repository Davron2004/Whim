## ADDED Requirements

### Requirement: A transient classifier failure is retried once inside the policy deadline
The policy check SHALL make at most two classifier attempts within one overall deadline of `WHIM_POLICY_TIMEOUT_MS` (default 10000), and SHALL bound each attempt by the smaller of `WHIM_POLICY_ATTEMPT_TIMEOUT_MS` (default 4500) and the deadline's remaining time.

A second attempt SHALL start only when all three of these hold:
- the first attempt ended in an unable-to-verdict condition (attempt timeout, transport error, rate-limit or provider `5xx`, malformed output, or an unknown verdict value);
- the request has not been aborted;
- at least 1000 ms of the deadline remain.

An `allow` or `refuse` verdict SHALL never be retried. An auth error SHALL never be retried. When no attempt yields a verdict, the check SHALL fail closed exactly as before, with `503 policy_unavailable`.

Every attempt that reached the provider SHALL be credited to the calling device. Its generation id SHALL be attributed to the gated request's ledger row. The check's log record SHALL carry the number of attempts and no checked text.

#### Scenario: A hung first attempt no longer fails the request
- **WHEN** a scripted classifier never answers its first attempt and answers `{"verdict":"allow"}` on its second
- **THEN** the request proceeds within `WHIM_POLICY_TIMEOUT_MS`, the log record shows `attempts: 2`, and both attempts' usage is credited

#### Scenario: Two failures still fail closed within the deadline
- **WHEN** both attempts time out
- **THEN** the response is `503 policy_unavailable` no later than `WHIM_POLICY_TIMEOUT_MS` after the check began, and the pipeline is never invoked

#### Scenario: A refusal is not retried
- **WHEN** the first attempt returns a `refuse` verdict
- **THEN** exactly one classifier call is made and the request is refused with `422 content_policy`

#### Scenario: A client that left is not retried for
- **WHEN** the request is aborted while the first attempt is pending
- **THEN** no second attempt is made
