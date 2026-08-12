## MODIFIED Requirements

### Requirement: The run stage is the synthetic harness, and containment failure is terminal

The run stage SHALL execute the candidate through the synthetic run harness against the built bundle, and
SHALL derive its verdict only from the harness's report. Error-severity runtime diagnostics SHALL send the
candidate to repair. A run report whose containment verdict is negative SHALL end the run **immediately
with a `failure` terminal event, consuming no repair attempt and feeding nothing back to the model** — the
loop does not iterate on escape attempts. A truncated run SHALL be reported as such rather than treated as
a pass. The pipeline SHALL NOT reimplement, approximate, or relax any part of the harness's containment,
gate, or page assembly.

A run report whose containment verdict is **unobserved** — the harness heard no authenticated verdict at
all — SHALL also end the run immediately with a `failure` terminal event, consuming no repair attempt and
feeding nothing back to the model, and SHALL NOT be treated as contained under any circumstance: not after
any number of attempts, not as a fallback, and not on a last attempt. It SHALL be a distinct outcome from a
negative verdict, carrying its own user-facing reason and the harness's own named unobserved-verdict
diagnostic; the pipeline SHALL NOT report it as a containment failure. Its reason SHALL say that the app
could not be verified, and SHALL NOT assert that the app was unsafe or that a breach was observed. An
unobserved verdict SHALL NOT be automatically re-run: the candidate is not rebuilt, re-executed, or
re-prompted, and the device's existing retry affordance remains the recovery path.

No detail of a rejected forgery — its payload, its count, or the fact of it — SHALL reach any model-facing
path, because a diagnostic the candidate authored and the repair loop consumed would be a prompt-injection
channel.

#### Scenario: Containment failure short-circuits

- **WHEN** a candidate's run report reports a negative containment verdict
- **THEN** the run ends with a single `failure` terminal event, no repair prompt is built, and no candidate
  source or diagnostic derived from the escape attempt is sent back to the model

#### Scenario: An unobserved verdict short-circuits with its own reason

- **WHEN** a candidate's run report carries an unobserved containment verdict
- **THEN** the run ends with a single `failure` terminal event whose `reason` is
  "We couldn't verify this app ran safely. Please try again." — distinct from the containment-failure
  reason, stating that the app could not be verified rather than that it was unsafe — and no repair
  prompt is built

#### Scenario: An unobserved verdict consumes no repair attempt and is never delivered

- **WHEN** a run's first candidate returns an unobserved containment verdict
- **THEN** the terminal `failure` event's attempt count reflects that no repair attempt was spent, no
  `result` is emitted, and the candidate is not re-run

#### Scenario: A runtime throw is repaired

- **WHEN** a candidate mounts and then throws in a handler during the sweep
- **THEN** the run-observed diagnostic is forwarded and a repair attempt is made with it in context

#### Scenario: Truncation is not a pass

- **WHEN** a candidate's run exceeds the harness's total budget and the report is marked truncated
- **THEN** the run does not deliver on that candidate

#### Scenario: Forgery detail never reaches the model

- **WHEN** a candidate's run report records rejected forgeries and the run ends
- **THEN** no prompt the pipeline builds contains the forgery count, the forged payload, or any reference
  to the rejection
