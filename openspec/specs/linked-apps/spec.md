# linked-apps Specification

## Purpose
Two launcher entries may deliberately share one user-data database — so a fork, or an app
continued from a restored version, can keep using the data its original accumulated instead of
starting empty. Sharing is host-mediated and decided once, at creation; it is never something a
bundle can see, choose, or address. Created by archiving change linked-apps-data-model.

## Requirements

### Requirement: Storage groups are host-mediated and decided at creation
Launcher entries MAY belong to a storage group whose members share one storage-engine database, and only a rewind continuation SHALL be able to create a new group membership; "Make a copy" SHALL never place a copy into its original's group, whichever answer the person gives (see `app-data-copy`). Group membership SHALL be recorded on the installed-app record at creation time and SHALL be immutable thereafter (no join/leave/unlink in v1). Copies that joined an original's group before this rule (#52's shared copies) SHALL keep their membership and keep working unchanged; nothing SHALL detach them or move their data automatically. The engine appId a realm is bound to SHALL resolve host-side through the storage group (founding entry's id when grouped, own id otherwise); the bundle SHALL never see, choose, or address a storage group, and no syscall SHALL gain any app- or store-addressing parameter.

#### Scenario: Shared group reads the same data
- **WHEN** app B is created into app A's storage group as a rewind continuation, A writes records, and B is then launched
- **THEN** B's engine reads the records A wrote, from the same database file

#### Scenario: Ungrouped default is today's behavior
- **WHEN** an app is installed or copied
- **THEN** it is bound to its own database file

#### Scenario: A copy never joins its original's group
- **WHEN** the person makes a copy of app A (grouped or not) and chooses either "Copy the data" or "Start fresh"
- **THEN** the copy's record carries no storage group and its engine appId is its own launcher id

#### Scenario: A legacy shared copy keeps sharing
- **WHEN** copy B joined founder A's group before this change, and the launcher starts after this change ships
- **THEN** B's record still names A's group, A and B still read and write one store, and deleting either keeps the other's data intact

#### Scenario: No sandbox-visible surface
- **WHEN** the syscall surface and the bundle-visible environment of a grouped app are inspected
- **THEN** no group id, appId choice, or store-addressing parameter is expressible from inside the sandbox

### Requirement: Rewind continuations share by default
An app created by continuing from a restored version (rewind + new prompt, wired by prompt-flow) SHALL join the original's storage group by default, with no question asked. The creation seam SHALL expose sharing only through a dedicated continuation entry point (`StoreAccess.continueSharingData`), and the copy entry point (`StoreAccess.fork`) SHALL have no parameter that can express sharing, so no "Make a copy" caller can request it.

#### Scenario: Continuation keeps the user's data
- **WHEN** a continuation entry is created from app A through the continuation entry point
- **THEN** the new entry joins A's storage group and its first launch reads A's existing user data

#### Scenario: The copy entry point cannot share
- **WHEN** the options accepted by `StoreAccess.fork` are inspected and every combination is exercised
- **THEN** no combination produces an entry whose storage group is set

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

### Requirement: A group member becomes independent by copying, never by leaving its group
The launcher SHALL NOT take an existing entry out of its storage group or move a group's data into a member's own store, whether a person asks for it or the launcher would do it by itself at launch or at any other time. A person who wants an app that no longer shares saved data SHALL get one by making a copy of a group member with "Copy the data" (see `app-data-copy`): the copy holds the group's data as of that moment in its own store and belongs to no group. Deleting the member afterwards SHALL follow the refcount rule unchanged. This route SHALL work the same from a sharer, from the last remaining member of a group, and from the founder. Whether a member has saved data to copy SHALL be decided from the store it resolves to, never from its own id, so the copy question is not skipped for a sharer. A process death at any point of the route SHALL leave every app that still has an entry with its complete data and SHALL NOT leave any entry bound to a partial store. A copy's database file that no entry resolves to SHALL be deleted by the launch sweep, which retries at each launch until the delete succeeds.

#### Scenario: A sharer is separated by copying
- **WHEN** B shares founder A's group, the person makes a copy C of B with "Copy the data", and then deletes B and its Undo window ends
- **THEN** C holds every record and kv value the group held when the copy was made, in a database file of its own, with no storage group; A's database file is byte-identical to what it was before the copy; and A still reads and writes it

#### Scenario: The last member is separated by copying
- **WHEN** founder A was deleted earlier, B is the only entry left in A's group, the person makes a copy C of B with "Copy the data", and then deletes B and its Undo window ends
- **THEN** the group's database file is deleted with B, and C still opens with all of its data

#### Scenario: The founder is separated by copying
- **WHEN** B shares founder A's group, the person makes a copy C of A with "Copy the data", and then deletes A and its Undo window ends
- **THEN** C holds the group's data in its own file with no storage group, and B still reads and writes the group's database file

#### Scenario: The question is asked for a sharer
- **WHEN** B shares founder A's group, the group's store holds saved data, no database file exists under B's own id, and the person chooses "Make a copy" on B
- **THEN** the launcher asks "Copy the data, or start fresh?" and "Copy the data" gives the copy the group's data; it does not start fresh without asking

#### Scenario: Killed while the copy's entry is being written
- **WHEN** the process is killed between any two writes that record C as a launcher entry
- **THEN** after relaunch either C is on the grid with its complete data, or the index holds no entry for C and C's database file is gone; no state exists in which C's file is kept and C is not shown

#### Scenario: Killed between the copy and the delete
- **WHEN** the process is killed after C's launcher entry is written and before the person deletes B
- **THEN** after relaunch A, B and C are all present, A and B still share one complete store, C has its complete copy, the copy journal is empty, and a second launch changes nothing

#### Scenario: Killed while the sharing app is being deleted
- **WHEN** the process is killed after B's delete was started and before it finished, whether or not B's entry was already removed
- **THEN** the next launch finishes deleting B, the group's database file survives if any entry still resolves to it and is deleted if none does, and C's data is unchanged

#### Scenario: Launch separates nothing
- **WHEN** the launcher starts on a phone that holds grouped entries, with or without copy journal records left by a closed process
- **THEN** every entry's storage group is what it was before the launch, and the only database files removed are those of a delete the person had already started and of copies that never got an entry

### Requirement: No operation on an existing entry changes its storage group
An existing entry's storage group SHALL stay what the app index recorded when the entry was created, through every launcher operation short of deleting the entry: a rebuild, a rewind continuation's first build, going back to a version, a tile change, and a delete followed by Undo. An operation that rewrites the entry's record, or that reads its group to place a copy or a continuation, SHALL take the group from the index's current record for that entry, not from the entry object its caller holds. An entry that shares a group before such an operation MUST read the same database file after it, and an entry with its own store MUST still have its own.

#### Scenario: A rebuild keeps a sharer in its group
- **WHEN** B shares founder A's group, A has saved records, and a change to B is delivered
- **THEN** B's record still names A's group and B's next launch reads the records A saved

#### Scenario: A continuation's first build reads the original's data
- **WHEN** the person goes back to an older version of A, asks for a change, and the build is delivered as a new entry
- **THEN** the new entry's record names A's group after the build's record is written, and its first launch reads A's saved data

#### Scenario: The caller's object cannot move an app between stores
- **WHEN** a rebuild is delivered with an entry object whose storage group differs from the index's record for that entry (a sharer's object with the group removed or replaced, or an ungrouped app's object with a group added)
- **THEN** the written record carries the group the index held, and the app opens the same database file as before

#### Scenario: Going back, a tile change and Undo leave the group alone
- **WHEN** B shares founder A's group and the person goes back to an older version of B, changes B's tile, and deletes B and then taps Undo
- **THEN** after each of these B's record still names A's group and B reads the same data as before

### Requirement: A launcher record is never written for an entry the index no longer holds
A rebuild, a rewind continuation and a copy SHALL be refused when the app index no longer holds the entry they were asked to act on. The check SHALL run inside the same serialized section as the operation's writes and before any of them, and a refused operation MUST write no launcher record, no version and no database file. A new entry's record SHALL become visible through one write: a process death while an entry is being added MUST leave either the whole entry or none.

#### Scenario: A build lands after its app was deleted
- **WHEN** a change to B is being made, another entry keeps B's version history alive, B is deleted and its delete completes, and the build is then delivered
- **THEN** the delivery is refused, the index holds no entry for B, no new entry was created, and no database file exists under B's id or its former group's id unless another entry resolves to it

#### Scenario: A continuation is not made from a deleted app
- **WHEN** the person went back to an older version of B, a change is being made, B is deleted and its delete completes, and the build is then delivered
- **THEN** the delivery is refused and no new entry joins B's former group

#### Scenario: A copy is not made from a deleted app
- **WHEN** a copy is requested with an entry object for an app the index no longer holds
- **THEN** the request is refused before the copy journal, the version store or any database file is written

#### Scenario: Killed while a new entry is being added
- **WHEN** the process is killed between the writes that add a new entry to the index
- **THEN** after relaunch the index either lists the entry with its record or reports no entry for that id, and adding an entry under that id later lists it once
