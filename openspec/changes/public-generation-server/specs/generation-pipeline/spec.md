## ADDED Requirements

### Requirement: A run is bounded in wall-clock time
The pipeline SHALL enforce a total wall-clock budget per run (`WHIM_GENERATION_MAX_MS`, default 600000, constructor-injectable, measured on the injectable clock from the start of the run).

When the budget elapses before the run ends, the pipeline SHALL abort its in-flight model stream and synthetic run with the same teardown as a client abort. Unlike a client abort, it SHALL then end the stream as a completed run: exactly one `usage` event followed by exactly one `failure` terminal event. The failure's `reason` SHALL say in plain words that building took too long and invite a retry, and SHALL contain no stage name, duration, or internal term. A client abort that arrives first SHALL still end the stream without a terminal event, and a budget elapsing after a client abort SHALL emit nothing.

#### Scenario: A stalled model ends in one failure
- **WHEN** the scripted model client stops producing deltas mid-generate and the run's budget elapses on the test clock
- **THEN** the transport observes an abort, and the stream ends with one `usage` event and one `failure` terminal event whose reason is user-facing prose

#### Scenario: A client abort still ends silently
- **WHEN** the client aborts a run before its budget elapses
- **THEN** no terminal event is emitted, and none is emitted later when the budget would have elapsed

## MODIFIED Requirements

### Requirement: Aborted runs reconcile their authoritative usage

Because a cancelled generation may still have been billed upstream, the server SHALL record the provider's generation id for every model call a run makes and, on abort, SHALL reconcile authoritative post-abort token counts from the provider's generation-stats endpoint and credit them to the calling device.

The reconciliation SHALL use an injectable transport. Because the record resolves asynchronously upstream, it SHALL retry with a bounded number of attempts, a per-attempt timeout, and a bounded total time budget. It SHALL give up quietly on exhaustion rather than failing anything user-visible, and SHALL introduce no server-side persistence beyond the usage store.

Separately from token reconciliation, **every** run SHALL resolve its cost after it ends, whether delivered, failed, budget-expired, or aborted. Resolution reads the same generation-stats data for every recorded generation id through the same bounded transport and records the summed USD cost, or an explicit unresolved state, on the request's ledger row. Cost resolution SHALL NOT credit tokens for a run whose `usage` event was already credited, so no run's tokens are ever counted twice.

#### Scenario: Cancelled run credits the reconciled usage

- **WHEN** a run is cancelled after its model call started and the injected transport returns
  authoritative counts for the recorded generation id
- **THEN** those counts are credited to the calling device and are visible in the usage readback

#### Scenario: Reconciliation gives up quietly

- **WHEN** the transport never resolves a record within the retry budget
- **THEN** nothing is credited, no error surfaces to any client, and no state beyond an unresolved ledger mark is persisted

#### Scenario: No double counting

- **WHEN** a run completes normally and emits its `usage` event
- **THEN** the completed run's usage is credited exactly once, and the post-run stats lookup records cost without crediting tokens again

#### Scenario: A completed run's cost is recorded

- **WHEN** a delivered run made two model calls and the stats transport returns `total_cost` for both ids
- **THEN** the request's ledger row carries their sum as its cost
