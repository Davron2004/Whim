## ADDED Requirements

### Requirement: Every dependency is on its latest stable release or carries a documented pin
Every direct dependency and devDependency in the root, `contract/` and `server/` `package.json` files SHALL resolve to the version npm publishes under the package's `latest` dist-tag, unless the pin register lists the package.

#### Scenario: A current package needs no entry
- **WHEN** a dependency resolves to the version its `latest` dist-tag names
- **THEN** it needs no pin register entry

#### Scenario: A pinned package is declared
- **WHEN** a dependency is held below its `latest` dist-tag because its peer range excludes the newer major
- **THEN** the pin register has an entry for that package

### Requirement: A pin entry names its blocker and its lift condition
Each pin register entry SHALL record the package name, the version range the repo allows, the reason the latest release cannot be used (naming the blocker: a peer-dependency range, a missing API, a required migration), and the event that lifts the pin.

#### Scenario: A peer-range pin
- **WHEN** ESLint is held at 9.x because `@react-native/eslint-config` peers `^8 || ^9`
- **THEN** its entry names that peer range as the reason and "an `@react-native/eslint-config` release that peers ESLint 10" as the lift condition

### Requirement: Prereleases are never the target
A version published only under a prerelease dist-tag (`next`, `beta`, `rc`, `canary` and the like) SHALL NOT count as the latest stable release.

#### Scenario: A next tag ahead of latest
- **WHEN** a package's `latest` dist-tag is 14.0.1 and its `next` dist-tag is 17.1.0
- **THEN** 14.0.1 is the target, and staying on 14.0.1 needs no pin entry

### Requirement: The pin register is a JSON file validated offline by the fast gate
The pin register SHALL be the committed file `dependency-pins.json` at the repository root, and a static check reachable from the fast gate SHALL validate it without network access.

#### Scenario: A stale entry fails the gate
- **WHEN** a package is removed from every `package.json` but its entry stays in `dependency-pins.json`
- **THEN** the static check fails and names the entry

#### Scenario: A reasonless pin fails the gate
- **WHEN** an entry's reason or lift condition is empty or missing
- **THEN** the static check fails and names the package

#### Scenario: A duplicate entry fails the gate
- **WHEN** two entries name the same package
- **THEN** the static check fails and names the package

#### Scenario: The lockfile drifts outside the declared range
- **WHEN** an entry allows `^6.0.0` and the lockfile resolves 7.0.2
- **THEN** the static check fails and names the package and both versions

### Requirement: A networked audit reports undeclared lag
The repo SHALL provide `npm run deps:audit`, which queries the registry for every declared dependency in every workspace and exits non-zero when any dependency resolves below its `latest` dist-tag without a pin register entry.

#### Scenario: Undeclared lag is reported
- **WHEN** a dependency resolves to 4.3.1, its `latest` dist-tag is 4.3.2, and it has no pin entry
- **THEN** `npm run deps:audit` exits non-zero and lists the package with 4.3.1 and 4.3.2

#### Scenario: A fully current repo passes
- **WHEN** every dependency either resolves to its `latest` dist-tag or has a pin entry
- **THEN** `npm run deps:audit` exits 0

### Requirement: The audit shows every pin beside its current latest release
`npm run deps:audit` SHALL print each pin register entry with the package's current `latest` version and the entry's lift condition, so a reviewer can see when a pin may be lifted.

#### Scenario: A pin is listed for review
- **WHEN** TypeScript is pinned to `^6.0.0` and its `latest` dist-tag is 7.0.2
- **THEN** the audit output lists TypeScript with `^6.0.0`, 7.0.2 and the entry's lift condition

### Requirement: The audit stays out of the gates
`npm run deps:audit` SHALL NOT be invoked by `scripts/gate.sh` or `scripts/gate-full.sh`, because unattended runs have no registry egress.

#### Scenario: Gates run without the registry
- **WHEN** `gate.sh` and `gate-full.sh` run inside the default-deny devcontainer
- **THEN** neither attempts a registry request for the dependency audit
