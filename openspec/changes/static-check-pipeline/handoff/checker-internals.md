# Handoff: checker-internals.md (chain-C → D, E)

The internal seam Chain C exposes so Chain D's passes and Chain E's assembly plug in without
re-deriving the parse/scope plumbing. D consumes these; it does not modify the parse gate or the
scope walker.

## Pass signature (every pass is a pure function over shared context)
```typescript
interface CheckContext {
  source: string;
  sourceFile: import('typescript').SourceFile; // parsed ONCE by the parse gate
  appliedSchema?: AppliedSchema;               // threaded for the schema pass (6.2)
  report(d: Diagnostic): void;                 // accumulates into CheckReport.diagnostics
}
type Pass = (ctx: CheckContext) => void;       // emits diagnostics via ctx.report; returns nothing
```
`runStaticChecks` (Chain E) parses once, then runs the passes in order against one `CheckContext`.

## Parse gate ordering (req 2 — load-bearing)
- The parse gate runs FIRST and ALONE. On syntactic errors it reports `parse_*` diagnostics
  (with line positions) and SHORT-CIRCUITS: no later pass runs against unparseable source.
- Chain E's assembler enforces the short-circuit; D's passes may assume `ctx.sourceFile` is
  syntactically valid when they run.

## Scope-resolution helper (the T8 walk's core — D may reuse it)
```typescript
// Resolves an identifier/member-access node to its binding origin via lexical scope,
// NOT token matching. Honest shadowing (a local named `window`) resolves 'local'.
type Binding = 'global' | 'local' | 'tainted'; // 'tainted' = derived from a forbidden root/alias
function resolveBinding(node: ts.Node, ctx: CheckContext): Binding;
```
- The forbidden-global pass (4.x) flags `'global'`/`'tainted'` references against the
  forbidden-name table (handoff/contract.md); `'local'` is never flagged (4.3 false-positive set).
- Chain D's SDK-lint pass (6.1) MAY reuse `resolveBinding` to confirm a `setTimeout` call refers
  to the real global before warning (P-openQ2). If D's pass is a simpler standalone walk, the
  helper stays a C-internal — either way it is exported here for reuse.

## Invariants for D / E
- D adds passes; it must NOT change the parse-gate-first ordering, the short-circuit, or the
  `report`/`CheckContext` shape.
- All passes are deterministic and execution-free (no eval, no source execution).
- New pass tests go in `checks/test/acceptance.ts` against the run.mjs harness
  (handoff/contract.md §test-harness).
