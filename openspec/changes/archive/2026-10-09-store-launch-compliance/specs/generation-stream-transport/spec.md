## MODIFIED Requirements

### Requirement: The streaming transport preserves the client error taxonomy
The transport SHALL raise the same `GenerationClientError` kinds as the fetch path for the same
conditions: `device_id` when the server rejects the `x-whim-device` header with a `DeviceIdError`
body, `http` for any other non-2xx response, `network` for a transport-level failure, and
`stream_parse` for a frame that fails JSON parsing or `GenerationEvent` validation. The error's
`kind`, `status`, and `hint` fields SHALL carry the same meanings as on the fetch path.

An `http` error SHALL also carry `code`, the body's `ApiError` `error` identifier when the body
validates as `ApiError`, and `retryAfterSeconds`, the response's `Retry-After` header when it is a
positive integer number of seconds. Both SHALL be read identically on the fetch path, on the
`XMLHttpRequest` path (which reads the header from the request object, since it has no real
`Response`), and on the non-streaming clarify, rewrite, and report calls. A missing or malformed
body or header SHALL leave the field absent and SHALL NOT change the error's `kind`.

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

#### Scenario: Refusal identifier and retry time survive both transports
- **WHEN** the server answers `POST /v1/generate` with `429`, `Retry-After: 120`, and
  `{ error: 'server_busy', hint: '…' }`, once over the fetch transport and once over the
  `XMLHttpRequest` transport
- **THEN** both raise `kind: 'http'` with `status: 429`, `code: 'server_busy'`, the hint, and
  `retryAfterSeconds: 120`

#### Scenario: A malformed Retry-After is dropped
- **WHEN** a `429` refusal carries `Retry-After: soon`
- **THEN** the error has no `retryAfterSeconds`, and its `kind`, `status`, `code`, and `hint` are
  unaffected
