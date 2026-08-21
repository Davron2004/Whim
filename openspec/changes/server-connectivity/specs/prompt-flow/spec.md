## ADDED Requirements

### Requirement: The compose entry point shows a server-unreachable notice without blocking generation
The prompt flow's entry point SHALL show a "server unreachable" notice when the session
connectivity state is offline and a server address is configured. The notice SHALL be advisory
only — it SHALL NOT prevent the user from submitting a prompt, and a submission that succeeds
SHALL proceed exactly as it would if the notice were absent (per `server-connectivity`'s "a real
generation succeeding counts as the session's first success").

#### Scenario: Notice shown while offline
- **WHEN** the user opens the prompt entry point while the connectivity state is offline
- **THEN** the screen shows a "server unreachable" notice

#### Scenario: Submitting while offline is still permitted
- **WHEN** the connectivity state is offline and the user submits a prompt
- **THEN** the request is sent exactly as it would be online, and the notice does not gate
  submission

#### Scenario: No notice when unconfigured
- **WHEN** no server address is configured
- **THEN** the existing "set an address in Settings" message is shown instead of the offline
  notice (unconfigured and offline are distinct, non-overlapping messages)
