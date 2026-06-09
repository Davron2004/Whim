# sandbox-isolation Specification

## Purpose
TBD - created by archiving change webview-sandbox-runtime. Update Purpose after archive.
## Requirements
### Requirement: Forbidden globals are unavailable to the bundle

The contained execution context SHALL NOT expose any Layer-3 escape-hatch global (spec §5.1) to the mini-app bundle. Each forbidden global MUST be removed or replaced with an inert reference such that invoking it throws synchronously rather than performing its effect. The forbidden set covers at minimum: `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`, `Function` / `new Function`, `localStorage`, `indexedDB`, dynamic `import()`, and `Worker`.

#### Scenario: Network primitives are dead

- **WHEN** the bundle calls `fetch(...)`, constructs `new XMLHttpRequest()`, or constructs `new WebSocket(...)`
- **THEN** each call throws (e.g. `ReferenceError`/`TypeError`) and no network request leaves the device

#### Scenario: Dynamic code execution is dead

- **WHEN** the bundle calls `eval(...)`, `new Function(...)`, or a dynamic `import(...)`
- **THEN** each call throws and no externally-supplied code string is executed

#### Scenario: Ambient persistence and threading are dead

- **WHEN** the bundle accesses `localStorage`, accesses `indexedDB`, or constructs a `Worker`
- **THEN** access throws or yields an inert object that performs no persistence or threading

#### Scenario: The probe checklist runs as pass/fail assertions

- **WHEN** the forbidden-globals probe checklist is executed against the contained context
- **THEN** every entry reports "throws or provably inert" with zero exceptions, producing a result usable as a never-regress invariant (the network/native-isolation assertion of spec §16.2)

### Requirement: The contained context cannot reach the host or native layer

There SHALL be no reachable reference path from the bundle's execution context to the React Native host JS context, the native message bridge, or the parent document. Containment MUST hold against deliberate escape attempts, not merely absent ones.

#### Scenario: Parent and top reach is blocked

- **WHEN** the bundle reads `window.parent`, `window.top`, or `window.frameElement`
- **THEN** it cannot obtain a usable handle to the host document or to any host/native global (the reference is null, throws, or is a cross-origin-blocked opaque object)

#### Scenario: Prototype-chain walking yields no escape

- **WHEN** the bundle walks prototype chains and constructor references (e.g. `({}).constructor.constructor`, `Object`/`Array`/`Function` prototypes) attempting to climb out of the sandbox
- **THEN** no path resolves to a host function, the RN message bridge, or a live native capability

### Requirement: Global neutralization is surgical, not total

The global-stripping technique SHALL remove only the dangerous set and MUST preserve the globals the legitimate React render path and injected SDK depend on, so that neutralization does not break the runtime itself.

#### Scenario: The allowed runtime survives stripping

- **WHEN** the forbidden globals are neutralized and the fake SDK is injected
- **THEN** the React render path still mounts and the injected SDK module remains the single reachable capability surface

#### Scenario: Non-configurable globals are handled

- **WHEN** a forbidden global cannot be `delete`d because the engine marks it non-configurable
- **THEN** it is still rendered inert by shadowing within the bundle's execution scope (or equivalent), and the probe checklist confirms it

