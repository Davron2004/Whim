# generation-contract Specification

## Purpose
The shared wire contract between the Whim device and the harness server: zod schemas
(TS-source-only) for the generation/rewrite requests, the SSE generation event stream, the
diagnostics envelope, the wire app record, and usage shapes. It is the single source of truth
for every shape crossing the device↔server wire — consumed by the server now, and by the device
prompt flow (#7), the static checks (#9), and evals (#12) later.

## Requirements

### Requirement: Shared wire-contract package
The repo SHALL provide an npm workspace `contract/` (package `@whim/contract`) that is the
single source of truth for every shape crossing the device↔server wire. Schemas SHALL be zod
values with static types derived via `z.infer` (no hand-maintained parallel types). The
package SHALL depend on `zod` only and MUST NOT depend on `react`, `react-dom`, React Native,
or any server framework. It SHALL ship TypeScript source directly (entry points resolve to
`src/`), with no build step and no generated `dist/`.

#### Scenario: One source of truth
- **WHEN** the server validates a request body or emits an SSE event
- **THEN** the schema used is imported from `@whim/contract`, and a payload that fails the
  schema's `parse` is a bug in the emitter, not the contract

#### Scenario: Dependency budget enforced
- **WHEN** `contract/package.json` is inspected at test time
- **THEN** its only runtime dependency is `zod`, and the suite fails if anything
  React-adjacent or framework-specific appears

### Requirement: Generation request and rewrite shapes
The contract SHALL define `GenerateRequest` (`prompt`, optional `app` carrying the full
current `source`, `manifest`, and `schema` for the edit flow — full re-send per Model 1, never
wire diffs) and `RewriteRequest`/`RewriteResponse` (`prompt` in, `rewrittenPrompt` out).

#### Scenario: Edit flow carries full source
- **WHEN** a client builds a `GenerateRequest` for editing an existing app
- **THEN** the schema requires the complete current source text (not a diff) inside `app`

### Requirement: SSE generation event stream schema
The contract SHALL define `GenerationEvent` as a discriminated union on `type` covering:
`stage` (stage ∈ plan|generate|check|run|repair; status ∈ start|done; optional attempt),
`token` (streamed generation text delta), `diagnostic` (carrying a `Diagnostic`), `usage`
(carrying a `Usage`), and the two terminal events `result` (carrying a `WireAppRecord`) and
`failure` (user-facing `reason` prose, `attempts`, accumulated `diagnostics`). Every event a
conforming server emits SHALL validate against this union, and every stream SHALL contain
exactly one terminal event as its last event.

#### Scenario: Round-trip validation
- **WHEN** each event of a canned stub-pipeline run is serialized and re-parsed with
  `GenerationEvent.parse`
- **THEN** every event validates, and exactly one terminal event appears, last

#### Scenario: Unknown event type rejected
- **WHEN** a payload with an unrecognized `type` is parsed
- **THEN** parsing fails (clients can trust the union is closed at any given contract version)

### Requirement: Diagnostics envelope
The contract SHALL define `Diagnostic` as the §8.1 envelope `{ kind, symbol?, line?, hint }`
where `hint` is mandatory non-empty text shaped like the right SDK answer. `kind` SHALL be an
open string at this change (the static-check change narrows it into the catalog inside this
same package).

#### Scenario: Hint is mandatory
- **WHEN** a `Diagnostic` is constructed without a non-empty `hint`
- **THEN** schema validation fails (§8.1: every diagnostic carries a fix hint)

### Requirement: Wire app record
The contract SHALL define `WireAppRecord` = `{ name, source, bundle, sourceMap?, manifest,
schema }` — the verified-bundle payload a generation delivers. It MUST NOT contain device-side
identity or install state (ids, install timestamps, launcher position): the stored record is
the launcher's concern, the wire record is this contract's.

#### Scenario: Wire record is install-state-free
- **WHEN** `WireAppRecord` is inspected
- **THEN** it has no app-id or install-state fields, and a `result` event validates with only
  generation outputs

### Requirement: Usage shape
The contract SHALL define `Usage` = `{ promptTokens, completionTokens, totalTokens }` (integer
token counts), used identically by SSE `usage` events, the usage-readback endpoint, and the
OpenRouter wrapper's captured usage.

#### Scenario: One usage shape everywhere
- **WHEN** the suite compares the schema used by the `usage` SSE event, the usage endpoint
  response, and the OpenRouter wrapper
- **THEN** all three are the same `Usage` schema by identity, not three lookalikes

### Requirement: Metro-safe device consumption
The contract package SHALL be consumable by the RN app through Metro with the stock RN config:
it lives inside the Metro project root, resolves via the standard workspace symlink, and a
repo-level guard script (`npm run guard:metro`) SHALL prove the Android JS bundle still
resolves after workspace-ification. The guard SHALL run in CI as a blocking gate.

#### Scenario: Bundle guard catches resolution breakage
- **WHEN** `npm run guard:metro` runs after `npm install`
- **THEN** a release-mode Metro bundle of `index.js` completes, and any workspace-induced
  resolution failure exits non-zero (failing CI)
