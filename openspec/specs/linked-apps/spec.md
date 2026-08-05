# linked-apps Specification

## Purpose
Two launcher entries may deliberately share one user-data database — so a fork, or an app
continued from a restored version, can keep using the data its original accumulated instead of
starting empty. Sharing is host-mediated and decided once, at creation; it is never something a
bundle can see, choose, or address. Created by archiving change linked-apps-data-model.

## Requirements
### Requirement: Storage groups are host-mediated and decided at creation
Launcher entries MAY belong to a storage group whose members share one storage-engine database. Group membership SHALL be recorded on the installed-app record at creation time and SHALL be immutable thereafter (no join/leave/unlink in v1). The engine appId a realm is bound to SHALL resolve host-side through the storage group (founding entry's id when grouped, own id otherwise); the bundle SHALL never see, choose, or address a storage group, and no syscall SHALL gain any app- or store-addressing parameter.

#### Scenario: Shared group reads the same data
- **WHEN** app B is created into app A's storage group, A writes records, and B is then launched
- **THEN** B's engine reads the records A wrote, from the same database file

#### Scenario: Ungrouped default is today's behavior
- **WHEN** an app is installed or forked without sharing
- **THEN** it is bound to its own database file exactly as before this change

#### Scenario: No sandbox-visible surface
- **WHEN** the syscall surface and the bundle-visible environment of a grouped app are inspected
- **THEN** no group id, appId choice, or store-addressing parameter is expressible from inside the sandbox

### Requirement: Rewind continuations share by default
An app created by continuing from a restored version (rewind + new prompt, wired by prompt-flow) SHALL join the original's storage group by default, with no question asked. The creation seam SHALL accept the sharing decision as an explicit parameter so the continuation path and the explicit-fork path use the same mechanism.

#### Scenario: Continuation keeps the user's data
- **WHEN** a continuation entry is created from app A with sharing requested
- **THEN** the new entry joins A's storage group and its first launch reads A's existing user data

### Requirement: Storage deletion is refcount-gated
Deleting a launcher entry SHALL always remove its index entry, and SHALL delete the group's database file only when no remaining installed entry resolves to that group. Deleting the founding member while sharers remain SHALL keep the file and the survivors' access intact.

#### Scenario: Founder deleted first
- **WHEN** apps A (founder) and B share a group and A is deleted
- **THEN** the database file survives and B still reads and writes its data

#### Scenario: Last member deleted
- **WHEN** the final remaining member of a group is deleted
- **THEN** the database file is deleted with it

### Requirement: Schema collisions on shared storage fail closed at launch
When a grouped app launches with a schema artifact that conflicts with the database's accumulated schema (same burned field ID with a different type or tombstone-violating meaning), the launch SHALL abort before the bundle runs, surfacing a structured error rendered as honest product copy. User data SHALL never be silently corrupted or coerced. Divergent same-named fields with distinct burned IDs are NOT a conflict: each line sees its own field, and additive-only evolution guarantees neither line can destroy the other's data.

#### Scenario: Conflicting artifact aborts pre-delivery
- **WHEN** apps A and B share a group and B launches with an artifact reusing one of A's burned field IDs at a different type
- **THEN** B's launch fails closed with a structured error before its bundle executes, and the shared data is unchanged

#### Scenario: Divergent same-named fields coexist
- **WHEN** A and B each add a field named "notes" under distinct burned IDs
- **THEN** both launch normally and each sees only its own "notes" field

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
