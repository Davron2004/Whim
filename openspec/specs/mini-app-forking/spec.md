# mini-app-forking Specification

## Purpose
TBD - created by archiving change on-device-snapshot-store. Update Purpose after archive.
## Requirements
### Requirement: A mini-app can be forked into an independent lineage

The user SHALL be able to fork a mini-app from any snapshot into a new, independent lineage. Generations made on the fork MUST NOT affect the original lineage, and generations on the original MUST NOT affect the fork.

#### Scenario: Edits to a fork do not touch the original

- **WHEN** the user forks a mini-app from generation 1 and then generates a new version on the fork
- **THEN** the fork advances independently while the original lineage's snapshots remain unchanged

### Requirement: Forked lineages never require merging

The versioning model SHALL treat forks as permanently independent lineages. No operation in the model MUST ever require merging two lineages back together.

#### Scenario: Divergent lineages coexist without a merge

- **WHEN** both the original and the fork receive further divergent generations
- **THEN** both lineages remain valid and fully usable, and no operation prompts for or requires a merge to resolve them
