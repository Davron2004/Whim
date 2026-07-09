# static-check-pipeline — tasks

*Order matters: English test specs (§16.5) come first; the library is pure logic with
unambiguous right answers, so it is TDD end-to-end (§16.2). The hostile bypass corpus
(tasks 8.x) is authored in a SEPARATE session (§16.4), never this one — the implementing
session hands off English bypass-class descriptions only. No execution of checked code
anywhere; no edits to `src/runtime/`, `src/sdk/`, `build/`, `invariants/`, or anything
generated.*

*Phased TDD (design D9 · `handoff/greenby-harness.md`): the executable corpus is authored
**tests-first in Chain B** — the whole B–E assertion set, every test tagged `greenBy:<chain>`
— on a greenBy harness that reads an untracked `checks/test/.phase`. Later chains (C/D/E)
implement code until their tagged tests pass; each chain leaves `checks:test` green *for its
phase* (later-chain tests are tolerated as pending), and the final/CI run is strict (all
green). So "write the test" (Chain B) and "make it pass" (its greenBy chain) are separate
tasks below — the red→green transition is scheduled by tag, not left red across a gate.*

## 1. English test specs (before any implementation — §16.5)

- [x] 1.1 Write the English test spec for the checker surface: every assertion tasks 3–7
      will implement — parse short-circuit, each allowlist rejection (specifier / require /
      dynamic import), each forbidden-global class (direct, alias, computed-on-alias,
      `.constructor`, pollution, string-arg timers), shadowing non-flagging, manifest
      extraction (literal-only, survives other failures), both capability directions,
      screen-graph resolutions, SDK lint steering, schema validate + conflict mapping,
      zero-diagnostics honest fixtures, report purity/determinism.
- [x] 1.2 Write the English test spec for the diagnostics catalog: hint mandatory, kinds
      closed + runtime-vocabulary match (`undeclared_capability`), warning-fails-`ok`,
      no suppression pragma.
- [x] 1.3 Write the English bypass-class handoff for the §16.4 session (task 8): the T8
      pattern families (alias chains, computed keys, string assembly, prototype walks,
      pollution routes, manifest games) described in prose — no encoded fixtures in this
      session.

## 2. Contract module (design D4/D6 — the seams)

- [x] 2.1 Create `checks/contract.ts` (dependency-free: types + const tables only): the
      `Diagnostic` shape (`kind`/`severity`/`line`/`column?`/`symbol?`/`message`/`hint`),
      the closed kind union, `CheckReport`, `ExtractedManifest`.
- [x] 2.2 Add the data tables: forbidden-global names, SDK-export→capability map
      (`storage`, `cues` rows — the as-built facades are namespace objects; no `diag` row,
      it has no SDK facade), nav-call shapes (table ships EMPTY — #3 landed no nav API;
      structure + test-injection seam only), SDK-lint rules (raw timers →
      `delay`/`interval`).
- [x] 2.3 Build the greenBy TDD harness `checks/test/harness.ts` per
      `handoff/greenby-harness.md`: the tagged `test(name, {greenBy}, fn)` helper, the
      `checks/test/.phase` reader (absent ⇒ strict), and the due/pending/XPASS/FAIL semantics
      with a non-zero exit iff a *due* test failed. Ordinary `checks/` code (not hook-blocked);
      frozen after this chain — C/D/E add tests but never edit it.

## 3. Parse gate + import allowlist (turns the `greenBy:C` tests green — Chain C phase)

- [x] 3.1 Scaffold `checks/` + the suite runner (`checks/test/run.mjs`, the house
      esbuild-bundle-then-node idiom) + `npm run checks:test`, then author the FULL B–E
      assertion corpus in `checks/test/acceptance.ts` on the 2.3 harness — every assertion
      tasks 3–7 will implement, each tagged `greenBy:` per `handoff/greenby-harness.md`'s
      schedule (B tests green now; C/D/E tests start pending). Under Chain B's phase, the
      suite is GREEN (only `greenBy:B` due). (The `package.json` script, root-tsconfig
      `checks/test` exclude, `scripts/gate.sh` suite line, and `knip.json` coverage are
      hook-blocked HUMAN edits — chain-A; the `checks/test/.phase` `.gitignore` line rides the
      same bootstrap pass though it isn't itself hook-blocked, so `.phase` is ignored before the
      dispatcher's first write.)
- [x] 3.2 Implement the parse gate over the TS compiler API (syntactic only, D2):
      diagnostics with original-source lines; unparseable source short-circuits all later
      passes.
- [x] 3.3 Implement the import allowlist: static specifiers exactly `vc-sdk`; `require` and
      dynamic `import()` rejected with hints naming the allowed import.

## 4. Forbidden-global walk (turns the `greenBy:C` tests green — design D3, the T8 closer)

- [x] 4.1 Implement lexical scope/binding resolution: global-vs-shadowed reference
      classification, alias tainting through assignment (`const g = globalThis; const h = g`).
- [x] 4.2 Implement the flagging rules over it: direct forbidden refs; member/computed
      access through global roots or tainted aliases; computed access on a tainted alias
      with unknown key; `.constructor` access; `__proto__` + shared-prototype
      `defineProperty`/`setPrototypeOf`/`assign`; string-argument `setTimeout`/`setInterval`.
      Every diagnostic carries the SDK-shaped hint.
- [x] 4.3 Verify the shadowing/false-positive assertions pass (honest local bindings named
      like globals are not flagged) — the §8.2 gate for this pass.

## 5. Manifest extraction + consistency checks (turns the `greenBy:D` tests green — design D5/D6)

- [x] 5.1 Implement `extractAppManifest`: single default-exported `defineApp` literal →
      `{name, initial, screens, capabilities, schema}`; non-literal fields →
      `manifest_not_static`; extraction result present on failing reports.
- [x] 5.2 Implement capability⇄use both directions over the export→capability table:
      `undeclared_capability` (error, runtime-gate kind name) / `unused_capability`
      (warning).
- [x] 5.3 Implement screen-graph resolution: `initial ∈ screens`; the nav-shapes table
      ships empty (no nav API as of #3), so prove the target-resolution mechanism with a
      test-injected shape row — literal targets resolve, non-literal targets rejected;
      hints list declared screens.

## 6. SDK lint + schema check (turns the `greenBy:D` tests green — design D6/D7)

- [x] 6.1 Implement the lint pass over the rules table: raw `setTimeout`/`setInterval`/
      `requestAnimationFrame` (function-arg form) → warning with `delay`/`interval` hint.
- [x] 6.2 Implement the schema pass: `validateArtifact` on the extracted schema literal
      (as-built kinds: `invalid_artifact`/`malformed_id`/`id_reuse`/`bad_field_type`/
      `bad_default`); with caller-supplied `appliedSchema`, `diffSchemas` conflict classes
      (as-built: `type_change`/`tombstone_violation`/`missing_default`) mapped to
      diagnostics preserving engine kind names + hints; absent → `emptyApplied()` baseline.

## 7. Report assembly + the honest population (turns the `greenBy:E` tests green — design D8)

- [x] 7.1 Implement `runStaticChecks(source, opts)`: pass ordering, diagnostic
      accumulation, `ok === diagnostics.length === 0`, determinism (stable ordering);
      purity assertions from task 1.1 green.
- [x] 7.2 Add the honest fixture population: FOUR of the five real `fixtures/*.app.tsx`
      (`tip-splitter`, `water-counter`, `pour-over-timer`, `style-gallery`) plus
      corpus-shaped samples — all asserted zero-diagnostics (the false-positive regression
      gate). `latency-probe` is excluded by design (raw `globalThis.__whimSyscall` +
      facade-less `diag`) — pin it as an expected-flagged sample instead. If an honest
      fixture trips a check, treat it as a checker bug or a fixture bug to
      surface — never weaken the assertion silently.
- [x] 7.3 Wire `checks:test` into CI (`.github/workflows/invariants.yml`) as a blocking
      step in the `isolation-suite` job beside the other Node suites (`quality-gate`
      already covers the checks lib via root typecheck/lint/knip once chain-A lands);
      `npm run lint` clean over `checks/`.

## 8. Hostile bypass corpus — SEPARATE session (§16.4; never this session)

- [x] 8.1 From the task-1.3 English handoff, author the encoded hostile fixtures under
      `checks/test/hostile/` (alias chains, computed keys, string assembly, prototype
      walks, pollution routes, manifest games), each asserting its expected diagnostic
      kind.
- [x] 8.2 Add the negative control: a deliberately-emasculated walk configuration (or a
      known-uncatchable sample documented as such) proving the hostile suite can fail —
      the not-vacuously-green check.

## 9. Close out

- [x] 9.1 Wire the `@whim/contract` narrowing (#8 landed first, so this edit is ours):
      TS-source re-export of the closed kind union from `checks/contract.ts` in
      `contract/src/index.ts`; the zod wire `kind` STAYS an open `z.string()` (the stub's
      `BUILD_FAILURE` must keep validating); add `severity`/`message` as OPTIONAL wire
      fields; `server:test` green after. Then re-verify seams + ledger: contract module
      importable standalone (no checker import); record the plain-dir deviation from the
      roadmap's "(workspace-ified once #8's exist)" note; repoint the nav-table
      coordination note from #3 to the future nav change; confirm the #11
      `extractAppManifest` note; record deviations in `docs/v1-roadmap.md` per protocol.
      (`docs/capabilities.md` already indexes both new capabilities as proposal-stage
      rows — the pointers flip to `openspec/specs/` at sync/archive; nothing to add.)
