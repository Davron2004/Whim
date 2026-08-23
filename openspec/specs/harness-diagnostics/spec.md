# harness-diagnostics Specification

## Purpose
TBD - created by syncing change static-check-pipeline. Update Purpose after archive.
## Requirements
### Requirement: Every diagnostic is structured and carries a mandatory fix hint

A diagnostic SHALL be structured data of the shape
`{ kind, severity, line?, column?, symbol?, message, hint }` (spec §8.1), where `kind` is a
machine-readable identifier, `line`/`column` are 1-based positions in the **original
TypeScript source** the model emitted, and `hint` is REQUIRED — a one-line, actionable next
step shaped like the right SDK answer (the `StorageError` rule: if the fix can't be
articulated, the agent can't apply it). `line` is optional in the shared shape (runtime
producers may have no source anchor), but every static-check diagnostic SHALL carry it.
Free-text-only diagnostics SHALL NOT exist.

#### Scenario: A diagnostic names its fix

- **WHEN** any pipeline pass emits a diagnostic (e.g., a forbidden `fetch` reference)
- **THEN** the diagnostic carries a non-empty `hint` naming the SDK-shaped alternative
  (e.g., the capability/SDK path to use instead), alongside `kind` and `line`

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

### Requirement: Severity orders work but never excuses it

Severity SHALL be exactly `error` (will not run, or will be denied) or `warning`
(a pre-error: becomes a bug under plausible input). Severity exists so repair fixes errors
first; it SHALL NOT gate shipping: a report is `ok` only when it contains **zero
diagnostics of any severity** (§8.2's zero-warning steady state), and the API SHALL expose
no severity-threshold knob.

#### Scenario: A warning alone fails the report

- **WHEN** a checked source produces one `warning` diagnostic and no errors
- **THEN** the report's `ok` is false

### Requirement: Warning definitions are global; there is no suppression mechanism

Diagnostic definitions SHALL live in the harness catalog, global to all apps and users.
There SHALL be no per-app, per-user, or inline (comment-pragma) mechanism to ignore a
diagnostic. A diagnostic class that proves useless on working code is removed from the
catalog for everyone (§8.2) — that removal is the only sanctioned way a diagnostic stops
firing.

#### Scenario: No inline escape hatch

- **WHEN** a checked source decorates a violating line with any disable-style comment
  pragma
- **THEN** the diagnostic for that line is emitted unchanged
