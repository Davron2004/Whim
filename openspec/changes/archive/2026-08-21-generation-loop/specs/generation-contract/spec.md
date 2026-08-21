## MODIFIED Requirements

### Requirement: Generation request and rewrite shapes
The contract SHALL define `GenerateRequest` (`prompt`, optional `app` carrying the current `source`, the
`manifest`, the `schema`, and the `appliedSchema` for the edit flow — full re-send per Model 1, never wire
diffs) and `RewriteRequest`/`RewriteResponse` (`prompt` in, `rewrittenPrompt` out).

Within `app`, `source` SHALL be **optional**: it carries the app's original TypeScript when the device has
it, and is absent for a pre-existing install whose snapshots predate source tracking. Its absence means
exactly "the device has no original source for this app", and a conforming server SHALL regenerate under
the supplied `manifest`/`appliedSchema` rather than treat compiled output as source. `manifest` and
`schema` remain required within `app`.

`app.appliedSchema` SHALL be an optional record carrying the **accumulated** applied-schema union of the
database the app writes to — the storage group's `_meta` union, not the app's own snapshot artifact
(decision #52 D5). It is the diff baseline the harness's schema checks run against and the source of the
burned-ID allocation floor; when it is absent the baseline is the empty applied schema.

#### Scenario: Edit flow carries full source
- **WHEN** a client builds a `GenerateRequest` for editing an existing app whose original source it holds
- **THEN** the schema accepts the complete current source text (not a diff) inside `app`

#### Scenario: Edit flow without tracked source still validates
- **WHEN** a client builds a `GenerateRequest` for an app whose snapshots carry no original source
- **THEN** the request validates with `app.source` absent, and `app.manifest` and `app.schema` still present

#### Scenario: Applied schema is a distinct field from the app's own schema
- **WHEN** `GenerateRequest` is inspected
- **THEN** `app.schema` (the app's declared artifact) and `app.appliedSchema` (the database's accumulated
  union) are separate optional-vs-required fields that can legitimately differ

## ADDED Requirements

### Requirement: Structured API error body

The contract SHALL define `ApiError` = `{ error, hint }` where `error` is a machine-readable identifier and
`hint` is mandatory non-empty guidance, mirroring the diagnostics discipline. Every non-SSE error body a
conforming server returns from a `/v1/*` route SHALL validate against `ApiError`, so no route invents an
ad-hoc error shape. `DeviceIdError` remains the narrower, closed-enum specialization for the identity
middleware and SHALL stay assignable to `ApiError`.

#### Scenario: Every route error validates
- **WHEN** each `4xx`/`5xx` JSON body a conforming server can return from a `/v1/*` route is parsed with
  `ApiError`
- **THEN** every one validates, and each carries a non-empty `hint`

#### Scenario: Device-identity errors remain a specialization
- **WHEN** a `DeviceIdError` value is parsed with `ApiError`
- **THEN** it validates, and parsing it with `DeviceIdError` still rejects an unrecognized `error` value
