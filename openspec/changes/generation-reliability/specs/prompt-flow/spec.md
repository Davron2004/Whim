## MODIFIED Requirements

### Requirement: Failure is shown by kind, honestly, never as a crash

A `failure` terminal event or a stream error SHALL show the Failure page: the ember out, "Couldn't make this", one sentence and actions chosen by failure kind as in `system.md` §8 (couldn't run with or without a rewording hint, server refused for now, needs a newer Whim, stopped when Whim closed, connection dropped), "Your other apps are untouched" (or "Your current version still works" when changing), a collapsed "What happened" timeline, and Discard in the body with a 6 s Undo. A dropped connection SHALL never suggest rewording. A connection problem before any run (clarify or rewrite unreachable) SHALL NOT open this page; the current page SHALL show a notice with Try again. A service refusal SHALL be presented as `service-refusals` specifies. Diagnostic detail SHALL be limited to each diagnostic's `hint`; no failure reason SHALL be a transport message, and an unknown reason SHALL show the server's text. The Failure page SHALL offer no report action for any failure kind, so a provider outage never prompts a report. A `failure` whose structured `cause` is `provider_unavailable` SHALL lead with the retry action and SHALL NOT advise rewording; a failure with no cause, or a cause this build does not know, SHALL behave as before.

#### Scenario: Offline mid-run

- **WHEN** the stream drops because the phone went offline
- **THEN** the page reads "I lost the connection to the server partway through." and Try again enables when the phone is back online

#### Scenario: A provider outage shows the server's sentence and no report prompt

- **WHEN** a run ends with a `failure` whose reason is "The AI service Whim uses is having trouble right now. It’s not something you did. Please try again in a little while."
- **THEN** the Failure page shows that sentence verbatim, offers a retry action, and offers no report action

#### Scenario: A provider-caused failure leads with retry and never advises rewording

- **WHEN** a run ends with a `failure` whose `cause` is `provider_unavailable`
- **THEN** the Failure page shows the server's sentence, its first action is the retry action, "Change the description" is not offered, and no report action is offered, also when the failed run is reopened from its tile

#### Scenario: A failure with an unknown cause behaves as before

- **WHEN** a `failure` carries a `cause` value this build does not know
- **THEN** the page chooses its kind and actions exactly as for a failure with no cause
