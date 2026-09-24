## ADDED Requirements

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
