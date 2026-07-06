# mini-app-versioning delta — storage-semantic-guards

## MODIFIED Requirements

### Requirement: Rollback is non-destructive

The user SHALL be able to roll back a mini-app to any previous snapshot **in the active lineage**, and rolling back MUST NOT destroy later snapshots — they remain recoverable, including by rolling forward to them again. A rollback target that does not lie on the active lineage's line (it is neither an ancestor of, equal to, nor a descendant of the lineage's current snapshot) MUST be refused with an error that names the lineage verbs (`fork` / `switchLineage`) as the sanctioned way to reach another lineage's history; the active lineage's ref and working state are unchanged by a refused rollback.

#### Scenario: Rolling back restores an earlier bundle without losing later ones

- **WHEN** the user rolls a mini-app back from generation 2 to generation 1
- **THEN** generation 1's bundle becomes the active version, and generation 2 is still present and can be returned to

#### Scenario: A cross-lineage snapshot id is refused

- **WHEN** a mini-app has been forked and `rollback` is called on the original lineage with a snapshot id that was created on the fork's lineage (not on the original's line)
- **THEN** the call fails with an error directing the caller to `fork`/`switchLineage`, and the original lineage's active snapshot and bundle are unchanged
