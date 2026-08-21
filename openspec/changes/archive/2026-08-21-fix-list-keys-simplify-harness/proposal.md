## Why

The Sonar cleanup replaced `List`'s unique positional wrapper keys with child-derived
keys, which makes repeated primitive children collide during React reconciliation. The
same cleanup added four layers of assertion-forwarding code that obscure the small,
suite-owned test harnesses without changing their behavior.

## What Changes

- Restore a unique wrapper-key strategy for every supported `List` child, including
  repeated strings and numbers, and add a regression acceptance test.
- Remove the unnecessary assertion-result forwarding layers from the server, bridge,
  storage, and launcher test harnesses while preserving their observable accounting and
  diagnostics.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sdk-design-system`: `List` wrapper rendering must remain reconciliation-safe for all
  supported child forms, including repeated primitive children.

## Impact

- `src/sdk/surfaces.tsx` and a self-contained SDK acceptance suite.
- Four Node-suite-local assertion helpers.
- No public API, dependency, build, gate, or containment-contract changes.
