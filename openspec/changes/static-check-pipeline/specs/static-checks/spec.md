# static-checks — delta for `static-check-pipeline`

## ADDED Requirements

### Requirement: The checker is a pure, execution-free library

The static-check pipeline SHALL be a pure TypeScript library: candidate mini-app source
(a string) in, a structured `CheckReport` out. It SHALL perform no I/O, hold no global
state, and produce identical reports for identical inputs. It MUST NOT execute, import,
`eval`, or otherwise run any part of the checked source — analysis is AST-only. A green
report is necessary but never sufficient: containment authority remains the sandbox runtime,
and run-behavior authority remains the synthetic run.

#### Scenario: Same source, same report

- **WHEN** the same source string is checked twice (any process, any order)
- **THEN** the two reports are deeply equal

#### Scenario: Hostile source is never executed

- **WHEN** a checked source contains top-level statements with observable side effects
  (e.g., writes to a module-scope sentinel, an unconditional `throw`)
- **THEN** checking completes and no such statement's effect is observable in the checking
  process

### Requirement: Parse gate runs first and alone

The pipeline SHALL parse the source with the TypeScript compiler and emit syntax errors as
catalog diagnostics. On an unparseable source, no other pass SHALL run (their results would
be noise against a broken tree), and the report still carries the parse diagnostics with
line positions in the original source.

#### Scenario: Syntax error short-circuits

- **WHEN** a source with a syntax error is checked
- **THEN** the report contains a parse-kind error diagnostic with the offending line, and no
  diagnostics from any later pass

### Requirement: Imports resolve only to vc-sdk

Every static import specifier SHALL be exactly `vc-sdk` (the #37 emit contract). Any other
specifier, any `require(...)` call, and any dynamic `import(...)` SHALL each produce an
error diagnostic whose hint names the allowed import.

#### Scenario: Off-allowlist import

- **WHEN** the source contains `import x from 'lodash'` (or `react`, `react/jsx-runtime`,
  a relative path, or a subpath like `vc-sdk/ui`)
- **THEN** the report contains an error diagnostic identifying the specifier and a hint
  pointing at `vc-sdk`

#### Scenario: Dynamic import

- **WHEN** the source contains `await import('vc-sdk')`
- **THEN** the report contains an error diagnostic (dynamic import is rejected regardless of
  specifier)

### Requirement: Forbidden-global walk closes T8

The pipeline SHALL detect references to forbidden capability globals by **binding
resolution, not token matching** (decisions #37, T8). The walk SHALL flag, with an error
diagnostic each: direct references to forbidden globals (the neutralize-list names, `eval`,
`Function`, `document`, and the global roots `window`/`globalThis`/`self`/`top`/`parent`/
`frames`); member or computed access to forbidden names through a global root **or through
any local alias of one** (taint follows lexical assignment); computed member access on a
global-root alias even when the key is statically unknown; `.constructor` member access
(the prototype-walk codegen step); `__proto__` access and any `Object.defineProperty`/
`Object.setPrototypeOf`/`Object.assign` whose target resolves to a shared prototype; and
string-argument `setTimeout`/`setInterval` (implicit eval).

#### Scenario: Token scan would miss alias indirection

- **WHEN** the source contains `const g = globalThis; const k = 'fe' + 'tch'; g[k](url)`
- **THEN** the report contains an error diagnostic at the computed access on `g`, even
  though no `fetch` token appears in the source

#### Scenario: Prototype-walk codegen

- **WHEN** the source contains `({}).constructor.constructor('return 1')()`
- **THEN** the report contains an error diagnostic at the `.constructor` access

#### Scenario: Object.prototype pollution attempt

- **WHEN** the source assigns through `__proto__` or calls `Object.defineProperty` with a
  shared prototype as target
- **THEN** the report contains an error diagnostic naming the pollution pattern

#### Scenario: Honest shadowing is not flagged

- **WHEN** the source declares and uses its own local binding named like a forbidden global
  (e.g., a parameter named `fetch` used only as a plain value within its scope)
- **THEN** the report contains no forbidden-global diagnostic for those uses

### Requirement: The app manifest is extracted statically, literal-only

The pipeline SHALL extract `{name, initial, screens, capabilities, schema}` from the
source's single default-exported `defineApp({...})` call by reading AST literals only.
A missing or duplicated `defineApp` default export, or a manifest field whose value is not
statically analyzable (spread, call result, identifier indirection), SHALL produce an error
diagnostic. The extracted manifest SHALL be included in the report whenever extraction
succeeds — including on otherwise-failing reports — as the harness-side source of the
app record.

#### Scenario: Computed capabilities rejected

- **WHEN** the source declares `capabilities: someArray` or `capabilities: ['sto' + 'rage']`
- **THEN** the report contains a manifest-not-static error diagnostic with a hint requiring
  a literal array of capability strings

#### Scenario: Extraction survives other failures

- **WHEN** a source has a valid literal `defineApp` argument but a forbidden-global
  violation elsewhere
- **THEN** the report is failing AND still carries the extracted manifest

### Requirement: Capability declarations match capability use, both directions

Using a capability-backed SDK export without declaring its capability SHALL produce an
error diagnostic with the same kind vocabulary as the runtime gate's denial
(`undeclared_capability`). Declaring a capability no SDK use requires SHALL produce a
warning diagnostic (`unused_capability` — the §5.4 consent sheet must not list ghosts).
The export→capability mapping SHALL be a data table such that a new capability is one row.

#### Scenario: Used but undeclared

- **WHEN** the source imports and calls `storage.kv.set` with `capabilities: []`
- **THEN** the report contains an `undeclared_capability` error naming `storage`, with a
  hint showing the corrected `capabilities` array

#### Scenario: Declared but unused

- **WHEN** the source declares `capabilities: ['storage']` and never uses a storage export
- **THEN** the report contains an `unused_capability` warning naming `storage`

### Requirement: Screen graph resolves statically

The pipeline SHALL verify that `initial` names a key of `screens`, and that every
navigation push/replace target expressed as a string literal names a declared screen.
Navigation targets that are not string literals SHALL produce an error diagnostic (the
same conservative policy as computed global access: the static answer to an undecidable
target is "don't write that"). The recognized navigation call shapes SHALL be table-driven
data so the as-built #3 SDK API is a data update, not a checker change.

#### Scenario: Dangling nav target

- **WHEN** a screen calls the navigation push with `'Settings'` and `screens` has no
  `Settings` key
- **THEN** the report contains an error diagnostic naming the unresolved target and listing
  the declared screens in its hint

#### Scenario: Unresolvable initial

- **WHEN** `initial: 'Hom'` does not match any `screens` key
- **THEN** the report contains an error diagnostic with a hint listing the declared screens

### Requirement: SDK lint steers toward the taught path

The pipeline SHALL implement the steering rules the runtime deliberately leaves unenforced:
raw `setTimeout`/`setInterval`/`requestAnimationFrame` use SHALL produce a warning
diagnostic whose hint names the SDK answer (`delay`/`interval` — the effects-and-cues
contract note: raw timers stay unstripped, steering lives here). Lint rules SHALL be
defined globally in the catalog (no per-app suppression, §8.2).

#### Scenario: Raw timer steered

- **WHEN** the source calls `setTimeout(cb, 1000)` with a function argument
- **THEN** the report contains a warning diagnostic with a hint naming `delay`/`interval`
  from `vc-sdk`

### Requirement: The schema check reuses the storage engine's pure functions

The pipeline SHALL validate an extracted `schema` literal with the storage engine's
exported `validateArtifact`, and — when the caller supplies the app's applied schema (the
edit flow; the server is stateless, the device ships it) — SHALL run the exported
`diffSchemas` and surface the conflict classes (`type_change`, `id_reuse`,
`tombstone_violation`, `missing_default`) as error diagnostics preserving the engine's kind
names and hints. With no applied schema supplied, the diff baseline SHALL be the empty
applied schema.

#### Scenario: Generation-time conflict caught before any run

- **WHEN** a checked source's schema redeclares an applied field's burned ID with a
  different type, and the applied schema is supplied
- **THEN** the report contains a `type_change` error diagnostic whose hint matches the
  engine's fix hint for the same conflict

#### Scenario: First generation validates shape only

- **WHEN** a source with a well-formed schema literal is checked without an applied schema
- **THEN** the report contains no schema diagnostics

### Requirement: Honest code produces zero diagnostics

The check suite SHALL maintain a population of honest, corpus-shaped fixture sources
(including the repo's real `fixtures/*.app.tsx`) that produce **zero** diagnostics, and a
hostile population (authored in a separate session per §16.4) that each produce their
expected diagnostic. Both populations gate CI: the honest set is the false-positive
regression gate (§8.2 — a check that fires on working code is a bug in the check), and the
hostile set is the proof the walk isn't vacuously green.

#### Scenario: Real fixtures stay clean

- **WHEN** `checks:test` runs the honest fixture population
- **THEN** every honest fixture's report is `ok` with zero diagnostics of any severity

#### Scenario: Bypass corpus stays caught

- **WHEN** `checks:test` runs the hostile fixture population
- **THEN** every hostile fixture's report contains its expected diagnostic kind
