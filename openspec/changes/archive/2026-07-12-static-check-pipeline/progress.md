# Progress ledger: static-check-pipeline

Schema: whim-harness. Integration branch: main. Dispatcher: main thread (/opsx:apply).
Chain DAG is a straight line A→B→C→D→E→(F separate session)→G (each chain reads the prior
chain's contract; see chains.md). No parallel-dispatch opportunity.

## chain-A: bootstrap (HUMAN-BOOTSTRAP — applied inline by the orchestrator, human-ratified per edit)

- disposition: IN PROGRESS (human approves each protected-file edit in the CLI; keeps A human-bootstrapped).
- NOT dispatched (Class-2: `scripts/gate.sh` suite line is never grantable to any subagent).
- Applied in the MAIN TREE (must be committed to main before chain B's worktree branches from it).
- edits (task 3.1 hook-blocked slivers only):
  - (a) package.json: `"checks:test": "node checks/test/run.mjs"`
  - (b) tsconfig.json exclude: `"checks/test"` (Node runner skipped by the gate's tsc --noEmit)
  - (c) scripts/gate.sh: `check "static-checks" npm run -s checks:test`
        NOTE reconciliation: chains.md wrote the label as `"checks:test"`; handoff/contract.md +
        handoff/greenby-harness.md both specify `"static-checks"`. Label is a cosmetic gate echo
        (parsed by no one); using `"static-checks"` — matches house convention (descriptive label
        ≠ script name) and the two contracts downstream implementers read.
  - (d) knip.json "." workspace: entry `checks/test/run.mjs`, project `checks/**/*.ts`
  - (e) .gitignore: `checks/test/.phase` (greenBy phase signal — never committed; dispatcher writes
        it per-worktree before dispatching each chain)
- deliberately NOT done: no `checks/tsconfig.json` (P2); no `.eslintignore` edit (opt-out lint model).
- expected: main is NOT gate-green after this commit alone (the `checks:test` suite has no run.mjs
  yet — that scaffold rides in chain B). First green = chain B self-gate in its post-A worktree.
- optional Class-2 follow-up: APPLIED (user opted in). XPASS/promotion non-vacuity note added to
  .claude/agents/reviewer.md (chains.md chain-A greenBy paragraph; docs/harness.md §6); codex mirror
  regenerated via `scripts/sync-codex.mjs --write` (.codex/agents/reviewer.toml) so gate-full's
  `--check` stays green.
- commit: chain A committed to main (config bootstrap; not independently gate-green by design). SHA 4d63bc9.

## chain-B: spec-and-contract (1.1,1.2,1.3,2.1,2.2,2.3,3.1)
- dispatched: BASE=4d63bc9 (post-A main tip); worktree .claude/worktrees/static-check-pipeline-B; branch chain/static-check-pipeline-B; .phase=B.
- writes-contract: handoff/contract.md, handoff/greenby-harness.md (both already authored in planning; B implements them as code).
- report: STATUS complete, GATE PASS, greenBy `PASS 8 · PENDING 31 · XPASS 0 · FAIL 0` (no vacuity). commit 30c039a.
- integrity: exit 0 (only checks/** + handoff/* touched; .phase not committed).
- merged: 8a07518 (--no-ff). tasks 1.1–3.1 ticked. regate: phase-B `./scripts/gate.sh` → FAST GATE PASSED (.phase written to main tree for the phased regate, then removed — main stays strict-by-default).
- worktree/branch/owner cleaned up.
- new artifacts: handoff/test-spec.md (1.1+1.2), handoff/bypass-classes.md (1.3, prose-only for the §16.4 Chain F session), checks/{contract.ts,index.ts,test/harness.ts,test/run.mjs,test/acceptance.ts}.
- deviations (all class A): (1) stub checks/index.ts `runStaticChecks` throws — scaffold for C/D/E, part of "scaffold checks/" (3.1); (2) NAV_CALL_SHAPES mutated via cast in a `finally` as the empty-table test-injection seam (no signature change).

### FORWARD-CARRY for chain D (adjudicated tripwire — MUST include in D's dispatch block):
D5 says manifest `schema` must be a "JSON-shaped literal" and the spec says identifier indirection → error, BUT honest fixtures water-counter/latency-probe write `schema: SCHEMA` (a same-module top-level `const`), and task 7.2 requires water-counter zero-diagnostics. RESOLUTION (orchestrator, from spec §"statically analyzable" + the screens precedent): `extractAppManifest` (5.1) SHALL resolve same-module top-level `const` identifier initializers to their literal values (that IS static — no execution), and flag `manifest_not_static` only for genuinely non-analyzable values (imported identifiers, call results, spreads, computed/reassigned bindings). B pre-authored the D schema corpus using `schema: SCHEMA` to match reality — D implements to that, not to a literal-only reading. MEMORY candidate (design D5 wording tension) — apply at close-out.

## chain-C: parse-import-scope (3.2,3.3,4.1,4.2,4.3)
- dispatched: BASE=953a958; worktree .claude/worktrees/static-check-pipeline-C; branch chain/static-check-pipeline-C; .phase=C.
- writes-contract: handoff/checker-internals.md.
- report: STATUS complete, GATE PASS, greenBy `PASS 22 · PENDING 12 · XPASS 5 · FAIL 0`. commit 2e2ae1f.
- integrity: exit 0 (checks/** + handoff/checker-internals.md; run.mjs edit verified = +4 lines `external:['typescript']` only).
- merged: 86deb20 (--no-ff). tasks 3.2–4.3 ticked. regate: phase-C → FAST GATE PASSED (22 due green). worktree/branch/owner cleaned.
- deviations (all class A): (1) run.mjs `external:['typescript']` — real latent bug (esbuild inlining typescript's CJS → "Dynamic require of fs"; C first to import typescript); does NOT touch frozen harness.ts test()/phase logic. (2) `ts.isImportCall` is @internal/absent from public .d.ts → used `node.expression.kind === ts.SyntaxKind.ImportKeyword`. (3) taint follows direct `const x = <ident>` chains only (matches spec's worked example + D3 conservative framing); documented in checker-internals.md so D assumes no deeper dataflow.
- checker-internals.md (81 lines): CheckContext/Pass shapes, resolveBinding/rootIdentifierOf sigs + taint invariants, PASSES array extension point in checks/index.ts, import paths for D.

### FORWARD-CARRY for chains D & E (XPASS non-vacuity — MUST include in D's and E's dispatch blocks):
Chain C left 5 XPASS (tests green before their owning phase): `D §schema: first generation…no schema diagnostics` (D owns) + 4 `E §…` (assembly ordering, purity×2, honest-corpus zero-diagnostics; E owns). These are ABSENCE-assertions — trivially green now because no code emits those diagnostics yet. Per the harness rule "the chain that owns that greenBy verifies it is non-vacuous," D MUST confirm its schema XPASS genuinely exercises the built pass once 5.x/6.x land, and E MUST confirm its 4 XPASS are non-vacuous once assembly/honest-corpus land. Not a defect — a scheduled verification.

## chain-D: semantic-passes (5.1,5.2,5.3,6.1,6.2)
- dispatched: BASE=cf39f84; worktree .claude/worktrees/static-check-pipeline-D; branch chain/static-check-pipeline-D; .phase=D.
- forward-carries handed to D: (1) D5 schema-identifier resolution directive; (2) verify the `D §schema` XPASS non-vacuous.
- report: STATUS complete, GATE PASS, greenBy `PASS 34 · PENDING 0 · XPASS 5 · FAIL 0`. commit 0c3960c.
- integrity: exit 0 (checks/** only; scope.ts change = +2 ADDITIVE optional CheckContext fields, no narrowing — matches checker-internals allowance).
- merged: fecc9b3 (--no-ff). tasks 5.1–6.2 ticked. regate: phase-D → FAST GATE PASSED (34 due green). worktree/branch/owner cleaned.
- D5 directive: IMPLEMENTED (manifest.ts resolves same-module top-level const initializers; flags only genuinely non-analyzable). Schema XPASS: CONFIRMED non-vacuous (schema-check.ts runs validateArtifact + diffSchemas(emptyApplied,…) → 'additive' plan, genuine zero-diagnostic outcome).
- **DEVIATIONS needing reviewer scrutiny + user decision at close-out:**
  - [A · spec-reconcile] Missing `defineApp` default export is NOT flagged (silent no-op); present-but-malformed/duplicated IS flagged. Spec PROSE says missing→error, but has NO scenario and B's `D §sdk-lint`/`D §diagnostics` tests feed defineApp-less snippets expecting only-a-warning. D's reading matches the frozen corpus; the spec prose is the outlier. RESOLUTION PATH: soften spec prose at sync/close-out (missing defineApp = not-a-manifest; malformed/dup = error). Flag to reviewer + surface to user.
  - [A · precision] capability-use detection matches any identifier whose root text == an sdkExport name, WITHOUT confirming it binds to the vc-sdk import (a same-named local would count as "use" → possible false-negative on unused_capability). No test exercises it. C's resolveBinding was available but not used here. Flag to reviewer as a hardening candidate.

### FORWARD-CARRY for chain E (MUST include in E's dispatch block):
D's assembly wiring already turns ALL 5 `greenBy:E` tests XPASS (assembly ordering, purity×2, honest-corpus, latency-probe-pinned). E's real work: (1) VERIFY each of the 5 E XPASS is non-vacuous now that the behavior exists (per harness "owner verifies non-vacuity"); (2) formalize the honest-fixture population (7.2 — 4 real fixtures zero-diagnostics + latency-probe pinned expected-flagged); (3) wire CI (7.3 — .github/workflows/invariants.yml, dispatchable/not-hook-blocked). E is largely audit + CI, NOT build-from-scratch.

## chain-E: assembly-fixtures-ci (7.1,7.2,7.3)
- dispatched: BASE=4fcc2a4; worktree .claude/worktrees/static-check-pipeline-E; branch chain/static-check-pipeline-E; .phase=E (all B/C/D/E due = strict).
- report: STATUS complete, GATE PASS, greenBy `PASS 41 · PENDING 0 · XPASS 0 · FAIL 0`, ZERO deviations. commit 1cb2fbd.
- integrity: exit 0 (checks/test/acceptance.ts + .github/workflows/invariants.yml only; CI diff = pure +7 insertion into isolation-suite job).
- merged: ba2442d (--no-ff). tasks 7.1–7.3 ticked. FINAL regate STRICT (no .phase) → FAST GATE PASSED, 41/41 due green. worktree/branch/owner cleaned.
- non-vacuity (E owned all 5): purity test was VACUOUS (compared two empty-diagnostic runs) → replaced with a 4-diagnostic multi-pass source asserting length>1 before deep-equal — a real fix; assembly-ordering strengthened to assert exact kind sequence; honest-corpus loads the 4 real fixtures + 3 probe-verified corpus samples; latency-probe pinned expected-flagged. Corpus grew 39→41.
- 7.1: audit only, no code change (ordering/accumulation/ok/determinism already correct; only per-call state is a WeakMap identity cache in scope.ts). 7.3: CI runs strict by construction (no .phase in checkout).

## Tail: gate-full + reviewer + hand-back (F, G)

- gate-full.sh (merged tip, sandbox off for Chromium): initially FAILED on knip (14 "unused" checks/ files — knip can't trace run.mjs's esbuild+dynamic-import). FIX f09eb2e: knip entry `checks/test/run.mjs` → `checks/test/**` (mirrors src/host/**/test/**; resolves knip's own redundant-entry hint). Re-run: FULL GATE PASSED (knip, guard:metro, 3 Chromium invariant suites, strict greenBy 41/41, openspec validate, codex-sync).
- reviewer (full A→E diff d43685f..f09eb2e): VERDICT findings; REPORT HONESTY matches diff (re-ran suite 41/41; confirmed E purity de-vacuity real; ran knip itself — fix restores not weakens detection; T8 walk genuine binding-resolution; WeakMap per-call-safe; no boundary/contract/ violations; no stub residue).
  - **F1 (medium-high, LIVE-REPRODUCED) checks/passes/capabilities.ts:44-45** — capability-use matched by identifier TEXT, not binding; sibling sdk-lint.ts:26 correctly uses resolveBinding. Local `const storage={...}` shadowing the SDK import → false `undeclared_capability` (caps:[]) OR silently swallows `unused_capability` (caps:['storage']). Real gap in the §5.4 consent-sheet guarantee. Reviewer: should-fix-before-done. F3(low): no test covers the collision — add a greenBy test with the fix.
  - **F2 (medium) checks/passes/manifest-extraction.ts:131-135** — missing defineApp = silent no-op vs spec prose "SHALL produce an error" (duplicated+malformed ARE flagged — verified). Genuine conformance gap; reconcile at close-out. Options: (a) soften spec prose to as-built [recommended — matches B's frozen corpus]; (b) flag missing-defineApp [breaks frozen D §sdk-lint tests, needs corpus edit + human sign-off].
  - Everything else conforms + is test-verified. Nothing blocks the mechanical gate; reviewer wants a recorded human decision on F1/F2 before F/G.
- USER DECISION: F1 → fix now (fix chain). F1 fix does NOT touch F2.
- USER DECISION (F2, 2026-07-08): APPROVED the recommendation. Chain G MUST (docs-only, no code/frozen-test churn):
  (a) soften `specs/static-checks/spec.md` §"The app manifest is extracted statically, literal-only":
      a source with NO `defineApp` default export = "not a manifest to extract" (no diagnostic, no
      manifest); a PRESENT-but-malformed OR DUPLICATED `defineApp` still SHALL error. This matches the
      as-built code + chain B's frozen corpus.
  (b) record that the "exactly one `defineApp` default export" precondition belongs at the FUTURE
      generation-harness caller boundary (post-#9), NOT in the pure library — so the completeness
      guarantee is relocated, not dropped. Note it in docs/v1-roadmap.md #9 (or the nav/caller note G
      already touches) as a forward requirement on the caller.
  Rationale in this ledger above (F2 options a/b) + the reviewer finding. capfix (F1) leaves
  manifest-extraction.ts untouched, so nothing here is pre-empted.

## chain-capfix: reviewer F1+F3 fix (post-review fix chain, steps 5–9)
- dispatched: BASE=f09eb2e; worktree .claude/worktrees/static-check-pipeline-capfix; branch chain/static-check-pipeline-capfix; NO .phase (strict — all 41 + new tests due).
- scope: checks/passes/capabilities.ts (use resolveBinding, mirror sdk-lint.ts) + checks/test/acceptance.ts (greenBy tests: shadow-collision both directions + duplicated-defineApp lock-in).
- status: IN PROGRESS.
- BLOCKED (class B, revision 1): implementer empirically proved the fix as specified is unbuildable — `resolveBinding` returns `'global'|'local'|'tainted'`; a vc-sdk import specifier and a same-named local shadow BOTH register via `declare(name,false)` → both resolve `'local'`, indistinguishable. sdk-lint.ts's `==='global'` trick can't apply (inverted for imports). No source changed. Options: (1) additively extend scope.ts to expose import-binding identity [durable]; (2) narrow duplicate walk in capabilities.ts [duplication, disallowed].
- ADJUDICATION (orchestrator): scope.ts is NOT owner-authored (it's this change's chain-C code, not invariants/; chain D already additively extended it) — my DO-NOT-TOUCH was a scoping pref, now lifted. Authorized OPTION 1 via SendMessage (revision 1/2): additive scope.ts primitive for import-binding resolution, guardrails below. Focused re-review of scope.ts+capabilities.ts diff planned post-fix (T8-adjacent file).
- report (revision 1): STATUS complete, GATE PASS, greenBy `PASS 45 · PENDING 0 · XPASS 0 · FAIL 0` (41 + 4 new). commit bef708c. Implemented option 1: scope.ts gains a parallel importBindingMap + `resolveImportBinding`/`resolvesToImport` (additive; ScopeFrame boolean→ScopeEntry{tainted,importInfo?}, resolveBinding/taint/forbidden-global semantics byte-for-byte preserved). capabilities.ts uses `resolvesToImport('vc-sdk', export)` not text match. checker-internals.md updated (106/120 lines).
- integrity: exit 0 (checks/{internal/scope.ts,passes/capabilities.ts,test/acceptance.ts} + handoff/checker-internals.md).
- RE-REVIEW: performed by orchestrator via direct diff inspection (change is ~50 surgical lines; a redundant agent would re-derive it). Verified: scope.ts change is provably additive (classification expr identical with local.tainted substituted for local; taint sources/forbidden-global paths untouched); shadow logic correct (nested const found first, importInfo undefined → resolvesToImport false); aliased imports handled (`propertyName ?? name` = module export name); new tests non-vacuous by construction (old text-match fires on the literal `storage` shadow → tests 1&2 red-before-fix). Gate confirms C forbidden-global + honest-shadowing suite stays green.
- merged: 8814b6e (--no-ff). strict regate → 45/45 green. FINAL gate-full.sh → FULL GATE PASSED (knip clean incl. new exports; 3 Chromium invariant suites; strict greenBy 45/45; openspec 16/16; codex-sync). worktree/branch/owner cleaned.

## CLOSING SUMMARY (A–E + capfix — snapshot written BEFORE chains F/G ran; their entries below supersede the REMAINING line)
- Chains run: A(bootstrap, human-ratified) → B → C → D → E, all merged + regated; + knip-entry fix (f09eb2e) + capfix (reviewer F1/F3, 8814b6e). Straight-line DAG, no parallel dispatch.
- Redispatches: 1 (capfix revision 1 — class-B API-gap, adjudicated to an additive scope.ts extension). All other chains one-shot.
- Deviations by class: all class A except the capfix class-B block (resolved). No class-C, no merge conflicts, no proposal-invalidation.
- Gate history: every chain self-gated (phased) + serial regate; two gate-full failures caught+fixed (knip entry pattern) then green; final gate-full PASSED.
- Reviewer: full A→E audit — report honesty matches diff; T8 walk genuine; 2 findings → F1 fixed (capfix), F2 → user-approved close-out docs directive (recorded above).
- Final corpus: 45 tests, all green STRICT. Main tip 8814b6e.
- REMAINING (as of this snapshot — since completed; see chain-F and chain-G entries below): chain F (hostile bypass corpus, separate §16.4 session), chain G (close-out — carries the F2 directive + @whim/contract wiring). Tasks 8.1/8.2 (F) and 9.1 (G) were unticked at snapshot time; both chains later ran to completion and all tasks are now ticked.
- MEMORY candidates (durable, from implementer reports): (1) esbuild bundling `typescript` into a Node ESM output throws "Dynamic require of fs" → `external:['typescript']` + upward node_modules resolution (chain C); `ts.isImportCall` is @internal/absent from public .d.ts → use `node.expression.kind === ts.SyntaxKind.ImportKeyword`. (2) a `'global'|'local'|'tainted'` binding classification collapses "import" and "shadowing local" → needs declaration-identity (capfix). Orchestrator to apply worthwhile ones.

## chain-F: hostile-bypass-corpus (8.1, 8.2)
- dispatch note (2026-07-08): continuing from the PR branch `static-check-pipeline` because A-E
  + capfix are under review there as squashed commit `bbcbcaf`, not yet merged to `main`.
- dispatched: BASE=bbcbcaf6bb0bd2907dfed4ba847c1e1901823eb3; worktree
  .claude/worktrees/static-check-pipeline-F; branch chain/static-check-pipeline-F; strict
  suite mode (no `.phase`).
- scope: `checks/test/hostile/**` plus the minimum required test-runner/index wiring if needed.
- reads: handoff/bypass-classes.md; specs/static-checks/spec.md §"Forbidden-global walk closes
  T8"; public `runStaticChecks` signature from handoff/contract.md only.
- report: STATUS complete, GATE PASS (`./scripts/gate.sh`), commit 2b6c4f8.
- integrity: exit 0 with `FIXLOOP_INTEGRATION_BRANCH=static-check-pipeline` (PR-branch
  continuation; changed files were `checks/test/acceptance.ts`, `checks/test/hostile/corpus.ts`,
  and `openspec/changes/static-check-pipeline/tasks.md`).
- merged: no-ff merge `chain(static-check-pipeline): F`; tasks 8.1/8.2 ticked.
- regate: STRICT `./scripts/gate.sh` → FAST GATE PASSED; static-check corpus now PASS 55 ·
  PENDING 0 · XPASS 0 · FAIL 0.
- coverage: alias chains, computed keys, string assembly, prototype walks, pollution routes, and
  manifest games. Negative control documents the dynamic deep-merge `__proto__` boundary by
  asserting no `prototype_pollution` claim for that runtime-shaped pattern.

## chain-G: close-out (9.1)
- dispatch note (2026-07-08): continuing from PR branch `static-check-pipeline` after F was
  squashed into commit 7b6f4f2.
- dispatched: BASE=7b6f4f2cd2c25e49520d6f01545b94f9c1cf0950; worktree
  .claude/worktrees/static-check-pipeline-G; branch chain/static-check-pipeline-G; strict
  suite mode.
- scope: `contract/src/index.ts`, `docs/v1-roadmap.md`,
  `openspec/changes/static-check-pipeline/specs/static-checks/spec.md`,
  `openspec/changes/static-check-pipeline/tasks.md`, and this progress ledger.
- reads: handoff/contract.md (#8 seam); docs/v1-roadmap.md #9 entry; reviewer F2 directive in
  this ledger.
- report: STATUS complete, `npm run server:test` PASS (143 passed), `./scripts/gate.sh` PASS,
  commit 36c3747.
- integrity: exit 0 with `FIXLOOP_INTEGRATION_BRANCH=static-check-pipeline`; changed files were
  contract/src/index.ts, server/test/contract.suite.ts, docs/v1-roadmap.md,
  specs/static-checks/spec.md, and tasks.md.
- merged: no-ff merge `chain(static-check-pipeline): G`; task 9.1 ticked.
- regate: STRICT `./scripts/gate.sh` → FAST GATE PASSED; static-check corpus remains PASS 55 ·
  PENDING 0 · XPASS 0 · FAIL 0; server:test now 143 passed.
- close-out notes: `@whim/contract` type-re-exports `DiagnosticKind` without importing checker
  implementation; wire `Diagnostic.kind` remains open, with optional `severity` and `message`.
  F2 decision applied: missing `defineApp` is no-manifest/no-diagnostic in the pure library;
  duplicated or present-malformed `defineApp` remains an error; exactly-one-default completeness
  moves to the future generation-harness caller boundary.

## FINAL verification after chain-G
- first `./scripts/gate-full.sh` attempt inside the host sandbox: FAILED only on the three
  Chromium-dependent suites (`invariants`, `bridge-invariants`, `deliver-by-source`) with macOS
  Mach-port permission errors; non-Chromium suites, knip, Metro guard, codex-sync, and openspec
  passed.
- rerun `./scripts/gate-full.sh` outside the sandbox: FULL GATE PASSED.

## POST-LEDGER: SonarCloud quality-gate rework on the PR branch (2026-07-09, recorded 2026-07-12)
- After the ledger above closed, PR #4 (`static-check-pipeline` → `main`) went through a
  SonarCloud (automatic analysis) quality-gate cycle outside this harness loop:
  - 13:50 — `78e59f0` "refactored for code readability" (Sonar-driven cleanup on the PR branch).
  - 15:31 — three parallel fix worktrees for the remaining findings: manifest cognitive
    complexity, schema-check readability, scope cognitive complexity (`fix/sonar-*` branches).
  - 18:31 — branch squashed to `9a3cc7f`; the final versions of `checks/internal/manifest.ts`,
    `checks/internal/scope.ts`, `checks/passes/schema-check.ts` are reworked variants of those
    fixes (the draft worktree versions were superseded). `.eslintrc.js` gained a
    `no-restricted-syntax` rule banning comparator-less `.sort()` (internalizing that Sonar rule).
  - 22:46Z — SonarCloud Quality Gate PASSED; PR #4 squash-merged to `main` as `03229ce`
    (tree-identical to `9a3cc7f`).
- Cleanup (2026-07-12): pruned the three superseded `fix/sonar-*` branches/worktrees, the stale
  `static-check-pipeline` branch, and 16 stale June `worktree-wf_*` branches.
- Follow-up adopted: fold SonarJS rules into the local lint so the gate catches these findings
  before PR time (see DEVLOG / harness docs).
