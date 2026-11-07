## MODIFIED Requirements

### Requirement: The ledger records a closed failure code
The usage ledger SHALL gain a nullable `failure_reason` column, added without rewriting existing
rows. For a request that ends in failure or refusal it SHALL hold the pipeline's terminal reason
code, a request failure code (`model_failure`, `internal_error`) or the refusal code; for any other
outcome it SHALL be null. A value outside those closed code
sets SHALL be rejected on write, so the ledger still holds no content. The operator `usage` command
SHALL report counts per failure reason.

#### Scenario: A failed row names its reason
- **WHEN** a generation ends with a repair-exhausted failure
- **THEN** its ledger row's `failure_reason` is the repair-exhausted code

#### Scenario: Free text is refused
- **WHEN** a caller tries to settle a row with a failure reason that is not a known code
- **THEN** the write is rejected and the row keeps a null reason

#### Scenario: A provider outage is named
- **WHEN** a generation ends because its engineer turn failed upstream twice, and a clarify request is answered `503 provider_unavailable`
- **THEN** both ledger rows record `provider_unavailable`, and the operator `usage` command counts them under that reason

### Requirement: The owner is alerted by email
`deploy/provision.sh` SHALL create or update, by display name, one email notification channel for
the operator-configured alert address and the following, so rerunning it changes nothing when
nothing changed: an uptime check on the API host's `/healthz` from at least three regions with an
alert after two consecutive failures; log-based alerts for an accepted report, for more than five
terminal generation failures in one hour, for a `budget_exhausted` refusal, for the provider breaker
opening (the `provider breaker open` log line), and for a device
diagnostic at `ERROR` or above, each rate-limited; and a billing budget on the configured billing
account with notifications at 50, 90 and 100 percent of the configured monthly amount. The policy
definitions SHALL be committed files under `deploy/monitoring/`. A report alert SHALL carry only
the report id and reason.

#### Scenario: A report sends an email
- **WHEN** a user sends a report
- **THEN** the alert address gets an email naming the report id and reason within five minutes, and
  the email contains no note, prompt, app name or source

#### Scenario: The API going down sends an email
- **WHEN** `/healthz` fails from the uptime checkers twice in a row
- **THEN** the alert address gets an email

#### Scenario: Rerunning provisioning is a no-op
- **WHEN** `provision.sh` runs twice with the same configuration
- **THEN** the second run creates no duplicate channel, check, policy or budget

#### Scenario: A provider outage sends one email an hour
- **WHEN** the provider breaker opens, closes and opens again within the same hour
- **THEN** the committed `deploy/monitoring/policy-provider-breaker-open.json` matches `jsonPayload.msg="provider breaker open"` on the `whim-server` Cloud Run revision's logs, and its notification rate limit is 3600 seconds

## ADDED Requirements

### Requirement: A breaker refusal is marked on the request log line
The request log line of a `provider_unavailable` refusal made by an open provider breaker SHALL carry `refusedBy: 'breaker'`, and no other request line SHALL carry that field, so the refusal can be told from a `provider_unavailable` that clarify or rewrite came to mid-call.

#### Scenario: A breaker refusal is distinguishable
- **WHEN** an open breaker refuses a generate request, and separately a clarify call fails upstream mid-call
- **THEN** both request lines show status `503` and `error: provider_unavailable`, and only the first carries `refusedBy: 'breaker'`
