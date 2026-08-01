## ADDED Requirements

### Requirement: The device consumes the generation stream incrementally
The device SHALL consume the `POST /v1/generate` SSE response incrementally, surfacing each
`GenerationEvent` to the caller as it arrives rather than after the response completes. The
transport SHALL NOT depend on a streaming `fetch` response body: React Native's global `fetch`
is the `whatwg-fetch` polyfill over `XMLHttpRequest`, which defines no `Response.body` and
settles its promise only at readyState 4 with the whole body buffered. `XMLHttpRequest`'s
incremental delivery SHALL be used for this route instead.

#### Scenario: Events surface before the stream completes
- **WHEN** the server has emitted a `stage` event but has not yet closed the stream
- **THEN** the client has already yielded that event to its caller, without waiting for the
  terminal `result` or `failure` event

#### Scenario: A non-streaming fetch does not fail the flow
- **WHEN** the client runs on a runtime whose `fetch` cannot stream response bodies
- **THEN** generation still completes normally, and no error with the hint "Response has no
  body" is produced

### Requirement: The streaming transport is selected before the request is issued
The transport SHALL be chosen by a runtime capability determination made before any request is
sent, never by inspecting a response that has already been received. Exactly one
`POST /v1/generate` request SHALL be issued per generation attempt.

#### Scenario: One request per generation
- **WHEN** a single generation is run to completion on a runtime whose `fetch` cannot stream
- **THEN** the server receives exactly one `POST /v1/generate` request, and the generation
  pipeline runs exactly once

### Requirement: The streaming transport preserves the client error taxonomy
The transport SHALL raise the same `GenerationClientError` kinds as the fetch path for the same
conditions: `device_id` when the server rejects the `x-whim-device` header with a `DeviceIdError`
body, `http` for any other non-2xx response, `network` for a transport-level failure, and
`stream_parse` for a frame that fails JSON parsing or `GenerationEvent` validation. The error's
`kind`, `status`, and `hint` fields SHALL carry the same meanings as on the fetch path.

#### Scenario: Device identity rejection is classified as device_id
- **WHEN** the server responds 400 with a `DeviceIdError` body
- **THEN** the client raises `GenerationClientError` with `kind: 'device_id'` and the server's
  `hint`, not `kind: 'network'`

#### Scenario: Other non-2xx responses are classified as http
- **WHEN** the server responds with a non-2xx status that is not a `DeviceIdError`
- **THEN** the client raises `GenerationClientError` with `kind: 'http'` carrying the status,
  and the body's `hint` when the body has one

#### Scenario: A malformed frame is a parse failure, not a network failure
- **WHEN** the stream delivers a frame whose `data:` payload is not valid JSON, or is valid
  JSON that does not match `GenerationEvent`
- **THEN** the client raises `GenerationClientError` with `kind: 'stream_parse'`

### Requirement: Cancellation aborts the request and ends iteration silently
An `AbortSignal` passed to the generation call SHALL abort the underlying request. An aborted
stream SHALL end iteration with no terminal event and no thrown error, matching the behavior the
prompt flow relies on when the user cancels or navigates away mid-generation.

#### Scenario: Cancelling mid-stream ends iteration without throwing
- **WHEN** the caller aborts the signal after some events have been yielded but before the
  terminal event
- **THEN** iteration ends silently, no further events are yielded, and no error is raised

#### Scenario: Cancelling releases the underlying request
- **WHEN** the caller aborts the signal mid-stream
- **THEN** the underlying request is aborted rather than left running to completion

### Requirement: The SSE framing and event validation are transport-independent
Frame parsing SHALL be identical across transports: `\n\n`-delimited blocks, `data:` payloads
validated against the `GenerationEvent` union, and keepalive comment blocks (lines beginning
`:`) recognized and skipped rather than treated as malformed. Multi-byte UTF-8 characters split
across delivery boundaries SHALL decode correctly.

#### Scenario: Keepalive comments are skipped
- **WHEN** the server emits a keepalive comment block between two events
- **THEN** no event is yielded for it and no parse error is raised

#### Scenario: A multi-byte character split across chunks decodes intact
- **WHEN** a multi-byte UTF-8 character in an event payload is split across two incremental
  deliveries
- **THEN** the assembled event contains the original character, with no replacement characters

### Requirement: The on-device streaming path is exercisable under test
The streaming transport SHALL be injectable so the acceptance suite can drive it directly,
rather than being reachable only on a real device. The suite SHALL include a case that fails if
the transport stops delivering events incrementally, so that a regression to
buffered-at-completion behavior is caught rather than passing silently.

#### Scenario: Incremental delivery has a negative control
- **WHEN** the transport is changed to yield all events only after the response completes
- **THEN** the acceptance suite fails

#### Scenario: The streaming transport runs under the Node suite
- **WHEN** `npm run launcher:test` runs
- **THEN** the streaming transport's own delivery, abort, and error-classification behavior is
  exercised, not only the fetch path
