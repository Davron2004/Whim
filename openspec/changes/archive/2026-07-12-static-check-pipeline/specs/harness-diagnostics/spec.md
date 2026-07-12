# harness-diagnostics — delta for `static-check-pipeline`

## ADDED Requirements

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

#### Scenario: Static and runtime agree on a name

- **WHEN** the same undeclared-capability mistake is reported statically by the checker and
  at runtime by the bridge gate
- **THEN** both reports carry the identical `kind` string

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
