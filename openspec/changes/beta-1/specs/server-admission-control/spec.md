## ADDED Requirements

### Requirement: A generation waits briefly for a slot before it is refused
The server SHALL hold a generation that finds every generation slot busy in a first-come-first-served wait of at most `WHIM_ADMISSION_WAIT_MS` (default 10000), admit it when a slot frees, and refuse it with `server_busy` only when the wait expires or the waiting list is full (`WHIM_ADMISSION_MAX_WAITERS`, default twice the generation cap). Configuration SHALL refuse a wait of 14000 ms or more.

#### Scenario: Slot frees during the wait
- **WHEN** all slots are busy and one is released 4 seconds after a new generation arrives
- **THEN** the waiting generation is admitted and streams normally

#### Scenario: Wait expires
- **WHEN** no slot frees within the wait
- **THEN** the request is refused with `429 server_busy` as today

#### Scenario: Order
- **WHEN** two generations wait and one slot frees
- **THEN** the one that arrived first is admitted

#### Scenario: Client leaves while waiting
- **WHEN** a waiting client disconnects or the server starts draining
- **THEN** the waiter is removed, holds no slot, and nothing is charged

#### Scenario: Unsafe wait refused at boot
- **WHEN** `WHIM_ADMISSION_WAIT_MS` is 14000 or more
- **THEN** the server refuses to start with a configuration error

### Requirement: The production caps come from a load test of the production machine type
The standard capacity profile SHALL set the generation and synthetic-run concurrency caps to the highest pair a recorded load test on that machine type sustained with p95 CPU under 70 % and no failed runs, and the operator runbook SHALL record the measurement.

#### Scenario: Profile applied
- **WHEN** the standard profile is deployed
- **THEN** the server runs with the load-tested caps and `docs/deploy.md` shows the run that justified them
