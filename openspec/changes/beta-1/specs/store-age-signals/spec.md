## ADDED Requirements

### Requirement: The age check ends within a deadline
The launcher SHALL resolve the store age check within 3 seconds of starting it, and SHALL treat a native call that has not settled by then as the `unavailable` signal, reduced through the same rules as any other answer.

#### Scenario: The native call never settles
- **WHEN** the age-signal read neither resolves nor rejects
- **THEN** after 3 seconds the check reduces to `unavailable` and the legal flow continues to the terms step

#### Scenario: A timely answer is used unchanged
- **WHEN** the native call answers within 3 seconds
- **THEN** that answer is reduced exactly as before and the deadline has no effect

### Requirement: A supervised minor's guardian acknowledges a significant terms change
The launcher SHALL request the platform's significant-change acknowledgment on iOS when this pass's age signal is `minor-approved` and the stored terms acceptance is for an older terms version than the current one. It SHALL keep AI features off when the guardian declines, SHALL proceed when the acknowledgment is unavailable or exceeds the age-check deadline, and SHALL store only the outcome keyed by terms version, never the raw age signal.

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
- **WHEN** the acknowledgment API is missing (older iOS), errors, or exceeds the deadline
- **THEN** the flow proceeds as if acknowledged for this pass only
