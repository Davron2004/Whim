# Handoff: contract.md (chain-B → C, D, E, G)

The surface of `checks/contract.ts` (dependency-free) + the public entry. Later chains import
these names and tables; they never redefine a shape or re-author a kind string.

## Types (shapes — exact field names verbatim)
```typescript
type Severity = 'error' | 'warning';
interface Diagnostic {
  kind: DiagnosticKind;        // closed union (below)
  severity: Severity;
  message: string;
  hint: string;                // mandatory, non-empty
  line: number;                // every static-check diagnostic carries a line
  column?: number; symbol?: string;
}
interface CheckReport {
  ok: boolean;                 // true IFF diagnostics.length === 0 (any severity)
  diagnostics: Diagnostic[];
  manifest?: ExtractedManifest; // present even when extraction failed (req 5)
}
// Public entry (design D8) — consumed by Chain E (assembly) and Chain F (black-box corpus):
function runStaticChecks(source: string, opts?: { appliedSchema?: AppliedSchema }): CheckReport;
```
`AppliedSchema` is imported from `src/host/storage-engine/contract.ts` (not redefined).

## DiagnosticKind — closed union
Authored in `checks/contract.ts` (task 2.x) from the catalog spec (task 1.2). These names are
FIXED verbatim because they reuse the runtime/engine vocabulary (P4) — do NOT invent parallels:
`undeclared_capability`, `unused_capability`, `type_change`, `id_reuse`, `tombstone_violation`,
`missing_default`. The NEW names (parse / import / forbidden-global / manifest / screen /
sdk-lint) are Chain B's to author in CATALOG-SPEC — once authored they are closed; downstream
stages (#10) extend ADDITIVELY only.

## Data tables (one row per entry; the passes are table-driven, not ad-hoc)
- **forbidden-name roots** — the global identifiers + member paths the T8 walk treats as tainted.
- **export→capability** — one row per capability, mapping an SDK export to the capability it
  implies (drives both `undeclared_capability` and `unused_capability`).
- **nav-call shapes** — the navigation call forms whose string-literal targets must resolve.
- **sdk-lint rules** — `setTimeout`/`setInterval`/`requestAnimationFrame` (function-arg form) →
  warning + the `delay`/`interval` hint.

## Invariants
- `hint` mandatory, non-empty. Every static-check `Diagnostic` carries `line`.
- `ok === (diagnostics.length === 0)`. No threshold knob; one `warning` ⇒ `ok: false`.
- `severity` is exactly `'error' | 'warning'`. NO suppression mechanism (no pragma/per-app skip).
- Schema-pass diagnostics PRESERVE the engine kind names (P4); capability diagnostics reuse the
  runtime name `undeclared_capability`.
- The checker NEVER executes the source (req 1); deterministic — same input ⇒ identical report.

## Test-harness idiom (Chain A + B bootstrap)
- Run via `npm run checks:test` → `node checks/test/run.mjs` (script added by the human, P1).
- `run.mjs` mirrors `src/host/bridge/test/run.mjs`: esbuild `bundle:true, platform:'node',
  format:'esm', target:'node20'`, `tsconfigRaw:'{}'` (P2), `import(pathToFileURL(outfile))`,
  `rmSync` cleanup. No test framework — assertions throw.

## Open point carried to the implementer (#8 seam — P7)
`Diagnostic.kind` is OPEN (`z.string()`) in #8's `@whim/contract`; #9 owns the CLOSED union
here. Whichever of #8/#9 lands second wires the `@whim/contract` re-export; if #8 is absent when
#9 finishes, Chain G records the deferred re-export in the roadmap ledger (don't hard-code it).
