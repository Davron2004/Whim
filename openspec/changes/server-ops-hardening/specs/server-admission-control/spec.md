## ADDED Requirements

### Requirement: A policy check for a generation waiting in line is ledgered and daily-limited
When a generation finds every slot busy, the server SHALL admit a ledger row of kind `policy-check` before the content-policy check runs. The row is admitted against `WHIM_LIMIT_POLICY_CHECKS_PER_DEVICE_DAY` (default 30) and `WHIM_LIMIT_POLICY_CHECKS_PER_DAY` (default 800), and it uses the same atomic admission, UTC-midnight reset and `429 daily_limit` refusal as every other kind.

The row's id SHALL be the request's id followed by `:policy-check`, so it never collides with the generation's own row. The server SHALL settle the row with the check's result:
- `ok` for an allow (cached or not);
- `refused` with failure reason `content_policy` for a refusal;
- `unavailable` with failure reason `policy_unavailable` when no verdict was produced.

The row SHALL carry the check's tokens, generation ids and resolved cost. The server SHALL NOT refund a `policy-check` unit.

Admitting, settling or limiting this row SHALL NOT spend or refund a `generate` unit. The generation's own `generate` row is admitted only when it takes a slot, as before. A generation that takes a free slot without waiting SHALL NOT write a `policy-check` row: its check stays attributed to its `generate` row.

#### Scenario: A join-and-abort loop is bounded
- **WHEN** every slot is busy and one device repeatedly starts a generation and aborts it while it waits
- **THEN** after `WHIM_LIMIT_POLICY_CHECKS_PER_DEVICE_DAY` attempts that day the next one is refused with `429 daily_limit` before any classifier call, and the device's `generate` count is unchanged

#### Scenario: Fresh device ids are bounded globally
- **WHEN** `WHIM_LIMIT_POLICY_CHECKS_PER_DAY` `policy-check` rows have been admitted today across all devices
- **THEN** the next generation that finds every slot busy is refused with `429 daily_limit` before any classifier call

#### Scenario: An unavailable check in line leaves a row with its cost
- **WHEN** a generation waiting in line gets no verdict from the classifier
- **THEN** the response is `503 policy_unavailable`, a `policy-check` row with outcome `unavailable` and reason `policy_unavailable` carries the classifier's tokens, and no `generate` row exists for the request

#### Scenario: A refusal in line spends a check unit, not a generation
- **WHEN** a generation waiting in line is refused by the content policy
- **THEN** its `policy-check` row has outcome `refused`, and no `generate` unit was spent or refunded

#### Scenario: The free-slot path is unchanged
- **WHEN** a generation takes a free slot at once and its policy check allows it
- **THEN** no `policy-check` row exists, and the check's tokens are attributed to the `generate` row
