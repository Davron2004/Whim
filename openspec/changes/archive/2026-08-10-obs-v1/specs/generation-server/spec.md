## MODIFIED Requirements

### Requirement: Server workspace and runtime
The repo SHALL provide an npm workspace `server/` (package `@whim/server`): a Node 22 HTTP
service whose runtime dependencies are exactly `hono`, `@hono/node-server`, `pino`, and
`@whim/contract` (+`zod` via the contract). `pino-pretty` SHALL be a dev dependency only — the
service SHALL run with structured JSON output when it is absent. The workspace MUST NOT depend on
`react`, `react-dom`, or anything React-Native-adjacent (the workspace-hoist safety rule).
Dev/test execution SHALL follow the repo's esbuild-bundle-then-run idiom (`npm run server:dev`,
`npm run server:test`) with no new test framework. The dev server SHALL bind `0.0.0.0` on
`WHIM_SERVER_PORT` (default 8787) so LAN devices can reach it; TLS and deployment are out of
scope.

#### Scenario: LAN-reachable dev server
- **WHEN** `npm run server:dev` starts on the dev machine
- **THEN** a client on the same LAN can `GET /healthz` over plain HTTP and receive `200`

#### Scenario: Dependency budget enforced
- **WHEN** the suite inspects `server/package.json`
- **THEN** runtime deps are exactly the allowed set, `pino-pretty` appears only under dev
  dependencies, and anything React-adjacent fails the test

#### Scenario: The service runs without the pretty printer
- **WHEN** the server starts in an environment where `pino-pretty` is not installed
- **THEN** it starts normally and emits structured JSON log lines

## ADDED Requirements

### Requirement: Server logging is structured and redacted at the serializer
Server logging SHALL go through one `pino` logger. The two ad-hoc `[whim-server]` console helpers
SHALL be removed, not wrapped: per-request logging and per-run pipeline breadcrumbs SHALL become
child loggers carrying their scope as a field, and each breadcrumb SHALL pass named fields rather
than a pre-formatted string.

The privacy floor SHALL be enforced by pino's `redact` configuration rather than by convention:
prompt text, generated mini-app source, the `x-whim-device` value, and the model-provider API key
SHALL be unreachable in emitted output even when a caller passes them, and SHALL be replaced with a
fixed marker. Redaction SHALL apply to the whole logger, so a new call site inherits it without
opting in.

In development the pretty transport SHALL be used for human reading; in its absence the logger
SHALL emit JSON. Logging SHALL NOT be added inside any response-path hot loop — SSE token emission
stays untouched.

#### Scenario: A request line carries fields
- **WHEN** a request completes
- **THEN** one record is emitted carrying method, path, status, and duration as named fields, and
  the SSE body's drain time is what the duration measures

#### Scenario: A sensitive field cannot be logged
- **WHEN** a caller passes prompt text, a device id, or the API key in a log payload
- **THEN** the serialized output carries the redaction marker in that field's place and the value
  appears nowhere in the output

#### Scenario: The old helpers are gone
- **WHEN** the server source is scanned for the retired `[whim-server]` console helpers
- **THEN** neither is defined nor called

#### Scenario: Token emission is not logged
- **WHEN** a generation streams many `token` events
- **THEN** no per-token record is emitted

### Requirement: A dev-only log-sink route persists batched device records
The server SHALL expose a log-sink route that accepts a batch of device log records and appends
them to a file, one JSON record per line, so device diagnostics survive logcat's ~4 KB truncation.

The route SHALL be **off by default** and SHALL exist only when explicitly enabled by environment
configuration; when disabled it SHALL NOT be mounted and a request to it SHALL yield `404`. It
SHALL NOT be mounted under `/v1`, so the invariant that every `/v1` route is gated by
`x-whim-device` is untouched and no ungated product surface is created. It SHALL bound the accepted
body size and the number of records per batch, rejecting an over-large batch with a structured
error rather than writing a partial file. A malformed batch SHALL be rejected without writing
anything.

Records SHALL be appended exactly as received, after the same redaction the server logger applies,
and the destination file SHALL be excluded from version control. A repo script SHALL tail that
file for a human reader.

#### Scenario: Disabled by default
- **WHEN** the server starts without the log-sink environment flag
- **THEN** a POST to the log-sink route returns `404` and no file is created

#### Scenario: A batch is appended
- **WHEN** the route is enabled and a valid batch of records is posted
- **THEN** the response is a success status with no body content, and the file gains one JSON line
  per record in the order they were sent

#### Scenario: The route is not under the device gate's prefix
- **WHEN** the route table is inspected
- **THEN** the log-sink path is not under `/v1`, and every `/v1` route still requires
  `x-whim-device`

#### Scenario: An over-large batch is refused whole
- **WHEN** a batch exceeding the configured record or byte bound is posted
- **THEN** the response is a structured error and the file is unchanged

#### Scenario: A malformed batch writes nothing
- **WHEN** a body that is not a valid record batch is posted
- **THEN** the response is a structured error and the file is unchanged
