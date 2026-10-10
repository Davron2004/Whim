## MODIFIED Requirements

### Requirement: A configured server is probed at startup and retried with capped exponential backoff until first success

The system SHALL probe the effective server (the saved override, or the compiled-in default) once AI-data consent is granted: at startup when consent already exists, or at the moment consent is granted. Before consent, or after it is turned off, the connectivity state SHALL be unknown and no probe SHALL be scheduled. For retry
purposes, a 200 response of either classification (verified or unverified) SHALL count as a
successful probe — the verified/unverified distinction is informational only (per the
save-time-verification requirement) and does not affect the retry loop. On an unreachable
result, the system SHALL retry with
exponential backoff starting at ~2 seconds and doubling on each subsequent failure, capped at
~30 seconds, repeating perpetually until the first successful probe. While the server is reachable and the app is idle, the system SHALL NOT schedule periodic probes: a successful probe schedules nothing, so an idle online session sends no further probe, however long it stays open. Turning consent off SHALL cancel any scheduled probe.

An online session SHALL turn offline only on evidence, by one of two routes. First, a request of the app's own (clarify, rewrite or generate) fails at the network level, meaning no server answered it, AND one probe started after that failure is unreachable. A refusal, an HTTP error status, an unusable reply, or the person leaving the request is not a network-level failure, and a failed request whose probe succeeds SHALL NOT change the state. Second, a probe asked for by a return to the foreground (see "The retry loop runs only while the app is foregrounded") is unreachable AND the confirmation probe, sent after the first backoff step (~2 seconds), is unreachable too: one failed foreground probe alone SHALL NOT change the state. Once offline, the system SHALL keep to the backoff above while the app is in the foreground, and the state SHALL return to online on the first success, whether a probe or a real response.

#### Scenario: Backoff doubles up to the cap

- **WHEN** the configured server stays unreachable across repeated startup retries
- **THEN** successive retry delays are approximately 2s, 4s, 8s, 16s, 30s, and remain at 30s on
  every attempt after the cap is reached

#### Scenario: The loop stops after the first success

- **WHEN** a retry attempt finally reaches the server
- **THEN** the connectivity state becomes online and no further probe is scheduled while the server
  stays reachable and the app is idle

#### Scenario: An idle online session sends no probe

- **WHEN** the session is online, the app stays in the foreground on the home screen, and nothing is requested for an hour
- **THEN** no probe is sent after the startup probe, and no timer is waiting to send one

#### Scenario: A request that gets no answer, confirmed by a probe, turns the session offline

- **WHEN** a request of the app's own fails at the network level while the session is online, and the probe that follows is unreachable
- **THEN** the state becomes offline, the offline notice shows, and the backoff probes begin; the first probe that reaches the server returns the state to online and clears the notice

#### Scenario: A request that gets no answer while the server answers the probe changes nothing

- **WHEN** a request of the app's own fails at the network level while the session is online, and the probe that follows reaches the server
- **THEN** the state stays online and no further probe is scheduled

#### Scenario: A request the server answered is not a connectivity failure

- **WHEN** a request of the app's own is answered with an HTTP error status or a refusal
- **THEN** no probe is sent and the state is unchanged

#### Scenario: One failed foreground probe is not an outage

- **WHEN** the session is online, the app returns to the foreground, and that probe is unreachable
- **THEN** the offline notice does not show; it shows only if the confirmation probe, ~2 seconds later, is unreachable too

#### Scenario: A 200-but-unverified startup probe still counts as success

- **WHEN** the startup probe reaches a listener that answers 200 without the Whim service
  identity
- **THEN** the retry loop treats it as a success and schedules no further probe

#### Scenario: No probe before consent

- **WHEN** the launcher starts with no consent grant
- **THEN** the connectivity state is unknown and no probe is sent or scheduled

#### Scenario: Granting consent starts the probe

- **WHEN** the user agrees on the consent screen
- **THEN** the effective server is probed right away, and the retry loop runs as above

#### Scenario: Revoking cancels the loop

- **WHEN** the retry loop is waiting on a scheduled probe and the user turns consent off
- **THEN** the scheduled probe is cancelled and the state returns to unknown

### Requirement: The retry loop runs only while the app is foregrounded

The system SHALL NOT introduce any background or push-triggered scheduling for the connectivity loop: no probe SHALL be sent or scheduled while the app is not in the foreground, and an app that is merely inactive (the iOS app switcher, Control Center, a system sheet) counts as not in the foreground. Leaving the foreground SHALL cancel any pending probe. When the app returns to the foreground the system SHALL re-check the server with one probe, at most once per 10 seconds: a return less than 10 seconds after the previous probe SHALL send none, and an offline session then continues its backoff. The loop SHALL read the foreground state the host runtime reports and SHALL NOT depend on an operating-system network-status signal.

#### Scenario: Backgrounding pauses retries

- **WHEN** the app is backgrounded mid-retry-loop and later foregrounded
- **THEN** no retry attempt occurs while backgrounded, and on the return one probe is sent unless the previous probe was less than 10 seconds before

#### Scenario: Nothing runs in the background

- **WHEN** the app stays in the background for an hour, online or offline
- **THEN** no probe is sent and no timer is pending

#### Scenario: Returns inside the floor send one probe

- **WHEN** the previous probe was more than 10 seconds ago, and the app returns to the foreground, returns again 3 seconds later, and a third time after a further 10 seconds
- **THEN** the first return sends one probe, the second sends none, and the third sends another
