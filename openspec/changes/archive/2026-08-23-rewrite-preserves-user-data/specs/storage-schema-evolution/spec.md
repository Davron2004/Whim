## ADDED Requirements

### Requirement: Abandoning a burned identity orphans data; it never migrates it

An artifact that stops declaring a collection id or a field id the database already contains SHALL leave that table or column physically intact and untouched, and the engine SHALL NOT delete, move, rename, or migrate the data it holds.

Data under an abandoned id is unreachable from code that no longer names the id — it is orphaned, not lost, and not recovered by any engine behaviour. The engine SHALL NOT treat abandonment as an error (an older artifact legitimately omits newer fields), which is exactly why generation-time checks, not the engine, are responsible for preventing a new generation from abandoning an id its predecessor used.

#### Scenario: A replaced collection id leaves the old rows intact

- **WHEN** an artifact declaring collection id `c2` is applied to a database whose accumulated schema contains `c1` with rows
- **THEN** the open succeeds, `c1` and every row in it are byte-identical afterwards, and reads through the new artifact see none of them

#### Scenario: An omitted field's column survives

- **WHEN** an artifact omitting an existing field id is applied and records are then updated through it
- **THEN** the omitted column is untouched on every record the update wrote
