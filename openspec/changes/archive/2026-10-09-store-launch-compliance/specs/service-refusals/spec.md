## ADDED Requirements

### Requirement: A refusal is recognised by the contract's closed refusal vocabulary
The launcher SHALL treat a request error as a service refusal exactly when it is an HTTP error whose body validated as `ApiError`, whose `error` is a member of the contract's `ServiceRefusalCode`, and whose `hint` is non-empty. Every other error SHALL keep its existing handling.

The launcher's per-code handling SHALL be a table keyed by `ServiceRefusalCode` (`payload_too_large`, `daily_limit`, `device_busy`, `server_busy`, `content_policy`, `policy_unavailable`, `budget_exhausted`), written so that a member added to the contract without a matching entry fails the typecheck. Matching SHALL use the identifier, never the status code or the hint text.

#### Scenario: Every contract code is recognised
- **WHEN** each of the seven `ServiceRefusalCode` members arrives as an `ApiError` body with a hint
- **THEN** each is classified as a service refusal carrying that code and hint

#### Scenario: An identifier outside the vocabulary is not a refusal
- **WHEN** a `429` arrives with `ApiError` `{ error: 'rate_limited', hint: '…' }`
- **THEN** it is not a service refusal and takes the existing failure handling

#### Scenario: A body without a hint is not a refusal
- **WHEN** a `422` arrives whose body is `{ error: 'content_policy' }` with no hint
- **THEN** it is not a service refusal

### Requirement: A refusal of what the user wrote lands where they can change it
A `content_policy` or `payload_too_large` refusal SHALL return the user to the step where the refused text is edited, with a notice. For a clarify or rewrite request that step is compose, with the prompt text and the app being changed preserved. For a generate request started from the plan step it is the plan step, with its rows and any hand edits preserved. Changing the text (typing in compose, or saving a row edit on plan) SHALL clear the notice.

#### Scenario: A clarify request is refused for content
- **WHEN** the user taps `Continue` on compose and the clarify request is refused with `content_policy`
- **THEN** compose shows the refusal notice with the prompt text unchanged, and editing the text removes the notice

#### Scenario: A rewrite reached through clarify is refused for content
- **WHEN** the user answers clarify questions, taps `Continue`, and the rewrite request is refused with `content_policy`
- **THEN** compose shows the notice with the prompt text preserved, and the loading plan step is gone

#### Scenario: A build is refused for size
- **WHEN** the user taps `Build it` and the generate request is refused with `payload_too_large`
- **THEN** the plan step shows the notice with every row as it was

### Requirement: An availability or limit refusal lands on the step whose action sent the request
A `policy_unavailable`, `budget_exhausted`, `daily_limit`, `device_busy`, or `server_busy` refusal SHALL return the user, with a notice and with that step's state preserved, to the step whose primary action sent the request: compose for clarify, compose or clarify (whichever step's `Continue` was tapped) for rewrite, and plan for a generate request started with `Build it`.

#### Scenario: A build is refused while another is running
- **WHEN** the user taps `Build it` while another build from this phone is still running, and the server refuses with `device_busy`
- **THEN** the plan step shows the notice with its rows preserved

#### Scenario: A rewrite after clarify hits the budget
- **WHEN** the user taps `Continue` on clarify and the rewrite is refused with `budget_exhausted`
- **THEN** the clarify step shows the notice with its answers preserved

### Requirement: The notice shows the server's hint and nothing technical
A refusal notice SHALL render the refusal's `hint` verbatim as plain text. It SHALL NOT pass the hint through Whim Syntax marking, and SHALL NOT render a status code, error identifier, `Retry-After` value, or transport message. Refusals about the user's text SHALL use the danger tone; availability and limit refusals SHALL use a neutral tone. All colours, radii, spacing, and type SHALL come from the shell palette and SDK tokens. Each refusal SHALL be recorded through the logging seam with its code, status, and the request it refused.

#### Scenario: Only the hint is visible
- **WHEN** a `daily_limit` refusal with a `Retry-After` of 3600 is shown
- **THEN** the notice text is the hint plus the copy-table retry line, and neither `429`, `daily_limit`, nor `3600` appears on screen

#### Scenario: The refusal is recoverable from the log
- **WHEN** any refusal notice is shown
- **THEN** a log record carries the refusal code, the HTTP status, and which request was refused

### Requirement: Retry-After holds the retry action until the window passes
When a refusal carries a `Retry-After` of a positive integer number of seconds, the landing step's primary action SHALL stay disabled, keeping its label, until that many seconds have passed. The notice SHALL add one copy-table line saying when trying again is possible: "in about N seconds" or "in about N minutes" under an hour, "after <local time>" later the same day, and "tomorrow after <local time>" beyond it. When the window ends, the action SHALL re-enable on its own and SHALL NOT send any request by itself. A missing, non-integer, zero, or negative `Retry-After` SHALL be treated as absent, leaving the action enabled. The window SHALL belong to the screen showing it and SHALL NOT be persisted.

#### Scenario: A daily limit disables the build action
- **WHEN** `Build it` is refused with `daily_limit` and `Retry-After: 5400`
- **THEN** `Build it` is disabled, the notice says to try again after the local time 90 minutes from now, and no request goes out when that time arrives

#### Scenario: A busy server without a known retry time
- **WHEN** a request is refused with `server_busy` and no `Retry-After`
- **THEN** the notice shows the hint and the primary action stays enabled

### Requirement: A refusal from compose, clarify, or plan never opens the failure screen
A service refusal of a request sent from the compose, clarify, or plan step SHALL NOT open the failure screen and SHALL NOT offer Discard or rephrase-from-failure actions. A fresh build refused while its build screen is still showing SHALL return to the plan step and leave no ghost tile (see `pending-builds`). If the user has already left the build screen when the refusal arrives, the refusal SHALL settle as a failed build whose reason is the hint.

#### Scenario: Refused before a build starts
- **WHEN** `Build it` is refused with `content_policy` while the build screen is showing
- **THEN** the user is on the plan step with the notice, no failure screen appeared, and no ghost tile exists for the attempt

#### Scenario: Refused after leaving
- **WHEN** the user taps `Leave it running` before the generate response arrives and the request is then refused
- **THEN** the grid shows a failed ghost tile whose failure screen reason is the refusal's hint

### Requirement: A refused retry updates the failure screen in place
A Retry from the failure screen that is refused SHALL keep the user on the failure screen, show the refusal's hint as the reason, and apply the `Retry-After` rule to the Retry action.

#### Scenario: Retrying into a daily limit
- **WHEN** the user taps Retry on a failed build and the request is refused with `daily_limit` and a `Retry-After`
- **THEN** the failure screen shows the hint as its reason and Retry stays disabled until the window passes
