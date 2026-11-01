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
all — SHALL NOT be treated as contained under any circumstance: not after any number of attempts, not as a
fallback, not on a re-run, and not on a last attempt. The run stage SHALL split it by the unobserved phase
the harness reports (specs/synthetic-run "An unobserved verdict names the phase that kept it away").

An unobserved verdict whose phase is `module-eval`, `bundle` or `mount-timeout` means the candidate never
mounted by its own fault — it threw while its module was evaluated, left no app to mount, or hung before
its first paint — and SHALL be treated as a candidate fault, not as an unverified run. The run stage SHALL
send that candidate to repair with the harness's candidate diagnostics in context — message, line and hint,
exactly as for any other run-observed `runtime_throw`, `unhandled_rejection` or `mount_timeout`, and never a
`containment_*` diagnostic — spending one repair attempt, or ending the run as repair-exhausted when none is
left. That candidate SHALL never be delivered; only a later candidate that earns its own affirmative
verdict can be.

An unobserved verdict with any other phase (`mount`, `deliver`, `probes` or `none`) is a harness fault. The
run stage SHALL re-run the same candidate once, unchanged and not re-prompted, in a fresh browser context,
consuming no repair attempt; the re-run's verdict SHALL then be handled as a first run's would be, except
that a re-run whose verdict is still unobserved, whatever its phase, SHALL end the run immediately with a
`failure` terminal event, consuming no repair attempt and feeding nothing back to the model. No candidate
SHALL be re-run more than once for an unobserved verdict. This replaces the earlier rule that an unobserved
verdict is never re-run.

That terminal unobserved ending SHALL be a distinct outcome from a negative verdict, carrying its own
user-facing reason and the harness's own named unobserved-verdict diagnostic; the pipeline SHALL NOT report
it as a containment failure. Its reason SHALL say that the app could not be verified, and SHALL NOT assert
that the app was unsafe or that a breach was observed. Like every reason the device shows, it SHALL use
typographic apostrophes and the product glossary. Beyond the one harness-fault re-run, the candidate is not
rebuilt, re-executed, or re-prompted, and the device's existing retry affordance remains the recovery path.

No detail of a rejected forgery — its payload, its count, or the fact of it — SHALL reach any model-facing
path, because a diagnostic the candidate authored and the repair loop consumed would be a prompt-injection
channel.

#### Scenario: Containment failure short-circuits

- **WHEN** a candidate's run report reports a negative containment verdict
- **THEN** the run ends with a single `failure` terminal event, no repair prompt is built, and no candidate
  source or diagnostic derived from the escape attempt is sent back to the model

#### Scenario: An unobserved verdict short-circuits with its own reason

- **WHEN** a candidate's run report carries an unobserved containment verdict with phase `probes`, and its
  one re-run is unobserved too
- **THEN** the run ends with a single `failure` terminal event whose `reason` is
  "We couldn’t verify this app ran safely. Please try again." — distinct from the containment-failure
  reason, stating that the app could not be verified rather than that it was unsafe — and no repair
  prompt is built

#### Scenario: An unobserved verdict consumes no repair attempt and is never delivered

- **WHEN** a run's first candidate returns an unobserved containment verdict with phase `none` on its run
  and on its re-run
- **THEN** the terminal `failure` event's attempt count reflects that no repair attempt was spent, no
  `result` is emitted, and the candidate was run exactly twice

#### Scenario: A candidate that throws while its module loads is repaired

- **WHEN** the engineer's candidate throws at module scope, so the harness reports an unobserved verdict
  with phase `module-eval` and a `runtime_throw`, and the repair turn returns a working candidate
- **THEN** a `repair` stage runs with that `runtime_throw` (message, line, hint) in the repair prompt and no
  `containment_unobserved` detail, one repair attempt is spent, and the run ends in `result` with the
  repaired candidate

#### Scenario: A candidate that hangs before its first paint is repaired

- **WHEN** a candidate's run report carries an unobserved verdict with phase `mount-timeout`
- **THEN** the candidate goes to repair with its `mount_timeout` diagnostic and is not re-run

#### Scenario: A never-mounted candidate with no repair left ends as repair-exhausted

- **WHEN** a candidate whose run reports phase `module-eval` arrives after the repair budget is spent
- **THEN** the run ends in the repair-exhausted `failure`, not the unverified one, and nothing is delivered

#### Scenario: A harness-fault re-run can still deliver

- **WHEN** a candidate's first run is unobserved with phase `none` and its re-run reports an affirmative
  verdict with no error diagnostics
- **THEN** the run delivers that candidate in `result` without spending a repair attempt

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

### Requirement: A model turn that loses its provider is retried once
The pipeline SHALL retry a plan, generate or repair turn once with the same messages when the provider fails with an upstream error (5xx, 429, network or stream error), emitting a `restart` event first when the turn had already yielded token events, and SHALL end with the provider-unavailable terminal failure ("A run whose provider stays down ends with its own reason") if the retry also fails upstream; the failed attempt's usage SHALL still be metered. A plan turn streams no tokens, so its resend never emits `restart`.

#### Scenario: Provider drops before the first token
- **WHEN** the provider closes the stream before the turn's first token
- **THEN** the turn is sent once more without a `restart` event and the build can complete

#### Scenario: Provider drops mid-turn
- **WHEN** the provider fails after the turn yielded tokens
- **THEN** one `restart` event is emitted, the turn is sent once more, and the build can complete

#### Scenario: Second failure
- **WHEN** the retried turn fails upstream too
- **THEN** the run ends with the provider-unavailable terminal failure

#### Scenario: A plan turn that loses its provider is resent
- **WHEN** the plan turn fails with a `503` from the provider and its resend succeeds
- **THEN** no `restart` event is emitted, the run continues to generate, and the failed plan attempt's usage is metered

### Requirement: An unverified or failed containment verdict is logged without content
The pipeline SHALL log, at info with the request id, the verdict kind, the id of the check that tripped, the unobserved phase and whether the candidate was re-run whenever a run ends as `containment_failed` or `run_unverified`, and SHALL NOT log source, DOM or console text.

Every `terminal failure` line SHALL carry `phase`, one of `module-eval | bundle | mount | deliver | probes | mount-timeout | none` — the harness's unobserved phase for the run that ended the attempt, `none` when that run's verdict was observed or no run took place — and `rerun: true | false`. When the pipeline sends a never-mounted candidate to repair it SHALL log one info line `run never mounted` carrying the request id and the phase. Neither line SHALL carry a message, source, symbol or hint.

#### Scenario: Unverified run
- **WHEN** a run ends `run_unverified`
- **THEN** one log line carries the request id, the verdict kind, the check id, the phase and `rerun: true`, and no content

#### Scenario: A repaired never-mounted candidate leaves a trace
- **WHEN** a candidate with phase `module-eval` is sent to repair and the run later delivers
- **THEN** one `run never mounted` info line names phase `module-eval` and carries no message text

## ADDED Requirements

### Requirement: A run whose provider stays down ends with its own reason
When a plan, generate or repair turn still fails upstream after its one resend, the pipeline SHALL end the run, with no further repair, in exactly one `failure` terminal event whose `reason` is the `provider_unavailable` refusal hint, and SHALL record the terminal failure code `provider_unavailable`. That `failure` SHALL carry `cause: 'provider_unavailable'` for a client at protocol level 2 or above. A resend that fails for a reason that is not upstream SHALL end as that reason ends today.

#### Scenario: A generate turn that fails twice upstream
- **WHEN** the scripted model client fails the generate turn with a `502` stream error twice
- **THEN** the stream ends with one `failure` whose reason is "The AI service Whim uses is having trouble right now. It’s not something you did. Please try again in a little while." (no provider, model, status code or stage named), no repair stage runs, and the ledger row's failure reason is `provider_unavailable`

#### Scenario: The provider terminal carries its cause by level
- **WHEN** a generate turn fails upstream twice, once for a stream declaring level `2` and once for level `1`
- **THEN** the level-2 `failure` carries `cause: 'provider_unavailable'`, the level-1 `failure` has the same reason and no `cause`, and a run ending as `internal_error` or `credit_exhausted` carries no `cause`

#### Scenario: A plan turn that fails twice upstream
- **WHEN** the plan turn fails with a network error and its resend fails with a `429`
- **THEN** the run ends with the provider sentence and the code `provider_unavailable`

#### Scenario: A non-upstream second failure keeps its own ending
- **WHEN** the generate turn fails with a `503` and its resend fails with a `401`
- **THEN** the run ends with the generic internal-error reason and the code `internal_error`, not `provider_unavailable`, and a `402` on the resend still ends as `credit_exhausted`
