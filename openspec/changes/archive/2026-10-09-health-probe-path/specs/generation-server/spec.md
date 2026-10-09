## MODIFIED Requirements

### Requirement: Device-identity middleware
All `/v1/*` routes SHALL require the header `x-whim-device` containing a UUID (the device's
anonymous MMKV-stored ID — decision #42 identity; no accounts, no PII). A missing or
malformed header SHALL yield `400` with a structured JSON error body before any handler runs.
`GET /health` and `GET /healthz` SHALL be exempt and SHALL answer the same body.

The gate SHALL be applied by path prefix rather than route by route, so a route added later is gated by construction and cannot be forgotten. The suite SHALL assert this over the server's whole `/v1` route table, not over an enumerated subset.

#### Scenario: Missing device header rejected
- **WHEN** a client calls `POST /v1/generate` without `x-whim-device`
- **THEN** the server responds `400` with a structured error body and no SSE stream opens

#### Scenario: Health check is anonymous
- **WHEN** a client calls `GET /healthz` with no headers
- **THEN** the server responds `200`

#### Scenario: Both health paths answer the same body
- **WHEN** a client calls `GET /health` and `GET /healthz` with no headers
- **THEN** both respond `200` with identical JSON bodies naming `service: "whim-server"`, the image's `commit` and both minimum builds

#### Scenario: Every /v1 route is gated, including new ones
- **WHEN** every route the server mounts under `/v1` is called without `x-whim-device`
- **THEN** each responds `400` with a structured error body before its handler runs, and the suite fails if any route is reachable unauthenticated
