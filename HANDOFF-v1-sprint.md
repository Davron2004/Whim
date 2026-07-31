# V1 Sprint Handoff — updated 2026-07-31 (resume run complete)

Branch `v1-sprint` @ **af29f52** — 110 commits ahead of `main`, **nothing pushed** (109 ahead of `origin/v1-sprint`). `main` untouched. Nothing archived. No protected file edited.

**`scripts/gate-full.sh` PASSES on the tip** — knip, `guard:metro`, the three Chromium invariant suites, and `openspec validate` (32/32). The knip deferral that had been blocking `synthetic-run-harness` since 2026-07-30 is **cleared** (`modelRosterFromEnv`'s consumer is generation-loop's composition root).

| Suite | Sprint start | Now |
|---|---|---|
| `npm run server:test` | 152 | **465** |
| `node evals/test/run.mjs` | 196 | **254** |
| `node synthrun/test/run.mjs` | 75 | **82** |
| `node server/test/e2e.run.mjs` | — | **31** |

Note the first three are the *only* way to run those suites today — `evals:test`, `synthrun:test`, and `server:e2e` are Class-2 npm scripts that do not exist until a human applies the pending records (below). `gate.sh` does not run them.

---

## What this run completed

**generation-loop (#11) — DONE except attended acceptance.** Chains 4→5→6→7 built and merged. Chain-4 was resumed from the interrupted WIP `ac32c70` rather than redone: its uncommitted diff held a real correctness fix (`roundDiagnostics` accumulates CHECK + RUN diagnostics of one round before the repair decision, not RUN alone) plus a settle() refactor closing an unhandled-rejection hazard. Decision **#56**. tasks.md: 1 unticked (7.6, attended on-device).

**eval-harness (#12) — DONE.** Chains C→E→F→G built and merged. tasks.md: **0 unticked**. Roadmap #12 marked as-built.

**Two HIGH-severity bugs found by the reviewer pass and fixed** (details below). Both were invisible to a green gate.

**One dispatcher-found defect fixed:** chain-F's gate-configuration check asserted the corpus-eval gate entry is *absent*, which would have gone red the moment a human applied `pending-class2.md` — at the worst moment, since that same line is what first puts the evals suite inside the gate. Replaced with a tri-state, self-healing check (applied-and-well-formed ⇒ pass; unapplied-but-recorded ⇒ pass; unapplied-and-unrecorded ⇒ **fail**; malformed application ⇒ fail).

---

## Remaining work — all attended, in order

1. **Apply the three `pending-class2.md` records** (each records exact before/after context; all verified still unapplied):
   - `openspec/changes/synthetic-run-harness/pending-class2.md` — `package.json` `synthrun:test` + a `gate.sh` check line
   - `openspec/changes/generation-loop/pending-class2.md` — `package.json` `"server:e2e": "node server/test/e2e.run.mjs"` + `gate-full.sh` `check "generation-e2e"    npm run -s server:e2e` (after `bridge-invariants`)
   - `openspec/changes/eval-harness/pending-class2.md` — four edits: `package.json` (`evals:test`, `evals`), `tsconfig.json` (`exclude` += `evals/test`), `gate.sh` (`check "corpus-eval" npm run -s evals:test`), `knip.json`. Apply-order matters: (a) before (c).
2. **Re-run `gate-full.sh`** after applying — the suites now run inside the gate for the first time. Expect the tri-state gate-config check to stay green through the transition (that is what it was rebuilt for).
3. **Attended on-device acceptances** (these flip status tags, they do not block gates):
   - generation-loop task **7.6** — real device on the LAN, real key: generate an app end to end and install it; kill the app mid-generation and confirm the server observes the abort and the reconciled usage lands in `/v1/usage`. Closes roadmap cancellation carryover (a) and flips #56's `PENDING` tag.
   - prompt-flow-ux task **7.2** and snapshot-lineage-identity task **5.2** (outstanding from the previous run).
4. **Decide eval-harness's decision entry — see "Open decisions" below.**
5. **Archive** the completed changes, then run attended sprint closure (push `v1-sprint`, draft PR into `main`, SonarCloud loop, `/git-cleanup` targeted at `v1-sprint`, single ratified merge).

---

## The two HIGH bugs — what they were, and what is still open

### 1. Completed-run double-credit on client disconnect (FIXED)

A run that finished **successfully** could be billed twice. `emitCompletion` yields `usage` then re-checks abort before the terminal; the route credited on `usage` but only set `reachedTerminal` when the *terminal* was observed. A client disconnecting in that gap left `reachedTerminal === false`, so `reconcileAbortedUsage` re-credited the same generation ids. `UsageStore.credit` is a plain additive accumulator in both implementations.

Fixed by gating reconciliation on **credit ownership** (a flag `interceptUsage` sets *synchronously, before* awaiting the credit) instead of terminal observation. `machine.ts` untouched, so "an aborted run never emits a terminal event" still holds structurally. Reproduced before fixing: `got {20,40,60}, expected {10,20,30}`.

**Still open, by design:** if `usageStore.credit()` itself throws, `creditOwned` is already set, so reconciliation will not retry that run's credit. This trades a theoretical *under*-credit on store failure for closing a real *over*-charge. Not airtight; recorded so nobody assumes otherwise.

### 2. Holdout content could leak into "redacted" reports (FIXED, three rounds)

`buildCaseResult` redacted only the `case` sub-object; `tierA`/`tierB`/`tierC` passed through verbatim. `Diagnostic.symbol` is documented as "the offending identifier/specifier/field name" — literal candidate source. A holdout candidate is LLM-generated *from the secret prompt*, and Tier A always runs.

Three rounds, each closing a **different channel of the same property**:
1. Tier A/B/C free text in `serializeReport` (reviewer's finding).
2. `diff.ts`'s regression objects + `renderDiff`'s rendered line — the deeper one, found by the implementer after a rejected justification.
3. CLI `console.error` sourcing/generation messages — the spec's redaction sentence names console output explicitly.

Design: redaction extended at the same single choke point, so "one constructor, redaction cannot be bypassed" is now *actually* true. Under `holdout`, closed-vocabulary and numeric fields survive (`kind`, `severity`, `status`, `score`, `rubricVersion`…) and all free text is **dropped, not hashed**. `visible` unchanged. `diff`/`compare`/determinism unaffected — they only ever read the surviving fields.

Also closed in the same branch: `evals/cli.mjs` was a **second** synthrun importer, contradicting the "ONLY module" comment asserted in `adapters/synthetic-run.ts` and `handoff/run-observation.md`. Now genuinely single — `grep -rn "from '\.\./synthrun'\|from '\.\./\.\./synthrun'" evals/` returns only the adapter.

**Root cause of that one was a planning defect, not implementer error:** `chains.md` gave chain-F a `reads:` list omitting `handoff/run-observation.md` — the one document stating the sole-importer rule. **Lesson for future chain planning: a chain that *touches* a subsystem needs the contract carrying that subsystem's invariants, not merely the contracts whose types it consumes.**

---

## Open decisions and residuals (for the human — deliberately not decided)

- **eval-harness has no `docs/decisions.md` entry.** #53/#54/#55/#56 cover prompt-flow-ux, snapshot-lineage, synthetic-run-harness and generation-loop; eval-harness — a 7-chain change delivering a whole top-level subsystem — has none. Its tasks.md never asked for one (task 6.4's `decisions.md` mention is about what `docs/evals.md` tells *operators* to record after a model bakeoff), so the tick is correct and this is not a missed task. But it is an inconsistency in the architectural record. Author **#57** at closure, or decide deliberately that the roadmap + capabilities row suffice.
- **Reconciliation's shared retry budget favors early generation ids.** `resolveAll` walks ids sequentially under one `totalBudgetMs` (default 5000ms), so a slow id-1 can consume the whole budget before id-2 is attempted. Documented behavior, but it makes a long run (several repair rounds ⇒ several ids) structurally *less* likely to reconcile its later-round tokens — and later repair rounds are the more expensive, larger-context calls. **This is a billing-fairness policy call, not a defect.**
- **`EvalRunReport.evalSet.location`** is recorded unconditionally. It is a path, not content; not in the spec's forbidden list; reports land in a gitignored dir. Left as-is deliberately.
- **A corrupted report file** passed to `diff`/`compare` can surface a `JSON.parse` `SyntaxError` whose message may include a snippet of the invalid JSON. Genuine chicken-and-egg — visibility is unknown until the parse succeeds.
- **`evals/judge/index.ts`** is currently imported by nothing (everything imports the concrete judges directly). An intended task-4.2 deliverable; will gain a consumer when Tier C is wired into the CLI. Knip does not flag it because knip is not wired to `evals/` until the Class-2 edits land.
- **Tier-B assertion `english` is now dropped for holdout.** An eval-set author who embeds prompt text into an assertion's English statement is an authoring-discipline matter, not a code-level gap.
- **`server-core.suite.ts`'s §5.5 "determinism" assertion is near-tautological** under a `ScriptedModelClient` — two clients scripted with the same string trivially agree. Its real content is "the plumbing adds no nondeterminism." The previous canned-echo version was equally weak; the value lives in the two assertions added beside it (never-echoes-input, unconfigured⇒502).

---

## Hard-won environment facts

Carried forward from the previous run (all still true):

- **Worktree `@whim/*` walk-up gap**: a fresh worktree has no local `node_modules`; Node/tsc resolve `@whim/contract`/`@whim/server` to the PRIMARY tree. Any worktree must first `mkdir -p <wt>/node_modules/@whim && ln -s ../../contract <wt>/node_modules/@whim/contract && ln -s ../../server <wt>/node_modules/@whim/server`, else its gate validates stale code. Also run `npm run build` in a fresh worktree (populates the gitignored `src/runtime/generated/*`).
- `evals/` (root RN tsconfig) can never statically import `server/src/*` (Node tsconfig) — not even `import type`. Pattern: esbuild CLI subprocess + dynamic import (see `evals/judge/live.ts`, `evals/cli.mjs`'s facade).
- `guard:metro` is worktree-path-depth-sensitive — meaningful only from the main tree. zod can never enter the Metro graph.
- `sonarjs/no-empty-test-file` ignores `eslint-disable`; use a `/* eslint sonarjs/no-empty-test-file: "off" */` configuration comment.
- synthrun's `mount_timeout` test can flake under load (budget already widened 500→800ms).
- Harness hooks + OS sandbox are DISABLED on this branch (f0d56d1, intentional). **Re-enable before normal operation.**

New from this run:

- **esbuild externals are cumulative and non-obvious.** `server/test/run.mjs` needs `external: ['typescript', 'esbuild']` — **both, neither alone suffices**. Without either: `Dynamic require of "fs" is not supported` from the bundled `typescript` package (`prompts.suite.ts` imports it directly). With only `typescript`: the same error from `node_modules/esbuild/lib/main.js`, because `stages.suite.ts → stages/build.ts → synthrun/builder.ts` bundles the esbuild package itself. `evals/test/run.mjs` now needs `['typescript', 'esbuild', 'playwright']` for the same reason once it reaches the adapter's value exports. `synthrun/test/run.mjs` documented this pattern first.
- **A relative-path `declare module '../foo.mjs'` is silently never matched by TypeScript** — only non-relative/wildcard specifiers reach the ambient-module table. Use `declare module '*/foo.mjs'`. Keep such a file free of unrelated global polyfills: merging `synthrun/assemble.d.ts` into `env.d.ts` let the latter's `process`/`crypto` declarations shadow `server/`'s real `@types/node` globals project-wide.
- **A real `evals/cli.mjs run` launches headless Chromium via synthrun** and works in this environment with no extra setup. The acceptance suite must stay Chromium-free by construction — every subprocess-driven CLI test must finish during eval-set resolution or candidate *sourcing*, never after a case reaches Tier A.
- Stale LSP diagnostics referencing removed worktree copies are noise; the merged tip's `tsc --noEmit` is the truth.

---

## Method notes for the next orchestrator

- **Dispatcher = main thread** per `.claude/commands/opsx/apply.md`, staging branch `v1-sprint` (sanctioned deviation from `integration/<change-id>`; `FIXLOOP_INTEGRATION_BRANCH=v1-sprint`). One implementer per chain in `.claude/worktrees/<change>-<n>`, self-gate → `fixloop.sh integrity` → serial `--no-ff` merge → regate → ledger. Chain blocks live in the session scratchpad `chain-blocks/`; re-assemble from chains.md + tasks.md + design.md + specs if gone.
- **Two independent changes ran as parallel lanes** (`server/**` vs `evals/**`) with merges strictly serialized. One collision was foreseen and defused by ordering rather than cleverness: generation-loop task 7.7 and eval-harness chain-F both append to `docs/capabilities.md`, so the second was cut from the staging tip only after the first merged.
- **Verify by count, not by color.** `gate.sh` staying green could not distinguish "suites registered and passing" from "suites still silently not running." The check that mattered was `server:test` reporting 458, not the gate reporting PASS.
- **A red-check proves a test is *sensitive*; it says nothing about whether its *input surface* is complete.** All three redaction rounds involved suites that were non-vacuous AND red-checked, and each still missed its channel for a different structural reason: round 1's secret fixture only entered via `candidateSource`; round 2's leak lived in a pass→fail branch the only holdout fixture (fail→pass) could never construct; round 3's surface had no assertions at all despite the spec naming it. This is the single most transferable lesson of the run.
- **Prose that asserts a guarantee the code does not provide** was the shape of both HIGH bugs — `generate.ts` claimed the two crediting paths "can never double-count"; `synthetic-run.ts` claimed to be "the ONLY module" importing the harness. Both were true when written and quietly stopped being true. Worth grepping for confident invariant claims in comments during review.
- **When an implementer discloses a gap, act on it.** Both of the deeper leaks (round 2's `diff.ts`, round 3's console path) were reached because the implementer named what it had *not* covered instead of claiming airtightness.
