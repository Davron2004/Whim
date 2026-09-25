## ADDED Requirements

### Requirement: Clarify and plan writing stay inside what a mini-app can do
The clarify and plan-writing prompts SHALL be built from one list of things a mini-app cannot do (at least: network and live data, notifications while closed, other people's devices), SHALL instruct the model not to offer them, and clarify SHALL answer a request whose core needs one of them with a `limit` naming the reason and the nearest buildable alternative instead of questions.

#### Scenario: Weather request
- **WHEN** a user asks for a weather app
- **THEN** clarify returns a `limit` whose alternative is buildable without live data, and no questions

#### Scenario: Partly impossible request
- **WHEN** a request is buildable except for one impossible extra (e.g. reminders while the app is closed)
- **THEN** clarify offers no option for the extra and the plan says plainly it is left out

#### Scenario: List and registry agree
- **WHEN** the capability registry gains a capability that the list names as missing
- **THEN** the server suite fails until the list is updated

### Requirement: A model turn that loses its provider is retried once
The pipeline SHALL retry a generate or repair turn once with the same messages when the provider fails with an upstream error (5xx, 429, network or stream error), emitting a `restart` event first when the turn had already yielded token events, and SHALL end with today's terminal failure if the retry also fails; the failed attempt's usage SHALL still be metered.

#### Scenario: Provider drops before the first token
- **WHEN** the provider closes the stream before the turn's first token
- **THEN** the turn is sent once more without a `restart` event and the build can complete

#### Scenario: Provider drops mid-turn
- **WHEN** the provider fails after the turn yielded tokens
- **THEN** one `restart` event is emitted, the turn is sent once more, and the build can complete

#### Scenario: Second failure
- **WHEN** the retried turn fails too
- **THEN** the run ends with the same terminal failure as today

### Requirement: An unverified or failed containment verdict is logged without content
The pipeline SHALL log, at info with the request id, the verdict kind and the id of the check that tripped whenever a run ends as `containment_failed` or `run_unverified`, and SHALL NOT log source, DOM or console text.

#### Scenario: Unverified run
- **WHEN** a run ends `run_unverified`
- **THEN** one log line carries the request id, the verdict kind and the check id, and no content

### Requirement: A no-change summary requires unchanged source
For a change request, the pipeline SHALL let the delivered summary claim no change only when the delivered source is byte-identical to the source the request started from.

#### Scenario: Source changed
- **WHEN** the delivered source differs from the starting source and the summariser says nothing changed
- **THEN** the summary is replaced by a neutral line that does not claim no change

### Requirement: Provider quantization floor is operator-configurable
The pipeline SHALL send `provider.quantizations` to OpenRouter when `WHIM_PROVIDER_QUANTIZATIONS` is set and SHALL send routing unchanged when it is unset.

#### Scenario: Unset
- **WHEN** `WHIM_PROVIDER_QUANTIZATIONS` is not set
- **THEN** the provider object is identical to today's
