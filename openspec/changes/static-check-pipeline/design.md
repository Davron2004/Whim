# static-check-pipeline — design

## Context

Spec §8.1 step 3 names the checks; decisions #37 (T8) names the failure mode of the naive
implementation (token-scan misses alias/pollution indirection); #40 exported
`validateArtifact`/`diffSchemas` as pure functions explicitly so this stage could reuse them.
The library has three consumers with different lifetimes — the server pipeline (#11), the
eval Tier-A gate (#12), and its own Node suite — and none of them exist yet except the suite,
so every interface decision here is a seam other changes inherit. The standing constraints
apply: diagnostics discipline (§8.1/§8.2), two test surfaces (§16.2 — this is squarely
Surface 1, TDD), reward-hacking defenses (§16.4), and "never widen" (this change touches no
runtime surface at all).

Current state *(refreshed 2026-07-03)*: #8 landed 2026-06-18 — the `contract/`+`server/`
workspaces exist. The as-built wire `Diagnostic` is `{ kind: z.string() /* open */,
symbol?, line?, hint: min(1) }` with a comment reserving the narrowing for this change
("do NOT hard-code a closed enum here"); the stub pipeline already streams a no-op `check`
stage pair and emits one canned kind (`BUILD_FAILURE`) in its failure branch. #3
(sdk-design-system) also landed — 22 components, theme *types* only, and **no navigation
API**. The only static checking in the repo is still esbuild's resolve-failure on
off-allowlist imports (build-time, not generation-time) and the runtime's three containment
legs (which produce *runtime throws*, not structured pre-run diagnostics).

## Goals / Non-Goals

**Goals:**

- A pure, deterministic, execution-free TS library: source string in → structured report out.
- Close T8: AST + lexical-scope walk that catches direct refs, alias indirection,
  prototype-walk codegen, and `Object.prototype` pollution — where a token scan provably fails.
- Define the diagnostics catalog (`harness-diagnostics`) that #10 and #11 will emit into.
- Static (AST-literal) manifest extraction — the harness-side app record source for #11.
- Zero false positives on honest corpus-shaped code (§8.2: a check that fires routinely on
  working code is a bug in the check, removed from the harness).

**Non-Goals:**

- Executing candidate code in any form (no `import()`, no `eval`, no sandbox boot — #10).
- Bundling or source maps (build pipeline owns both; checker input is pre-bundle TS source,
  so diagnostic lines are native to the original file).
- Containment. The sandbox's three legs are the boundary; this stage is diagnostics quality
  and defense-in-depth. A static pass is necessary, never sufficient.
- Full semantic type-checking against the SDK's `.d.ts` surface (deferred until #3 freezes
  the SDK; the pass list is additive so it can join later without API change).
- Server mounting, SSE, or any I/O (#8/#11).

## Decisions

### D1 — Placement: top-level `checks/`, plain directory, not yet a workspace

Node-land code in this repo lives at the top level (`build/`, `invariants/`), device code
under `src/`. The checker is server/eval territory. #8 has since landed, and its as-built
workspaces show what workspace-ification actually costs: a `package.json` + own tsconfig +
root-tsconfig exclusion + a `knip.json` workspace block + a `package-lock.json` regen (all
hook-blocked) + a fresh `guard:metro` verification surface. `checks/` has no dependency of
its own and no consumer that needs a package specifier yet (#11 is unproposed), so it stays
a **plain top-level dir under the root tsc** — library files included (root `include` is
`**/*.ts(x)`), `checks/test` added to the root `exclude` alongside the other Node suite
dirs. Workspace-ification is deferred to the first consumer that needs `@whim/checks`;
task 9.1 records this as a deviation from the roadmap #9 note "(workspace-ified once #8's
exist)". Alternatives rejected: `src/host/` (not device code; Metro has no business near
it), `server/lib/` (couples the lib to the server's lifetime), npm workspace now (all cost,
no consumer).

### D2 — Parser: the TypeScript compiler API, syntactic gate only

`typescript` ^5.8 is already a devDependency; the parse gate uses it as a library (single
`SourceFile`, syntactic diagnostics — no `lib.dom` ambient config, no program-level semantic
pass). Rationale: deterministic, fast (one file, ~a few KiB), and immune to the
moving-SDK-types problem — semantic diagnostics against an SDK that #3 is actively reshaping
would mint exactly the §8.2 fires-on-working-code warning class. The TS AST then feeds every
downstream pass (one parse, N walks over it — or one walk with N visitors; implementation's
choice, the report is the contract). Alternatives rejected: a lighter parser (acorn/babel —
second AST dialect in a TS repo for zero gain), full `ts.createProgram` typecheck (deferred,
non-goal).

### D3 — The forbidden-global walk: lexical-scope-aware, conservative where undecidable

The T8 lesson is that the *name* is not the *capability* — `globalThis['fe'+'tch']` contains
no `fetch` token. The walk therefore tracks **bindings**, not strings:

- **Forbidden-name table** (data, one place): the neutralize-list names (`fetch`,
  `XMLHttpRequest`, `WebSocket`, `EventSource`, `RTCPeerConnection`, `localStorage`,
  `sessionStorage`, `indexedDB`, `caches`, `Worker`, `sendBeacon` via `navigator`), the
  CSP-killed codegen names (`eval`, `Function`), the DOM/host roots (`document`, `window`,
  `globalThis`, `self`, `top`, `parent`, `frames`), and dynamic `import()`.
- **Scope awareness**: a reference is flagged only if it resolves to the *global* — a local
  `const fetch = …` declaration shadows it (flagging shadowed uses is the §8.2 false-positive
  class). Conversely, aliases are tainted: `const g = globalThis; g.fetch` flags at `g.fetch`,
  and the taint follows lexical assignment (`const h = g`).
- **Conservative on undecidability**: *computed* member access on a tainted global-root alias
  (`g[x]`) is an error regardless of what `x` is — the static answer to an undecidable string
  is "don't write that," and the closed-world SDK never requires it. Same policy for
  `.constructor` member access (the prototype-walk first step; chained or not), `__proto__`
  reads/writes, `Object.defineProperty`/`setPrototypeOf`/`Object.assign` whose target
  resolves to a shared prototype, and string-argument `setTimeout`/`setInterval` (implicit
  eval).
- **Scope of the dataflow: lexical and intraprocedural.** No interprocedural value tracking,
  no string-concatenation solving. The walk catches the honest model's mistakes and every
  known bypass *pattern*; what slips a genuinely adversarial encoding is the runtime's job
  (three legs) and #10's trusted-vantage observation. This boundary is stated in the spec so
  nobody later mistakes a green static check for containment.

### D4 — Diagnostics catalog: closed kinds, mandatory hints, severity that orders but never excuses

`checks/contract.ts` is dependency-free (the storage-engine `contract.ts` precedent — types
plus small const tables, importable by anything):

- Shape: `{ kind, severity: 'error' | 'warning', line?, column?, symbol?, message, hint }` —
  §8.1's shape with `hint` **required** (the `StorageError` rule: if you can't articulate the
  fix, the agent can't either). `line`/`column` are 1-based positions in the original TS
  source; `line` is optional in the shared shape (matching #8's wire `Diagnostic`, whose
  producers include runtime stages with no source anchor) but every static-check pass
  emits it. `severity` and `message` are this change's §8.2-driven additive refinement of
  #8's minimal wire shape (severity is *shown* to the agent — it must cross the wire).
- **Kinds are a closed union** authored in this contract module; #10 extends it (additively)
  for runtime-observed kinds. Where the same misdeed exists at runtime, the kind name matches
  the bridge gate's vocabulary (`undeclared_capability` here = `undeclared_capability` on a
  `sysret` denial) so the repair model sees one language for one mistake.
- **Severity** (§8.2): `error` = will not run or will be denied; `warning` = pre-error
  (becomes a bug under plausible input). Severity exists to *order* repair, never to pass a
  bundle: the report's `ok` is `diagnostics.length === 0` — the zero-warning steady state is
  structural, there is no severity threshold knob. A warning class that proves useless is
  removed from the catalog (globally), not suppressed per-app.
- **Seam to #8 (now as-built — #8 landed 2026-06-18; this change is second, so the wiring
  is in-scope here, Chain G / task 9.1)**: `contract/src/index.ts` ships `Diagnostic.kind`
  as an open `z.string()` with a comment reserving the narrowing for this change. The
  closed union is authored in `checks/contract.ts` (the lib must stand alone — D1) and
  surfaced from `@whim/contract` by a TS-source re-export (a relative import escaping the
  package dir is acceptable for this TS-source-only, never-published workspace; `tsc -p
  contract` is `--noEmit`, so no `rootDir` constraint). Two rules keep the wire honest:
  the zod `kind` **stays an open `z.string()`** — the stub pipeline's `BUILD_FAILURE` and
  #10's future runtime kinds must keep validating; the narrowing is the exported closed
  union *type* (+ const table). And `severity`/`message` land as **optional** wire fields,
  so existing producers and `server:test` stay green. Consumers (#11, #12) import from
  `@whim/contract` and see the narrowed vocabulary.

### D5 — Manifest extraction: AST-literal-only, never by execution

`build.mjs` extracts app records by *importing* the fixture under Node — acceptable for
trusted in-repo fixtures, forbidden for model output (executing untrusted code outside the
sandbox). The checker's `extractAppManifest` reads the `defineApp({...})` argument as an AST
literal: `name`/`initial` string literals, `screens` object keys with identifier values,
`capabilities` array of string literals, `schema` a JSON-shaped literal. Anything computed
(spread, function call, identifier reference for these fields) → `manifest_not_static`
diagnostic. This doubles as a generation contract: the manifest *must* be boring, which is
also what makes #11's harness-validated app record trustworthy. Exactly one `defineApp` call,
as the default export — anything else is a diagnostic (the #37 emit contract).

### D6 — Capability⇄use and screen-graph checks: table-driven

Two small data tables, kept beside the forbidden-name table:

- **Export→capability map**: which `vc-sdk` imports imply which manifest capability. The
  as-built facades are two namespace objects: `storage` (`storage.kv.*`,
  `storage.records.*`) → `'storage'`; `cues` (`cues.haptic`/`cues.sound` — one `cues`
  export, not separate functions) → `'cues'`. The registry's third capability, `'diag'`,
  deliberately has **no row**: it has no SDK facade (only the `latency-probe` fixture
  reaches it, via raw `globalThis.__whimSyscall`), so a generated app declaring it draws
  `unused_capability`. Both directions: used-not-declared → `undeclared_capability` (error;
  the runtime gate would deny it); declared-not-used → `unused_capability` (warning; §5.4
  disclosure honesty — the consent sheet must not list ghosts). Adding capability #N+1 =
  one map row, mirroring #41's registry discipline.
- **Nav-call shapes**: `initial ∈ screens` is the whole check today — **#3 landed with no
  SDK navigation API** (only bridge-level nav-depth/back frames exist, invisible to
  mini-app source), so the shapes table ships **empty**. The mechanism stays: when a nav
  change lands, its call shapes (string-literal targets only; a computed target is a
  diagnostic — same conservative policy as D3, same model-steering rationale) are added as
  table rows, and the suite proves the mechanism now with a test-injected shape row.
  ⚠️ The old coordination note pointed at #3; task 9.1 repoints it at whichever future
  change adds navigation.

### D7 — Schema check: adapt #40's pure functions, caller supplies state

Import `validateArtifact`, `diffSchemas`, `emptyApplied` from
`src/host/storage-engine/schema.ts` (relative import; already pure and dependency-free —
note `AppliedSchema` is exported from `schema.ts`, not `contract.ts`). The pass extracts
the `schema` literal (D5), runs `validateArtifact` (as-built kinds: `invalid_artifact`,
`malformed_id`, `id_reuse`, `bad_field_type`, `bad_default`), and — when the caller
supplies an `appliedSchema` (the edit/regeneration flow; the server is stateless per Model 1,
so the device ships the applied schema with the request) — runs `diffSchemas` and maps its
conflict classes (as-built: `type_change`, `tombstone_violation`, `missing_default` —
`id_reuse` is a validate-time kind, not a diff kind) into catalog diagnostics, preserving
the engine's kind names and hints verbatim (one vocabulary, again). First generation =
`emptyApplied()`. *(`storage-semantic-guards` touched neither function — its
`unqueryable_field` guard is engine-private and runtime-only; see Open Questions.)*

### D8 — API and verification

```ts
runStaticChecks(source: string, opts?: {
  appliedSchema?: AppliedSchema;   // edit flow; omitted on first generation
  filename?: string;               // diagnostic display only
}): CheckReport
// CheckReport = { ok: boolean; diagnostics: Diagnostic[]; manifest?: ExtractedManifest }
```

Pure function, no I/O, no global state — what makes it equally callable from #11's pipeline,
#12's Tier-A gate, and a unit test. `manifest` is present whenever extraction succeeded, even
on a failing report (the repair prompt wants both). Verification is the house idiom: a TS
acceptance suite esbuild-bundled and run under Node 22 (`npm run checks:test`), exit non-zero
on failure, blocking CI step beside `storage:test`/`bridge:test`. TDD per §16.2 — assertions
written before passes. Two fixture populations: **honest** fixtures (corpus-shaped apps,
including four of the five real `fixtures/*.app.tsx` sources — `tip-splitter`,
`water-counter`, `pour-over-timer`, `style-gallery`; `latency-probe` is excluded and pinned
as an expected-flagged sample, since it bypasses the SDK via raw `globalThis.__whimSyscall`
to reach the facade-less `diag` capability and the checker flagging it is correct) must
produce *zero* diagnostics — the
false-positive gate and the proof the suite isn't vacuously red; **hostile** fixtures (the
T8-pattern bypass corpus: aliasing, computed access, string-splitting, pollution,
manifest games) must each produce the expected diagnostic — and these are authored in a
**separate session** (§16.4) from English specs, never by the implementing session.

## Risks / Trade-offs

- **[False positives vs §8.2]** A scope bug flags honest code; the agent burns repair loops
  on phantom diagnostics. → The honest-fixture population *is* the regression gate (zero
  diagnostics, asserted in CI); the walk is scope-aware by design, not by patch; any check
  class that misfires on working code is removed from the catalog, not special-cased.
- **[False confidence]** A green static check is mistaken for containment. → Stated as a
  non-goal here, restated as a requirement in the spec ("necessary, never sufficient"), and
  the pipeline ordering in #11 always runs #10 after a green check.
- **[Nav API drift]** *(updated — #3 landed with no navigation API.)* The residual risk is
  a future nav change landing without adding shape rows. → The table ships empty but
  mechanism-proven (test-injected row in the suite); task 9.1 repoints the ledger
  coordination note from #3 to the future nav change.
- **[Seam drift with #8]** *(largely resolved — #8 is as-built and matches the assumed
  shape.)* Remaining care: the wire `kind` must stay an open `z.string()` when the
  narrowing lands (the stub's `BUILD_FAILURE` and #10's runtime kinds must keep
  validating), and `severity`/`message` join the wire as *optional* fields — Chain G
  verifies `server:test` stays green after the `contract/src/index.ts` edit.
- **[TS version drift]** Compiler upgrades change AST/diagnostic details. → The suite asserts
  on catalog diagnostics (kinds/lines), never on compiler internals; `typescript` stays the
  single pinned devDependency.
- **[Adversarial-corpus session discipline]** The hostile fixtures could leak into the
  implementing session's view. → Tasks hand off *English* bypass-class descriptions only;
  the encoded fixtures land in the dedicated session (the effects-and-cues 7.x precedent).

## Open Questions

- Semantic type-checking against the SDK `.d.ts` (#3 landed — the surface is much larger
  now, 22 components, but stable): worth a follow-up pass — deliberately not designed here
  beyond keeping the pass list additive.
- `storage-semantic-guards` added a runtime-only guard (`unqueryable_field`: `json`-typed
  fields refused in `where`/`orderBy`) as a **private** engine method. A generation-time
  analog (schema literal + literal `ListQuery` call sites) is a plausible additive pass,
  but needs the rule either exported from the engine or re-derived here — deferred, and if
  built, the kind name `unqueryable_field` is reused verbatim (the D4 one-vocabulary rule).
- *(Resolved)* `checks/` stays a plain relative-import dir; workspace-ification deferred to
  the first consumer needing `@whim/checks` (D1, refreshed 2026-07-03).
