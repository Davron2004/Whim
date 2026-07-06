# Context chains: static-check-pipeline

<!-- Retrofit (this change predated chains). Tasks from tasks.md grouped per the template rules:
     3–7 tasks/chain, grouped by shared files/layer, sequential A→G. See research.md for the
     task→file map and the proposer notes (P1–P7) that drive these boundaries. -->

## chain-A: bootstrap (HUMAN-BOOTSTRAP — not dispatchable)
- tasks: 3.1 (hook-blocked slivers only)
- rationale: the two config lines every later chain assumes — the `checks:test` script and the
  `checks/test` tsconfig exclude — are the only hook-blocked edits in the change.
- reads: specs/static-checks/spec.md §"Pure execution-free library"; handoff: none
- writes-contract: none (the bootstrap facts live in handoff/contract.md §test-harness)
- note: **DO NOT DISPATCH (research.md P1).** `protect-harness.sh` blocks `*/package.json` and
  `tsconfig*.json`. The **human** (a) adds `"checks:test": "node checks/test/run.mjs"` to root
  `package.json` and (b) adds `"checks/test"` to root `tsconfig.json` `exclude` (so the gate's
  `tsc --noEmit` skips the Node runner, matching `src/host/*/test`). NO `checks/tsconfig.json`
  (P2). Make both edits in an editor, then dispatch B. The dispatchable scaffold of 3.1
  (`checks/test/run.mjs` + `acceptance.ts`) rides in Chain B.

## chain-B: spec-and-contract (1.1, 1.2, 1.3, 2.1, 2.2, + 3.1 scaffold)
- tasks: 1.1, 1.2, 1.3, 2.1, 2.2, 3.1(scaffold sliver)
- rationale: the English specs (§16.5 first), the bypass-class handoff for the §16.4 session,
  the dependency-free `checks/contract.ts` (types + data tables), and the `run.mjs`/
  `acceptance.ts` test harness — all share `checks/contract.ts` + the test scaffold and are the
  seam every later chain consumes.
- reads: specs/harness-diagnostics/spec.md §all (4 reqs); specs/static-checks/spec.md §"Pure
  execution-free library", §"Imports resolve only to vc-sdk"; handoff: none
- writes-contract: handoff/contract.md
- note: replicate the esbuild-bundle-then-run idiom from `src/host/bridge/test/run.mjs` verbatim
  for `checks/test/run.mjs`, plus `tsconfigRaw:'{}'` (P2). `checks/contract.ts` is
  dependency-free; reuse runtime/engine kind names verbatim (P4 — `undeclared_capability`,
  `type_change`, `id_reuse`, `tombstone_violation`, `missing_default`). 1.3 is the prose bypass
  handoff consumed ONLY by the separate §16.4 session (Chain F) — keep checker internals out of
  it (P6). Do NOT hard-code a closed wire enum that conflicts with #8's open `Diagnostic.kind`
  (P7).

## chain-C: parse-import-scope (3.2, 3.3, 4.1, 4.2, 4.3)
- tasks: 3.2, 3.3, 4.1, 4.2, 4.3
- rationale: the parse gate, import allowlist, and the full lexical scope / forbidden-global walk
  (T8) all share the TS compiler API surface and one scope-tracking structure; splitting 3.x from
  4.x would force an incomplete mid-construction handoff of the scope walker. Largest dispatchable
  chain (5 tasks), tightly coupled around the checker walk.
- reads: specs/static-checks/spec.md §"Parse gate runs first and alone", §"Imports resolve only
  to vc-sdk", §"Forbidden-global walk closes T8"; handoff: handoff/contract.md
- writes-contract: handoff/checker-internals.md
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
  handoff/checker-internals.md
- writes-contract: none
- note: 6.2 imports `validateArtifact`/`diffSchemas`/`emptyApplied` from
  `src/host/storage-engine/schema.ts` by relative path and MUST surface diff conflict classes
  under the engine's own kind names (P4). 5.1 puts the extracted manifest in the report even on
  failure (req 5). Capability + screen-graph + nav shapes are table-driven (reqs 6/7); the tables
  come from handoff/contract.md.

## chain-E: assembly-fixtures-ci (7.1, 7.2, 7.3)
- tasks: 7.1, 7.2, 7.3
- rationale: composes `runStaticChecks` from all passes, adds the honest-fixture gate, and wires
  the CI step — depends on every pass (Chains C + D) being complete, and nothing depends back on
  it within the implementing sequence.
- reads: specs/static-checks/spec.md §"Pure execution-free library" (determinism); handoff:
  handoff/contract.md, handoff/checker-internals.md
- writes-contract: none
- note: `runStaticChecks` is deterministic (same input → identical report); 7.2's 4
  `fixtures/*.app.tsx` must each yield zero diagnostics (P5 — a tripping honest fixture is a bug
  to fix, never suppressed). 7.3 edits `.github/workflows/invariants.yml` — NOT hook-blocked,
  dispatchable (P3); add `checks:test` as a blocking step, leave existing steps untouched.

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
- rationale: ledger update + the #8 `Diagnostic.kind` narrowing-seam re-verification — runs last,
  after the hostile corpus (F) confirms T8 coverage and after the checker is complete.
- reads: handoff/contract.md (the #8 seam); docs/v1-roadmap.md #9 entry; handoff: none
- writes-contract: none
- note: edits `docs/v1-roadmap.md` (not hook-blocked, dispatchable). If #8 (harness-server-
  skeleton) has NOT landed, record the deferred `@whim/contract` re-export in the ledger rather
  than attempting it (P7). Also add the two new capabilities (`static-checks`,
  `harness-diagnostics`) to `docs/capabilities.md` if that hasn't happened at sync time.
