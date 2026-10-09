## MODIFIED Requirements

### Requirement: Batched delivery to the dev sink is best-effort and never affects the app
The seam SHALL offer a dev sink that batches records and POSTs them to the dev server's log-sink
route. Batching SHALL be bounded by both a record count and a flush interval, SHALL drop the
oldest pending records rather than growing without bound, and SHALL be off unless explicitly
enabled.

Delivery SHALL be best-effort: a sink failure — unreachable host, non-2xx, timeout — SHALL NOT
surface to the user, SHALL NOT throw into the caller's stack, SHALL NOT block rendering or any
generation request, and SHALL NOT be retried indefinitely. A sink failure SHALL itself be recorded
in the ring buffer, so the overlay can explain why nothing is arriving on the host, and SHALL NOT
recurse into another delivery attempt for that record.

The sink's destination SHALL be the server address the device already persists, reached over
`adb reverse` port forwarding; no second address is configured and no new setting is added.

The dev sink and the diagnostics upload (capability `device-diagnostics`) SHALL be the only two
paths by which a record leaves the device. Each SHALL be a transport of the seam, so each receives
records only after redaction; no call site SHALL send a log record by any other route.

#### Scenario: Records are batched, not sent one by one
- **WHEN** several records are emitted inside one flush interval
- **THEN** they are delivered as a single request body

#### Scenario: An unreachable sink is invisible to the user
- **WHEN** the sink's host refuses the connection
- **THEN** no alert, toast, or error screen appears, the in-flight generation is unaffected, and a
  record noting the delivery failure is in the ring buffer

#### Scenario: The failure record does not recurse
- **WHEN** a delivery failure is recorded
- **THEN** recording it does not itself trigger another delivery attempt for that record

#### Scenario: Off by default
- **WHEN** the dev sink has not been explicitly enabled
- **THEN** the dev sink makes no network request, whatever the diagnostics upload does

#### Scenario: No third path out of the seam
- **WHEN** the device source is scanned for network calls that carry log records
- **THEN** only the dev sink transport and the diagnostics transport make them
