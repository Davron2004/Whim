## ADDED Requirements

### Requirement: The build screen shows derived activity signals alongside the stage sentence

While a generation request streams, the build screen SHALL additionally render, alongside the
existing stage sentence: the elapsed time since the request started, and a rising output-size
counter reflecting cumulative generated-output characters observed so far. Both signals SHALL be
derived aggregates only — no raw `token` text or raw `diagnostic` field SHALL be rendered as part
of, or alongside, either signal.

#### Scenario: Elapsed time renders and advances

- **WHEN** a generation request has been streaming for some duration
- **THEN** the build screen shows an elapsed-time value reflecting that duration, and the value
  advances as the stream continues

#### Scenario: The output-size counter rises with generated output

- **WHEN** `token` events carrying generated output arrive during a stream
- **THEN** the build screen's output-size counter increases to reflect the cumulative character
  count, without displaying any of the token text itself

### Requirement: A stall heartbeat visibly reports when the stream goes quiet

The build screen SHALL track the time since the last `token` or `stage` event arrived. When that
quiet period exceeds a threshold of approximately 8 seconds, the screen SHALL visibly report that
the stream has gone quiet, stating how long it has been quiet (e.g. "quiet for Ns"). The heartbeat
SHALL clear its quiet indication as soon as a new `token` or `stage` event arrives.

#### Scenario: A stalled stream shows a quiet indication

- **WHEN** more than approximately 8 seconds pass with no `token` or `stage` event arriving
- **THEN** the build screen shows a quiet indication stating the elapsed quiet duration

#### Scenario: A resumed stream clears the quiet indication

- **WHEN** a quiet indication is showing and a new `token` or `stage` event arrives
- **THEN** the quiet indication clears immediately

#### Scenario: A healthy stream shows no quiet indication

- **WHEN** `token` or `stage` events keep arriving within the ~8 second threshold
- **THEN** no quiet indication is shown

### Requirement: The build screen offers a details affordance into the run timeline

The build screen SHALL offer an affordance that, when activated, shows the current attempt's run
timeline (this change's `generation-run-journal` capability) rendered as a readable list. This
affordance MUST NOT render raw `token` text or raw `diagnostic` `kind`/`symbol`/`message` values.

#### Scenario: The details affordance opens the timeline

- **WHEN** the user activates the build screen's details affordance during or after a run
- **THEN** the current attempt's run timeline is shown as a readable list of stage transitions and
  output growth, with no raw token or diagnostic internals

### Requirement: The failure screen includes a what-happened timeline section

The failure screen SHALL include a "what happened" section rendering the failed attempt's run
timeline as a readable list — stage transitions with durations, output growth, and the failure
detail already permitted on this screen (`reason` and each diagnostic's `hint`). This section is
in addition to, not a replacement for, the existing checklist panel.

#### Scenario: A failure's timeline is shown on the failure screen

- **WHEN** the failure screen renders for a `failed` or `interrupted` pending-build record
- **THEN** a "what happened" section shows the recorded stage transitions, their durations, and
  output growth, alongside the existing checklist

#### Scenario: The timeline section carries no engineering detail beyond what the screen already permits

- **WHEN** the "what happened" section is inspected
- **THEN** every piece of failure detail it shows is a `reason` string or a diagnostic `hint`, and
  no `kind`, `symbol`, or raw `message` value appears

### Requirement: Dev mode adds diagnostics and repair-attempt counts to the run timeline

The run timeline SHALL additionally show the number of diagnostics observed and the number of
repair attempts observed for the attempt when the host's explicit developer-diagnostics flag is
enabled (the project's `__DEV__ || <explicit flag>` convention — never a bare `__DEV__` check).
This additional detail SHALL NOT appear when the flag is disabled.

#### Scenario: Dev mode shows additional counts

- **WHEN** the developer-diagnostics flag is enabled and the run timeline is shown
- **THEN** it additionally shows the diagnostics count and the repair-attempts count observed for
  that attempt

#### Scenario: Non-dev builds show no additional counts

- **WHEN** the developer-diagnostics flag is disabled
- **THEN** the run timeline shows no diagnostics count and no repair-attempts count
