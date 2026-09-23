## MODIFIED Requirements

### Requirement: Every model call goes through an injectable client

The pipeline SHALL reach a language model only through a `ModelClient` interface supplied at construction:
streaming text deltas, a resolved `Usage`, and the provider's generation id. The OpenRouter wrapper SHALL be
one adapter behind that interface, and the deterministic test suites SHALL run a scripted client that
replays recorded turns. No test in any gate SHALL make a live API call: the suites SHALL install a
transport that fails loudly if any request to the provider host is attempted, and SHALL pass with
`OPENROUTER_API_KEY` absent from the environment. Model ids SHALL be caller parameters read from the
environment per role (the rewrite and engineer models, plus the optional clarify, summary, plan and repair
overrides that fall back to them) and SHALL NOT be hard-coded into any call site.

#### Scenario: The gate never reaches the network

- **WHEN** the deterministic server suite runs with `OPENROUTER_API_KEY` unset and a transport that throws
  on any request to the provider host
- **THEN** every pipeline test passes and the throwing transport is never invoked

#### Scenario: The model id is a parameter

- **WHEN** the roster is configured with a given engineer model id and a generation runs
- **THEN** that id appears verbatim in the outgoing request the adapter builds, and no other model id
  appears anywhere in the pipeline source

#### Scenario: A model failure is an honest failure

- **WHEN** the scripted client raises the wrapper's auth error mid-generate
- **THEN** the run ends with a single `failure` terminal event whose `reason` is user-facing prose, the
  stream closes cleanly, and no credential or provider detail is leaked into the stream

## ADDED Requirements

### Requirement: Every model call states its reasoning mode

Every model call SHALL carry an explicit reasoning setting — `off`, `on`, `low`, `medium`, `high`, or
`default` — taken from its role's roster entry and never left to the provider's default by omission. The
role defaults SHALL be: clarify `off`, rewrite `off`, summary `off`, plan `on`, engineer (generate) `on`, and
repair the engineer's effective setting, each overridable through `WHIM_CLARIFY_REASONING`,
`WHIM_REWRITE_REASONING`, `WHIM_SUMMARY_REASONING`, `WHIM_PLAN_REASONING`, `WHIM_ENGINEER_REASONING` and
`WHIM_REPAIR_REASONING`. The content-policy classifier SHALL always use `off`, whatever the rewrite role's
setting. A value outside the allowed set SHALL fail configuration loading with an error naming the variable
and the allowed values. Every model call SHALL also carry its role label (`policy`, `clarify`, `rewrite`, `summary`, `plan`, `generate` or
`repair`).

#### Scenario: Latency-critical calls default to reasoning off

- **WHEN** the roster is loaded with only `WHIM_REWRITE_MODEL` and `WHIM_ENGINEER_MODEL` set, and a
  classifier check, a clarify, a rewrite and a post-run summary each make their model call
- **THEN** each of those four requests carries the `off` setting

#### Scenario: Engineer turns keep reasoning and the thinking signal

- **WHEN** a generation runs under the default roster
- **THEN** the plan, generate and repair requests carry the `on` setting, and reasoning deltas still
  surface as `thinking` events

#### Scenario: Repair can think less than the first draft

- **WHEN** `WHIM_ENGINEER_REASONING` is `on` and `WHIM_REPAIR_REASONING` is `off`
- **THEN** generate requests carry `on`, repair requests carry `off`, and with `WHIM_REPAIR_REASONING`
  unset repair requests carry whatever the engineer's setting is

#### Scenario: A role override is honored and stays local

- **WHEN** `WHIM_CLARIFY_REASONING` is `low` and every other reasoning variable is unset
- **THEN** the clarify request carries `low` and every other role keeps its default

#### Scenario: The classifier cannot be switched to reasoning

- **WHEN** `WHIM_REWRITE_REASONING` is `on`
- **THEN** the rewrite request carries `on` and the classifier request still carries `off`

#### Scenario: A misspelled setting fails at boot

- **WHEN** `WHIM_PLAN_REASONING` is `fast`
- **THEN** configuration loading fails with an error naming `WHIM_PLAN_REASONING` and listing the
  allowed values, and no server starts

### Requirement: Per-role model overrides fall back to the two roster models

Clarify, summary, plan and repair SHALL each read an optional model id from `WHIM_CLARIFY_MODEL`,
`WHIM_SUMMARY_MODEL`, `WHIM_PLAN_MODEL` and `WHIM_REPAIR_MODEL`. When unset or empty, clarify and summary
SHALL use `WHIM_REWRITE_MODEL`, and plan and repair SHALL use `WHIM_ENGINEER_MODEL`. `WHIM_REWRITE_MODEL` and
`WHIM_ENGINEER_MODEL` SHALL remain required, and the content-policy classifier SHALL keep using the rewrite
model.

#### Scenario: The two-variable configuration behaves as before

- **WHEN** only `WHIM_REWRITE_MODEL` and `WHIM_ENGINEER_MODEL` are set
- **THEN** clarify, rewrite, summary and classifier requests carry the rewrite model id, and plan,
  generate and repair requests carry the engineer model id

#### Scenario: Overrides route only their own role

- **WHEN** `WHIM_CLARIFY_MODEL` and `WHIM_PLAN_MODEL` are set to two other model ids
- **THEN** clarify requests carry the clarify override, plan requests carry the plan override, rewrite
  and classifier requests still carry the rewrite model id, and generate and repair requests still carry
  the engineer model id
