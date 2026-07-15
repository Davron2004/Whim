# Research digest: What exactly regressed in `List` keys, and what changed in the four Node-test harnesses?

## Relevant files

- `docs/capabilities.md` — capability map; this change is limited to `sdk-design-system` and Node-suite support code.
- `openspec/specs/sdk-design-system/spec.md` — `List` is an SDK surface component that must render through the existing React-to-DOM path without exposing DOM concepts.
- `docs/harness.md` — fast gate runs all Node suites; each suite owns its small harness rather than using a shared framework.
- `src/sdk/surfaces.tsx` — `List` flattens `children` and creates the bordered wrapper elements.
- `src/sdk/test/run.mjs` — discovers and bundles every `*.acceptance.ts(x)` SDK suite independently.
- `server/test/harness.ts` — server/contract suite's `check`/`eq` accounting and output.
- `src/host/bridge/test/acceptance.ts` — bridge suite's local `ok`/`eq` accounting.
- `src/host/storage-engine/test/acceptance.ts` — storage suite's local `ok`/`eq` accounting.
- `src/host/launcher/test/harness.ts` — launcher suites' shared local `Harness` accounting.

## Current behavior

`List` first calls `React.Children.toArray(children)`, then creates one wrapper `<div>` per item for divider styling. `origin/main` used the wrapper position (`i`) as its key.

The outgoing Sonar cleanup added `listItemKey()`, which returns an element key or a primitive child value, and passes that result to the wrapper key. For valid primitive children such as `['same', 'same']`, both wrappers receive the identical `"same"` key. React consequently reports duplicate keys and cannot reliably preserve wrapper identity across reconciliation. The SDK has smoke and navigation acceptance suites but no `List` regression coverage.

The same outgoing cleanup replaced the direct success/failure branch in four harnesses with a `CheckResult` object plus `recordPass`, `recordFailure`, and `record` forwarding layer. The observable contracts remain the prior counters, failure arrays, console output, and non-zero runner result. The four implementations are not a shared API: server prints successful check names and maintains a separate `failed` counter, while bridge/storage/launcher only increment `passed` and record failures.

## Constraints and invariants

- `List` remains an SDK-only, React-to-DOM component with inline token-resolved styles; its public `ListProps` exposes only `children` and no DOM-specific API.
- Wrapper keys must be unique among sibling wrappers for all supported `ReactNode` child forms, including repeated primitive values. Key choice must not alter children, ordering, or divider placement.
- The SDK runner independently discovers `*.acceptance.ts(x)` files; a new SDK regression suite must therefore be self-contained and compatible with its esbuild Node/React-test-renderer setup.
- The Node suites retain their current pass/fail accounting and diagnostics. `server:test`, `bridge:test`, `storage:test`, and `launcher:test` are part of the fast gate; changing test-support code must keep their exit behavior intact.
- `docs/harness.md` describes the house style as a small, suite-owned harness, so no cross-suite framework or protected gate/config change is implied by this scope.

## Integration points

- `List` wrapper-key generation in `src/sdk/surfaces.tsx` is the only production location implicated by the regression.
- A new `src/sdk/test/*.acceptance.tsx` file is automatically included by `src/sdk/test/run.mjs`; it can render `List` through React test renderer and observe duplicate-key diagnostics without editing the runner.
- The four direct assertion entry points are `check()` (server), `ok()` (bridge and storage), and `Harness.ok()` (launcher). Their existing branches are the only locations of the added forwarding abstraction.

## Acceptance and verification requirements

- An SDK acceptance test must cover repeated primitive children and fail if rendering emits a duplicate-key diagnostic; it must leave normal multi-child `List` rendering and divider wrappers intact.
- The de-noised harnesses must preserve each suite's existing success count, recorded failure text/output, and failure exit result.
- Run `npm run sdk:test`, `npm run server:test`, `npm run bridge:test`, `npm run storage:test`, and `npm run launcher:test`; then run the repository fast gate (`scripts/gate.sh`) before commit integration. The full gate remains the pre-merge requirement for the change.

## Risks and unknowns

- Positional keys are safe for this component's static wrapper list but intentionally do not preserve wrapper identity when callers reorder unkeyed children; this is the behavior on `origin/main`.
- I did not verify behavior in a browser runtime; the established SDK Node acceptance runner uses React test renderer, while the design-system spec separately relies on the full invariant suite for contained delivery.

## Open questions for the planner

- None identified.
