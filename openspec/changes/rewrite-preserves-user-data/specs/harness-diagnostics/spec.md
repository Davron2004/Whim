## MODIFIED Requirements

### Requirement: Kinds are a closed, centrally-owned vocabulary

Diagnostic kinds SHALL form a closed union authored in the checks contract module
(dependency-free, importable without the checker — the storage-engine `contract.ts`
precedent) and surfaced through the shared server contract package as the narrowing of its
open wire `kind` (the seam #8's generation-contract defines). Downstream stages (synthetic
run, repair loop) SHALL extend the vocabulary additively through this module, never by
minting ad-hoc kind strings.
Where the same misdeed exists at runtime, the static kind SHALL reuse the runtime's name
(e.g., `undeclared_capability` matches the bridge gate's denial kind) so the repair model
sees one language for one mistake.

The vocabulary SHALL carry a named runtime-observed kind, `containment_unobserved`, meaning
"no authenticated containment verdict was observed" — the harness never heard back, so
neither containment nor a breach was established. It SHALL be distinct from
`containment_failure` (an authenticated verdict that reported a breach) and distinct from
`mount_timeout` (no authenticated `paint` frame within the mount budget), because a verdict
can go unobserved without a mount timeout and a mount timeout is not evidence about
containment. No producer SHALL emit one of the three in place of another.

The vocabulary SHALL carry the storage engine's **verb-time** error kinds under the engine's own
names — `type_mismatch`, `unknown_collection`, `unknown_field`, `unknown_record`,
`unqueryable_field`, `kv_too_large` — so that a rejected syscall the harness observes at run time
has a name and cannot be dropped for lack of one. It SHALL NOT carry the engine's **host-fault**
kinds `not_open` and `corrupt_storage`: those report the harness's own engine state rather than a
mistake in the candidate, carry no fix the model could apply, and are surfaced through the run
report's trace instead. A producer SHALL NOT rename a host fault into a candidate diagnostic kind
in order to report it.

#### Scenario: Static and runtime agree on a name

- **WHEN** the same undeclared-capability mistake is reported statically by the checker and
  at runtime by the bridge gate
- **THEN** both reports carry the identical `kind` string

#### Scenario: Unobserved, failed, and timed-out are three kinds

- **WHEN** the closed kind union is inspected
- **THEN** it contains `containment_unobserved`, `containment_failure`, and `mount_timeout`
  as three distinct members, and `containment_unobserved` is declared in the contract module
  rather than minted at its producer

#### Scenario: Verb-time storage kinds are named, host faults are not

- **WHEN** the closed kind union is inspected against the storage engine's `StorageErrorKind`
- **THEN** the six verb-time kinds appear under the engine's own names, and `not_open` and
  `corrupt_storage` do not appear at all
