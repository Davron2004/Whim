## ADDED Requirements

### Requirement: The flow benchmark drives the device's flow end to end

`server/flowbench.mjs` SHALL, for each selected case of an eval-set manifest, post `/v1/clarify` with the
case prompt, answer every returned question with its first option, post `/v1/rewrite` with the prompt and
those answers, and post `/v1/generate` with the rewritten prompt and the same answers — the request shapes
the device sends — against the server URL given on the command line, under a fresh device id per case. It
SHALL reach the server over HTTP only and SHALL import nothing from the server besides contract types.
Cases SHALL come from `--eval-set <dir>` (a directory holding a `manifest.json`) filtered by `--cases`, and
`--parallel <n>` SHALL bound how many cases run at once. It SHALL exit `0` when every case delivered a
`result`, `1` when any case did not, and `2` on invalid arguments or an unreadable eval set.

#### Scenario: The flow reaches generate with the device's shapes

- **WHEN** the benchmark runs one case against a server whose clarify returns two questions and whose
  rewrite returns a rewritten prompt
- **THEN** the rewrite request carries the case prompt and both questions answered with their first
  options, the generate request carries the rewritten prompt and the same two answers, and all three
  requests carry the same syntactically valid device id

#### Scenario: Bad arguments are refused

- **WHEN** the benchmark is started without a server URL or with an eval-set path holding no manifest
- **THEN** it exits `2` without sending any request

### Requirement: The report times every phase and stage

For each case the report SHALL record every phase's HTTP status and wall-clock duration, and for generate:
the time to the stream's first event, each stage's duration from its `start` to its `done` event (attempt
qualified for repairs), the repair count, the time from the last stage's `done` to the terminal event, and
the terminal outcome — for a failure, its reason and attempt count. It SHALL print one table row per case,
print per-phase median and maximum durations across the run, and write the whole report as JSON to the
path given by `--json`.

#### Scenario: Stage durations come from the stage events

- **WHEN** a generate stream emits plan, generate, check and run stage events with `start` and `done`,
  then a `result`
- **THEN** the report holds a non-negative duration for each of those stages and for the stretch between
  the last `done` and the `result`, and their order matches the events

#### Scenario: A failed generation is reported with its reason

- **WHEN** the generate stream ends with a `failure` event
- **THEN** the case's outcome is `failure` with that event's reason and attempt count, and the run exits
  `1`

### Requirement: Delivered sources feed the corpus-eval scorer

With `--save-sources <dir>`, the benchmark SHALL write each delivered app's source to `<dir>/<caseId>.ts`,
so `evals/cli.mjs run --eval-set <set> --source-dir <dir>` scores exactly the benchmarked output. A case
without a delivered app SHALL write no file.

#### Scenario: A delivered source is saved byte for byte

- **WHEN** the benchmark runs two cases with `--save-sources` and one ends in `result`, the other in
  `failure`
- **THEN** the first case's file holds the `result` event's `app.source` byte for byte and no file exists
  for the second

### Requirement: Policy-unavailable retries are opt-in and counted

With `--retries <n>`, a phase answered `503` with the `policy_unavailable` error SHALL be re-posted up to
`n` times. The report SHALL record how many retries each phase used, and the phase's duration SHALL cover
every attempt. Without the flag, the first `503` SHALL be reported as that phase's outcome.

#### Scenario: A transient refusal is retried when asked

- **WHEN** the server answers the first clarify post with `503 policy_unavailable` and the second with
  `200`, and the benchmark runs with `--retries 1`
- **THEN** the clarify phase reports status `200`, one retry, and a duration covering both posts

#### Scenario: Without retries the refusal is the result

- **WHEN** the server answers clarify with `503 policy_unavailable` and the benchmark runs without
  `--retries`
- **THEN** the clarify phase reports status `503` with the `policy_unavailable` error and zero retries
