# generation-contract delta — server-cancellation

## MODIFIED Requirements

### Requirement: SSE generation event stream schema
The contract SHALL define `GenerationEvent` as a discriminated union on `type` covering:
`stage` (stage ∈ plan|generate|check|run|repair; status ∈ start|done; optional attempt),
`token` (streamed generation text delta), `diagnostic` (carrying a `Diagnostic`), `usage`
(carrying a `Usage`), and the two terminal events `result` (carrying a `WireAppRecord`) and
`failure` (user-facing `reason` prose, `attempts`, accumulated `diagnostics`). Every event a
conforming server emits SHALL validate against this union, and every stream that runs to
completion SHALL contain exactly one terminal event as its last event. A stream aborted by
the client (disconnect or cancellation) ends without a terminal event — the terminal-event
invariant applies only to streams the server runs to completion, and a truncated stream is
not a conformance violation.

#### Scenario: Round-trip validation
- **WHEN** each event of a canned stub-pipeline run is serialized and re-parsed with
  `GenerationEvent.parse`
- **THEN** every event validates, and exactly one terminal event appears, last

#### Scenario: Unknown event type rejected
- **WHEN** a payload with an unrecognized `type` is parsed
- **THEN** parsing fails (clients can trust the union is closed at any given contract version)

#### Scenario: A client-aborted stream is not a conformance violation
- **WHEN** a client disconnects mid-stream and the server aborts the generation
- **THEN** every event emitted before the abort validates against the union, and the absence
  of a terminal event on the truncated stream is expected, not an emitter defect
