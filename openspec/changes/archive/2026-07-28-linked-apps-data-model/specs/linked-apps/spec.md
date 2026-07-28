# Delta Spec: linked-apps (new capability)

## ADDED Requirements

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
