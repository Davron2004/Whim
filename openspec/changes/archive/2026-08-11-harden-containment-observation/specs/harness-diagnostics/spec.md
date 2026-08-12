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

#### Scenario: Static and runtime agree on a name

- **WHEN** the same undeclared-capability mistake is reported statically by the checker and
  at runtime by the bridge gate
- **THEN** both reports carry the identical `kind` string

#### Scenario: Unobserved, failed, and timed-out are three kinds

- **WHEN** the closed kind union is inspected
- **THEN** it contains `containment_unobserved`, `containment_failure`, and `mount_timeout`
  as three distinct members, and `containment_unobserved` is declared in the contract module
  rather than minted at its producer
