## ADDED Requirements

### Requirement: An unobserved verdict names the phase that kept it away
A run report whose containment verdict is `null` SHALL carry `unobservedPhase`, one of `module-eval | bundle | mount | deliver | probes | mount-timeout | none`, and a report with a boolean verdict SHALL carry none. The phase SHALL be the first cause the harness recorded and SHALL carry no message, source or symbol. Adding it SHALL leave the three-valued verdict, the diagnostics list and the `containment_unobserved` diagnostic unchanged.

#### Scenario: A module-scope throw is attributed to module evaluation
- **WHEN** a candidate throws at module scope (for example `new Intl.NumberFormat('en-US', { style: 'currency' })` outside any component), so it never paints and no probes frame arrives
- **THEN** the report's verdict is `null`, its diagnostics hold the `runtime_throw` and `containment_unobserved`, and `unobservedPhase` is `module-eval`

#### Scenario: An observed verdict carries no phase
- **WHEN** a nonce-authenticated probes frame reports a boolean verdict
- **THEN** the report has no `unobservedPhase`

### Requirement: The unobserved phase comes from the channel, never the message
The harness SHALL derive the phase only from the channel a cause arrived on: `module-eval` for a CDP `runtime_throw` or `unhandled_rejection` whose top stack frame is the candidate's own inserted script, recorded before any paint; `bundle`, `mount`, `deliver` or `probes` for the runtime loader's caught-error frame with that `where`; `mount-timeout` when the mount budget fired with no paint; and `none` when none of these was recorded. It SHALL NOT read message text to decide.

#### Scenario: A pre-paint hang is attributed to the mount budget
- **WHEN** a candidate wedges the renderer before its first paint
- **THEN** `unobservedPhase` is `mount-timeout`

#### Scenario: A loader probes failure is not attributed to the candidate
- **WHEN** the candidate paints and the runtime loader reports a `[probes]` error frame instead of a verdict
- **THEN** `unobservedPhase` is `probes`

#### Scenario: A throw after paint does not make the phase module-eval
- **WHEN** a candidate throws after the loader's `paint` frame has been relayed (for example from a timer armed by an effect, or an event handler), and the run then ends without a probes frame
- **THEN** `unobservedPhase` is `none`

#### Scenario: A throw before the relayed paint may be attributed to module evaluation
- **WHEN** a candidate throws from a first-render effect body, before the loader's `paint` frame is relayed, and no probes frame arrives
- **THEN** `unobservedPhase` MAY be `module-eval`, which only routes the candidate to repair and never delivers it

#### Scenario: A malformed verdict payload has phase none
- **WHEN** a nonce-authenticated probes frame arrives whose containment field is not a boolean
- **THEN** the verdict is `null` and `unobservedPhase` is `none`
