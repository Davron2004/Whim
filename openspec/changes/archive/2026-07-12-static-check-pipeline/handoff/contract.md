# Handoff: contract.md (chain-B → C, D, E, G)

The surface of `checks/contract.ts` (dependency-free) + the public entry. Later chains never redefine a shape or re-author a kind string.

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
`AppliedSchema` is imported from `src/host/storage-engine/schema.ts` (NOT contract.ts; never redefined).

## DiagnosticKind — closed union
Authored in `checks/contract.ts` (task 2.x) from the catalog spec (task 1.2). These names are
FIXED verbatim because they reuse the runtime/engine vocabulary (P4) — do NOT invent parallels:
`undeclared_capability`, `unused_capability`; engine validate kinds `invalid_artifact`,
`malformed_id`, `id_reuse`, `bad_field_type`, `bad_default`; engine diff kinds `type_change`,
`tombstone_violation`, `missing_default`. The NEW names (parse / import / forbidden-global /
manifest / screen / sdk-lint) are Chain B's to author in CATALOG-SPEC — once authored they are
closed; downstream stages (#10) extend ADDITIVELY only.

## Data tables (one row per entry; the passes are table-driven, not ad-hoc)
- **forbidden-name roots** — the global identifiers + member paths the T8 walk treats as tainted.
- **export→capability** — one row per capability (as-built: `storage`→'storage', `cues`→'cues';
  NO `diag` row — no SDK facade); drives `undeclared_capability` + `unused_capability`.
- **nav-call shapes** — ships EMPTY (#3 landed no nav API); test-injection seam only; a future nav change adds rows.
- **sdk-lint rules** — `setTimeout`/`setInterval`/`requestAnimationFrame` (function-arg form) →
  warning + the `delay`/`interval` hint.

## Invariants
- `hint` mandatory, non-empty. Every static-check `Diagnostic` carries `line`.
- `ok === (diagnostics.length === 0)`. No threshold knob; one `warning` ⇒ `ok: false`.
- `severity` is exactly `'error' | 'warning'`. NO suppression mechanism (no pragma/per-app skip).
- Engine/runtime kind names verbatim (P4 — see the FIXED list above).
- The checker NEVER executes the source (req 1); deterministic — same input ⇒ identical report.

## Test-harness idiom (Chain A + B bootstrap)
- Run via `npm run checks:test` → `node checks/test/run.mjs` (script + gate.sh line + knip
  coverage added by the human, P1). `run.mjs` mirrors `src/host/bridge/test/run.mjs`: esbuild
  `bundle:true, platform:'node', format:'esm', target:'node20'`, `tsconfigRaw:'{}'` (P2),
  `import(pathToFileURL(outfile))`, `rmSync` cleanup. No test framework — assertions throw.

## #8 seam (RESOLVED — P7): Chain G wires it
#8 landed 2026-06-18; #9 is second. Chain G edits `contract/src/index.ts`: TS-source re-export
of the closed union from `checks/contract.ts`; the zod wire `kind` STAYS open `z.string()`
(stub kind `BUILD_FAILURE` + future runtime kinds must keep validating); `severity`/`message`
join the wire as OPTIONAL fields; `server:test` green after. B–F never touch `contract/`.
