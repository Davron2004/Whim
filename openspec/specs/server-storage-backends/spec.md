# server-storage-backends Specification

## Purpose
TBD - created by archiving change durable-server-stores. Update Purpose after archive.
## Requirements
### Requirement: The operator selects one durable backend for every server store
The server SHALL keep its usage ledger, lifetime usage counters, reports and beta waitlist in one backend chosen by `WHIM_STORE_BACKEND`: `sqlite` (the default: `node:sqlite` files under `WHIM_DATA_DIR`) or `firestore` (a Firestore Native database named by `WHIM_FIRESTORE_DATABASE`, default `(default)`, in the project of the server's Google credentials). Boot, `whim-admin` and `whim-waitlist` SHALL obtain their stores from one factory, and no other production code SHALL construct a store class. Any other `WHIM_STORE_BACKEND` value SHALL fail boot, naming the variable and the allowed values.

#### Scenario: Default backend is unchanged
- **WHEN** the server boots with `WHIM_STORE_BACKEND` unset
- **THEN** all three stores are the `node:sqlite` stores under `WHIM_DATA_DIR`, exactly as before

#### Scenario: An unknown backend refuses to boot
- **WHEN** the server boots with `WHIM_STORE_BACKEND=postgres`
- **THEN** boot fails before listening, and the error names `WHIM_STORE_BACKEND` and the values `sqlite` and `firestore`

#### Scenario: An unreachable Firestore refuses to boot
- **WHEN** the server boots with `WHIM_STORE_BACKEND=firestore` and its credentials cannot read the database
- **THEN** boot fails before listening, naming the store backend, rather than failing on the first request

### Requirement: Records outlive every server instance on the Firestore backend
With `WHIM_STORE_BACKEND=firestore`, every record the stores hold SHALL persist independently of any server process, so stopping, replacing or scaling the server to zero instances SHALL NOT remove or reset any record or daily count.

#### Scenario: Waitlist signup survives scale-to-zero
- **WHEN** a signup is stored, every server instance stops, and a new instance starts
- **THEN** `whim-waitlist export` lists the signup with its original `created_at`

#### Scenario: Daily ceilings survive a restart
- **WHEN** a device uses its last generation of the UTC day and the server restarts
- **THEN** that device's next generation the same day is refused with reason `device`

### Requirement: Every backend honours the same store contracts
The in-memory, SQLite and Firestore implementations of `UsageStore`, `UsageRecordKeeping`, `ReportStore`, `ReportRecordKeeping` and `WaitlistStore` SHALL pass one shared conformance suite. The suite SHALL cover:
- admission order and limits;
- refund idempotence;
- first-outcome-wins settlement;
- the cost-state transitions;
- credit increments;
- report listing order and limit;
- waitlist upsert, order and removal;
- device export and delete;
- each retention cutoff.

All store methods SHALL be asynchronous, and each store SHALL expose `close()`.

#### Scenario: One suite, three backends
- **WHEN** the conformance suite runs
- **THEN** every case runs against in-memory, SQLite and the Firestore emulator, and any backend that diverges fails the suite

#### Scenario: Repeat waitlist signup on Firestore
- **WHEN** the same email signs up twice with different casing and surrounding spaces
- **THEN** the second call returns `updated`, one row exists, and its `created_at` is the first signup's

### Requirement: Admission is atomic on every backend
Each backend SHALL admit a request in one atomic step that checks the device limit, then the global limit, and records the request. Two concurrent admissions SHALL NOT both consume the last device or global unit. A refunded request SHALL free its unit exactly once. A reused request id SHALL be rejected without consuming a unit.

#### Scenario: Last-unit race on Firestore
- **WHEN** two admissions for the same device and kind race for that device's last unit of the day
- **THEN** exactly one is admitted and the other is refused with reason `device`

#### Scenario: Refund frees the unit once
- **WHEN** an admitted request is refunded twice
- **THEN** exactly one unit becomes available again

### Requirement: Retention purges run identically on every backend
The report, ledger, idle-usage and waitlist purges SHALL delete the same records on every backend. They use the same cutoffs, which never exceed the disclosure manifest's maximums, and run at boot and hourly. Admission counters SHALL be deleted with the ledger day they count.

#### Scenario: Expired waitlist row purged on Firestore
- **WHEN** a waitlist row's `updated_at` is older than 730 days and the purge runs
- **THEN** the row is gone and a row updated within 730 days remains

### Requirement: Operators reach production records without a shell on the instance
`whim-admin` and `whim-waitlist` SHALL run from an operator's machine against the Firestore backend using the operator's Google credentials, with the same commands and output as against SQLite. No HTTP route SHALL expose these records.

#### Scenario: Export the waitlist from a laptop
- **WHEN** the operator runs the waitlist export with `WHIM_STORE_BACKEND=firestore` and project-owner credentials
- **THEN** it prints the production waitlist as the same CSV the SQLite backend prints

### Requirement: A SQLite data directory can be imported into Firestore
`whim-admin import-sqlite --data-dir <dir>` SHALL copy every waitlist row, report, lifetime usage counter and ledger request from the SQLite files in `<dir>` into the configured Firestore database. It SHALL keep their ids and timestamps, rebuild the admission counters for imported days, and print per-store counts. Running it again SHALL change nothing.

#### Scenario: Import is idempotent
- **WHEN** the import runs twice against the same data directory
- **THEN** both runs report the same counts and the Firestore record set after the second run equals the set after the first

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

