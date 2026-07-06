# Research digest: static-check-pipeline

*Retrofit digest (this change predates the harness scaffolding). Researcher-crawled; proposer
notes appended at the end. Cited by chains.md + handoff/*.md.*

## 1. Goal and scope

Change #9 delivers a pure, execution-free TypeScript static-analysis library at the new
top-level dir `checks/`, callable as `runStaticChecks(source, opts?) → CheckReport`. It defines
two capabilities: `static-checks` (the 8-pass pipeline — parse gate, import allowlist,
forbidden-global AST walk closing T8, manifest extraction, capability-use consistency,
screen-graph resolution, SDK lint, schema check) and `harness-diagnostics` (the shared
diagnostics catalog — closed `kind` union, mandatory non-empty `hint`, `severity`, zero-warning
`ok` semantics). `checks/` is created wholesale; **no existing `src/**`/`build/`/`invariants/`/
`android/` file is modified**. The only edits outside `checks/` are two hook-blocked config
lines (root `package.json` script + `tsconfig.json` exclude — see P1) and one dispatchable CI
step (`.github/workflows/invariants.yml`).

## 2. Task inventory with file/layer tags

| # | Heading | Primary file(s) / layer | Hook-blocked? |
|---|---|---|---|
| 1.1 | English test spec — checker surface | `checks/test/SPEC.md` (prose, new) | no |
| 1.2 | English test spec — diagnostics catalog | `checks/test/CATALOG-SPEC.md` (prose, new) | no |
| 1.3 | English bypass-class handoff for §16.4 session | prose handoff doc (new) | no |
| 2.1 | Create `checks/contract.ts` (types) | `checks/contract.ts` (new, dependency-free) | no |
| 2.2 | Add data tables to contract | `checks/contract.ts` (extend) | no |
| 3.1 | Scaffold `checks/` + suite runner | `checks/test/run.mjs`,`acceptance.ts` (new) **+** root `package.json` (`checks:test`) **+** `tsconfig.json` (`checks/test` exclude) | **partly — `package.json` + `tsconfig.json`** |
| 3.2 | Parse gate | `checks/checker.ts` (new) | no |
| 3.3 | Import allowlist | `checks/` (same checker file) | no |
| 4.1 | Lexical scope / binding resolution | `checks/` (new walk module) | no |
| 4.2 | Forbidden-global flagging rules | `checks/` (new) | no |
| 4.3 | Shadowing / false-positive assertions | `checks/test/acceptance.ts` | no |
| 5.1 | `extractAppManifest` | `checks/` (new) | no |
| 5.2 | Capability-use both directions | `checks/` (new) | no |
| 5.3 | Screen-graph resolution | `checks/` (new) | no |
| 6.1 | SDK lint pass | `checks/` (new) | no |
| 6.2 | Schema pass (`validateArtifact`/`diffSchemas`) | `checks/` (new; imports `src/host/storage-engine/schema.ts`) | no |
| 7.1 | `runStaticChecks` assembly + determinism | `checks/index.ts` (new) | no |
| 7.2 | Honest fixture population | `checks/test/acceptance.ts`; reads `fixtures/*.app.tsx` | no |
| 7.3 | Wire `checks:test` into CI | `.github/workflows/invariants.yml` (modify) | no (not in hook set) |
| 8.1 | Hostile bypass corpus — SEPARATE §16.4 session | `checks/test/hostile/` (new) | no |
| 8.2 | Negative control | `checks/test/hostile/` (extend) | no |
| 9.1 | Close out — seam re-verify + ledger | `docs/v1-roadmap.md` (ledger) | no |

## 3. Chain seams (proposer's final boundaries — see chains.md)

Seven clusters A→G. A is human-bootstrap (two hook-blocked config lines). B/C/D/E are
implementer-dispatchable. F is a SEPARATE §16.4 session (hostile corpus, never the implementing
session). G is close-out.

- **A — Human bootstrap** (3.1 blocked slivers): `checks:test` script + `checks/test` tsconfig
  exclude. NOT dispatchable.
- **B — Spec + contract** (1.1, 1.2, 1.3, 2.1, 2.2, + 3.1 scaffold sliver): English specs, the
  bypass-class handoff, `checks/contract.ts` (types + data tables), and the `run.mjs`/
  `acceptance.ts` test-harness scaffold.
- **C — Parse + import + scope** (3.2, 3.3, 4.1, 4.2, 4.3): parse gate, import allowlist, and the
  binding-resolution forbidden-global walk (T8). Grouped so the scope walker is never a
  cross-chain handoff mid-construction.
- **D — Semantic passes** (5.1, 5.2, 5.3, 6.1, 6.2): manifest extraction, capability consistency,
  screen graph, SDK lint, schema check.
- **E — Assembly + fixtures + CI** (7.1, 7.2, 7.3): compose `runStaticChecks`, honest-fixture
  gate, CI step.
- **F — Hostile bypass corpus** (8.1, 8.2): SEPARATE session per §16.4; reads only the 1.3 prose
  handoff + the public signature. Sequenced after E.
- **G — Close out** (9.1): ledger + the #8 `Diagnostic.kind` narrowing seam re-verify.

## 4. Cross-chain contracts (→ handoff/*.md)

- **B → C,D,E,G** (`handoff/contract.md`): the `checks/contract.ts` surface — closed
  `DiagnosticKind` union (with the runtime/engine-reused names fixed verbatim), `Diagnostic` /
  `CheckReport` / `ExtractedManifest` shapes, the public `runStaticChecks` signature, the four
  data tables (forbidden-name roots, export→capability, nav-call shapes, SDK-lint rules), the
  catalog invariants, the test-harness idiom, and the #8 narrowing seam.
- **C → D,E** (`handoff/checker-internals.md`): the per-pass function signature, the shared
  `CheckContext` (parsed `SourceFile` + diagnostic accumulator), the parse-gate-short-circuit
  rule, and the scope-resolution helper (`resolveBinding`) D's SDK-lint pass may reuse.

## 5. Spec surface

### `harness-diagnostics` (4 requirements)
1. Structured diagnostic with mandatory `hint` — `{ kind, severity, line?, column?, symbol?,
   message, hint }`; `hint` non-empty required; every static-check diagnostic carries `line`;
   no free-text-only diagnostics.
2. Closed, centrally-owned `kind` vocabulary — authored in `checks/contract.ts`; surfaced in
   `@whim/contract` as the narrowing of #8's open wire `kind`; downstream stages extend
   additively; same-misdeed kinds REUSE the runtime name (`undeclared_capability`).
3. Severity orders but never excuses — exactly `'error' | 'warning'`; `ok` iff zero diagnostics
   of any severity; no threshold knob; one warning ⇒ `ok: false`.
4. No suppression mechanism — no per-app/inline pragma; a useless diagnostic class is removed
   globally, never silenced per-app.

### `static-checks` (9 requirements)
1. Pure execution-free library — source string in, `CheckReport` out; no I/O, no global state,
   deterministic; NEVER executes the checked source in any form.
2. Parse gate runs first and alone — TS syntactic diagnostics; unparseable source short-circuits
   all later passes; parse diagnostics still carry line positions.
3. Imports resolve only to `vc-sdk` — any other static specifier, `require(...)`, or dynamic
   `import(...)` is an error diagnostic whose hint names `vc-sdk`.
4. Forbidden-global walk closes T8 — binding resolution, NOT token matching; flags direct refs,
   member/computed access through global roots or tainted aliases, computed access on a tainted
   alias with unknown key, `.constructor` access, `__proto__` + `defineProperty`/`setPrototypeOf`/
   `assign` onto shared prototypes, string-arg `setTimeout`/`setInterval`; honest shadowing NOT
   flagged.
5. Manifest extracted statically, literal-only — single default-exported `defineApp({...})`;
   non-literal fields → `manifest_not_static`; the extracted manifest appears in the report even
   on failure.
6. Capability declarations match use both directions — `undeclared_capability` (error) and
   `unused_capability` (warning); export→capability map is a one-row-per-capability data table.
7. Screen graph resolves statically — `initial ∈ screens`; string-literal nav targets must
   resolve; non-literal targets are errors; nav shapes are table-driven.
8. SDK lint steers toward the taught path — `setTimeout`/`setInterval`/`requestAnimationFrame`
   (function-arg form) → warning hinting `delay`/`interval`; no suppression.
9. Schema check reuses the storage engine's pure functions — `validateArtifact`; with an
   `appliedSchema`, `diffSchemas` conflict classes (`type_change`, `id_reuse`,
   `tombstone_violation`, `missing_default`) → error diagnostics PRESERVING the engine kind
   names; absent → `emptyApplied()` baseline. Honest code ⇒ zero diagnostics (false-positive
   gate).

## 6. Existing surfaces depended on

- `src/host/storage-engine/schema.ts` — pure, no SQL dep; exports `validateArtifact`,
  `diffSchemas`, `emptyApplied`. Task 6.2 imports these by relative path. Both this and the
  schema are under the root tsconfig `include`, so tsc + esbuild resolve the cross-dir import
  with no path config.
- `src/host/storage-engine/contract.ts` — dependency-free; exports `SchemaArtifact`,
  `AppliedSchema`, `StorageError`, `FieldType`. Tasks 2.1/6.2 consume the types.
- `typescript` ^5.8 — already a root devDependency; the AST parser (design D2). No new dep.
- `esbuild` — already a root devDependency; `checks/test/run.mjs` replicates the
  `src/host/bridge/test/run.mjs` idiom: `build({bundle:true, platform:'node', format:'esm',
  target:'node20'})` → `import(pathToFileURL(outfile))` → `rmSync`. Add `tsconfigRaw:'{}'` (the
  build.mjs jsx-runtime gotcha) so the bundle doesn't inherit `jsx:react-jsx`.
- `fixtures/*.app.tsx` — 4 real corpus apps (latency-probe, water-counter, pour-over-timer,
  tip-splitter); task 7.2 reads them as honest fixtures (must produce zero diagnostics).
- `.github/workflows/invariants.yml` — current steps `storage:test`, `bridge:test`,
  `launcher:test`, `build`, `invariants`, `bridge:invariants`; task 7.3 adds `checks:test`. NOT
  hook-blocked.
- root `package.json` (`checks:test` script) + root `tsconfig.json` (`checks/test` exclude) —
  **hook-blocked**; human-bootstrap (P1).

## 7. Drift / overlap / independence

- **Roadmap:** #9 entry (`docs/v1-roadmap.md` ~262–290) is `proposed 2026-06-12`; contract
  notes + the D8 API signature + seam notes (#3 nav table, #8 kind narrowing, #11
  `extractAppManifest`) all match the design. No drift.
- **Independence from #8 (harness-server-skeleton):** confirmed genuinely independent — `checks/`
  stands alone before #8's workspaces exist (design D1); **no file is written by both changes.**
  The one coordination seam is `Diagnostic.kind`: #8 defines it as an OPEN `z.string()`
  (`handoff/contract.md`); #9 owns the closed catalog in `checks/contract.ts`. Whichever change
  lands SECOND wires the `@whim/contract` re-export; if #8 isn't present when #9 finishes, the
  re-export defers (task 9.1) — a coordination point, not a blocker.
- **Archived overlap:** none — `effects-and-cues`/`launcher-shell` touched `src/**`/`android/`,
  all excluded here. #10 (synthetic-run) will extend `harness-diagnostics` ADDITIVELY — no
  conflict.

---

## Proposer notes (retrofit decisions — read before dispatching)

**P1 — Chain A is human-bootstrap, NOT dispatchable (two hook-blocked lines).**
`protect-harness.sh` blocks `*/package.json` and `tsconfig*.json`. Task 3.1 must (a) add the
`checks:test` script to root `package.json` and (b) add `"checks/test"` to the root
`tsconfig.json` `exclude` array. (b) is load-bearing: the root tsconfig is
`include: ["**/*.ts","**/*.tsx"]`, and the gate's `tsc --noEmit` would otherwise typecheck the
Node test runner (`checks/test/acceptance.ts`, hostile `.ts`) against the app lib and fail —
exactly why every other Node suite (`src/host/*/test`, `invariants`, `fixtures/adversarial`) is
excluded. The **human** makes both edits in an editor before B is dispatched. The dispatchable
slivers of 3.1 (`checks/test/run.mjs` + `acceptance.ts` scaffold) ride in Chain B.

**P2 — NO `checks/tsconfig.json`.** The checker LIBRARY (`checks/*.ts`) is covered by the root
tsconfig `include` and SHOULD be typechecked. The test runner avoids inheriting `jsx:react-jsx`
via esbuild `tsconfigRaw:'{}'` (memory: esbuild jsx-runtime gotcha), not a local tsconfig. This
keeps Chain A to two lines and resolves researcher open-Q 2/4.

**P3 — Task 7.3 (CI yml) IS dispatchable.** `.github/workflows/` is not in the hook set; an
implementer may add the `checks:test` step. It sits at the end of Chain E (gate closure), after
all passes exist.

**P4 — Schema-pass kind-name fidelity (#9 req 9).** The schema pass MUST surface
`diffSchemas`'s conflict classes under the engine's OWN kind names (`type_change`, `id_reuse`,
`tombstone_violation`, `missing_default`) — do not invent parallel names. Same discipline as the
runtime-name reuse for `undeclared_capability`. Flagged in `handoff/contract.md`.

**P5 — Honest-fixture false-positive gate (#9 req 1, task 7.2).** The 4 `fixtures/*.app.tsx`
must each produce zero diagnostics. `pour-over-timer` now uses the SDK `interval`/`delay`
(effects-and-cues, archived) rather than raw timers, so the SDK-lint pass should stay clean — but
the Chain E implementer verifies this AT RUNTIME; a tripping honest fixture is a checker-or-fixture
bug to fix, never a suppression to add.

**P6 — Hostile corpus (8.x) is a SEPARATE §16.4 session.** Like the effects-and-cues invariant
session, the bypass corpus is authored by a DIFFERENT session than the one implementing the
checker, and receives only the prose bypass-class handoff (task 1.3) + the public signature —
never the checker internals. Chain F is flagged not-dispatchable-in-the-implementing-sequence;
sequence it after E. Keep its negative control non-vacuous (8.2).

**P7 — #8 narrowing seam ordering (task 9.1).** The closed `DiagnosticKind` union lives in
`checks/contract.ts` regardless of #8. The `@whim/contract` re-export is done by whichever of
#8/#9 lands second. If #9 finishes first, Chain G records the deferred re-export in the roadmap
ledger rather than attempting it. Flagged in `handoff/contract.md`.

## 8. Open questions for the dispatcher

1. **Exact new `kind` strings.** The runtime/engine-reused names are fixed (P4 + req 6/9). The
   NEW names (parse, import, forbidden-global, manifest, screen, sdk-lint) are authored in task
   1.2 (`CATALOG-SPEC.md`) / 2.x — handoff/contract.md fixes the RULE and the reused names, and
   leaves the new strings to Chain B's catalog authoring.
2. **Does D's SDK-lint pass reuse C's `resolveBinding`?** SDK lint flags function-arg
   `setTimeout`/`setInterval` — overlapping with C's forbidden-global walk. If reuse is cheap,
   the scope helper is a real C→D handoff (declared in checker-internals.md); if D's pass is a
   simpler standalone walk, it is self-contained. Chain D decides; checker-internals.md exposes
   the helper either way.
