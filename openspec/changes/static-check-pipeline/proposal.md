# static-check-pipeline

## Why

The §8.1 loop's step 3 — *static check, before running anything* — does not exist. The
generation loop (#11) cannot be assembled without it, the eval harness (#12) uses it as the
Tier-A deterministic gate, and the repair loop is only as good as the diagnostics this stage
feeds back ("the thing that makes a harness good is the quality of diagnostics fed back, not
the model" — spec §8.1). It also closes the one open pen-test finding: **T8** (decisions #37
follow-up) showed the spike's token-scan static check **misses `Object.prototype` /
`globalThis`-alias pollution** — the real checker must be an AST/dataflow walk, not a token
grep. Roadmap change #9, Lane C; no dependencies (pure library), so it is a Wave-1 window.

## What Changes

- **A new pure TypeScript library, `checks/`** (top-level, like `build/` and `invariants/` —
  Node-land, no RN imports, no DOM, no execution of the checked code), usable verbatim by the
  server (#8/#11), the eval runner (#12), and its own Node test suite. One entry point:
  check a candidate mini-app source string → a structured report.
- **The check passes** (spec §8.1 step 3, in order, accumulating diagnostics):
  1. **Parse gate** — TS compiler (already a devDependency) syntax diagnostics; nothing else
     runs on an unparseable file.
  2. **Import allowlist** — every import specifier must be exactly `vc-sdk` (the #37 contract:
     one TS file, imports only `vc-sdk`); `require`, dynamic `import()`, and any other
     specifier are diagnostics.
  3. **Forbidden-global AST walk (closes T8)** — direct references to stripped/forbidden
     globals (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `RTCPeerConnection`,
     `localStorage`, `indexedDB`, `Worker`, `document`, `eval`, `Function`, …); **alias
     indirection** (`globalThis`/`window`/`self`/local aliases of them, incl. computed member
     access on a global alias); **prototype-walk codegen patterns** (`.constructor` chains —
     the `({}).constructor.constructor` hole CSP closes at runtime, caught here at
     generation time); **`Object.prototype` pollution attempts** (`__proto__` writes,
     `Object.defineProperty/setPrototypeOf` onto shared prototypes — the T7-adjacent
     poison-the-next-generation vector).
  4. **Static manifest extraction** — `defineApp`'s argument must be statically analyzable
     (literal `name` / `initial` / `screens` / `capabilities` / `schema`); extraction is
     AST-only, never executes the bundle (the server-side analog of `build.mjs`'s
     extract-by-import, which the harness must not do to untrusted code outside the sandbox).
     Feeds #11's harness-validated app record.
  5. **Capability⇄use consistency, both directions** — used-but-undeclared (would be
     gate-denied at runtime; error) and declared-but-unused (consent dialog lists a
     capability the app never touches; §5.4 disclosure honesty) — driven by a data table
     mapping SDK exports → required capability (today: `storage`, `cues`), one row per
     capability (#41's append-only discipline extends here).
  6. **Screen-graph resolution** — `initial` resolves to a screen; navigation push targets
     resolve to declared screens (nav API shape per #1's contract notes — `useNavigation` /
     `useRoute` — finalized against #3's as-built API; the check is table-driven so #3
     landing is a data update, not a rewrite).
  7. **SDK lint** — the steering rules the runtime deliberately does not enforce: raw
     `setTimeout`/`setInterval` → `delay`/`interval` (the #2 contract note: "raw `setTimeout`
     stays unstripped; steering = #9's SDK lint"), plus the §5.5 cleanup-discipline class.
  8. **Schema check** — reuse the storage engine's **exported pure** `validateArtifact` +
     `diffSchemas` (#40: "the diff is a pure exported function the future harness reuses as a
     generation-time static check") against a caller-supplied applied schema (the server is
     stateless — Model 1 — so the device sends the applied schema with an edit request;
     absent means first generation).
- **The diagnostics catalog** — the §8.1 `{kind, symbol, line, hint}` shape, structured
  kinds, severity per §8.2 (severity orders work, never excuses it; zero-warning steady
  state; every diagnostic carries a fix hint shaped like the right SDK answer). Authored in
  a **dependency-free contract module** (the storage-engine `contract.ts` precedent) and
  surfaced in `@whim/contract` as the narrowing of #8's open wire `Diagnostic.kind` (per
  #8's contract notes, which landed first); `severity`/`message` are this change's additive
  refinement of that wire shape.
- **Node test suite** (`npm run checks:test`, the house esbuild-bundle-then-run idiom),
  TDD per §16.2 — pure logic with unambiguous right answers — blocking in CI.
- **Adversarial bypass corpus authored in a separate session** (§16.4): the implementing
  session writes the honest-path and known-pattern tests; the hostile fixtures that try to
  sneak past the walk (string-splitting, aliasing, computed access) are authored by a
  dedicated session against the English test spec, so the implementer cannot teach to the test.

Explicitly **not** changing: no execution of candidate code (that is #10's synthetic run);
no bundling (the build pipeline exists); no server mounting (#8/#11); no runtime, sandbox,
CSP, or module-allowlist edits (locked #35/#37). **The static check is not a containment
boundary** — the sandbox's three legs are; this stage exists for diagnostic quality, repair
speed, and defense-in-depth, and its misses must be caught by #10/the runtime, never excused
by "the static check passed."

## Capabilities

### New Capabilities

- `static-checks`: the generation-time check pipeline — parse gate, import allowlist,
  forbidden-global/prototype-pollution AST walk (T8), static manifest extraction,
  capability⇄use consistency, screen-graph resolution, SDK lint, schema check — as a pure,
  deterministic, execution-free library.
- `harness-diagnostics`: the shared diagnostics catalog every harness stage emits into —
  structured kind vocabulary, mandatory fix hints, severity semantics, source-line fidelity
  (§8.1/§8.2). #10 (synthetic run) and #11 (repair loop) consume/extend this capability.

### Modified Capabilities

*(none — the storage specs are untouched; this change consumes `validateArtifact`/
`diffSchemas` exactly as #40 exported them. If reuse reveals a needed export change, that is
a finding to surface, not a delta to write here.)*

## Impact

- **New:** `checks/` (library + its dependency-free `contract.ts` + `test/` suite);
  `checks:test` script in `package.json`; a blocking CI step alongside the existing suites.
- **Reads (no edits):** `src/host/storage-engine/schema.ts` (`validateArtifact`,
  `diffSchemas`, `emptyApplied`, `AppliedSchema`) and `src/host/storage-engine/contract.ts`
  (`SchemaArtifact`) — both already pure/dependency-free by design.
- **Untouched:** `src/runtime/`, `src/sdk/`, `src/host/bridge/`, `build/`, `invariants/`
  (adversarial fixtures land under `checks/test/` in their own session, not in the sandbox
  invariant suite), CSP/sandbox/allowlist (standing constraint).
- **Dependencies:** none new at runtime — the TS compiler API (`typescript` ^5.8, already a
  devDependency) is the parser; Node 22.
- **Seams created:** the closed diagnostic-kind union (narrows `@whim/contract`'s open wire
  `kind` — #8's seam, wired by whichever change is implemented second);
  the SDK-export→capability table and nav-call-shape table (data updates when #2/#3 land);
  `extractAppManifest` (consumed by #11's harness-validated app record).
