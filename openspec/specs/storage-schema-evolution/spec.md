# storage-schema-evolution Specification

## Purpose
TBD - created by archiving change mini-app-storage-engine. Update Purpose after archive.
## Requirements
### Requirement: Storage is schema-declared with burned identities as physical keys

Each generation SHALL declare its collections and fields in a schema artifact. Every collection and field carries a stable burned ID, and the physical storage key (table name, column name) MUST be the burned ID, never the display name. A rename SHALL be a display-name change over the same ID, requiring no DDL and no data movement.

#### Scenario: A rename serves existing data unchanged

- **WHEN** a field's display name changes between generations while its burned ID stays the same
- **THEN** previously written values are served under the new display name, and the physical column is untouched

### Requirement: Schema evolution is additive-only, enforced by static checks

The engine SHALL validate every incoming schema artifact against the last-applied one and MUST reject, with a structured fix-hint-carrying error, any non-additive change: a type change on an existing ID, reuse of any retired or existing ID, removal without tombstoning, or a new field lacking a default. The check logic SHALL be available as a pure function usable outside the engine (for generation-time static checks).

#### Scenario: A type change is rejected

- **WHEN** an artifact arrives in which an existing field ID's type differs from the applied artifact's type for that ID
- **THEN** the open is refused with a structured error naming the collection and field and carrying a fix hint, and the database is unmodified

#### Scenario: A new field without a default is rejected

- **WHEN** an artifact adds a field to an existing collection without declaring a default
- **THEN** the open is refused with a structured error, since old rows could not be read forgivingly

### Requirement: Field deletion is a tombstone; identities are never reused

Deleting a field SHALL retire its burned ID forever (tombstone) while retaining the stored data. A later field with the same display name MUST receive a fresh ID and MUST NOT collide with the retired field's data.

#### Scenario: A reused display name cannot resurrect stale data

- **WHEN** a field is tombstoned and a later generation declares a new field with the same display name
- **THEN** the new field gets a new burned ID backed by a new column, reads of it return its own values (or defaults), and the tombstoned column's data remains physically intact

### Requirement: Rollback and roll-forward never lose data

A generation whose artifact omits fields that a newer generation declared SHALL be accepted without any DDL: the engine MUST leave unaddressed columns untouched, so writes by older code cannot strip newer fields, and rolling back then rolling forward loses nothing.

#### Scenario: Old code preserves a newer generation's field

- **WHEN** generation N+1 adds a field and writes values, the app rolls back to generation N (whose artifact lacks that field), generation N updates existing records, and the app rolls forward to N+1
- **THEN** the values generation N+1 wrote are still present on every record generation N touched

### Requirement: DDL is engine-derived and restricted to two forms

The agent SHALL never author DDL. The engine MUST derive all DDL from the artifact diff, and the only DDL forms it may ever execute are `CREATE TABLE` and `ALTER TABLE ADD COLUMN`.

#### Scenario: An additive diff produces only the two allowed forms

- **WHEN** an artifact adds one new collection and one new field to an existing collection
- **THEN** the engine executes exactly one `CREATE TABLE` and one `ALTER TABLE ADD COLUMN` (with the declared default), and no other DDL form is ever observed in any test run

#### Scenario: A rollback-shaped diff produces no DDL

- **WHEN** an artifact arrives that is an older subset of the applied schema
- **THEN** the open succeeds with zero DDL executed

### Requirement: The accumulated schema is readable without applying anything

The storage engine SHALL expose a read-only way to obtain a database's **accumulated** applied-schema union
without opening it for use and without applying any schema artifact. Reading SHALL perform no DDL, SHALL
not create the database when it does not exist (reading back the empty applied schema instead), and SHALL
leave the accumulated `_meta` union, the tables, and the rows byte-identical. The read SHALL be reachable
by callers that cannot load the engine's native binding — it SHALL live with the engine's pure schema
functions, importable without pulling the native-backed barrel in.

#### Scenario: Reading changes nothing

- **WHEN** a database's accumulated schema is read and the database is then compared with its prior state
- **THEN** `_meta`, every table, and every row are unchanged

#### Scenario: A never-created database reads as empty

- **WHEN** the accumulated schema is read for an app id whose database has never been created
- **THEN** the result is the empty applied schema and no file is created

#### Scenario: Retired columns are part of the union

- **WHEN** a database has had a field tombstoned and its accumulated schema is read
- **THEN** the retired column is present in the union alongside the active ones

### Requirement: The burned-ID floor is a pure, exported function

The engine SHALL export a pure function that, given an applied schema, reports the per-collection
**burned-ID floor** — the maximum ordinal among that collection's active and retired columns. It SHALL be
importable without the native binding (the harness runs it off-device), SHALL count retired columns
exactly like active ones (a tombstoned ID stays burned), and SHALL report no floor for a collection the
applied schema does not contain. It is the single definition of "past the union's max" that the harness's
checks and prompts both use — neither re-derives it.

#### Scenario: Retired IDs raise the floor

- **WHEN** a collection has active columns up to ordinal 3 and a retired column at ordinal 9
- **THEN** the reported floor for that collection is 9

#### Scenario: An unknown collection has no floor

- **WHEN** the floor is requested for a collection absent from the applied schema
- **THEN** no floor is reported for it, and a first allocation in that collection is unconstrained

#### Scenario: Importable without the native binding

- **WHEN** the function is imported from a Node process with no native storage binding available
- **THEN** the import succeeds and the function evaluates

