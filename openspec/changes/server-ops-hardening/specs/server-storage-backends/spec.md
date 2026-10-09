## ADDED Requirements

### Requirement: A lost commit reply never credits usage twice
Every backend SHALL apply one `credit` call to a device's lifetime token totals at most once, including when the backend's client retries a commit whose reply was lost after the commit landed.

On the Firestore backend, `credit` SHALL run in one transaction. That transaction reads a credit marker document named by an id the store mints once per `credit` call, applies the increments and creates the marker only when the marker is absent, and does nothing when it is present. This mirrors how `admit` recognizes its own row through its per-call `admissionId`. A marker SHALL hold only the UTC day it was written. It SHALL NOT hold a device id, token counts, or any request content.

Because the generate route awaits the credit inside an open stream, the Firestore `credit` transaction SHALL give up after at most 5 attempts, far fewer than an admission's 25. When the credit fails, the route SHALL log it, still forward the run's own terminal event, and leave the run's tokens to cost reconciliation.

The retention purge SHALL delete markers written before the previous UTC day, so a marker outlives any client retry window and is never kept longer than that.

The `UsageStore.credit(deviceId, usage)` signature and its callers SHALL NOT change. Concurrent `credit` calls for one device SHALL still sum exactly.

#### Scenario: A credit whose commit reply is lost counts once
- **WHEN** a Firestore `credit` of 100 total tokens runs through a client that replays every commit it sends (transactional and plain) as the SDK does after a lost reply
- **THEN** the device's lifetime `totalTokens` grows by exactly 100

#### Scenario: The check is not satisfied by a transaction without a marker
- **WHEN** the same replaying client drives a `credit` that increments inside a transaction but keeps no per-call marker
- **THEN** the lost-reply conformance case fails, so the case cannot be satisfied by wrapping the increment in a transaction alone

#### Scenario: Concurrent credits still sum
- **WHEN** five `credit` calls for one device run concurrently on every backend
- **THEN** the device's totals equal the sum of all five

#### Scenario: A credit that keeps failing gives up and the stream still ends
- **WHEN** every attempt of a Firestore `credit` fails with a retryable error
- **THEN** the credit rejects after 5 attempts, writing nothing, and a generate stream whose in-stream credit fails still ends in exactly one terminal event

#### Scenario: Markers are purged after a day
- **WHEN** the purge runs on a UTC day after a credit marker's day plus one
- **THEN** that marker is gone, and a marker written the previous UTC day or later remains
