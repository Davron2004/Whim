## ADDED Requirements

### Requirement: The health check identifies the service
`GET /healthz` SHALL respond `200` with a JSON body identifying the service, for example
`{ ok: true, service: 'whim-server' }`, rather than a bare string, so a caller can distinguish
"this is a Whim server" from any other process that happens to answer 200 on `/healthz` (measured
this cycle: multiple unrelated local listeners can 200 on that path). The route SHALL remain
outside the `/v1/*` prefix and exempt from the `x-whim-device` header gate, so it stays probeable
by a bare `curl` or browser request with no headers.

#### Scenario: Health check body identifies the service
- **WHEN** a client calls `GET /healthz` with no headers
- **THEN** the response is `200` with a JSON body whose fields identify it as the Whim server

#### Scenario: Health check stays anonymous and ungated
- **WHEN** a client calls `GET /healthz` with no `x-whim-device` header
- **THEN** the response is `200` (not `400`), unaffected by the device-identity middleware
