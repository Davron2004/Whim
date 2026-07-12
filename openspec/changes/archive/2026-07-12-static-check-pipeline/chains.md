# Context chains: static-check-pipeline

<!-- Retrofit (this change predated chains). Tasks from tasks.md grouped per the template rules:
     3–7 tasks/chain, grouped by shared files/layer, sequential A→G (each chain reads the prior
     chain's contract, so the DAG is a straight line — no parallel dispatch opportunity here).
     See research.md for the task→file map and the proposer notes (P1–P7) that drive these
     boundaries. NOTE: research.md predates the greenBy layer (design D9, added 2026-07) — for
     the phased-TDD mechanism trust design.md/handoff/greenby-harness.md, not research.md. -->

## chain-A: bootstrap (HUMAN-BOOTSTRAP — not dispatchable)
- tasks: 3.1 (hook-blocked slivers only)
- rationale: the four config edits every later chain assumes — `checks:test` script, tsconfig
  exclude, `gate.sh` suite line, knip coverage — are the only hook-blocked edits in the change.
- reads: specs/static-checks/spec.md §"Pure execution-free library"; handoff: none
- writes-contract: none (the bootstrap facts live in handoff/contract.md §test-harness)
- note: **DO NOT DISPATCH (research.md P1).** `protect-harness.sh` blocks `*/package.json`,
  `tsconfig*.json`, `scripts/gate*.sh`, and `knip.json`. The **human** (a) adds
  `"checks:test": "node checks/test/run.mjs"` to root `package.json`; (b) adds `"checks/test"`
  to root `tsconfig.json` `exclude` (so the gate's `tsc --noEmit` skips the Node runner,
  matching `src/host/*/test`); (c) adds a `check "checks:test" npm run -s checks:test` line to
  `scripts/gate.sh` (suites are enumerated explicitly — without it the harness DONE gate never
  runs the suite; `gate-full.sh` inherits); (d) extends `knip.json`'s `"."` workspace with
  `checks/**` (entry `checks/test/run.mjs`, project `checks/**/*.ts` — knip's workspace map is
  explicit and would otherwise silently skip the dir). NO `checks/tsconfig.json` (P2); no
  `.eslintignore` edit (opt-out model — `checks/` lints by default, which is wanted). Make all
  four edits in an editor, then dispatch B. The dispatchable scaffold of 3.1
  (`checks/test/run.mjs` + `acceptance.ts`) rides in Chain B.
- greenBy bootstrap (design D9 · `handoff/greenby-harness.md`): in the SAME editor pass, add
  `checks/test/.phase` to `.gitignore` (not hook-blocked, but do it here so the phase file is
  ignored before the dispatcher's first write). Then the DISPATCHER, not a chain, drives the
  phase: before dispatching chain N it writes `<worktree>/checks/test/.phase` = `N` into that
  chain's worktree (runbook: `.claude/commands/opsx/apply.md` step 5). No delete step exists:
  `.phase` is untracked, so it never merges, and the final `gate-full.sh` on the merged main
  tip — and CI — are strict by construction. Optional Class-2 human edit: add the XPASS/promotion
  non-vacuity line to `.claude/agents/reviewer.md` (see `docs/harness.md` §6).
- grants (reconciliation, 2026-07): the scoped-grant mechanism does NOT make this chain
  dispatchable. Under the worktree dispatch model (2026-07-07, `docs/harness.md`) implementers DO
  run in worktrees, so the three Class-1 edits (`package.json`/`tsconfig.json`/`knip.json`) could
  in principle be granted — but **`scripts/gate.sh` is Class-2** (`docs/archive/parallel-fix-loop.md`
  §4.9): never grantable to any subagent, full stop, and this chain's whole point is the gate.sh
  suite line. One Class-2 edit in the set keeps the whole pass human-in-the-editor (splitting the
  four edits across an agent lane + a human pass would just split one atomic bootstrap in two). So
  this chain stays HUMAN-BOOTSTRAP; grants change nothing here.

## chain-B: spec-and-contract (1.1, 1.2, 1.3, 2.1, 2.2, 2.3, + 3.1 harness+corpus)
- tasks: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1
- rationale: the English specs (§16.5 first), the bypass-class handoff for the §16.4 session,
  the dependency-free `checks/contract.ts` (types + data tables), the greenBy TDD harness (2.3),
  and — tests-first (D9) — the FULL B–E assertion corpus authored on it (3.1). All share
  `checks/contract.ts` + the harness and are the seam every later chain consumes.
- reads: specs/harness-diagnostics/spec.md §all (4 reqs); specs/static-checks/spec.md §"Pure
  execution-free library", §"Imports resolve only to vc-sdk"; handoff: none
- writes-contract: handoff/contract.md, handoff/greenby-harness.md
- note: replicate the esbuild-bundle-then-run idiom from `src/host/bridge/test/run.mjs` verbatim
  for `checks/test/run.mjs`, plus `tsconfigRaw:'{}'` (P2). Build the greenBy harness (2.3) and
  author the whole B–E corpus tagged per `handoff/greenby-harness.md` (3.1): with `.phase=B`, only
  `greenBy:B` tests are due, so the chain's gate is GREEN while C/D/E tests sit pending.
  `checks/contract.ts` is
  dependency-free; reuse runtime/engine kind names verbatim (P4 — `undeclared_capability`,
  `type_change`, `id_reuse`, `tombstone_violation`, `missing_default`). 1.3 is the prose bypass
  handoff consumed ONLY by the separate §16.4 session (Chain F) — keep checker internals out of
  it (P6). Do NOT hard-code a closed wire enum that conflicts with #8's open `Diagnostic.kind`
  (P7) — #8 is as-built and its zod `kind` stays open; B only authors the union in
  `checks/contract.ts`, the `@whim/contract` wiring is Chain G's.

## chain-C: parse-import-scope (3.2, 3.3, 4.1, 4.2, 4.3)
- tasks: 3.2, 3.3, 4.1, 4.2, 4.3
- rationale: the parse gate, import allowlist, and the full lexical scope / forbidden-global walk
  (T8) all share the TS compiler API surface and one scope-tracking structure; splitting 3.x from
  4.x would force an incomplete mid-construction handoff of the scope walker. Largest dispatchable
  chain (5 tasks), tightly coupled around the checker walk.
- reads: specs/static-checks/spec.md §"Parse gate runs first and alone", §"Imports resolve only
  to vc-sdk", §"Forbidden-global walk closes T8"; handoff: handoff/contract.md,
  handoff/greenby-harness.md
- writes-contract: handoff/checker-internals.md
- greenBy: retires the `greenBy:C` tests (the whole parse/import/forbidden-global set Chain B
  pre-authored). Dispatcher sets `.phase=C`, so D/E tests stay pending; leave them pending, do
  NOT touch the harness or other chains' tags. Any `greenBy:C` test that XPASSes before you
  implement its pass is a vacuity flag — make it genuinely exercise the pass, don't ship it green-by-accident.
- note: parse gate runs FIRST and short-circuits later passes on unparseable source (req 2);
  the forbidden-global walk is binding-resolution, NOT token matching, and must NOT flag honest
  shadowing (req 4 — 4.3 is the false-positive assertion set). Expose the `resolveBinding` helper
  + the per-pass signature + `CheckContext` in handoff/checker-internals.md (D's SDK-lint pass
  may reuse the helper — P-openQ2).

## chain-D: semantic-passes (5.1, 5.2, 5.3, 6.1, 6.2)
- tasks: 5.1, 5.2, 5.3, 6.1, 6.2
- rationale: manifest extraction, capability-use consistency, screen-graph resolution, SDK lint,
  and the schema pass — the remaining table-driven passes, all consuming the same parsed
  `SourceFile` from Chain C and feeding `runStaticChecks`. None feed back into C.
- reads: specs/static-checks/spec.md §"Manifest extracted statically", §"Capability
  declarations match use", §"Screen graph resolves statically", §"SDK lint steers toward the
  taught path", §"Schema check reuses the storage engine"; handoff: handoff/contract.md,
  handoff/checker-internals.md, handoff/greenby-harness.md
- writes-contract: none
- greenBy: retires the `greenBy:D` tests (manifest/capability/screen-graph/SDK-lint/schema).
  Dispatcher sets `.phase=D`, so the `greenBy:C` set is now DUE too — a broken C test fails your
  gate (regression protection); E tests stay pending. Same XPASS-is-vacuity rule.
- note: 6.2 imports `validateArtifact`/`diffSchemas`/`emptyApplied` from
  `src/host/storage-engine/schema.ts` by relative path (`AppliedSchema` also lives there, not in
  contract.ts) and MUST surface engine kinds verbatim (P4 — validate:
  `invalid_artifact`/`malformed_id`/`id_reuse`/`bad_field_type`/`bad_default`; diff:
  `type_change`/`tombstone_violation`/`missing_default`). 5.1 puts the extracted manifest in the
  report even on failure (req 5). Capability + screen-graph + nav shapes are table-driven
  (reqs 6/7) — the nav table is EMPTY as-built (no #3 nav API; 5.3 proves the mechanism via a
  test-injected row); the tables come from handoff/contract.md.

## chain-E: assembly-fixtures-ci (7.1, 7.2, 7.3)
- tasks: 7.1, 7.2, 7.3
- rationale: composes `runStaticChecks` from all passes, adds the honest-fixture gate, and wires
  the CI step — depends on every pass (Chains C + D) being complete, and nothing depends back on
  it within the implementing sequence.
- reads: specs/static-checks/spec.md §"Pure execution-free library" (determinism); handoff:
  handoff/contract.md, handoff/checker-internals.md, handoff/greenby-harness.md
- writes-contract: none
- greenBy: retires the `greenBy:E` tests (composition, purity/determinism, honest-fixture
  zero-diagnostics, `latency-probe` expected-flagged) — the LAST pre-authored phase. Dispatcher
  sets `.phase=E`, so B+C+D are all due; after this chain the suite must be fully green under
  strict too. 7.3's CI step should run the suite STRICT (no `.phase` in a fresh checkout ⇒ strict,
  so nothing extra is needed — just confirm CI does not write a `.phase`).
- note: `runStaticChecks` is deterministic (same input → identical report); 7.2's honest set is
  FOUR of five fixtures (`tip-splitter`, `water-counter`, `pour-over-timer`, `style-gallery`) —
  zero diagnostics each; `latency-probe` is pinned expected-flagged (raw `__whimSyscall` +
  facade-less `diag`), never added to the honest set (P5 — a tripping honest fixture is a bug
  to fix, never suppressed). 7.3 edits `.github/workflows/invariants.yml` — NOT hook-blocked,
  dispatchable (P3); add `checks:test` to the `isolation-suite` job as a blocking step, leave
  existing steps untouched.

## chain-F: hostile-bypass-corpus (8.1, 8.2) — SEPARATE §16.4 SESSION (not dispatchable here)
- tasks: 8.1, 8.2
- rationale: the adversarial bypass corpus + its negative control prove the forbidden-global walk
  (T8) cannot be evaded — and per §16.4 must be authored by a DIFFERENT session than the one that
  implemented the checker, working only from the prose bypass-class handoff.
- reads: the task-1.3 bypass-class handoff + specs/static-checks/spec.md §"Forbidden-global walk
  closes T8"; handoff: the PUBLIC `runStaticChecks` signature from handoff/contract.md ONLY (never
  checker-internals.md)
- writes-contract: none
- note: **separate-session track (research.md P6)**, analogous to the effects-and-cues invariant
  session — do NOT dispatch alongside the implementing chains. Sequence after E. 8.2's negative
  control must stay non-vacuous (it must still catch a real bypass). The corpus exercises the
  checker as a black box through `runStaticChecks`.

## chain-G: close-out (9.1)
- tasks: 9.1
- rationale: wires the `@whim/contract` narrowing (#8 landed 2026-06-18, so this change is
  second and the re-export is ours — P7 resolved) + ledger update — runs last, after the
  hostile corpus (F) confirms T8 coverage and after the checker is complete.
- reads: handoff/contract.md (the #8 seam); docs/v1-roadmap.md #9 entry; handoff: none
- writes-contract: none
- note: edits `contract/src/index.ts` (dispatchable — `contract/` is not hook-blocked): re-export
  the closed kind union from `checks/contract.ts` (TS-source relative import); the zod wire
  `kind` STAYS an open `z.string()` (the stub's `BUILD_FAILURE` must keep validating);
  `severity`/`message` join the wire as OPTIONAL fields; `server:test` must be green after.
  Also edits `docs/v1-roadmap.md` (not hook-blocked): record the plain-dir deviation from
  "(workspace-ified once #8's exist)" and repoint the nav-table note from #3 to the future nav
  change. `docs/capabilities.md` already indexes `static-checks` + `harness-diagnostics` as
  proposal-stage rows — pointers flip to `openspec/specs/` at sync/archive; nothing to add.
