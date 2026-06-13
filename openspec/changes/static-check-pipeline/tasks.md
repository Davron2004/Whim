# static-check-pipeline — tasks

*Order matters: English test specs (§16.5) come first; the library is pure logic with
unambiguous right answers, so it is TDD end-to-end (§16.2). The hostile bypass corpus
(tasks 8.x) is authored in a SEPARATE session (§16.4), never this one — the implementing
session hands off English bypass-class descriptions only. No execution of checked code
anywhere; no edits to `src/runtime/`, `src/sdk/`, `build/`, `invariants/`, or anything
generated.*

## 1. English test specs (before any implementation — §16.5)

- [ ] 1.1 Write the English test spec for the checker surface: every assertion tasks 3–7
      will implement — parse short-circuit, each allowlist rejection (specifier / require /
      dynamic import), each forbidden-global class (direct, alias, computed-on-alias,
      `.constructor`, pollution, string-arg timers), shadowing non-flagging, manifest
      extraction (literal-only, survives other failures), both capability directions,
      screen-graph resolutions, SDK lint steering, schema validate + conflict mapping,
      zero-diagnostics honest fixtures, report purity/determinism.
- [ ] 1.2 Write the English test spec for the diagnostics catalog: hint mandatory, kinds
      closed + runtime-vocabulary match (`undeclared_capability`), warning-fails-`ok`,
      no suppression pragma.
- [ ] 1.3 Write the English bypass-class handoff for the §16.4 session (task 8): the T8
      pattern families (alias chains, computed keys, string assembly, prototype walks,
      pollution routes, manifest games) described in prose — no encoded fixtures in this
      session.

## 2. Contract module (design D4/D6 — the seams)

- [ ] 2.1 Create `checks/contract.ts` (dependency-free: types + const tables only): the
      `Diagnostic` shape (`kind`/`severity`/`line`/`column?`/`symbol?`/`message`/`hint`),
      the closed kind union, `CheckReport`, `ExtractedManifest`.
- [ ] 2.2 Add the data tables: forbidden-global names, SDK-export→capability map
      (`storage`, `cues` rows), nav-call shapes (#1 contract: `useNavigation`/`useRoute`),
      SDK-lint rules (raw timers → `delay`/`interval`).

## 3. Parse gate + import allowlist (TDD — red first against task 1.1)

- [ ] 3.1 Scaffold `checks/` + the suite runner (`checks/test/run.mjs`, the house
      esbuild-bundle-then-node idiom) + `npm run checks:test`; first assertions red.
- [ ] 3.2 Implement the parse gate over the TS compiler API (syntactic only, D2):
      diagnostics with original-source lines; unparseable source short-circuits all later
      passes.
- [ ] 3.3 Implement the import allowlist: static specifiers exactly `vc-sdk`; `require` and
      dynamic `import()` rejected with hints naming the allowed import.

## 4. Forbidden-global walk (TDD; design D3 — the T8 closer)

- [ ] 4.1 Implement lexical scope/binding resolution: global-vs-shadowed reference
      classification, alias tainting through assignment (`const g = globalThis; const h = g`).
- [ ] 4.2 Implement the flagging rules over it: direct forbidden refs; member/computed
      access through global roots or tainted aliases; computed access on a tainted alias
      with unknown key; `.constructor` access; `__proto__` + shared-prototype
      `defineProperty`/`setPrototypeOf`/`assign`; string-argument `setTimeout`/`setInterval`.
      Every diagnostic carries the SDK-shaped hint.
- [ ] 4.3 Verify the shadowing/false-positive assertions pass (honest local bindings named
      like globals are not flagged) — the §8.2 gate for this pass.

## 5. Manifest extraction + consistency checks (TDD; design D5/D6)

- [ ] 5.1 Implement `extractAppManifest`: single default-exported `defineApp` literal →
      `{name, initial, screens, capabilities, schema}`; non-literal fields →
      `manifest_not_static`; extraction result present on failing reports.
- [ ] 5.2 Implement capability⇄use both directions over the export→capability table:
      `undeclared_capability` (error, runtime-gate kind name) / `unused_capability`
      (warning).
- [ ] 5.3 Implement screen-graph resolution: `initial ∈ screens`; literal nav targets
      resolve; non-literal targets rejected; hints list declared screens.

## 6. SDK lint + schema check (TDD; design D6/D7)

- [ ] 6.1 Implement the lint pass over the rules table: raw `setTimeout`/`setInterval`/
      `requestAnimationFrame` (function-arg form) → warning with `delay`/`interval` hint.
- [ ] 6.2 Implement the schema pass: `validateArtifact` on the extracted schema literal;
      with caller-supplied `appliedSchema`, `diffSchemas` conflict classes mapped to
      diagnostics preserving engine kind names + hints; absent → `emptyApplied()` baseline.

## 7. Report assembly + the honest population (design D8)

- [ ] 7.1 Implement `runStaticChecks(source, opts)`: pass ordering, diagnostic
      accumulation, `ok === diagnostics.length === 0`, determinism (stable ordering);
      purity assertions from task 1.1 green.
- [ ] 7.2 Add the honest fixture population: the real `fixtures/*.app.tsx` sources plus
      corpus-shaped samples — all asserted zero-diagnostics (the false-positive regression
      gate). If a real fixture trips a check, treat it as a checker bug or a fixture bug to
      surface — never weaken the assertion silently.
- [ ] 7.3 Wire `checks:test` into CI (`.github/workflows/invariants.yml`) as a blocking
      step beside the existing suites; `npm run lint` clean over `checks/`.

## 8. Hostile bypass corpus — SEPARATE session (§16.4; never this session)

- [ ] 8.1 From the task-1.3 English handoff, author the encoded hostile fixtures under
      `checks/test/hostile/` (alias chains, computed keys, string assembly, prototype
      walks, pollution routes, manifest games), each asserting its expected diagnostic
      kind.
- [ ] 8.2 Add the negative control: a deliberately-emasculated walk configuration (or a
      known-uncatchable sample documented as such) proving the hostile suite can fail —
      the not-vacuously-green check.

## 9. Close out

- [ ] 9.1 Re-verify the seams: contract module importable standalone (no checker import);
      ledger notes for #3 (nav-shape table), #8 (contract re-export), #11
      (`extractAppManifest`) still accurate against as-built code; record deviations in
      `docs/v1-roadmap.md` per protocol.
