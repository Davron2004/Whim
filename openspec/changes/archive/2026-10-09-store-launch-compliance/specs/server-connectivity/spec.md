## MODIFIED Requirements

### Requirement: Saving a server address in Settings immediately probes it and shows the result inline
When the user saves a server address in Settings and AI-data consent is granted, the system SHALL probe the address and show the classification inline on the Settings screen. Saving SHALL succeed and persist regardless of the probe result — an address that probes unreachable or unverified is still saved. Without a current consent grant the system SHALL NOT probe, SHALL still save, and SHALL show a neutral line saying the address is checked once AI features are on.

#### Scenario: Saving a reachable, verified address
- **WHEN** the user enters an address that verifies
- **THEN** the address is saved and the screen shows a verified/reachable result

#### Scenario: Saving an unreachable address is not blocked
- **WHEN** the user enters an address that is currently unreachable (e.g. pre-configuring a
  server that isn't running yet) and saves it
- **THEN** the address is saved exactly as entered, and the screen shows an unreachable result
  rather than refusing the save

#### Scenario: Saving an unverified address shows a warning, not a hard failure
- **WHEN** the user enters an address that answers `/healthz` with 200 but without the Whim
  service identity
- **THEN** the address is saved and the screen shows a warning-toned result distinct from both
  the verified and unreachable results

#### Scenario: Saving without consent sends nothing
- **WHEN** a user without a consent grant saves a server address
- **THEN** the address is saved, no probe request is sent, and the screen shows the neutral
  "checked once AI features are on" line

### Requirement: A configured server is probed at startup and retried with capped exponential backoff until first success
Once AI-data consent is granted, the system SHALL probe the effective server (the saved override, or the compiled-in default) once: at startup when consent already exists, or at the moment consent is granted. Before consent, or after it is turned off, the connectivity state SHALL be unknown and no probe SHALL be scheduled. For retry
purposes, a 200 response of either classification (verified or unverified) SHALL count as a
successful probe — the verified/unverified distinction is informational only (per the
save-time-verification requirement) and does not affect the retry loop. On an unreachable
result, the system SHALL retry with
exponential backoff starting at ~2 seconds and doubling on each subsequent failure, capped at
~30 seconds, repeating perpetually until the first successful probe of the session. After the
first success, the system SHALL NOT schedule any further probe for the remainder of the session.
Turning consent off SHALL cancel any scheduled probe.

#### Scenario: Backoff doubles up to the cap
- **WHEN** the configured server stays unreachable across repeated startup retries
- **THEN** successive retry delays are approximately 2s, 4s, 8s, 16s, 30s, and remain at 30s on
  every attempt after the cap is reached

#### Scenario: The loop stops after the first success
- **WHEN** a retry attempt finally reaches the server
- **THEN** the connectivity state becomes online and no further scheduled probe occurs for the
  remainder of the session, even if the server later becomes unreachable again

#### Scenario: A 200-but-unverified startup probe still counts as success
- **WHEN** the startup probe reaches a listener that answers 200 without the Whim service
  identity
- **THEN** the retry loop treats it as a success and stops scheduling further probes

#### Scenario: No probe before consent
- **WHEN** the launcher starts with no consent grant
- **THEN** the connectivity state is unknown and no probe is sent or scheduled

#### Scenario: Granting consent starts the probe
- **WHEN** the user agrees on the consent screen
- **THEN** the effective server is probed right away, and the retry loop runs as above

#### Scenario: Revoking cancels the loop
- **WHEN** the retry loop is waiting on a scheduled probe and the user turns consent off
- **THEN** the scheduled probe is cancelled and the state returns to unknown

### Requirement: A real generation or rewrite call succeeding counts as the session's first success
Any successful response from the clarify, rewrite, or generate request paths, and any service refusal those paths receive (a structured `ApiError` whose `error` is a `ServiceRefusalCode`, which proves the Whim server answered), SHALL be treated as proof of connectivity equivalent to a successful dedicated probe: it SHALL transition the session
connectivity state to online and cancel any pending scheduled retry, even if the dedicated
startup probe has not yet succeeded on its own.

#### Scenario: A successful generation stops a still-retrying probe loop
- **WHEN** the startup probe loop is still retrying (server was unreachable at launch) and the
  user submits a prompt that completes successfully before the next scheduled probe fires
- **THEN** the connectivity state becomes online immediately and the pending scheduled probe is
  cancelled

#### Scenario: A refusal also proves reachability
- **WHEN** the startup probe loop is still retrying and a clarify request is refused with
  `server_busy`
- **THEN** the connectivity state becomes online and the pending scheduled probe is cancelled

## REMOVED Requirements

### Requirement: No server address configured is distinct from an unreachable configured address
**Reason**: A compiled-in production server means an address always exists (`release-config`), so "no address configured" can no longer happen. Its job, keeping `unknown` apart from `offline` when there is nothing to check, now belongs to the consent gate.
**Migration**: The unknown state now means "no current AI-data consent grant"; see the modified startup-probe requirement above and `ai-data-consent` "Nothing is sent to the server before consent is granted". Tests asserting unknown-with-no-address become tests asserting unknown-without-consent.
