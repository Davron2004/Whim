# Context chains: fix-list-keys-simplify-harness

## chain-1: sdk-list-reconciliation

- tasks: 1.1, 1.2, 1.3
- rationale: The production `List` wrapper identity and its independently discovered
  SDK regression test share the same React reconciliation context.
- reads: `specs/sdk-design-system/spec.md` §"The component kit renders under the
  unchanged containment contract"; `design.md` §"Decisions"; handoff: none
- writes-contract: none
- file scope: `src/sdk/surfaces.tsx`, `src/sdk/test/*.acceptance.tsx`

## chain-2: node-harness-direct-accounting

- tasks: 2.1, 2.2, 2.3
- rationale: These four suite-owned assertion entry points share the same narrow
  cleanup goal but have no API or product-code dependency on the SDK chain.
- reads: `research.md` §"Current behavior", §"Constraints and invariants";
  `design.md` §"Decisions"; handoff: none
- writes-contract: none
- file scope: `server/test/harness.ts`, `src/host/bridge/test/acceptance.ts`,
  `src/host/storage-engine/test/acceptance.ts`, `src/host/launcher/test/harness.ts`
