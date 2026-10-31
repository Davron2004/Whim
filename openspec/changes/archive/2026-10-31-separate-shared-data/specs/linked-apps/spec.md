## ADDED Requirements

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
