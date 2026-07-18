# Delta Spec: mini-app-storage

## MODIFIED Requirements

### Requirement: Each mini-app's data is physically isolated in its own store

Each **storage group's** user data SHALL live in its own physically separate SQLite database (one database file per storage group). A storage group defaults to exactly one app — an app that has not been explicitly created into another app's group has its own database file, preserving the original per-app isolation. Group membership is host-mediated, recorded at creation time on the installed-app record, and immutable thereafter (see the `linked-apps` capability). An engine instance MUST be constructed bound to exactly one database handle, and the engine API MUST NOT accept any per-call app addressing — no parameter exists with which to name another group's store. Cross-**group** isolation is exactly as strong as the original cross-app isolation.

#### Scenario: Two apps with identical collections cannot see each other's data

- **WHEN** app A and app B, in different storage groups, each declare a collection with the same display name and each appends records to it
- **THEN** each app's engine instance lists only its own records, and the two databases are separate files on disk

#### Scenario: The API cannot express a cross-app read

- **WHEN** the full verb surface (`kv.*`, `records.*`) of an engine instance is inspected
- **THEN** no verb accepts an app identifier, database path, or any other store-addressing parameter

#### Scenario: Sharing requires an explicit host-side act

- **WHEN** an app is installed or forked without an explicit share decision
- **THEN** it is bound to its own database file; only a creation-time host-mediated share decision (never anything expressible by a bundle) can place two apps in one group
