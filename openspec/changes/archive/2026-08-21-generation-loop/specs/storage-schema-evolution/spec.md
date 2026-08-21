## ADDED Requirements

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
