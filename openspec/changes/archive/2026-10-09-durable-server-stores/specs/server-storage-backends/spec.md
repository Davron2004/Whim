## ADDED Requirements

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
