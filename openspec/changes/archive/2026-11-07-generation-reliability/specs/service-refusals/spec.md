## MODIFIED Requirements

### Requirement: A refusal is recognised by the contract's closed refusal vocabulary
The launcher SHALL treat a request error as a service refusal exactly when it is an HTTP error whose body validated as `ApiError`, whose `error` is a member of the contract's `ServiceRefusalCode`, and whose `hint` is non-empty. Every other error SHALL keep its existing handling.

The launcher's per-code handling SHALL be a table keyed by `ServiceRefusalCode` (`payload_too_large`, `daily_limit`, `device_busy`, `server_busy`, `content_policy`, `policy_unavailable`, `budget_exhausted`, `update_required`, `consent_required`, `provider_unavailable`), written so that a member added to the contract without a matching entry fails the typecheck. Matching SHALL use the identifier, never the status code or the hint text.

#### Scenario: Every contract code is recognised
- **WHEN** each of the ten `ServiceRefusalCode` members arrives as an `ApiError` body with a hint
- **THEN** each is classified as a service refusal carrying that code and hint

#### Scenario: An identifier outside the vocabulary is not a refusal
- **WHEN** a `429` arrives with `ApiError` `{ error: 'rate_limited', hint: '…' }`
- **THEN** it is not a service refusal and takes the existing failure handling

#### Scenario: A body without a hint is not a refusal
- **WHEN** a `422` arrives whose body is `{ error: 'content_policy' }` with no hint
- **THEN** it is not a service refusal

### Requirement: An availability or limit refusal lands on the step whose action sent the request
A `policy_unavailable`, `budget_exhausted`, `provider_unavailable`, `daily_limit`, `device_busy`, or `server_busy` refusal SHALL return the user, with a notice and with that page's state preserved, to the page of the making sheet whose primary action sent the request: Describe for clarify and for rewrite (both are sent by Describe's `Continue`), and the Plan page for a generate request started with `Make it` (or `Make the change`).

#### Scenario: A build is refused while another is running
- **WHEN** the user taps `Make it` while another run from this phone is still going, and the server refuses with `device_busy`
- **THEN** the Plan page shows the notice with its rows preserved

#### Scenario: A rewrite after clarify hits the budget
- **WHEN** the user taps `Continue` on Describe, the clarify questions land, and the rewrite is refused with `budget_exhausted`
- **THEN** Describe shows the notice with the words preserved

#### Scenario: A build is refused during a provider outage
- **WHEN** the user taps `Make it` and the generate request is refused with `provider_unavailable` and `Retry-After: 45`
- **THEN** the Plan page shows the server's hint in a neutral notice with the rows preserved and the retry line, `Make it` stays disabled until the window passes, and no Failure page appears
