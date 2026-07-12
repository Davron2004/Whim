# Research digest: static-check-pipeline

*Retrofit digest (this change predates the harness scaffolding). Researcher-crawled; proposer
notes appended at the end. Cited by chains.md + handoff/*.md.*
*Refreshed 2026-07-03 against as-built state — #8 landed 2026-06-18, #3 (sdk-design-system)
and storage-semantic-guards landed 2026-07-02; see §7 for the drift resolution.*

## 1. Goal and scope

Change #9 delivers a pure, execution-free TypeScript static-analysis library at the new
top-level dir `checks/`, callable as `runStaticChecks(source, opts?) → CheckReport`. It defines
two capabilities: `static-checks` (the 8-pass pipeline — parse gate, import allowlist,
forbidden-global AST walk closing T8, manifest extraction, capability-use consistency,
screen-graph resolution, SDK lint, schema check) and `harness-diagnostics` (the shared
diagnostics catalog — closed `kind` union, mandatory non-empty `hint`, `severity`, zero-warning
`ok` semantics). `checks/` is created wholesale; **no existing `src/**`/`build/`/`invariants/`/
`android/` file is modified**. The only edits outside `checks/` are four hook-blocked config
edits (root `package.json` script, root `tsconfig.json` exclude, a `scripts/gate.sh` suite
line, `knip.json` coverage — see P1), one dispatchable CI step
(`.github/workflows/invariants.yml`), and the Chain-G `contract/src/index.ts` narrowing
re-export (dispatchable — `contract/` is not hook-blocked).

## 2. Task inventory with file/layer tags

| # | Heading | Primary file(s) / layer | Hook-blocked? |
|---|---|---|---|
| 1.1 | English test spec — checker surface | `checks/test/SPEC.md` (prose, new) | no |
| 1.2 | English test spec — diagnostics catalog | `checks/test/CATALOG-SPEC.md` (prose, new) | no |
| 1.3 | English bypass-class handoff for §16.4 session | prose handoff doc (new) | no |
| 2.1 | Create `checks/contract.ts` (types) | `checks/contract.ts` (new, dependency-free) | no |
| 2.2 | Add data tables to contract | `checks/contract.ts` (extend) | no |
| 3.1 | Scaffold `checks/` + suite runner | `checks/test/run.mjs`,`acceptance.ts` (new) **+** root `package.json` (`checks:test`) **+** `tsconfig.json` (`checks/test` exclude) **+** `scripts/gate.sh` (suite line) **+** `knip.json` (coverage) | **partly — `package.json`, `tsconfig.json`, `gate.sh`, `knip.json`** |
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
| 9.1 | Close out — wire `@whim/contract` narrowing + seam re-verify + ledger | `contract/src/index.ts` (modify) + `docs/v1-roadmap.md` (ledger) | no |

## 3. Chain seams (proposer's final boundaries — see chains.md)

Seven clusters A→G. A is human-bootstrap (two hook-blocked config lines). B/C/D/E are
implementer-dispatchable. F is a SEPARATE §16.4 session (hostile corpus, never the implementing
session). G is close-out.

- **A — Human bootstrap** (3.1 blocked slivers): `checks:test` script, `checks/test` tsconfig
  exclude, `scripts/gate.sh` suite line, `knip.json` coverage. NOT dispatchable.
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
- **G — Close out** (9.1): wire the `@whim/contract` narrowing re-export (#8 landed first,
  so it is this change's edit) + ledger deviations.

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
7. Screen graph resolves statically — `initial ∈ screens`; nav shapes are table-driven and
   the shipped table is EMPTY (#3 landed no nav API) — mechanism proven via a test-injected
   shape row: string-literal targets must resolve, non-literal targets are errors.
8. SDK lint steers toward the taught path — `setTimeout`/`setInterval`/`requestAnimationFrame`
   (function-arg form) → warning hinting `delay`/`interval`; no suppression.
9. Schema check reuses the storage engine's pure functions — `validateArtifact` (as-built
   kinds: `invalid_artifact`, `malformed_id`, `id_reuse`, `bad_field_type`, `bad_default`);
   with an `appliedSchema`, `diffSchemas` conflict classes (as-built: `type_change`,
   `tombstone_violation`, `missing_default`) → error diagnostics PRESERVING the engine kind
   names; absent → `emptyApplied()` baseline. Honest code ⇒ zero diagnostics (false-positive
   gate).

## 6. Existing surfaces depended on

- `src/host/storage-engine/schema.ts` — pure, no SQL dep; exports `validateArtifact`,
  `diffSchemas`, `emptyApplied`, **and `AppliedSchema`** (the type lives here, not in
  contract.ts). Task 6.2 imports these by relative path. Both this and the
  schema are under the root tsconfig `include`, so tsc + esbuild resolve the cross-dir import
  with no path config. `storage-semantic-guards` (landed 2026-07-02) did not touch this
  file; its `unqueryable_field` guard is a private runtime-engine method (see design Open
  Questions).
- `src/host/storage-engine/contract.ts` — dependency-free; exports `SchemaArtifact`,
  `StorageError`, `FieldType` (+ `FIELD_TYPES`, `StorageErrorKind` — now incl.
  `unqueryable_field`). Tasks 2.1/6.2 consume the types.
- `typescript` ^5.8 — already a root devDependency; the AST parser (design D2). No new dep.
- `esbuild` — already a root devDependency; `checks/test/run.mjs` replicates the
  `src/host/bridge/test/run.mjs` idiom: `build({bundle:true, platform:'node', format:'esm',
  target:'node20'})` → `import(pathToFileURL(outfile))` → `rmSync`. Add `tsconfigRaw:'{}'` (the
  build.mjs jsx-runtime gotcha) so the bundle doesn't inherit `jsx:react-jsx`.
- `fixtures/*.app.tsx` — now **5** real corpus apps: tip-splitter, water-counter,
  pour-over-timer, style-gallery (new, sdk-design-system), latency-probe. Task 7.2's honest
  population is the first FOUR; **latency-probe is excluded** — it calls raw
  `globalThis.__whimSyscall` (the walk would rightly flag it) and declares the facade-less
  `diag` capability. Pinned as an expected-flagged sample instead (P5).
- `.github/workflows/invariants.yml` — as-built TWO jobs: `quality-gate` (build, typecheck,
  lint --max-warnings 0, knip, `openspec validate --all --strict`, tripwire grep) and
  `isolation-suite` (build, `server:test`, `guard:metro`, `storage:test`, `bridge:test`,
  `launcher:test`, Chromium install, `invariants`, `bridge:invariants`). Task 7.3 adds
  `checks:test` to `isolation-suite`; `quality-gate` covers the checks lib via root
  typecheck/lint/knip automatically. NOT hook-blocked. (Observed drift, not ours:
  `vstore:test` runs in `gate.sh` but not in CI.)
- `scripts/gate.sh` / `gate-full.sh` — the harness DONE gate; each suite is an explicit
  `check "<name>" npm run -s <script>` line, so `checks:test` needs its own line in
  `gate.sh` (gate-full.sh inherits it). **Hook-blocked**; human-bootstrap (P1).
- `knip.json` — explicit per-workspace map (`.`, `contract`, `server`); no glob covers a new
  top-level `checks/`, so without a human edit knip silently skips it. Extend the `"."`
  workspace (entry: `checks/test/run.mjs`; project: `checks/**/*.ts`). **Hook-blocked** (P1).
- `.eslintignore` — opt-out model; `checks/` (incl. `checks/test`) is linted by default
  under the root `@react-native` config, same as `server/`. No edit needed.
- root `package.json` (`checks:test` script) + root `tsconfig.json` (`checks/test` exclude;
  as-built the exclude list also carries `contract` + `server`, which self-typecheck inside
  `server/test/run.mjs`) — **hook-blocked**; human-bootstrap (P1).
- `contract/src/index.ts` — as-built wire `Diagnostic`: `{kind: z.string() (open), symbol?,
  line?, hint: min(1)}` with a comment reserving the narrowing for #9; stub pipeline emits
  one canned kind `BUILD_FAILURE` (`server/src/pipeline.ts`) and already streams a no-op
  `check` stage. Task 9.1 edits this file (dispatchable).

## 7. Drift / overlap / independence

- **Roadmap (refreshed 2026-07-03):** #9 entry is `proposed 2026-06-12`; four drift items
  since, all resolved in the refreshed artifacts: (a) **#8 landed 2026-06-18** — the
  `@whim/contract` narrowing re-export is now in-scope for #9 (task 9.1), no longer a
  whichever-lands-second hedge; (b) **#3 (sdk-design-system) landed with NO navigation
  API** — the nav-shapes table ships empty; the old ⚠️ note to #3 repoints to the future
  nav change; (c) the roadmap note "(workspace-ified once #8's exist)" is deliberately
  deviated from — `checks/` stays a plain dir (design D1); 9.1 records the deviation;
  (d) `server-cancellation` is #11 carryover (`Pipeline.run(request, signal?)`) — no #9
  impact.
- **#8 as-built:** the coordination seam confirmed — wire `Diagnostic.kind` is an OPEN
  `z.string()` whose comment reserves the narrowing for #9. #9 lands second → Chain G wires
  the re-export in `contract/src/index.ts`, keeping the zod `kind` open (the stub's
  `BUILD_FAILURE` must keep validating) and adding `severity`/`message` as optional wire
  fields.
- **Archived overlap:** none — `effects-and-cues`/`launcher-shell` touched `src/**`/`android/`,
  all excluded here. `storage-semantic-guards` (landed, unarchived) touched only
  engine/version-store runtime paths — no overlap with `schema.ts`. #10 (synthetic-run)
  will extend `harness-diagnostics` ADDITIVELY — no conflict.

---

## Proposer notes (retrofit decisions — read before dispatching)

**P1 — Chain A is human-bootstrap, NOT dispatchable (four hook-blocked edits).**
`protect-harness.sh` blocks `*/package.json`, `tsconfig*.json`, `scripts/gate*.sh`, and
`knip.json`. Task 3.1 needs the human to (a) add the `checks:test` script to root
`package.json`; (b) add `"checks/test"` to the root `tsconfig.json` `exclude` array —
load-bearing: root `include` is `["**/*.ts","**/*.tsx"]` and the gate's `tsc --noEmit`
would otherwise typecheck the Node test runner against the app lib and fail, exactly why
every other Node suite (`src/host/*/test`, `invariants`, `fixtures/adversarial`) is
excluded; (c) add a `check "checks:test" npm run -s checks:test` line to `scripts/gate.sh`
(the gate enumerates suites explicitly — without it the harness DONE gate never runs the
new suite; `gate-full.sh` inherits it); (d) extend `knip.json`'s `"."` workspace with
`checks/**` coverage (entry `checks/test/run.mjs`, project `checks/**/*.ts`) — knip's
workspace map is explicit and would otherwise silently skip the dir. The **human** makes
all four edits in an editor before B is dispatched. The dispatchable slivers of 3.1
(`checks/test/run.mjs` + `acceptance.ts` scaffold) ride in Chain B.

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

**P5 — Honest-fixture false-positive gate (#9 req 1, task 7.2).** The honest population is
FOUR of the five fixtures: `tip-splitter`, `water-counter`, `pour-over-timer` (SDK
`interval`/`delay`, no raw timers), `style-gallery` (sdk-design-system's component gallery,
`capabilities: []`) — each must produce zero diagnostics. **`latency-probe` is NOT honest
by design**: it reaches the facade-less `diag` capability via raw `globalThis.__whimSyscall`,
which the T8 walk must flag — pin it as an expected-flagged sample (a free, non-§16.4
sanity assertion), never add it to the zero-diagnostics set. A tripping honest fixture is a
checker-or-fixture bug to fix, never a suppression to add.

**P6 — Hostile corpus (8.x) is a SEPARATE §16.4 session.** Like the effects-and-cues invariant
session, the bypass corpus is authored by a DIFFERENT session than the one implementing the
checker, and receives only the prose bypass-class handoff (task 1.3) + the public signature —
never the checker internals. Chain F is flagged not-dispatchable-in-the-implementing-sequence;
sequence it after E. Keep its negative control non-vacuous (8.2).

**P7 — #8 narrowing seam (RESOLVED: #8 landed 2026-06-18; #9 is second → Chain G wires it).**
The closed `DiagnosticKind` union lives in `checks/contract.ts`; Chain G re-exports it from
`contract/src/index.ts` (TS-source relative import — fine for the TS-source-only workspace)
and adds `severity`/`message` as OPTIONAL wire fields. Two invariants: the zod `kind` stays
an open `z.string()` (the stub pipeline's `BUILD_FAILURE` and #10's runtime kinds must keep
validating — the narrowing is the exported union type + const table, not a zod enum), and
`server:test` must stay green after the edit. Flagged in `handoff/contract.md`.

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
