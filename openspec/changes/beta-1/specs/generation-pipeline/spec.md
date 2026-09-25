## ADDED Requirements

### Requirement: Clarify and plan writing stay inside what a mini-app can do
The clarify and plan-writing prompts SHALL be built from one list of things a mini-app cannot do (at least: network and live data, notifications while closed, other people's devices), SHALL instruct the model not to offer them, and SHALL instruct it to turn an impossible request into the nearest buildable version stated plainly in the plan.

#### Scenario: Weather request
- **WHEN** a user asks for a weather app
- **THEN** clarify offers no live-data option and the plan describes a buildable alternative and says live weather isn't possible

#### Scenario: List and registry agree
- **WHEN** the capability registry gains a capability that the list names as missing
- **THEN** the server suite fails until the list is updated

### Requirement: An engineer turn is retried once before anything reached the device
The pipeline SHALL retry a generate or repair turn once with the same messages when the provider fails with an upstream error (5xx, 429, network or stream error) before the turn yielded any token event, and SHALL keep today's terminal failure otherwise; the failed attempt's usage SHALL still be metered.

#### Scenario: Provider drops before the first token
- **WHEN** the provider closes the stream before the turn's first token
- **THEN** the turn is sent once more and the build can complete

#### Scenario: Provider drops after tokens were streamed
- **WHEN** the provider fails after the turn yielded tokens
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
