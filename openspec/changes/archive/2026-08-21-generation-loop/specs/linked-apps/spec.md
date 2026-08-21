## ADDED Requirements

### Requirement: Generation reads the group's accumulated schema, never the app's own artifact

Decision #52 D5's allocation contract SHALL be enforced, not merely recorded. When the device builds a
generation request for an installed entry, the applied schema it ships SHALL be read from the **live
database the entry writes to** — the storage group's accumulated `_meta` union, resolved through the same
`storageGroupId ?? id` rule that resolves the engine's app id — and SHALL NOT be taken from the entry's own
stored schema artifact. For a grouped entry these differ by construction: the union carries every member's
fields, the artifact only its own.

Reading the union SHALL apply no artifact and SHALL perform no DDL: asking what a database currently holds
must never alter it. An entry whose database does not exist yet SHALL read back as the empty applied schema,
not as an error.

#### Scenario: A grouped entry ships the whole group's union

- **WHEN** apps A and B share a storage group, each having added its own fields, and B's owner prompts an
  edit to B
- **THEN** the applied schema in B's generation request contains A's fields as well as B's

#### Scenario: The stored artifact is not the source

- **WHEN** an entry's stored schema artifact disagrees with the live database's accumulated union
- **THEN** the generation request carries the union, and the artifact is carried separately as the app's own
  declared schema

#### Scenario: Reading the union is side-effect-free

- **WHEN** the applied schema is read for an entry and the database is then inspected
- **THEN** the database's accumulated schema, tables, and rows are unchanged

#### Scenario: A brand-new group reads as empty

- **WHEN** the applied schema is read for an entry whose database has never been created
- **THEN** the result is the empty applied schema and no database file is created

### Requirement: New fields in a shared group are allocated above the group's floor

A generation for an entry in a storage group SHALL allocate any new burned field ID strictly above the
accumulated union's per-collection maximum ordinal, counting retired columns as burned. This is the
generation-time complement to the launch-time fail-closed guard: the guard catches a conflicting artifact
before the bundle runs, and this contract keeps the harness from producing one in the first place.
Divergent same-named fields under distinct burned IDs remain permitted and distinct across group members.

#### Scenario: A sharer's new field lands above the founder's highest ID

- **WHEN** the founder's fields occupy ordinals up to 7 in a collection and a sharer's generation adds a
  field to that collection
- **THEN** the delivered schema artifact's new field ID has an ordinal greater than 7

#### Scenario: An under-floor allocation never reaches the device

- **WHEN** a generated candidate allocates a field ID at or below the group's floor
- **THEN** the harness reports it and repairs the candidate, and no record carrying that allocation is
  delivered

#### Scenario: Same-named divergent fields still coexist

- **WHEN** two group members each add a field named "notes" under distinct burned IDs allocated above the
  floor at the time of each generation
- **THEN** both are delivered, both are distinct fields, and neither collides
