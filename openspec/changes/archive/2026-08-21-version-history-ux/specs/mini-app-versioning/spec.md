# Delta Spec: mini-app-versioning

## ADDED Requirements

### Requirement: Same-line enumeration survives rollback (timeline)
The store SHALL provide an additive enumeration verb (`timeline`) that lists every snapshot on the active lineage's line — ancestors *and* tag-reachable descendants of the current position — newest first, capped like `history`. After a rollback moves the active position backward, snapshots later on the same line SHALL still be enumerated, so roll-forward targets remain discoverable without knowing their ids. Existing verbs SHALL be unchanged in shape and behavior; the verb returns the same snapshot shape (`{id, prompt, createdAt}`) as `history`.

#### Scenario: Descendants listed after rollback
- **WHEN** an app has snapshots A→B→C, is rolled back to A, and `timeline` is called
- **THEN** the result contains A, B, and C, newest first, and B and C are valid `rollback` (roll-forward) targets

#### Scenario: Other lineages excluded
- **WHEN** an app has a fork lineage alongside the active lineage and `timeline` is called
- **THEN** only snapshots on the active lineage's line are enumerated

#### Scenario: Cap respected
- **WHEN** the line holds more snapshots than the configured history limit
- **THEN** `timeline` returns the newest entries up to the limit
