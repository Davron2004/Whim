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
