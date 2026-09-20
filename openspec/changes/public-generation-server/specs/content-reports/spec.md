## ADDED Requirements

### Requirement: Devices can report content with POST /v1/report
The server SHALL expose `POST /v1/report`, gated by the same `/v1` device-identity middleware as every other `/v1` route, which SHALL validate its body as the contract's `ReportRequest` and SHALL answer an accepted report with HTTP `202` and a body that validates as `ReportResponse` (`{ reportId }`).

A body that fails validation SHALL receive `400` with an `ApiError`, including a `note` over 1000 characters, an `appName` over 200 characters, or an unknown `reason`. The route SHALL make no model call and SHALL NOT run the content policy check, since a report of objectionable content must never be refused for containing it. `reportId` SHALL be an unguessable server-generated identifier.

#### Scenario: A report is accepted
- **WHEN** a device posts `{ reason: 'offensive', note: 'rude jokes', appName: 'Joke Box', prompt: '…', source: '…' }` with its device header
- **THEN** the response is `202` with a body that validates as `ReportResponse`, and no model call is made

#### Scenario: A minimal report is accepted
- **WHEN** a device posts `{ reason: 'broken' }`
- **THEN** the response is `202` with a `reportId`

#### Scenario: An over-long note is a shape error
- **WHEN** a report's `note` is 1001 characters
- **THEN** the response is `400` with an `ApiError` body and nothing is stored

#### Scenario: The route is gated like every /v1 route
- **WHEN** `POST /v1/report` is called without `x-whim-device`
- **THEN** the response is `400` before the handler runs, and the whole-route-table gate assertion covers this route

### Requirement: Report payloads and volume are bounded
The report route SHALL refuse a raw body over `WHIM_MAX_BODY_BYTES_REPORT` (default 512 KiB), a `prompt` over `WHIM_MAX_PROMPT_BYTES` UTF-8 bytes, and a `source` over `WHIM_MAX_REPORT_SOURCE_BYTES` UTF-8 bytes (default 256 KiB), each with `413 payload_too_large`.

It SHALL count reports as the `report` kind in the admission ledger. A device over `WHIM_LIMIT_REPORTS_PER_DEVICE_DAY` (default 10) receives `429 daily_limit` with `Retry-After`, and any device receives `429 server_busy` with `Retry-After` once the day's `WHIM_LIMIT_REPORTS_PER_DAY` (default 300) is reached. A refused report SHALL store nothing.

#### Scenario: An oversized source is refused whole
- **WHEN** a report carries a 300 KiB `source`
- **THEN** the response is `413` with `error: 'payload_too_large'` and no report row exists

#### Scenario: Report spam from one device is capped
- **WHEN** a device posts its eleventh report of the UTC day with the default limit
- **THEN** the response is `429 daily_limit` with a `Retry-After` header, and only ten reports from that device are stored

### Requirement: Reports are the only stored user content, kept in their own store
Accepted reports SHALL be stored in a report store of their own, a SQLite database file `reports.db` under `WHIM_DATA_DIR`, separate from the usage database.

Each row SHALL hold only: `reportId`, the received timestamp, the device id, `reason`, and whichever of `note`, `appName`, `prompt`, and `source` the user sent. The server SHALL NOT enrich a report with any other content (no server-side lookup of prompts, runs, or bundles, since none is stored). The data directory SHALL be created with owner-only permissions, and the report database file SHALL NOT be readable by other users. This store is the single deliberate exception to the rule that the server persists no request content, and it holds only what a user explicitly chose to send.

#### Scenario: A stored report holds exactly what was sent
- **WHEN** a report with `reason`, `note`, and `prompt` but no `source` or `appName` is accepted and its row is read back
- **THEN** the row holds that `reason`, `note`, and `prompt`, empty `source` and `appName`, the device id, and a timestamp, and nothing else

#### Scenario: Report content never enters the usage database
- **WHEN** a report carrying distinctive marker text is accepted
- **THEN** the marker appears in `reports.db` and nowhere in the usage database

### Requirement: Reports expire after a retention period
The server SHALL delete every report older than `WHIM_REPORT_RETENTION_DAYS` (default 90 days). The purge SHALL run at startup and at least hourly while running, and the operator command SHALL be able to run it on demand.

A purge SHALL remove the rows and SHALL reclaim their storage, so deleted content does not linger in free pages.

#### Scenario: An expired report is purged
- **WHEN** the store holds a report received 91 days ago and one received yesterday, and a purge runs with the default retention
- **THEN** only yesterday's report remains

#### Scenario: Retention is configurable
- **WHEN** `WHIM_REPORT_RETENTION_DAYS` is `30` and a purge runs over a report received 31 days ago
- **THEN** that report is deleted

### Requirement: The operator can list and read reports from the VM
The server package SHALL provide an operator command, runnable inside the production container while the server is running, with three subcommands. `reports list` SHALL print, newest first and bounded by `--since <days>` and `--limit <n>`, each report's id, received time, reason, app name, note, and the byte sizes of any `prompt` and `source`, without the prompt or source text. `reports show <id>` SHALL print one report in full. `reports purge` SHALL apply the retention period now.

`list` and `show` SHALL support JSON output. None of the subcommands SHALL require the server to stop, and a concurrent report write SHALL still succeed.

#### Scenario: Listing hides bulky content
- **WHEN** the operator runs `reports list --since 7`
- **THEN** each line shows id, time, reason, app name, note, and content sizes, and no prompt or source text is printed

#### Scenario: Showing one report prints everything sent
- **WHEN** the operator runs `reports show <id>` for a report carrying prompt and source
- **THEN** the full prompt and source are printed

#### Scenario: Listing while the server accepts reports
- **WHEN** `reports list` runs while the server accepts a new report
- **THEN** both complete successfully

### Requirement: Report handling logs no report content
The server SHALL log each accepted report as one record carrying the `reportId`, `reason`, and the byte sizes of any `prompt` and `source`, and SHALL NOT log the note, app name, prompt, source, or device id.

A refused report SHALL log its refusal code only.

#### Scenario: The log line is content-free
- **WHEN** a report carrying marker text in every free-text field is accepted and the log output is inspected
- **THEN** one record carries the id, reason, and sizes, and no marker text or device id appears in any record
