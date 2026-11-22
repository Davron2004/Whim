## MODIFIED Requirements

### Requirement: Only an allowlisted projection of an error record leaves the device
The device SHALL send a log record off the phone only as its projection onto a closed diagnostic
shape, computed after the seam's redaction. The batch body SHALL carry exactly `osVersion`
beyond its records; platform, app version and build travel in the request envelope
(`request-envelope`). Each record SHALL carry exactly `at`, `level`,
`channel`, `message`, and a subset of the allowlisted fields `screen`, `errorClass`, `where`,
`stage`, `reason`, `kind`, `status`, `errorCode`, `domain`, `readyState`,
`observedRepairAttempts`, `requestId`, `route`, `count`, `stack`, `exposure` and `webview`;
every other field SHALL be dropped. `exposure` and `webview` SHALL appear only on the bridge-exposure
record, `exposure` SHALL match its closed grammar and `webview` SHALL be an engine name and major
version only (`chrome-<n>` or `webkit`). String values SHALL be capped at 128 characters, except `stack`, which SHALL be capped at
4 KB with its first line removed. `route` SHALL be a path only, never a URL with a host or query.
A record originating in a mini-app SHALL NOT carry `stack` or any message text; its error name
SHALL travel as `errorClass`, mapped onto a closed set of built-in JavaScript error names
(`Error`, `TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `EvalError`, `URIError`,
`AggregateError`) with any other name sent as `Other` (#63 B9). No device id, prompt, answer, plan,
app name, generated source, report note or stored user data SHALL appear in a projection.

#### Scenario: Unknown fields are dropped
- **WHEN** a record with fields `detail`, `url`, `appId` and `errorClass` is projected
- **THEN** the projection carries `errorClass` and none of `detail`, `url`, `appId`

#### Scenario: A stack loses its message line
- **WHEN** a host error whose stack begins `TypeError: cannot read 'total' of undefined` is projected
- **THEN** the projected `stack` starts at the first frame and the message text appears nowhere in
  the projection

#### Scenario: A mini-app error carries only its class and site
- **WHEN** a mini-app throws `new Error("Alice owes 40")` after mount
- **THEN** the projection carries `where: "runtime"` and `errorClass: "Error"`, and "Alice" appears
  nowhere in the batch

#### Scenario: A mini-app error name built from saved data never leaves
- **WHEN** a mini-app throws an error whose `name` is set from a saved record, such as
  `Object.assign(new Error("x"), { name: "Alice owes 40" })`
- **THEN** the projection carries `errorClass: "Other"`, and "Alice" appears nowhere in the batch

#### Scenario: A full URL is reduced to its path
- **WHEN** a transport error on `https://api.example/v1/generate?x=1` is projected
- **THEN** `route` is `/v1/generate`

#### Scenario: A failure sentence built from model output travels only as a closed code
- **WHEN** a generation ends in a failure whose sentence names screens from the user's plan (e.g. "repeated: Alice's Lisbon Tab")
- **THEN** the uploaded record's `reason` is a closed code, and no word of the sentence appears in the body

#### Scenario: Exposure fields outside the exposure record are dropped
- **WHEN** an ordinary error record carries an `exposure` or `webview` field
- **THEN** the projection carries neither

### Requirement: Error-level records are uploaded, batched, deduplicated and capped
The diagnostics transport SHALL be a transport of the logging seam and SHALL forward only
`error`-level records from the seam; the only non-error record it uploads is the `info`-level
bridge-exposure record, which the host enqueues already projected. It SHALL deduplicate by
`(channel, message, errorClass, where)` within one app session, and the bridge-exposure record by
`(message, exposure, webview)`, incrementing `count` on the retained record instead of adding another. It SHALL hold
at most 50 distinct records per session and SHALL drop records beyond that. It SHALL flush at 20
pending records, every 30 seconds, and when the app moves to the background. Each flush SHALL be
one `POST /v1/diagnostics` attempt with no retry; a failure SHALL be recorded in the ring buffer
on the sink channel, SHALL NOT surface to the user, and SHALL NOT recurse into another upload.

#### Scenario: A repeating error is one record
- **WHEN** the same mini-app error fires 300 times inside one flush interval
- **THEN** that flush carries one record for it with `count` 300

#### Scenario: Repeats after a flush report only the new count
- **WHEN** an error already flushed with `count` 5 fires 3 more times in the same session
- **THEN** the next flush carries it once with `count` 3, and it still counts as one of the 50

#### Scenario: Warnings stay on the phone
- **WHEN** a `warn`-level record is emitted
- **THEN** no upload includes it

#### Scenario: A failed upload is invisible to the user
- **WHEN** the server is unreachable during a flush
- **THEN** no alert or error screen appears, the batch is not retried, and a delivery-failure
  record is in the ring buffer

#### Scenario: A refused upload pauses the session
- **WHEN** the diagnostics route answers `429`
- **THEN** no further upload is attempted until its delta-seconds `Retry-After` has passed, or for the rest of the session without one, and records produced meanwhile are discarded, not queued

## ADDED Requirements

### Requirement: Bridge-exposure results are uploaded under the error-details consent
The host SHALL upload each distinct navigated-frame exposure result (`webview-message-provenance`) as one `info`-level `bridge-exposure` record carrying `exposure` and `webview`, through the same consent gate as error records, and the record MUST NOT carry a token, a URL, an app id or any mini-app data.

#### Scenario: The exposure value uses a closed grammar
- **WHEN** a result is projected
- **THEN** `exposure` is `refused`, `timed-out` or `navigated:<visible>` (`<visible>` one of `none`, `android`, `ios`, `android+ios`), with `+canary` appended when the canary reached native code, and `webview` is `chrome-<major>` or `webkit`

#### Scenario: One record per distinct result per session
- **WHEN** four pool WebViews in one session each report `navigated:none` on `chrome-131`
- **THEN** the session uploads one `bridge-exposure` record for that result with `count` 4

#### Scenario: A changed result is a new record
- **WHEN** a later page load in the same session reports `navigated:android+canary`
- **THEN** it is uploaded as its own record, not merged into the earlier one

#### Scenario: No consent, no exposure upload
- **WHEN** the error-details switch is off, or no current consent grant exists, and an exposure result is recorded
- **THEN** nothing is sent, and the result is not sent after consent or the switch is later turned on
