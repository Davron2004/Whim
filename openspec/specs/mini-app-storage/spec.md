# mini-app-storage Specification

## Purpose
TBD - created by archiving change mini-app-storage-engine. Update Purpose after archive.
## Requirements
### Requirement: Each mini-app's data is physically isolated in its own store

Each mini-app's user data SHALL live in its own physically separate SQLite database (one database file per app). An engine instance MUST be constructed bound to exactly one app's database handle, and the engine API MUST NOT accept any per-call app addressing — no parameter exists with which to name another app's store.

#### Scenario: Two apps with identical collections cannot see each other's data

- **WHEN** app A and app B each declare a collection with the same display name and each appends records to it
- **THEN** each app's engine instance lists only its own records, and the two databases are separate files on disk

#### Scenario: The API cannot express a cross-app read

- **WHEN** the full verb surface (`kv.*`, `records.*`) of an engine instance is inspected
- **THEN** no verb accepts an app identifier, database path, or any other store-addressing parameter

### Requirement: Storage is driven by product verbs, never SQL

The engine SHALL expose only the closed verb set — `kv.get/set/remove` and `records.append/list/update/remove` — and all SQL MUST be host-authored. Caller-supplied **values** (keys, record field values, filter comparison values) MUST only ever be bound as SQL parameters, never interpolated into statement text. Caller-supplied **identifiers** (collection and field names) cannot be parameters and MUST instead be resolved through the applied schema to engine-minted burned IDs; an unresolvable name MUST raise a structured error and MUST NOT be concatenated into SQL. There MUST be no code path by which caller-supplied text reaches a SQL statement string.

#### Scenario: SQL metacharacters in values are inert data

- **WHEN** a record is appended whose field value contains SQL metacharacters (quotes, semicolons, `'); DROP TABLE c1;--`) and is later read back via a `where` filter using that same string
- **THEN** the value round-trips byte-identical, the filter matches it as a literal, and every executed statement is one of the fixed host-authored templates with the dangerous input present only in the bound-parameter array

#### Scenario: An injection attempt through a field or collection name is rejected, not interpolated

- **WHEN** `list`, `update`, or `append` is called with a collection or `where`/`orderBy` field name that is not a declared name (including one crafted to carry SQL metacharacters)
- **THEN** the call fails with a structured `unknown_collection` / `unknown_field` error, no SQL is executed with that name, and the engine's storage is unchanged

#### Scenario: Every executed statement is a known host-authored template

- **WHEN** the injection test block exercises every verb with adversarial keys, values, field names, and collection names
- **THEN** the set of executed SQL statement texts is exactly the fixed host-authored template set (verified by capturing executed statements), with no statement constructed from caller input

### Requirement: Record writes operate at record granularity

`records.append` SHALL write only the new record, and `records.update` SHALL set only the fields named in its patch. An update MUST NOT rewrite, serialize, or otherwise touch fields outside the patch.

#### Scenario: A partial update leaves unnamed fields intact

- **WHEN** a record with fields `{amount, note, category}` is updated with the patch `{amount: 12}`
- **THEN** `note` and `category` retain their prior values, including fields the calling code never read

### Requirement: Reads can be filtered, ordered, and bounded host-side

`records.list` SHALL accept `where` (per-field equality or range `gt/gte/lt/lte`, AND-composed), `orderBy` (one field, asc/desc), `limit`, and `offset`, evaluated in the engine — so a bounded query returns only the matching subset rather than the full collection.

#### Scenario: A time-bucketed query returns only the bucket

- **WHEN** a collection holds records spanning many dates and `list` is called with a `date` range `where`, an `orderBy`, and a `limit`
- **THEN** only records inside the range are returned, in the requested order, no more than `limit` of them

### Requirement: KV is for scalars and is size-capped

`kv.set` SHALL accept JSON-serializable values up to a configured size cap and MUST reject oversized values with a structured error whose hint directs the caller to `records.append`.

#### Scenario: An oversized KV write is rejected with a redirecting hint

- **WHEN** `kv.set` is called with a value exceeding the configured cap (e.g. an array of thousands of records)
- **THEN** the write is refused with a structured error `{kind, hint}` whose hint names the record verbs, and the existing value under that key is unchanged

### Requirement: An ephemeral mode exists for test runs

The engine SHALL support an ephemeral (`:memory:`) mode behind the identical verb surface, so smoke tests and synthetic runs never touch real user data and leave no trace.

#### Scenario: Ephemeral writes do not survive and do not leak

- **WHEN** an ephemeral engine instance for an app performs the full verb lifecycle and is closed, and a persistent instance for the same app is then opened
- **THEN** none of the ephemeral writes are present in the persistent store, and no database file was created for the ephemeral instance

### Requirement: Data survives app restarts

Data written through the engine SHALL persist across full app process kills and relaunches on the real device target.

#### Scenario: Kill and relaunch round-trip

- **WHEN** records and KV values are written, the app process is killed, and the app is relaunched
- **THEN** reopening the engine for the same app returns all written data intact

### Requirement: Storage operations feel interactive

Engine operations SHALL complete fast enough to feel interactive for realistic Tier-0 data sizes on the device target, and the measured latencies MUST be recorded in the decision log / DEVLOG.

#### Scenario: Verb latencies are measured and recorded on-device

- **WHEN** the on-device acceptance run exercises each verb against realistic data volumes
- **THEN** each operation completes within an interactive budget and the observed timings are written into `docs/decisions.md` / `DEVLOG.md`

