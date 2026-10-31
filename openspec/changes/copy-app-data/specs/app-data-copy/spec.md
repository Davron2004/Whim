## ADDED Requirements

### Requirement: Making a copy asks whether to copy the data or start fresh
When the person chooses "Make a copy" (tile menu) or "Make a copy from here" (History), the launcher SHALL ask one question, "Copy the data, or start fresh?", offering "Copy the data" and "Start fresh". Leaving the question without choosing SHALL create nothing. Either answer MUST give the copy its own storage-engine appId, its own launcher id. The copy MUST NOT be placed in the original's storage group. No answer exists that shares data between the copy and its original. All question copy SHALL come from the centralized copy table and pass the copy lint.

#### Scenario: Start fresh gives an empty store
- **WHEN** the person makes a copy of app A and chooses "Start fresh"
- **THEN** the copy opens with no saved data, and its store resolves to its own appId, never to A's

#### Scenario: Copy the data starts from A's data
- **WHEN** the person makes a copy of app A that has saved records and kv values and chooses "Copy the data"
- **THEN** the copy opens showing the same records and values A had at that moment, read from the copy's own database file

#### Scenario: Leaving the question makes nothing
- **WHEN** the person opens the question and then dismisses it or goes back
- **THEN** no launcher entry, version lineage or database file is created

### Requirement: The copy option is offered only behind the capability flag
`StoreAccess` SHALL expose a read-only `canCopyData` boolean. It SHALL be true exactly when a data-copy seam was injected at construction. The launcher SHALL show "Copy the data" only when `canCopyData` is true. Otherwise "Make a copy" SHALL behave as "Start fresh" with no question. `StoreAccess.fork` SHALL take `{ data: 'fresh' | 'copy' }`, with `'fresh'` as the default. A `'copy'` request on an instance without the seam MUST fail before any version-store or index write.

#### Scenario: No seam, no option
- **WHEN** the launcher is built with a `StoreAccess` constructed without the data-copy seam
- **THEN** `canCopyData` is false, "Make a copy" creates a fresh copy without asking, and no "Copy the data" control is rendered

#### Scenario: A copy request without the seam fails cleanly
- **WHEN** `fork(entry, undefined, { data: 'copy' })` is called on an instance without the seam
- **THEN** it rejects, and the index, the version store's lineages and the storage directory are unchanged

### Requirement: Copied data is a faithful snapshot of the whole store
"Copy the data" SHALL copy the source app's entire user-data store as one transaction-consistent snapshot into a new database file named for the copy's appId. The snapshot SHALL include:
- every collection table with all of its columns, active and retired;
- every kv entry;
- every record's engine-assigned id, unchanged;
- the `_meta` accumulated schema, unchanged.

The source store SHALL be the one the source resolves to: its storage group's store when the source is grouped, its own store otherwise. The copy MUST happen host-side only. No syscall, bundle-visible value or SDK surface SHALL change, and the bundle SHALL NOT be able to observe that its data was copied.

#### Scenario: Record ids survive the copy
- **WHEN** app A holds records with ids 3, 7 and 12, a kv value, and a retired field's column with data, and a copy is made with "Copy the data"
- **THEN** the copy's store holds the same ids with the same field values, the same kv value, the retired column with its data, and a `_meta` equal to A's

#### Scenario: A consistent snapshot while the source is open
- **WHEN** the source app's store has an open connection at the moment the copy runs
- **THEN** the copy reflects one committed state of the source, never a mixture of states before and after a concurrent write

#### Scenario: Copying a copy that already shares a group
- **WHEN** a legacy copy B is in founder A's storage group and the person makes a copy of B with "Copy the data"
- **THEN** the new copy gets the group's data in its own new file, and A and B keep sharing their group's store unchanged

### Requirement: A copy is all-or-nothing across crashes
A data copy SHALL become visible only through its launcher entry. That entry SHALL be written only after the copied store has been fully written, closed and verified: the integrity check passes, and its `_meta` contains every collection and field of the source's accumulated schema read before the copy. Before any byte of the copy is written, a persisted copy journal entry SHALL record the copy's appId. On every launch, before any app's store is opened, the launcher SHALL sweep the journal:
- an entry whose appId has a launcher entry SHALL be cleared;
- an entry whose appId has no launcher entry SHALL have that appId's database file deleted, and then be cleared.

A crash at any point SHALL therefore leave either no copy at all or a complete, verified copy. It SHALL never leave a launcher entry bound to a partially copied store.

#### Scenario: Crash during the snapshot
- **WHEN** the process is killed while the copy's database file is being written
- **THEN** after relaunch no launcher entry exists for the copy, its database file is gone, the journal is empty, and the original's data is unchanged

#### Scenario: Crash after the snapshot, before the entry
- **WHEN** the process is killed after the copy's file is complete but before its launcher entry is written
- **THEN** after relaunch the sweep deletes the file, no copy appears, and making a copy again succeeds

#### Scenario: Crash after the entry, before the journal is cleared
- **WHEN** the process is killed after the copy's launcher entry is written but before its journal entry is cleared
- **THEN** after relaunch the copy is present with all its data and the sweep only clears the journal entry

#### Scenario: A stray file never leaks into a fresh copy
- **WHEN** a database file already exists under the appId a new copy is about to use, and no launcher entry resolves to that appId
- **THEN** the file is deleted before the copy proceeds, and the new copy's data comes only from its source (or is empty for "Start fresh")

### Requirement: A failed copy creates nothing and says so
If the snapshot, its verification, or the entry write fails, the copy operation SHALL:
- delete any partially written database file;
- clear its journal entry;
- write no launcher entry;
- leave the original's data unchanged;
- reject with a structured error kind: `no_space`, `source_unreadable`, `verify_failed` or `io`.

The launcher SHALL show plain copy for the failure and SHALL offer "Start fresh" as the way forward. It SHALL NOT silently make an empty copy instead.

#### Scenario: Out of space
- **WHEN** the device runs out of space while the copy is written
- **THEN** no copy appears, no partial file remains, and the person is told there wasn't room to copy the data and offered "Start fresh"

#### Scenario: Verification fails
- **WHEN** the written copy fails its integrity check or its `_meta` lacks a field of the source's accumulated schema
- **THEN** the file is deleted, no entry is written, and the operation rejects with `verify_failed`

### Requirement: Copied schema evolves independently with no identity reuse
The copy's store SHALL carry the source's accumulated schema (the monotone union, including retired fields) as its own `_meta`, so the copy's burned-ID floor starts at the source's floor at copy time. After the copy:
- each app's generations SHALL read their own store's accumulated schema;
- each app SHALL allocate new burned IDs above its own floor;
- neither app SHALL ever reuse an identity burned before the copy;
- neither app's later schema changes SHALL appear in the other's store.

Identities burned independently after the copy live in separate stores that are never merged, so they cannot collide.

#### Scenario: Both evolve after the copy
- **WHEN** A's accumulated schema has fields up to ordinal 7 in a collection, a copy C is made with "Copy the data", then A adds a text field and C adds an integer field to that collection
- **THEN** each new field's ordinal is greater than 7, A's store has no column for C's field and C's store has none for A's, and both launch and read their pre-copy records unchanged

#### Scenario: A copy from an older version keeps the newer schema
- **WHEN** the person makes a copy from version 2 of A with "Copy the data" while A's current version has added fields after version 2
- **THEN** the copy runs version 2's code against a store whose `_meta` still holds every field A ever had, its first launch needs no schema change, and its next generation allocates above A's floor at copy time

### Requirement: Copies are fully independent after the copy
After a copy is made with either answer, writes, schema changes, and deletion in the copy or in the original SHALL NOT affect the other's user data. Deleting the original SHALL leave the copy's store intact. Deleting the copy SHALL delete its own store and SHALL NOT touch the original's.

#### Scenario: Writes stay on their side
- **WHEN** a copy C is made of A with "Copy the data", then A adds a record and C deletes a record that both had
- **THEN** A still has the record C deleted, and C does not have the record A added

#### Scenario: Deleting the original keeps the copy's data
- **WHEN** a copy C is made of A with "Copy the data" and A is deleted and its purge completes
- **THEN** C still launches with all of its data

### Requirement: Copying stays responsive and has no size cap
The copy SHALL run off the JavaScript thread on device. The triggering control SHALL show a busy state and SHALL NOT be re-triggerable for that app until the copy completes or fails. No size cap SHALL be imposed on the copied store; the only limit is free space. The copy of a 50 MB store SHALL complete within 5 seconds on the reference Android emulator and iOS simulator, measured by the on-device probe.

#### Scenario: Busy while copying
- **WHEN** the person chooses "Copy the data" on an app whose store takes noticeable time to copy
- **THEN** the control shows busy, a second "Make a copy" on that app is refused until the first finishes, and the shell keeps responding to touches

#### Scenario: Large store within budget
- **WHEN** the on-device probe copies a 50 MB store
- **THEN** the copy completes, verifies, and the measured time is reported and is at most 5 seconds
