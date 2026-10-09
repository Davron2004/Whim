## ADDED Requirements

### Requirement: A beta build must upgrade cleanly over the previous release
Before a build ships to testers, the release process SHALL install the previous release on a fresh emulator and a fresh simulator, seed it with an example app with saved data and a generated app with two versions, install the new build over it, and SHALL block the release unless every tile, version, saved datum, the consent state and the device id are unchanged.

#### Scenario: Clean upgrade
- **WHEN** the upgrade check runs from the previous release to the candidate on Android and iOS
- **THEN** it passes and its evidence is recorded in the change's progress ledger

#### Scenario: Data lost
- **WHEN** any seeded item is missing after the upgrade
- **THEN** the check fails and the build does not ship
