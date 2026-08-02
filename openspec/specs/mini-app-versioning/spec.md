# mini-app-versioning Specification

## Purpose
TBD - created by archiving change on-device-snapshot-store. Update Purpose after archive.
## Requirements
### Requirement: Every generation is an immutable snapshot tagged with its prompt

Each generation of a mini-app SHALL be recorded as an immutable snapshot, and each snapshot MUST carry the structured prompt that produced it so a later snapshot can be traced back to the instruction that created it.

#### Scenario: Two generations produce two traceable snapshots

- **WHEN** a mini-app is generated, then regenerated with a different prompt
- **THEN** two distinct snapshots exist in order, and each snapshot's history entry shows the prompt that produced it

### Requirement: Rollback is non-destructive

The user SHALL be able to roll back a mini-app to any previous snapshot **in the active lineage**, and rolling back MUST NOT destroy later snapshots — they remain recoverable, including by rolling forward to them again. A rollback target that does not lie on the active lineage's line (it is neither an ancestor of, equal to, nor a descendant of the lineage's current snapshot) MUST be refused with an error that names the lineage verbs (`fork` / `switchLineage`) as the sanctioned way to reach another lineage's history; the active lineage's ref and working state are unchanged by a refused rollback.

#### Scenario: Rolling back restores an earlier bundle without losing later ones

- **WHEN** the user rolls a mini-app back from generation 2 to generation 1
- **THEN** generation 1's bundle becomes the active version, and generation 2 is still present and can be returned to

#### Scenario: A cross-lineage snapshot id is refused

- **WHEN** a mini-app has been forked and `rollback` is called on the original lineage with a snapshot id that was created on the fork's lineage (not on the original's line)
- **THEN** the call fails with an error directing the caller to `fork`/`switchLineage`, and the original lineage's active snapshot and bundle are unchanged

### Requirement: A snapshot can be pinned as known-good

The user SHALL be able to pin a snapshot as a known-good version, and a pinned snapshot MUST remain retrievable by its label regardless of how many later generations occur.

#### Scenario: A pinned version survives later generations

- **WHEN** the user pins generation 1, then creates several more generations
- **THEN** the pinned version is still retrievable by its label and its bundle is unchanged

### Requirement: History and diffs are viewable

The user SHALL be able to view a mini-app's snapshot history and see the difference between any two snapshots.

#### Scenario: History lists snapshots and diff shows the change

- **WHEN** the user views history after two generations, then requests a diff of generation 1 vs generation 2
- **THEN** history lists both snapshots with their prompts, and the diff shows the change in the bundle between them

### Requirement: Git is never exposed to the user

All versioning operations SHALL be surfaced as product verbs (snapshot, undo, rollback, pin, history, diff). The underlying version-control mechanism MUST NOT leak into the user-facing surface — no git terminology, commands, hashes, or concepts are ever shown or required.

#### Scenario: No operation reveals the mechanism

- **WHEN** the user performs any versioning operation
- **THEN** the operation completes without exposing git commands, terminology, or commit identifiers

### Requirement: Version operations feel interactive

Snapshot, rollback, pin, diff, and history operations SHALL complete fast enough to feel interactive for realistic Tier-0 bundle sizes, and the measured latencies MUST be recorded in the spike artifact.

#### Scenario: Operations complete within an interactive budget

- **WHEN** each version operation is run against a realistic Tier-0 bundle
- **THEN** it completes within an interactive latency budget (eyeballed) and the observed timing is written into the decisions log / DEVLOG

### Requirement: A snapshot carries the original source, not only the runnable bundle

Every snapshot a generation produces SHALL store the app's **original TypeScript source** as its own
artifact alongside the runnable bundle, so a later edit can re-send what the model actually wrote rather
than what the build emitted. Reading a snapshot's source SHALL return that artifact when present and
SHALL report its absence honestly for snapshots taken before source tracking existed — it SHALL NOT
silently substitute the compiled bundle. Existing installs SHALL keep working unchanged: an absent source
artifact is a legitimate state, never a migration or an error, and it resolves naturally the first time the
app is regenerated.

#### Scenario: A generated snapshot round-trips its source

- **WHEN** a generation is delivered and its snapshot's source is read back
- **THEN** the result is the original TypeScript the generation produced, not the bundle

#### Scenario: A legacy snapshot reports no source

- **WHEN** a snapshot taken before source tracking is read for its source
- **THEN** the absence is reported as such, and the compiled bundle is not returned in its place

#### Scenario: Legacy entries keep launching

- **WHEN** an app whose snapshots carry no source artifact is launched, restored, forked, and deleted
- **THEN** every operation behaves exactly as before, because the runnable bundle is unchanged

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
