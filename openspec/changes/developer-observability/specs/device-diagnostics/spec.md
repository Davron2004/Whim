## ADDED Requirements

### Requirement: Only an allowlisted projection of an error record leaves the device
The device SHALL send a log record off the phone only as its projection onto a closed diagnostic
shape, computed after the seam's redaction. The batch body SHALL carry exactly `osVersion`
beyond its records; platform, app version and build travel in the request envelope
(`request-envelope`). Each record SHALL carry exactly `at`, `level`,
`channel`, `message`, and a subset of the allowlisted fields `screen`, `errorClass`, `where`,
`stage`, `reason`, `kind`, `status`, `errorCode`, `domain`, `readyState`,
`observedRepairAttempts`, `requestId`, `route`, `count` and `stack`; every other field SHALL be
dropped. String values SHALL be capped at 128 characters, except `stack`, which SHALL be capped at
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

### Requirement: Error-level records are uploaded, batched, deduplicated and capped
The diagnostics transport SHALL be a transport of the logging seam and SHALL forward only
`error`-level records. It SHALL deduplicate by `(channel, message, errorClass, where)` within one
app session, incrementing `count` on the retained record instead of adding another. It SHALL hold
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

### Requirement: Uploads require a current AI-data consent grant
The diagnostics transport SHALL NOT make any request unless a current AI-data consent grant exists
and the Settings "Send error details" switch (`legal-surface-v2`, spec `privacy-settings`) is on.
Records emitted while either is missing SHALL be discarded, not queued for later.

#### Scenario: No consent, no upload
- **WHEN** the user has not agreed, or has turned AI features off, and an error is logged
- **THEN** no request is made to `/v1/diagnostics` and the record is not sent after a later grant

#### Scenario: The error-details switch is off
- **WHEN** consent is current, the user has turned "Send error details" off, and an error is logged
- **THEN** no request is made to `/v1/diagnostics` and the record is not sent after the switch is
  turned back on

### Requirement: Uncaught host errors and fatal JS errors are captured
The app SHALL install a global JS error handler and an unhandled-promise-rejection hook that log
through the seam at `error` level and then defer to the previously installed handler, so a fatal
error still ends the process as before. For a fatal error the app SHALL write the allowlisted
projection of that one record to persistent storage under a single fixed key, SHALL upload it on
the next launch once consent allows, and SHALL delete it after the upload attempt.

#### Scenario: A fatal JS error is reported on the next launch
- **WHEN** a fatal JS error kills the app and the user reopens it with consent granted
- **THEN** the next diagnostics upload carries that error's record and the stored copy is gone

#### Scenario: An unhandled rejection is logged
- **WHEN** a promise rejects with no handler in host code
- **THEN** an `error`-level record is emitted through the seam

### Requirement: Mini-app failures reach the seam as error records
Every mini-app failure the host can observe SHALL reach the seam as an `error`-level record: a
fatal sandbox error frame (`where` of `bundle`, `mount` or `deliver`), a paint-watchdog timeout
and a launch failure SHALL each emit an `error`-level record through the seam, in addition to
driving the failure screen. Inside the sandbox realm, the loader SHALL listen for `error` and
`unhandledrejection` on the realm's window and SHALL report each as the existing
nonce-authenticated `error` frame with `where` of `runtime` or `rejection` and the error's name.
This SHALL add no frame kind, no capability, no global and no CSP change; a frame failing the nonce
check SHALL still be rejected.

#### Scenario: A mount failure is an error record
- **WHEN** a bundle throws synchronously during mount
- **THEN** the failure screen shows and an `error`-level record with `where: "mount"` is emitted

#### Scenario: A throw in an event handler is captured
- **WHEN** a mini-app's button handler throws after the app has painted
- **THEN** the host receives a trusted `error` frame with `where: "runtime"` and emits a record

#### Scenario: A forged error frame is still rejected
- **WHEN** a bundle posts an `error` frame without the realm nonce
- **THEN** the host treats it as a forgery and emits no mini-app error record for it

### Requirement: The diagnostics route validates, bounds and logs without storing
The server SHALL expose `POST /v1/diagnostics`, gated by `x-whim-device` like every `/v1` route.
It SHALL validate the body against the closed `DiagnosticsBatch` schema from `@whim/contract`,
rejecting unknown keys with `400`. It SHALL cap the body at 32 KB and a batch at 50 records. It
SHALL enforce a per-device daily record allowance and a global daily ceiling held in memory,
answering `429` beyond either. It SHALL log each accepted record once through the server logger on
scope `device` at the record's level, with the envelope's fields, and SHALL NOT write the batch,
the records, or the device id to any database or file. It SHALL answer `204` on success.

#### Scenario: An unknown key is refused
- **WHEN** a batch contains a record with a `detail` field
- **THEN** the route answers `400` and logs no record from that batch

#### Scenario: Accepted records become log lines, not rows
- **WHEN** a valid batch of three records is posted
- **THEN** the route answers `204`, three `scope: "device"` lines are logged, and neither
  `usage.db` nor `reports.db` gains a row

#### Scenario: A flooding device is cut off
- **WHEN** one device exceeds its daily record allowance
- **THEN** further batches from it answer `429` until the next UTC day

### Requirement: Release builds keep a source map for every shipped bundle
Each release build SHALL produce the Hermes source map for its bundle and upload it to the private
source-map bucket keyed by platform, version and build number. An operator script SHALL read a
stack from standard input and print symbolicated frames for a given platform, version and build,
and SHALL fail with a clear message when no map exists for that key rather than using another.

#### Scenario: A logged stack is readable
- **WHEN** the operator pipes a `stack` from a device record into the script with its platform,
  version and build
- **THEN** the output names source files and lines in `src/`

#### Scenario: A missing map is refused
- **WHEN** no map exists for the given key
- **THEN** the script exits non-zero naming the missing key

### Requirement: What the app sends is disclosed wherever it is declared
Every place that declares what Whim collects SHALL cover diagnostics before a build containing the
diagnostics transport ships: the consent screen, the privacy policy, the Play Data safety form, the
iOS privacy manifest and the App Store privacy answers SHALL each cover crash logs and diagnostics
as the disclosure manifest's error-details category and store mapping record them (`legal-surface-v2`,
spec `ai-data-consent`): collected, linked (Apple's definition counts linkage through the request's
device ID), never used for tracking, optional and on by default. The release checks SHALL fail when a build
contains the diagnostics transport and any of these omits diagnostics, and when they disagree with
each other.

#### Scenario: A missing declaration blocks the release
- **WHEN** the release checks run on a build containing the diagnostics transport and the iOS
  privacy manifest does not declare diagnostics
- **THEN** the checks fail, naming the manifest

#### Scenario: Declarations agree
- **WHEN** the release checks run
- **THEN** they pass only if the Play form, the privacy manifest and the App Store answers all
  declare the same diagnostics types
