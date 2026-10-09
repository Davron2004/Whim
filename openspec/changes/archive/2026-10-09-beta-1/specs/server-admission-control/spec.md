## ADDED Requirements

### Requirement: A generation that finds every slot busy waits in line on its stream
The server SHALL run the credit check, the daily-limit checks and the content policy before opening the stream, then, when every generation slot is busy, SHALL open the stream and hold the generation in a first-come-first-served line, emitting a `queued` event with its position on entry, on every position change and at least every 5 seconds. It SHALL start the generation when a slot frees, SHALL refuse with `429 server_busy` before opening a stream when the line already holds `WHIM_QUEUE_MAX` generations (default 50), and SHALL end a generation that waited `WHIM_QUEUE_MAX_WAIT_MS` (default 180000) with a terminal `failure` whose reason says Whim is busy. A generation SHALL NOT spend a daily unit until it gets a slot.

#### Scenario: Slot frees while waiting
- **WHEN** all slots are busy, a generation joins the line at position 1, and a slot frees 40 seconds later
- **THEN** the client receives `queued` events during the wait, then the normal stage events

#### Scenario: Order
- **WHEN** two generations wait and one slot frees
- **THEN** the one that joined first starts

#### Scenario: Line full
- **WHEN** the line already holds `WHIM_QUEUE_MAX` generations
- **THEN** a new generation is refused with `429 server_busy` and no stream is opened

#### Scenario: Waited too long
- **WHEN** a generation has waited `WHIM_QUEUE_MAX_WAIT_MS`
- **THEN** its stream ends with one terminal `failure` and no daily unit was spent

#### Scenario: Client leaves the line
- **WHEN** a waiting client disconnects or cancels, or the server starts draining
- **THEN** the generation leaves the line, holds no slot, spends no daily unit, and everyone behind it moves up

### Requirement: The production caps come from a load test of the production machine type
The server's default generation and synthetic-run concurrency caps, which the standard capacity profile runs with (the profile sets no server limit of its own), SHALL be the highest pair a recorded load test on the standard machine type sustained with p95 CPU under 70 % and no failed runs, and the operator runbook SHALL record the measurement.

#### Scenario: Profile applied
- **WHEN** the standard profile is deployed
- **THEN** the server runs with the load-tested caps and `docs/deploy.md` shows the run that justified them
