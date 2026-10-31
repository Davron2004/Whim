## MODIFIED Requirements

### Requirement: A refusal is recognised by the contract's closed refusal vocabulary
The launcher SHALL treat a request error as a service refusal exactly when it is an HTTP error whose body validated as `ApiError`, whose `error` is a member of the contract's `ServiceRefusalCode`, and whose `hint` is non-empty. Every other error SHALL keep its existing handling.

The launcher's per-code handling SHALL be a table keyed by `ServiceRefusalCode` (`payload_too_large`, `daily_limit`, `device_busy`, `server_busy`, `content_policy`, `policy_unavailable`, `budget_exhausted`, `update_required`, `consent_required`), written so that a member added to the contract without a matching entry fails the typecheck. Matching SHALL use the identifier, never the status code or the hint text.

#### Scenario: Every contract code is recognised
- **WHEN** each of the nine `ServiceRefusalCode` members arrives as an `ApiError` body with a hint
- **THEN** each is classified as a service refusal carrying that code and hint

#### Scenario: An identifier outside the vocabulary is not a refusal
- **WHEN** a `429` arrives with `ApiError` `{ error: 'rate_limited', hint: '…' }`
- **THEN** it is not a service refusal and takes the existing failure handling

#### Scenario: A body without a hint is not a refusal
- **WHEN** a `422` arrives whose body is `{ error: 'content_policy' }` with no hint
- **THEN** it is not a service refusal

### Requirement: A refusal of what the user wrote lands where they can change it
A `content_policy` or `payload_too_large` refusal SHALL return the user to the page of the making sheet where the refused text is edited, with a notice. For a clarify or rewrite request that page is Describe, with the person's words and the app being changed preserved. For a generate request started from the Plan page it is the Plan page, with its rows, answers and any hand edits preserved. Changing the text (typing on Describe, or saving a row edit on Plan) SHALL clear the notice.

#### Scenario: A clarify request is refused for content
- **WHEN** the user taps `Continue` on Describe and the clarify request is refused with `content_policy`
- **THEN** Describe shows the refusal notice with the words unchanged, and editing the words removes the notice

#### Scenario: A rewrite reached through clarify is refused for content
- **WHEN** the clarify questions have landed on the Plan page and the rewrite request that follows them is refused with `content_policy`
- **THEN** Describe shows the notice with the words preserved, and the loading Plan page is gone

#### Scenario: A build is refused for size
- **WHEN** the user taps `Make it` and the generate request is refused with `payload_too_large`
- **THEN** the Plan page shows the notice with every row as it was

### Requirement: An availability or limit refusal lands on the step whose action sent the request
A `policy_unavailable`, `budget_exhausted`, `daily_limit`, `device_busy`, or `server_busy` refusal SHALL return the user, with a notice and with that page's state preserved, to the page of the making sheet whose primary action sent the request: Describe for clarify and for rewrite (both are sent by Describe's `Continue`), and the Plan page for a generate request started with `Make it` (or `Make the change`).

#### Scenario: A build is refused while another is running
- **WHEN** the user taps `Make it` while another run from this phone is still going, and the server refuses with `device_busy`
- **THEN** the Plan page shows the notice with its rows preserved

#### Scenario: A rewrite after clarify hits the budget
- **WHEN** the user taps `Continue` on Describe, the clarify questions land, and the rewrite is refused with `budget_exhausted`
- **THEN** Describe shows the notice with the words preserved

### Requirement: The notice shows the server's hint and nothing technical
A refusal notice SHALL render the refusal's `hint` verbatim as plain text. It SHALL NOT pass the hint through Whim Syntax marking, and SHALL NOT render a status code, error identifier, `Retry-After` value, or transport message. Refusals about the user's text SHALL use the danger tone; availability and limit refusals SHALL use a neutral tone. All colours, radii, spacing, and type SHALL come from the design tokens. Each refusal SHALL be recorded through the logging seam with its code, status, and the request it refused.

#### Scenario: Only the hint is visible
- **WHEN** a `daily_limit` refusal with a `Retry-After` of 3600 is shown
- **THEN** the notice text is the hint plus the copy-table retry line, and neither `429`, `daily_limit`, nor `3600` appears on screen

#### Scenario: The refusal is recoverable from the log
- **WHEN** any refusal notice is shown
- **THEN** a log record carries the refusal code, the HTTP status, and which request was refused

### Requirement: Retry-After holds the retry action until the window passes
When a refusal carries a `Retry-After` of a positive integer number of seconds, the landing page's primary action SHALL stay disabled, keeping its label, until that many seconds have passed. The notice SHALL add one copy-table line saying when trying again is possible: "Try again in about N seconds." under a minute, "Try again in about N minutes." under an hour, "Try again after <time>." later the same local day and "Try again tomorrow after <time>." beyond it, where `<time>` is the local clock time formatted in the app's language (for example "8:00 PM"), rounded up to the whole minute so that it never names a time before the window ends. A line read after the window has ended SHALL say "Try again shortly." and name no number. When the window ends, the action SHALL re-enable on its own, a neutral notice SHALL clear with it, and nothing SHALL send a request by itself. A missing, non-integer, zero, or negative `Retry-After` SHALL be treated as absent, leaving the action enabled. The window SHALL belong to the screen showing it and SHALL NOT be persisted.

#### Scenario: A daily limit disables the build action
- **WHEN** `Make it` is refused with `daily_limit` and `Retry-After: 5400`
- **THEN** `Make it` is disabled, the notice reads "Try again after <time>." naming the local time 90 minutes from now rounded up to the minute, and no request goes out when that time arrives

#### Scenario: A busy server without a known retry time
- **WHEN** a request is refused with `server_busy` and no `Retry-After`
- **THEN** the notice shows the hint and the primary action stays enabled

#### Scenario: The named time is never early
- **WHEN** a `daily_limit` refusal's window ends at 8:00:29 PM local time
- **THEN** the notice reads "Try again after 8:01 PM."

### Requirement: A refusal from compose, clarify, or plan never opens the failure screen
A service refusal of a request sent from the Describe or Plan page SHALL NOT open the Failure page and SHALL NOT offer Discard or rewording-from-failure actions. A fresh run refused while its Making page is still showing SHALL return to the Plan page and leave no tile for the attempt (see `pending-builds`). If the user has already closed the making sheet when the refusal arrives, the refusal SHALL settle as a failed run whose reason is the hint.

#### Scenario: Refused before a build starts
- **WHEN** `Make it` is refused with `content_policy` while the Making page is showing
- **THEN** the user is on the Plan page with the notice, no Failure page appeared, and no tile exists for the attempt

#### Scenario: Refused after leaving
- **WHEN** the user closes the making sheet before the generate response arrives and the request is then refused
- **THEN** Home shows a failed tile for the attempt whose Failure page reason is the refusal's hint

### Requirement: A refused retry updates the failure screen in place
A `Try again` from the Failure page that is refused SHALL bring the user back to that run's Failure page, show the refusal's hint as the reason, and apply the `Retry-After` rule to its `Try again` action.

#### Scenario: Retrying into a daily limit
- **WHEN** the user taps `Try again` on a failed run's Failure page and the request is refused with `daily_limit` and a `Retry-After`
- **THEN** the Failure page shows the hint as its reason and `Try again` stays disabled until the window passes
