## MODIFIED Requirements

### Requirement: Shared wire-contract package
The repo SHALL provide an npm workspace `contract/` (package `@whim/contract`) that is the
single source of truth for every shape crossing the device↔server wire. Schemas SHALL be zod
values with static types derived via `z.infer` (no hand-maintained parallel types). The
package SHALL depend on `zod` only and MUST NOT depend on `react`, `react-dom`, React Native,
or any server framework. It SHALL ship TypeScript source directly (entry points resolve to
`src/`), with no build step and no generated `dist/`.

Exactly one exception to the zod-only rule SHALL exist: the dev-only log-envelope module, which
declares plain TypeScript types and no zod value. The exception SHALL be limited to that module,
SHALL carry no `/v1` route, and SHALL NOT be extended to any product wire shape. Any future
exception SHALL be argued in its own change, not absorbed into this one.

#### Scenario: One source of truth
- **WHEN** the server validates a request body or emits an SSE event
- **THEN** the schema used is imported from `@whim/contract`, and a payload that fails the
  schema's `parse` is a bug in the emitter, not the contract

#### Scenario: Dependency budget enforced
- **WHEN** `contract/package.json` is inspected at test time
- **THEN** its only runtime dependency is `zod`, and the suite fails if anything
  React-adjacent or framework-specific appears

#### Scenario: The exception stays one module wide
- **WHEN** the contract package's modules are scanned for exported types with no corresponding zod
  schema
- **THEN** only the dev-log module is found

## ADDED Requirements

### Requirement: The dev log envelope is a type-only contract module
The contract package SHALL declare the device→host dev log record and its batch envelope as plain
TypeScript types in a module of their own. That module SHALL export no runtime value, so importing
it can never pull `zod` — or any other value — into a consumer's module graph.

The device SHALL import it `import type` only, matching the discipline every existing device-side
contract import already follows. The module SHALL also be where the log-sink route's path is
declared as the single written statement both sides implement, so the device does not derive it and
the server does not invent it.

Runtime validation of an incoming batch is the **server's** obligation and SHALL be performed by a
hand-written structural guard on the server side. The absence of a zod schema SHALL NOT be read as
permission to trust the body.

#### Scenario: The module has no runtime footprint
- **WHEN** the dev-log contract module is compiled
- **THEN** it emits no runtime exports, and a consumer importing it adds no module to its bundle

#### Scenario: The device import is type-only
- **WHEN** device source importing the dev-log envelope is inspected
- **THEN** every import of it is an `import type`, and `zod` does not appear in the Metro bundle's
  module graph as a result

#### Scenario: The server still validates
- **WHEN** the server receives a batch whose records do not match the declared shape
- **THEN** the batch is rejected, and the absence of a zod schema has not caused an unvalidated
  write
