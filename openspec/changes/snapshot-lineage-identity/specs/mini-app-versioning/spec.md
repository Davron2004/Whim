# Delta Spec: mini-app-versioning

## ADDED Requirements

### Requirement: Version enumeration and restore are lineage-correct
`timeline` SHALL enumerate only snapshots created on the active lineage's own line. A snapshot that is a DAG descendant of the current position but was created on a DIFFERENT lineage — a sibling fork, or the original after this lineage forked away — SHALL NOT be enumerated. `rollback` SHALL refuse any target not on the active lineage's own line, using the same lineage-correct predicate as `timeline`. The lineage each snapshot belongs to SHALL be recorded per snapshot at creation time and SHALL never appear in any returned value, prompt text, or error message. Snapshots created before this identity existed SHALL be treated as belonging to the primary (`main`) lineage. Single-lineage behavior (an app never forked) SHALL be unchanged.

#### Scenario: Non-diverged fork excludes the original's later versions
- **WHEN** an app is forked and, before the fork makes any snapshot of its own, the original creates further snapshots, and `timeline` is called on the fork
- **THEN** only the fork's own line (the versions it inherited up to the fork point) is enumerated, and none of the original's later snapshots appear

#### Scenario: Rolled-back original excludes a diverged fork's versions
- **WHEN** the original lineage is rolled back to a point at or before where a fork diverged, a snapshot exists on the fork's line, and `timeline` is called on the original
- **THEN** the fork's snapshots are not enumerated

#### Scenario: Restore never lands on another lineage
- **WHEN** `rollback` is asked to restore a snapshot that belongs to a different lineage than the active one
- **THEN** it is refused with an error that names the fork / switch-lineage path and contains no git vocabulary

#### Scenario: Lineage identity never surfaces
- **WHEN** any snapshot is read back through `history`, `timeline`, or a point lookup
- **THEN** the returned prompt and every field are identical to a store without lineage stamping — the internal lineage marker never appears in any surfaced value

#### Scenario: Single-lineage behavior is unchanged
- **WHEN** an app has never been forked and `timeline` / `rollback` are used across rollbacks
- **THEN** enumeration and restore behave identically to before this change — every snapshot on the one line remains listed and restorable
