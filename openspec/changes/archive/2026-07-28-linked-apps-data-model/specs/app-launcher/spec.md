# Delta Spec: app-launcher

## ADDED Requirements

### Requirement: Explicit fork asks share-vs-fresh at fork time
When the user invokes the Fork action, the launcher SHALL ask one plain question before creating the new app: use the same saved data, or start fresh. The answer SHALL be threaded to the creation seam as the sharing decision. Rewind continuations SHALL NOT be asked (they share by default, per `linked-apps`). All question copy SHALL come from the centralized copy table and pass the product-verbs guard (no "clone"/"link"/storage vocabulary).

#### Scenario: Fork with shared data
- **WHEN** the user forks app A and chooses to use the same saved data
- **THEN** the new app joins A's storage group and reads A's existing data on first launch

#### Scenario: Fork starting fresh
- **WHEN** the user forks app A and chooses to start fresh
- **THEN** the new app gets its own empty database, exactly as forks behaved before this change

### Requirement: Delete tears down storage only when the group is empty
The launcher's delete flow SHALL remove the app's index entry unconditionally, and SHALL delete the underlying database file only when no remaining installed entry resolves to the same storage group — mirroring the existing refcount discipline used for the shared version-store repo.

#### Scenario: Deleting one member of a group
- **WHEN** two apps share a storage group and one is deleted
- **THEN** the survivor's data is intact and its launches keep working

#### Scenario: Deleting an ungrouped app
- **WHEN** an app with its own database (no sharers) is deleted
- **THEN** its database file is deleted with it, as before this change
