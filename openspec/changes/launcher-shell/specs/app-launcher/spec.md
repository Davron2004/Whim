# app-launcher Specification (delta)

## ADDED Requirements

### Requirement: Installed apps are persistent host-held records

The host SHALL maintain a persistent record for every installed mini-app — identity, display
name, the host-held manifest and schema artifact (#41 D4: never the bundle's
self-description), a reference to its versioned bundle, and an example flag — and the set of
installed apps MUST survive a full process kill and relaunch.

#### Scenario: Installed apps survive a restart

- **WHEN** the user has installed apps, force-stops the host, and relaunches it
- **THEN** the launcher lists the same apps with the same names, labels, and working launch

#### Scenario: The realm is bound to the record, not the bundle's claims

- **WHEN** a mini-app is launched from a record
- **THEN** the realm's capability gate enforces the record's host-held manifest, and nothing
  the bundle reports about itself alters what is granted

### Requirement: The home grid launches apps full-screen, one realm at a time

The launcher home SHALL present the installed apps as a grid; tapping an app MUST launch it
full-screen in a freshly reset realm (one WebView == one realm == one app), and leaving the
app MUST tear that realm down so no state leaks into the next launch.

#### Scenario: Tap to launch, leave to reset

- **WHEN** the user taps an app tile, uses the app, exits to the launcher, and launches a
  second app
- **THEN** each app runs full-screen in its own fresh realm and the second app observes
  nothing from the first (containment and generation fencing intact)

### Requirement: Bundles delivered from host-held records run under the unchanged containment contract

The host SHALL deliver an installed app's bundle source from its versioned record into the
runtime over the existing loader channel. The iframe-side contract — CSP, sandbox attributes,
module allowlist, channel (b) delivery, realm reset per delivery — MUST be byte-identical to
the baked-bundle path.

#### Scenario: A record-delivered app behaves identically to its baked twin

- **WHEN** the same fixture bundle is delivered once from the baked map and once from a
  host-held record
- **THEN** it renders, syscalls, and persists identically in both runs, and the containment
  verdict from the trusted vantage is unchanged

### Requirement: Deleting an app leaves no residue

The launcher SHALL offer delete on every installed app behind an explicit confirmation.
Deletion MUST remove the launcher record, the app's user data store, and — when no other
installed entry shares the underlying version data — its version history, leaving no
per-app storage behind.

#### Scenario: Delete removes record, data, and history

- **WHEN** the user deletes an installed app (and no fork of it remains) and confirms
- **THEN** the app disappears from the grid, its user-data database is gone, its version
  data is gone, and relaunching the host shows no trace of it

#### Scenario: Deleting the original spares a surviving fork

- **WHEN** an app has a fork and the user deletes the original
- **THEN** the fork still launches, keeps its history, and keeps its own user data

### Requirement: Forking creates an independent launcher entry

The launcher SHALL offer fork on every installed app. The fork MUST appear as a new launcher
entry carrying its provenance, MUST start from the original's current bundle, MUST evolve
independently (its future snapshots never affect the original, per the mini-app-forking
contract), and MUST have its own empty user data store.

#### Scenario: A fork runs independently of its original

- **WHEN** the user forks an installed app and opens the fork
- **THEN** the fork runs the same bundle as the original at fork time, but writes to its own
  storage — data entered in the fork never appears in the original, and vice versa

### Requirement: First run seeds two example apps and a create affordance

On first run the launcher SHALL seed the tip splitter and water counter as installed,
example-labeled records — full citizens: launchable, forkable, deletable, snapshot-backed
from their first install — alongside a prominent "make your first app" affordance. Seeding
MUST be idempotent across restarts and MUST NOT resurrect deleted examples.

#### Scenario: A fresh install is not empty

- **WHEN** the host runs for the first time
- **THEN** the grid shows tip splitter and water counter labeled as examples plus the create
  affordance, and both examples launch and run on-device

#### Scenario: Deleted examples stay deleted

- **WHEN** the user deletes a seeded example and restarts the host
- **THEN** the example does not reappear

### Requirement: The launcher surface speaks product verbs only

Every user-facing string on the launcher surface SHALL use product vocabulary; no git
terminology, mechanism names, or internal identifiers (realm, generation, snapshot ids in
hash form) are ever shown.

#### Scenario: No mechanism vocabulary reaches the screen

- **WHEN** the user performs any launcher action (launch, fork, delete, seed-time browsing)
- **THEN** all visible text passes the product-verbs build guard with no git or mechanism
  terms
