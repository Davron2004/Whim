## MODIFIED Requirements

### Requirement: Every backend honours the same store contracts
The in-memory, SQLite and Firestore implementations of `UsageStore`, `UsageRecordKeeping`, `ReportStore`, `ReportRecordKeeping` and `WaitlistStore` SHALL pass one shared conformance suite. The suite SHALL cover:
- admission order and limits;
- refund idempotence;
- first-outcome-wins settlement;
- the cost-state transitions;
- credit increments;
- report listing order and limit;
- waitlist upsert, order and removal;
- the waitlist's news-consent rules, including a withdrawal no signup undoes;
- waitlist removal fingerprints: kept on removal, refusing a later signup, lifted by restore;
- reading an unmigrated opt-out-model waitlist row;
- device export and delete;
- each retention cutoff.

All store methods SHALL be asynchronous, and each store SHALL expose `close()`.

#### Scenario: One suite, three backends
- **WHEN** the conformance suite runs
- **THEN** every case runs against in-memory, SQLite and the Firestore emulator, and any backend that diverges fails the suite

#### Scenario: Repeat waitlist signup on Firestore
- **WHEN** the same email signs up twice with different casing and surrounding spaces
- **THEN** the second call returns `updated`, one row exists, and its `created_at` is the first signup's

#### Scenario: Sticky withdrawal on Firestore
- **WHEN** an email signs up with news consent, signs up again without it, then signs up a third time with it
- **THEN** the row has no news consent after the third call, as on the other two backends

#### Scenario: Concurrent signup and removal on Firestore
- **WHEN** a signup and a removal for the same email race
- **THEN** either no row exists and the fingerprint is kept, or the signup is refused as `suppressed`; a row never exists alongside its fingerprint

### Requirement: Retention purges run identically on every backend
The report, ledger, idle-usage and waitlist purges SHALL delete the same records on every backend. They use the same cutoffs, which never exceed the disclosure manifest's maximums, and run at boot and hourly. Admission counters SHALL be deleted with the ledger day they count. The waitlist purge SHALL delete removal fingerprints kept more than 730 days ago as well as rows.

#### Scenario: Expired waitlist row purged on Firestore
- **WHEN** a waitlist row's `updated_at` is older than 730 days and the purge runs
- **THEN** the row is gone and a row updated within 730 days remains

#### Scenario: Expired fingerprint purged on Firestore
- **WHEN** a removal fingerprint was kept more than 730 days ago and the purge runs
- **THEN** the fingerprint is gone, a fingerprint kept within 730 days remains, and the purge's `waitlist:` line counts both kinds

### Requirement: A SQLite data directory can be imported into Firestore
`whim-admin import-sqlite --data-dir <dir>` SHALL copy every waitlist row, waitlist removal fingerprint, report, lifetime usage counter and ledger request from the SQLite files in `<dir>` into the configured Firestore database. It SHALL keep their ids and timestamps, carry each waitlist row's news-consent fields, rebuild the admission counters for imported days, and print per-store counts. Running it again SHALL change nothing.

#### Scenario: Import is idempotent
- **WHEN** the import runs twice against the same data directory
- **THEN** both runs report the same counts and the Firestore record set after the second run equals the set after the first

#### Scenario: An opt-out-model SQLite file imports into the opt-in model
- **WHEN** the data directory's `waitlist.db` still has the `updates_opt_out` column with one ticked row
- **THEN** that row arrives in Firestore with no news consent and a withdrawal, and its email, platform, notice id and timestamps are unchanged
