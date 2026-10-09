# store-age-signals Specification

## Purpose
TBD - created by archiving change legal-surface-v2. Update Purpose after archive.
## Requirements
### Requirement: The launcher checks the store's age signal before the terms step
Before showing the terms step, the launcher SHALL ask the platform for the store's age signal (Apple Declared Age Range on iOS, Play Age Signals on Android) when no age-check outcome is stored, when the stored one is older than 30 days, or when the stored one is blocked. It SHALL reduce the answer to one of `adult`, `minor-approved`, `minor-not-approved`, `under-13` or `unavailable`. `minor-not-approved` SHALL keep the AI features off and show a message saying a parent can approve Whim through the store. `under-13`, when the store's age range says the user is under 13, SHALL keep the AI features off and show a message saying Whim's AI features are for people 13 and over. Every other result SHALL let the flow continue. On iOS, where a withdrawn parental approval reaches only the developer's server, the device never produces `minor-not-approved`. Unsupported OS versions, regions without a signal, and API errors SHALL count as `unavailable`.

#### Scenario: An approved minor continues
- **WHEN** the signal reports a user under 18 whose parent approved through the store
- **THEN** the terms step opens as usual

#### Scenario: An unapproved minor is held
- **WHEN** the signal reports a user under 18 without the store's parental approval
- **THEN** the terms step does not open, the parental-approval message shows, no request is sent, and installed apps keep working

#### Scenario: A user under 13 is held
- **WHEN** the store's age range for the user has an upper bound below 13
- **THEN** the AI features stay off, the launcher shows the 13-and-over message, and the terms step is not shown

#### Scenario: No signal lets the user through
- **WHEN** the platform API is unavailable or fails
- **THEN** the flow continues to the terms step

### Requirement: Age data stays on the phone and only the outcome is kept
The launcher SHALL keep only `{ outcome: 'allowed' | 'blocked', checkedAt }` from an age check, and SHALL discard the raw signal once the outcome is derived. Nothing about age SHALL be sent to the server, logged off the device, or added to any request, so the disclosure manifest does not change.

#### Scenario: The raw signal is not stored
- **WHEN** an age check completes
- **THEN** the key-value store holds only the outcome and its date, with no age range or birth-date field

#### Scenario: Nothing about age leaves the phone
- **WHEN** a request is sent after an age check
- **THEN** its headers and body carry no age or age-check field

### Requirement: The age check ends within a deadline
The launcher SHALL resolve the store age check within 3 seconds of starting it, and SHALL treat a native call that has not settled by then as the `unavailable` signal, reduced through the same rules as any other answer.

#### Scenario: The native call never settles
- **WHEN** the age-signal read neither resolves nor rejects
- **THEN** after 3 seconds the check reduces to `unavailable` and the legal flow continues to the terms step

#### Scenario: A timely answer is used unchanged
- **WHEN** the native call answers within 3 seconds
- **THEN** that answer is reduced exactly as before and the deadline has no effect

### Requirement: A supervised minor's guardian acknowledges a significant terms change
The launcher SHALL request the platform's significant-change acknowledgment on iOS when this pass's age signal is `minor-approved` and the stored terms acceptance is for an older terms version than the current one. It SHALL keep AI features off when the guardian declines, SHALL proceed when the acknowledgment is unavailable or does not settle within its own 60-second deadline (it waits on a person, so the 3-second age-check deadline does not apply to it), and SHALL store only the outcome keyed by terms version, never the raw age signal.

#### Scenario: Guardian acknowledges
- **WHEN** a `minor-approved` user whose accepted terms are older than the current terms reaches the age-check phase and the guardian acknowledges
- **THEN** the flow continues to the terms step and the acknowledgment is not requested again for that terms version

#### Scenario: Guardian declines
- **WHEN** the guardian declines the acknowledgment
- **THEN** AI features stay off, as for `minor-not-approved`

#### Scenario: Not requested for adults or current terms
- **WHEN** the age signal is anything other than `minor-approved`, or the accepted terms are current
- **THEN** no acknowledgment is requested

#### Scenario: Unavailable
- **WHEN** the acknowledgment API is missing (older iOS), errors, or does not settle within 60 seconds
- **THEN** the flow proceeds as if acknowledged for this pass only

