## ADDED Requirements

### Requirement: Report request and response shapes
The contract SHALL define `ReportReason` as the closed set `offensive | harmful | broken | other`, `ReportRequest` as `{ reason: ReportReason, note?: string (at most 1000 characters), appName?: string (at most 200 characters), prompt?: string, source?: string }`, and `ReportResponse` as `{ reportId: string (non-empty) }`.

`prompt` and `source` carry no character bound in the schema. Their byte caps are a server admission concern answered with `413`, not a shape rule, because the cap is measured in UTF-8 bytes and is configurable. The shapes SHALL be zod values like every other product wire shape, and SHALL carry no device identity, since identity rides the `x-whim-device` header.

#### Scenario: A full report validates
- **WHEN** a `ReportRequest` with every field set within bounds is parsed
- **THEN** it validates

#### Scenario: Only the reason is required
- **WHEN** `{ reason: 'other' }` is parsed as `ReportRequest`
- **THEN** it validates

#### Scenario: Bounds and the closed reason set are enforced
- **WHEN** a `ReportRequest` with a 1001-character `note`, one with a 201-character `appName`, and one with `reason: 'spam'` are parsed
- **THEN** all three fail

#### Scenario: The response carries an id
- **WHEN** `{ reportId: '' }` and `{}` are parsed as `ReportResponse`
- **THEN** both fail, and a non-empty `reportId` validates

### Requirement: Service refusal codes are a closed vocabulary
The contract SHALL define `ServiceRefusalCode` as the closed set `payload_too_large | daily_limit | device_busy | server_busy | content_policy | policy_unavailable | budget_exhausted`: the `error` identifiers a conforming server uses for size, admission, content-policy, and operator-budget refusals.

`ApiError` itself SHALL remain unchanged, with an open `error` string and a mandatory non-empty `hint`. Every refusal body SHALL validate as `ApiError` with its `error` a member of `ServiceRefusalCode`. The vocabulary SHALL grow only additively, and no refusal SHALL introduce a second error shape.

`budget_exhausted` SHALL mean the operator's own provider credit is exhausted, as distinct from `daily_limit` (a device or global admission ceiling) and `policy_unavailable` (the content classifier down). A `budget_exhausted` refusal's `hint` SHALL say generation is unavailable for now without naming the provider or a dollar amount.

#### Scenario: The vocabulary is closed
- **WHEN** `rate_limited` is parsed with `ServiceRefusalCode`
- **THEN** parsing fails, and each of the seven listed identifiers validates

#### Scenario: ApiError is untouched
- **WHEN** an `ApiError` whose `error` is `invalid_request` is parsed
- **THEN** it still validates, because `ApiError.error` stays an open string
