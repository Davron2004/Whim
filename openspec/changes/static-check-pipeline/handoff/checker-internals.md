# Handoff: checker-internals.md (chain-C → D, E)

The internal seam Chain C built so Chain D's passes and Chain E's assembly plug in without
re-deriving the parse/scope plumbing. D consumes these; it does not modify the parse gate or
the scope walker. As-built (not the pre-implementation draft) — file paths are real imports.

## Files

- `checks/internal/parse.ts` — `parseSource(source, filename?) → { sourceFile, diagnostics }`.
  Syntactic-only (`ts.createSourceFile(..., ts.ScriptKind.TSX)` + its `parseDiagnostics`
  field — an `@internal` TS field, stable at runtime but absent from the public `.d.ts`, so it
  is accessed via a local `SourceFileWithParseDiagnostics` interface, not `ts.isImportCall`-style
  public API assumptions). Diagnostics carry `kind: 'parse_error'`, 1-based `line`/`column`.
- `checks/internal/scope.ts` — `CheckContext`, `Pass`, `Binding`, `resolveBinding`,
  `rootIdentifierOf`, `buildContext`.
- `checks/passes/import-allowlist.ts` — `importAllowlistPass: Pass` (task 3.3).
- `checks/passes/forbidden-globals.ts` — `forbiddenGlobalsPass: Pass` (task 4.2).
- `checks/index.ts` — `runStaticChecks` composes: parse (short-circuit on failure) → build one
  `CheckContext` → run `PASSES` in order → `{ ok: diagnostics.length === 0, diagnostics }`.
  `PASSES` is a plain `readonly Pass[]` array in `checks/index.ts` — **append your pass there**,
  do not fork the composition. `manifest` is not populated yet — extraction (D, task 5.1) owns
  filling `CheckReport.manifest`; that plumbing is not yet added to `CheckContext` and is D's to
  design (e.g. a dedicated extraction step before/alongside `PASSES`, or a mutable slot on ctx).

## Pass signature (every pass is a function over shared context, side-effects via `report`)

```typescript
interface CheckContext {
  source: string;
  sourceFile: import('typescript').SourceFile; // parsed ONCE by the parse gate
  appliedSchema?: AppliedSchema;               // threaded for the schema pass (6.2), unused by C
  report(d: Diagnostic): void;                 // accumulates into CheckReport.diagnostics
}
type Pass = (ctx: CheckContext) => void; // emits diagnostics via ctx.report; returns nothing
```
Passes are NOT literally pure functions returning a value — they emit via the `report` callback
so multiple passes can accumulate into one array without each allocating/merging its own list.

## Parse gate ordering (req 2 — load-bearing, already enforced in `runStaticChecks`)
- The parse gate runs FIRST and ALONE. On syntax errors `parseSource` returns non-empty
  `diagnostics`; `runStaticChecks` returns immediately with ONLY those (no `CheckContext` is
  even constructed, so no later pass can run).
- D's passes may assume `ctx.sourceFile` is syntactically valid when they run.

## Scope-resolution helper (the T8 walk's core — D may reuse it)

```typescript
type Binding = 'global' | 'local' | 'tainted'; // 'tainted' = derived from a forbidden root/alias
function resolveBinding(node: ts.Node, ctx: CheckContext): Binding;
function rootIdentifierOf(expr: ts.Expression): ts.Identifier | undefined; // leftmost ident in a
  // property/element-access chain, e.g. `top.frames.fetch` → `top`; unwraps parens/`!`/`as`.
```
- Binding resolution is lexical-scope tracking (param/const/let/var/function/class/import
  declarations, function/block/catch/for scope boundaries), NOT token matching. `'local'` is the
  default/fallback for any node not classified as a read (declaration names, property-access
  `.name`, type positions) — `resolveBinding` never throws.
- Taint is set only by a direct `const x = <identifier>` chain: the identifier is a taint-source
  name (`GLOBAL_ROOTS` ∪ `FORBIDDEN_DIRECT_NAMES` from `checks/contract.ts`) or is itself already
  `'tainted'`. Taint does NOT flow through function calls/returns/destructuring — those default to
  `'local'` (conservative on the safe side: undecidable indirection isn't silently trusted, but
  it also isn't chased past a function boundary — table-driven, not deep dataflow analysis).
- Results are cached per `ctx.sourceFile` in a module-level `WeakMap` — cheap to call
  `resolveBinding` repeatedly across passes on the same parse.
- The forbidden-global pass flags `'global'` refs to `FORBIDDEN_DIRECT_NAMES ∪ GLOBAL_ROOTS`,
  and any member/computed access whose base root is `'tainted'` (unconditionally, even with a
  statically-unknown key) or a `'global'` root name. `'local'` is never flagged (4.3).
- Chain D's SDK-lint pass (6.1) MAY reuse `resolveBinding` on a `setTimeout`/`setInterval`
  callee to confirm it is the real global (not shadowed) before warning — `forbidden-globals.ts`
  already does this for the string-argument `implicit_eval` check; the same guard applies.

## Import-binding resolution (post-merge capfix — reviewer Finding 1)

`Binding`'s three values can't tell "resolves to an import" from "resolves to a same-named
local that shadows it" — both classify as `'local'` (an import is declared into scope exactly
like any other local). `capabilities.ts`'s shadow guard needs that distinction, so `scope.ts`
additively grew a second, parallel map built in the same walk:

```typescript
export interface ImportBindingInfo { moduleSpecifier: string; importedName: string; }
function resolveImportBinding(node: ts.Node, ctx: CheckContext): ImportBindingInfo | undefined;
function resolvesToImport(node: ts.Node, ctx: CheckContext, moduleSpecifier: string, importedName: string): boolean;
```

- `resolveImportBinding` returns info **only** when the identifier's nearest lexical
  declaration is itself an import (default/namespace/named specifier) — `undefined` for globals
  AND for locals that shadow an import of the same name (task capfix-1's core fix).
  `importedName` is the name exported BY THE MODULE before any local alias (`'default'` for a
  default import, `'*'` for a namespace import, else `propertyName ?? name`).
- `resolvesToImport` is the convenience boolean form: `resolvesToImport(root, ctx, 'vc-sdk',
  'storage')` asks "does `root` resolve to the `vc-sdk` import of `storage`" — this is now how
  `capabilities.ts` decides "use" (never root-identifier-TEXT matching alone).
- Purely additive: `resolveBinding`/`rootIdentifierOf`'s existing return values, the taint walk,
  and the forbidden-global paths are byte-for-byte unchanged — verified by the full existing
  greenBy:'C' suite staying green.

## Invariants for D / E
- D adds passes to `PASSES` in `checks/index.ts`; it must NOT change the parse-gate-first
  ordering, the short-circuit, or the `CheckContext`/`Pass` shape (extending `CheckContext` with
  a new optional field is fine; narrowing or renaming existing fields is not).
- All passes are deterministic and execution-free (no eval, no source execution) — verified by
  `runStaticChecks` never doing anything but parse + walk.
- New pass tests go in `checks/test/acceptance.ts` against the `run.mjs` harness
  (handoff/contract.md §test-harness). `checks/test/run.mjs` now sets `external: ['typescript']`
  in its esbuild call (Chain C fix — bundling `typescript`'s CJS into the ESM test bundle threw
  `Dynamic require of "fs" is not supported` at runtime; externalizing it lets Node's own
  resolution load the real package instead). No other change to `run.mjs`.
