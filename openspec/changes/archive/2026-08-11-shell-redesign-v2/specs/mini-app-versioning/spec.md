## MODIFIED Requirements

### Requirement: Every generation is an immutable snapshot tagged with its prompt

Each generation of a mini-app SHALL be recorded as an immutable snapshot, and each snapshot MUST carry the structured prompt that produced it so a later snapshot can be traced back to the instruction that created it.

The structured prompt SHALL be a **versioned envelope**. Its current version carries the verbatim submitted prompt text and, when the run produced one, the run's summary alongside it — so a snapshot can be shown back to the user both as what they asked for and as what happened, without a second store to keep consistent across rollback, fork and delete.

Every reader SHALL accept every envelope version it may encounter, and a raw non-envelope string, without a migration: an older envelope resolves to its prompt text with no summary, which is a legitimate state rather than an error. Envelope version numbers SHALL be monotonic, and a new field SHALL never be added without bumping the version. The per-snapshot lineage stamp SHALL remain a commit trailer outside the envelope and SHALL NOT be written into it.

#### Scenario: Two generations produce two traceable snapshots

- **WHEN** a mini-app is generated, then regenerated with a different prompt
- **THEN** two distinct snapshots exist in order, and each snapshot's history entry shows the prompt that produced it

#### Scenario: A snapshot carries the run's summary beside the verbatim prompt

- **WHEN** a generation whose run produced a summary is recorded
- **THEN** the snapshot's structured prompt carries both the verbatim submitted text and that summary, and the text is unmodified by the summary's presence

#### Scenario: An older envelope still reads

- **WHEN** a snapshot recorded under an earlier envelope version, or with a raw string prompt, is read back
- **THEN** it resolves to its prompt text with no summary, nothing errors, and no migration runs

#### Scenario: Lineage identity stays out of the envelope

- **WHEN** a snapshot's structured prompt is read back
- **THEN** it contains no lineage marker, exactly as before this change
