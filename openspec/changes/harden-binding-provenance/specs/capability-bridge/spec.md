# capability-bridge Specification

## ADDED Requirements

### Requirement: A host function exposed to a Playwright page is bound with main-frame provenance

A host function exposed to a Playwright-controlled page SHALL be installed via `exposeBinding`, never `exposeFunction`, and its callback SHALL reject as its first statement any invocation whose binding source is not the main frame — before any `JSON.parse` of the call's payload and before any dispatch. `exposeFunction` MUST NOT be used because it installs the binding on the global of every execution context reachable from the page, including the opaque-origin sandboxed iframe, and its wrapper discards the `{context, page, frame}` source Playwright provides for `exposeBinding` — that source is the only way to know which frame is calling. A refusal SHALL return `null` rather than throw, because Playwright's `deliverBindingResult` evaluates the return expression back inside the caller's realm, and an error there is an information channel into the untrusted caller. The callback's `source` argument SHALL be typed structurally rather than imported as `BindingSource`, since `playwright` does not re-export that type.

#### Scenario: A hostile caller from the sandboxed frame is refused before parsing

- **WHEN** a call arrives at the bound function whose binding source is not the main frame
- **THEN** the callback returns `null` without parsing or dispatching the payload, and no host-side effect occurs

#### Scenario: The legitimate main-frame caller is unaffected

- **WHEN** the outer page's own script invokes the bound function
- **THEN** the call is parsed and dispatched normally and yields a result

### Requirement: The bridge-invariants suite proves syscall authority against a hostile sandboxed caller

The bridge-invariants suite (`npm run bridge:invariants`) SHALL include a scenario in which code running inside the opaque-origin sandboxed frame attempts to invoke the host-side syscall dispatch directly, and SHALL assert three things together: that the refusal was observed, via an explicit refusal counter, since a returned `null` is indistinguishable from a silent no-op at the call site; that the attempted state change is absent when read back from the storage engine itself, not merely absent from an in-memory trace of dispatched calls; and that a positive control — the same syscall issued through the legitimate main-frame relay — succeeds and its effect is visible on that same readback.

#### Scenario: A hostile in-sandbox caller is refused and leaves no trace

- **WHEN** the adversarial fixture running inside the sandboxed frame issues a syscall frame directly to the host dispatch channel
- **THEN** the suite's refusal counter records the refusal, and reading the target state back from the storage engine shows no change

#### Scenario: The legitimate path still succeeds

- **WHEN** the same syscall is issued through the sandbox's own shim over the legitimate main-frame relay
- **THEN** the call succeeds and the resulting state is visible on readback from the storage engine

### Requirement: The fast gate statically rejects unguarded Playwright host bindings

The fast gate SHALL run a structural, AST-based check over every `.ts` and `.mjs` file that imports `playwright`, and SHALL fail if that file calls `exposeFunction`, or calls `exposeBinding` with a callback whose first statement is not a main-frame provenance rejection. The check SHALL be AST-based rather than string- or regex-based, so that reformatting the call or renaming a local variable cannot defeat it. The check SHALL cover directories ESLint does not lint — `invariants/` is listed in `.eslintignore`, so ESLint provably cannot see a violation there. The check's own suite SHALL include a hostile fixture containing both an unguarded `exposeFunction` call and an `exposeBinding` call whose provenance rejection is placed after a `JSON.parse` rather than first, and SHALL assert the check flags both while a correctly-guarded `exposeBinding` passes.

#### Scenario: An unguarded exposeFunction is flagged

- **WHEN** a `.ts` or `.mjs` file importing `playwright` calls `exposeFunction`
- **THEN** the fast gate fails, naming the file and line

#### Scenario: A late provenance check is flagged

- **WHEN** a file calls `exposeBinding` with a callback that parses or dispatches before rejecting non-main-frame callers
- **THEN** the fast gate fails, naming the file and line

#### Scenario: The check itself is proven non-vacuous

- **WHEN** the check's own suite runs against the hostile fixture
- **THEN** both the unguarded `exposeFunction` and the late-guard `exposeBinding` are flagged, and a correctly-guarded `exposeBinding` passes
