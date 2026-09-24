## ADDED Requirements

### Requirement: Every /v1 request carries the client envelope
The app SHALL send four headers on every `/v1` request, built in the same place as `x-whim-device`:
`x-whim-platform` (`ios` or `android`), `x-whim-app-version` (the installed marketing version),
`x-whim-build` (the installed build number, a positive integer) and `x-whim-consent` (the consent
version the request is sent under, a positive integer, or `none` when no grant is required and
none exists). The version and build SHALL come from the installed app at run time, through a
native module, never from a constant committed to the repository. Requests outside `/v1` SHALL NOT
carry the envelope.

#### Scenario: A generate request carries the envelope
- **WHEN** a user with a current consent grant starts a build on an iOS build 381500
- **THEN** the `/v1/generate` request carries `x-whim-platform: ios`, `x-whim-build: 381500`,
  the installed marketing version, and `x-whim-consent` equal to the granted version

#### Scenario: A report without a grant says so
- **WHEN** a user who never granted consent sends a report
- **THEN** the `/v1/report` request carries `x-whim-consent: none`

#### Scenario: The build number is the installed one
- **WHEN** the same source is released as two builds with different build numbers
- **THEN** each installed build sends its own build number

### Requirement: The server reads the envelope and treats its absence as a legacy client
The server SHALL parse the envelope on every `/v1` request after the device gate. A request with
none of the four headers SHALL be treated as a legacy client with build `0` and consent version
`1`, and served as it would have been before the envelope existed. A request with some but not all
of the headers, or any malformed value, SHALL be refused with status `400` and an `ApiError`, before
any route admission.

#### Scenario: The demo build keeps working
- **WHEN** a build that predates the envelope sends a generate request and both minimum builds are
  `0`
- **THEN** the request is served exactly as before, and its response carries a request id

#### Scenario: A half envelope is refused
- **WHEN** a request carries `x-whim-build` but no `x-whim-platform`
- **THEN** the server answers `400` with an `ApiError` and runs no route admission

### Requirement: One request id follows a /v1 request everywhere
The server SHALL mint one UUID per `/v1` request before the device gate runs. It SHALL return that
id in an `x-whim-request-id` response header on every `/v1` response, including refusals from the
device gate, the envelope check, the minimum-build gate and admission, and including streamed
responses. It SHALL attach the id as `requestId` to every log line emitted while serving that
request, including the generation pipeline's terminal line, and SHALL use it as the usage ledger
row's id when the request is admitted. The header name SHALL be a constant exported by
`@whim/contract`. The app SHALL read the header on success and failure on every `/v1` call and
SHALL expose it on the call's result and on its error.

#### Scenario: A refusal carries the id
- **WHEN** a `/v1/generate` request is refused with `429`
- **THEN** the response has an `x-whim-request-id` header, the refusal's log line carries the same
  `requestId`, and the app's error for that call exposes the same id

#### Scenario: A failed generation joins up
- **WHEN** a generation ends in a terminal failure
- **THEN** the terminal failure log line, the ledger row id and the response header all carry the
  same id

#### Scenario: A device-gate refusal still has an id
- **WHEN** a `/v1` request has no `x-whim-device` header
- **THEN** the `400` response still carries `x-whim-request-id`

### Requirement: The server runs a practice only when the request's consent version covers it
The server SHALL hold a closed, append-only table that maps each consent version to the data
categories it covers, and SHALL run a practice that sends data to a model provider or stores data
only when the request's consent version covers that practice's category. A consent version above
the highest the server knows SHALL be read as the highest it knows. Clarify, rewrite and generate
SHALL require the category for request material; a request to them whose consent is `none` SHALL be
refused with the refusal code `consent_required`, status `403`, before any model work. Report SHALL
require no grant. Every route that sends data to a model or stores data SHALL declare its category,
and a static check SHALL fail when one does not.

#### Scenario: No grant, no model call
- **WHEN** a client sends a clarify request with `x-whim-consent: none`
- **THEN** the server answers `403` with `consent_required`, and no model is called

#### Scenario: A newer phone doesn't grant the server more
- **WHEN** a request carries a consent version higher than any the server knows
- **THEN** the server applies only the categories of the highest version it knows

#### Scenario: A route that forgets its category fails the build
- **WHEN** a new route that calls a model is added without declaring a category
- **THEN** the static check fails, naming the route

### Requirement: The refusal vocabulary gains the envelope's two codes
`ServiceRefusalCode` SHALL gain `update_required` and `consent_required`, additively, each with a
one-sentence user-facing hint that names no internal identifier. The app's refusal rules SHALL map
both, so that adding either without a rule fails the typecheck.

#### Scenario: The phone recognises both codes
- **WHEN** a response is refused with `update_required` or `consent_required`
- **THEN** the app's refusal mapping recognises it instead of treating it as an unknown failure

### Requirement: The phone's header names match the contract
The app SHALL keep its own literal header names, because contract values never enter the app
bundle, and a static check SHALL fail when any of them differs from the constant `@whim/contract`
exports.

#### Scenario: A renamed header is caught
- **WHEN** the contract's build header constant changes and the app's literal does not
- **THEN** the static check fails, naming the header

### Requirement: The request log line carries the envelope, never the device
The server's per-request log line SHALL carry `requestId`, `platform`, `appVersion`, `build` and
`consent` alongside method, path, status and duration, and SHALL NOT carry the device id.

#### Scenario: A request line is filterable by build
- **WHEN** a request from build 381500 completes
- **THEN** its log line carries `build: 381500` and no device id
