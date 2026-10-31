## MODIFIED Requirements

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
