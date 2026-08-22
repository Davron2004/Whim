## ADDED Requirements

### Requirement: Leaving clarify or rewrite cancels the in-flight request cleanly
The device SHALL abort the underlying request when the user navigates away from the compose step before the clarify exchange resolves, or away from the plan step before the rewrite response resolves. Neither an abandoned clarify exchange nor an abandoned rewrite request SHALL be allowed to run to completion server-side after the user has left the step that started it.

#### Scenario: Leaving compose cancels clarify
- **WHEN** the user backs out of the compose step (or returns Home) before the clarify exchange
  resolves
- **THEN** the clarify request is aborted

#### Scenario: Leaving the plan step cancels rewrite
- **WHEN** the user navigates away from the plan step before the rewrite response resolves
- **THEN** the rewrite request is aborted

### Requirement: A response to a request the user has left cannot move the screen
Applying a clarify or rewrite response to on-screen state SHALL be guarded by the current screen
still being the one that started the request. A response that resolves after the user has
navigated elsewhere SHALL be discarded rather than applied.

#### Scenario: A late clarify response cannot hijack navigation
- **WHEN** the user backs out of the compose step to Home while a clarify exchange is in flight,
  and the clarify response resolves afterward
- **THEN** the resolved response is discarded and the user remains on Home; no screen change is
  forced

#### Scenario: A late rewrite response after leaving the plan step is discarded
- **WHEN** the user navigates away from the plan step while a rewrite request is in flight, and
  the response resolves afterward
- **THEN** the resolved response is discarded and does not alter the screen the user is now on

### Requirement: A hung connection to the generation stream is surfaced honestly
Opening the `POST /v1/generate` stream SHALL be bounded by a connect/first-event timeout. If no
first byte or event is observed within that window, the attempt SHALL be classified and shown as
a network failure, not left rendering as in-progress. Once the first event has been observed, no
further timeout SHALL apply to the remainder of the stream — a long-running generation SHALL be
allowed to continue indefinitely.

#### Scenario: A hung connect surfaces as a failure, not a stall
- **WHEN** the server accepts the TCP connection but never sends a first byte of the
  `/v1/generate` response within the connect timeout window
- **THEN** the build step shows the honest failure screen with a network-classified reason,
  rather than remaining on the first stage indefinitely

#### Scenario: A long but active stream is never timed out
- **WHEN** the stream has already delivered at least one event and continues running well beyond
  the connect-timeout duration
- **THEN** the stream is not aborted for exceeding any duration limit

#### Scenario: The timeout applies on both transports
- **WHEN** the runtime uses the `fetch`-based transport or the `XMLHttpRequest`-based transport
  to open the generation stream
- **THEN** a hung connect on either transport is classified as a network failure within the same
  connect-timeout window
