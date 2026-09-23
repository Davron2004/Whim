## ADDED Requirements

### Requirement: Server logs reach Google Cloud Logging as structured entries
Every log line the server and Caddy containers write SHALL reach Google Cloud Logging in the
deployment's project within a minute, with pino's JSON fields queryable as structured payload
fields and its level mapped to Cloud Logging severity. Each pino line SHALL carry a `severity`
string (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`) alongside its numeric level. Shipping
SHALL run on the VM host, not inside a container, so the container egress rules and the
container's lack of metadata-server access stay as they are. `docker compose logs` on the VM SHALL
keep working. The serializer-level redaction SHALL be unchanged, so nothing it removes can reach
Cloud Logging.

#### Scenario: A field is queryable
- **WHEN** a generation fails on the deployed server
- **THEN** a Logs Explorer query on `jsonPayload.msg="terminal failure"` finds the line with its
  `reason` and `requestId` fields and severity `INFO`

#### Scenario: An error line has error severity
- **WHEN** the server logs at pino level `error`
- **THEN** the Cloud Logging entry's severity is `ERROR`

#### Scenario: Container egress is unchanged
- **WHEN** the boot self-test and smoke checks run after log shipping is installed
- **THEN** the container still cannot reach the metadata server and the smoke checks pass

### Requirement: One request id follows a /v1 request everywhere
The server SHALL mint one UUID per `/v1` request before device identity and admission run. It
SHALL return that id in an `x-whim-request-id` response header on every `/v1` response, including
refusals and streamed responses, SHALL attach it as `requestId` to every log line emitted while
serving that request, including the generation pipeline's terminal line, and SHALL use it as the
usage ledger row's id when the request is admitted. The header name SHALL be a constant exported
by `@whim/contract`. The device SHALL read the header and SHALL attach the id to any error record
about that request.

#### Scenario: A refusal carries the id
- **WHEN** a `/v1/generate` request is refused with `429`
- **THEN** the response has an `x-whim-request-id` header and the refusal's log line carries the same
  `requestId`

#### Scenario: A failed generation joins up
- **WHEN** a generation ends in a terminal failure
- **THEN** the terminal failure log line, the ledger row id, the response header, and the device's
  error record for it all carry the same id

### Requirement: The ledger records a closed failure code
The usage ledger SHALL gain a nullable `failure_reason` column, added without rewriting existing
rows. For a request that ends in failure or refusal it SHALL hold the pipeline's terminal reason
code or the refusal code; for any other outcome it SHALL be null. A value outside those closed code
sets SHALL be rejected on write, so the ledger still holds no content. The operator `usage` command
SHALL report counts per failure reason.

#### Scenario: A failed row names its reason
- **WHEN** a generation ends with a repair-exhausted failure
- **THEN** its ledger row's `failure_reason` is the repair-exhausted code

#### Scenario: Free text is refused
- **WHEN** a caller tries to settle a row with a failure reason that is not a known code
- **THEN** the write is rejected and the row keeps a null reason

### Requirement: The owner is alerted by email
`deploy/provision.sh` SHALL create or update, by display name, one email notification channel for
the operator-configured alert address and the following, so rerunning it changes nothing when
nothing changed: an uptime check on the API host's `/healthz` from at least three regions with an
alert after two consecutive failures; log-based alerts for an accepted report, for more than five
terminal generation failures in one hour, for a `budget_exhausted` refusal, and for a device
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

### Requirement: The server reports which commit it is running
`GET /healthz` SHALL include `commit`: the full 40-character git SHA the running image was built
from, baked into the image at build time from the same SHA that tags it, never read from anything
the deploy step sets at run time. An image not built by the release pipeline SHALL report
`"unknown"`. The boot log line SHALL carry the same `commit`. The smoke checks SHALL accept any
40-character SHA when run standalone, and when run by a deploy or rollback they SHALL fail unless
`commit` equals the SHA that deploy just rolled out.

#### Scenario: A deploy that didn't take is caught
- **WHEN** a deploy of commit B finishes but the container still runs the image for commit A
- **THEN** the smoke checks fail, naming both SHAs

#### Scenario: A rollback reports the old commit
- **WHEN** `deploy.sh --tag <A>` rolls back to commit A's image
- **THEN** `/healthz` reports commit A without any separate setting being changed

#### Scenario: A local build says so
- **WHEN** the server runs outside the release image
- **THEN** `/healthz` reports `"commit": "unknown"`
