## MODIFIED Requirements

### Requirement: The fast gate statically rejects unguarded Playwright host bindings

The fast gate SHALL run a structural, AST-based check over every `.ts` and `.mjs` source file in the repository, whether or not it imports `playwright` (a helper handed a page need not), and SHALL fail if a file references `exposeFunction`, or calls `exposeBinding` with a callback whose first statement is not a main-frame provenance rejection. The check SHALL be AST-based rather than string- or regex-based, so that reformatting the call or renaming a local variable cannot defeat it. The check SHALL cover directories ESLint does not lint — `invariants/` is listed in the `ignores` of `eslint.config.mjs`, so ESLint provably cannot see a violation there. The check's own suite SHALL include a hostile fixture containing both an unguarded `exposeFunction` call and an `exposeBinding` call whose provenance rejection is placed after a `JSON.parse` rather than first, and SHALL assert the check flags both while a correctly-guarded `exposeBinding` passes.

#### Scenario: An unguarded exposeFunction is flagged

- **WHEN** a `.ts` or `.mjs` source file calls `exposeFunction`
- **THEN** the fast gate fails, naming the file and line

#### Scenario: A late provenance check is flagged

- **WHEN** a file calls `exposeBinding` with a callback that parses or dispatches before rejecting non-main-frame callers
- **THEN** the fast gate fails, naming the file and line

#### Scenario: The check itself is proven non-vacuous

- **WHEN** the check's own suite runs against the hostile fixture
- **THEN** both the unguarded `exposeFunction` and the late-guard `exposeBinding` are flagged, and a correctly-guarded `exposeBinding` passes
