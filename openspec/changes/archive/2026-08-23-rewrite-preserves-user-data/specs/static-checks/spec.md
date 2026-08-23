## ADDED Requirements

### Requirement: An edit candidate keeps the applied schema's collections and fields

When an applied schema is supplied, the checker SHALL report a `schema_identity_drift` error diagnostic for every collection id present in the applied schema that the candidate's schema artifact does not declare, and for every **active** field id within a declared collection that the candidate neither declares nor lists in that collection's own `tombstones`.

Field ids already retired in the applied schema SHALL be exempt. Collections the candidate introduces that the applied schema does not contain SHALL be unconstrained. Each diagnostic's hint SHALL name the abandoned id and state that the user's existing rows live under it, so repair can restore the id rather than invent a new one. This is a generation-time rule only: the engine's tolerance for an older artifact that omits newer fields is unchanged, because a restore never passes through the checker.

#### Scenario: An abandoned collection id is caught

- **WHEN** the applied schema contains collection id `c1` and the checked candidate's schema declares only a new collection with id `c2`
- **THEN** the report contains a `schema_identity_drift` error diagnostic naming `c1`, whose hint says the existing rows live under it

#### Scenario: An abandoned field id is caught

- **WHEN** the applied schema's collection `c1` has active field ids `f1` and `f2`, and the candidate declares `c1` with `f2` only and no tombstone for `f1`
- **THEN** the report contains a `schema_identity_drift` error diagnostic naming `f1`

#### Scenario: A deliberate tombstone is not drift

- **WHEN** the same candidate declares `c1` with `f2` and lists `f1` in that collection's `tombstones`
- **THEN** the report contains no `schema_identity_drift` diagnostic

#### Scenario: A first generation is unconstrained

- **WHEN** a candidate is checked with no applied schema supplied
- **THEN** the report contains no `schema_identity_drift` diagnostic

### Requirement: An edit candidate keeps reading where the data already is

When the caller supplies the previous source's storage surface, the checker SHALL report a `storage_surface_drift` error diagnostic for every kv key literal and every record-collection literal in that surface which the candidate's own surface does not contain.

The rule SHALL be superset, never equality: a candidate may add storage locations and may never stop reading one. A storage-facade argument that is not a string literal SHALL produce a `storage_surface_dynamic` **warning** diagnostic at that call site — never silence — and SHALL suppress `storage_surface_drift` for that facade (`kv` or `records`) in that candidate, since a computed key makes the absence unprovable in both directions. Each drift hint SHALL name the missing location and state that the user's existing data lives there. With no previous surface supplied, neither diagnostic SHALL be emitted.

#### Scenario: A dropped kv key is caught

- **WHEN** the previous surface names kv key `habitCompletionHistory` and the checked candidate reads no kv key at all
- **THEN** the report contains a `storage_surface_drift` error diagnostic naming `habitCompletionHistory`, whose hint says the user's existing data lives there

#### Scenario: A dropped collection is caught

- **WHEN** the previous surface names collection `Completions` and the candidate's `storage.records.*` calls name only `Streaks`
- **THEN** the report contains a `storage_surface_drift` error diagnostic naming `Completions`

#### Scenario: Adding a location is not drift

- **WHEN** the candidate reads the previous surface's kv key and collection and additionally appends to a new collection
- **THEN** the report contains no `storage_surface_drift` diagnostic

#### Scenario: A computed key warns and suppresses the error

- **WHEN** the previous surface names kv key `total` and the candidate calls `storage.kv.get(someVariable)`
- **THEN** the report contains a `storage_surface_dynamic` warning at that call site and no `storage_surface_drift` diagnostic for the kv facade

#### Scenario: A new app is unconstrained

- **WHEN** a candidate is checked with no previous surface supplied
- **THEN** the report contains neither `storage_surface_drift` nor `storage_surface_dynamic` for absence

## MODIFIED Requirements

### Requirement: The kind vocabulary grows additively for the generation loop

The closed diagnostic-kind vocabulary in the checks contract module SHALL gain exactly the kinds the
generation loop needs and no others, added to the existing array-first list so the type and the runtime
self-check cannot drift, and no consumer SHALL mint a kind string outside that module.

Those kinds are: `id_below_floor` (a new field ID at or below the applied schema's burned-ID floor),
`build_failure` (the candidate parsed but the production bundle contract could not build it),
`schema_identity_drift` (an edit candidate abandons a collection or active field id the applied schema
contains), `storage_surface_drift` (an edit candidate stops reading a storage location the previous
source read), and `storage_surface_dynamic` (a storage-facade argument that is not a string literal, so
continuity cannot be verified — the only warning-severity member of this set).

The module SHALL additionally carry the storage engine's **verb-time** error kinds verbatim —
`type_mismatch`, `unknown_collection`, `unknown_field`, `unknown_record`, `unqueryable_field` and
`kv_too_large` — so a runtime denial the synthetic run observes has a name in the closed vocabulary
rather than being dropped. The host-fault kinds `not_open` and `corrupt_storage` SHALL NOT be added:
they describe the harness's own engine state, not a candidate mistake.

#### Scenario: New kinds are in the central list

- **WHEN** the checks contract module's kind list is inspected
- **THEN** `id_below_floor`, `build_failure`, `schema_identity_drift`, `storage_surface_drift`,
  `storage_surface_dynamic` and the six verb-time storage kinds appear in it, and the derived kind type
  includes them

#### Scenario: Host-fault kinds stay out

- **WHEN** the checks contract module's kind list is inspected for `not_open` and `corrupt_storage`
- **THEN** neither appears in it

#### Scenario: No ad-hoc kinds elsewhere

- **WHEN** the generation pipeline's sources are inspected for diagnostic construction
- **THEN** every `kind` value used is a member of the central vocabulary
