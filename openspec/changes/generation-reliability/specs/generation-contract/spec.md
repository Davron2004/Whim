## ADDED Requirements

### Requirement: The refusal vocabulary gains provider_unavailable
`ServiceRefusalCode` SHALL gain `provider_unavailable`, additively. It SHALL mean the AI provider the server depends on is failing, as distinct from `budget_exhausted` (the operator's credit) and `policy_unavailable` (the content classifier). Its hint SHALL be "The AI service Whim uses is having trouble right now. It’s not something you did. Please try again in a little while." and SHALL name no provider, model or status code.

#### Scenario: The code validates
- **WHEN** `provider_unavailable` is parsed with `ServiceRefusalCode`
- **THEN** it validates, and `rate_limited` still fails

### Requirement: The provider_unavailable code is introduced at protocol level 2
The contract's `PROTOCOL_LEVEL` SHALL become `2`. The server SHALL register `provider_unavailable` at level 2 with `compat: { min: 2, fallback: 'fail', notice: <its hint> }`, so a client declaring level 1 receives only `{ error, hint, compat }` and shows the notice on its failure screen. A client declaring a level above the server's own SHALL be admitted and served everything the server has.

#### Scenario: A level-1 client gets the compat envelope
- **WHEN** the server answers a request declaring `x-whim-protocol: 1` with a `provider_unavailable` refusal
- **THEN** the body is `{ error: 'provider_unavailable', hint, compat: { min: 2, fallback: 'fail', notice } }` with the notice equal to the hint sentence

#### Scenario: A level-2 client gets the refusal itself
- **WHEN** the same refusal answers a request declaring level `2`
- **THEN** the body validates as `ApiError` with `error: 'provider_unavailable'` and the hint, and the device decodes it rather than applying the fallback

#### Scenario: A client above the server's level is served
- **WHEN** a request declares `x-whim-protocol: 3` to a level-2 server
- **THEN** it is admitted, and no message above level 2 is sent
