## MODIFIED Requirements

### Requirement: The schema check reuses the storage engine's pure functions

The pipeline SHALL validate an extracted `schema` literal with the storage engine's
exported `validateArtifact` (surfacing its kinds verbatim: `invalid_artifact`,
`malformed_id`, `id_reuse`, `bad_field_type`, `bad_default`), and — when the caller
supplies the app's applied schema (the edit flow; the server is stateless, the device
ships it) — SHALL run the exported `diffSchemas` and surface its conflict classes
(`type_change`, `tombstone_violation`, `missing_default`) as error diagnostics preserving
the engine's kind names and hints. With no applied schema supplied, the diff baseline
SHALL be the empty applied schema.

When an applied schema IS supplied, the pass SHALL additionally enforce the **monotone
allocation floor** (decision #52 D5): within each collection present in the applied schema,
every field ID the candidate introduces SHALL have an ordinal strictly greater than the
maximum ordinal among that collection's active **and** retired columns. A field ID at or
below that floor SHALL produce an `id_below_floor` error diagnostic whose hint names the
next free ID, even when `diffSchemas` alone would have classified the artifact as additive
(reusing a never-allocated gap below the maximum is invisible to a diff but violates the
allocation contract). Collections absent from the applied schema have no floor.

#### Scenario: Generation-time conflict caught before any run

- **WHEN** a checked source's schema redeclares an applied field's burned ID with a
  different type, and the applied schema is supplied
- **THEN** the report contains a `type_change` error diagnostic whose hint matches the
  engine's fix hint for the same conflict

#### Scenario: First generation validates shape only

- **WHEN** a source with a well-formed schema literal is checked without an applied schema
- **THEN** the report contains no schema diagnostics

#### Scenario: Allocation below the floor is caught

- **WHEN** the supplied applied schema's collection has burned IDs `f1` and `f5` (so `f2`–`f4`
  were never allocated) and the checked source introduces a new field `f3`
- **THEN** the report contains an `id_below_floor` error diagnostic naming `f3` and hinting
  at `f6`

#### Scenario: Allocation above the floor is clean

- **WHEN** the same applied schema is supplied and the checked source introduces `f6`
- **THEN** the report contains no `id_below_floor` diagnostic

#### Scenario: A retired column still raises the floor

- **WHEN** the applied schema's collection has active `f2` and retired `f9`, and the checked
  source introduces `f5`
- **THEN** the report contains an `id_below_floor` diagnostic — a tombstoned ID is burned and
  the floor counts it

## ADDED Requirements

### Requirement: The kind vocabulary grows additively for the generation loop

The closed diagnostic-kind vocabulary in the checks contract module SHALL gain exactly the kinds the
generation loop needs and no others: `id_below_floor` (a new field ID at or below the applied schema's
burned-ID floor) and `build_failure` (the candidate parsed but the production bundle contract could not
build it). Both SHALL be added to the existing array-first list so the type and the runtime self-check
cannot drift, and no consumer SHALL mint a kind string outside that module.

#### Scenario: New kinds are in the central list

- **WHEN** the checks contract module's kind list is inspected
- **THEN** `id_below_floor` and `build_failure` appear in it, and the derived kind type includes them

#### Scenario: No ad-hoc kinds elsewhere

- **WHEN** the generation pipeline's sources are inspected for diagnostic construction
- **THEN** every `kind` value used is a member of the central vocabulary
