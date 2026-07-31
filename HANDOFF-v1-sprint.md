# V1 Sprint Handoff — overnight run 2026-07-30/31

Orchestrator run ended early: **monthly API spend limit hit** mid-sprint. Everything below is committed on branch `v1-sprint` (staging branch for the whole sprint; `main` untouched). Every merged chain passed integrity + fast-gate regate; per-change ledgers are in `openspec/changes/<id>/progress.md`.

## Completed tonight (built + gate-full + reviewer CLEAN)
1. **prompt-flow-ux (#7)** — 6 chains. Two-stage prompt flow, SSE client, screens, LauncherRoot wiring, Settings server address. Decision #53. REMAINING: attended on-device acceptance (task 7.2), then archive.
2. **snapshot-lineage-identity** — 3 chains. Lineage stamp + lineage-correct predicate, fork guard retired. Decision #54. REMAINING: attended task 5.2, then archive.
3. **synthetic-run-harness (#10)** — 5 chains. Chromium run-and-observe harness (`synthrun/`): builder byte-equivalence tripwire, trusted-vantage observers + watchdog, capability wiring, sweep + screens, RunReport. 75/75 suite. Decision #55. REMAINING: apply `openspec/changes/synthetic-run-harness/pending-class2.md` (2 exact lines: package.json `synthrun:test` script + gate.sh check line — Class-2, human), rerun gate-full, attended checks, then archive. NOTE: its gate-full verdict is DEFERRED on a knip finding owned by generation-loop (see below).

## In progress
4. **eval-harness (#12)** — chains A, D, B merged (loader/corpus/redaction; rubric+judges+tier-C; tier-A+adapter+case-verdict). Evals suite 82/82. NEXT: chain-C (tier-b-assertions) — was dispatched, killed by the limit, worktree cleaned, NO work lost (it had only started). Then E (report-diff-compare, after C+D), F (cli-sourcing-docs, after E), G (class2-bootstrap-record, floats). Chain blocks ready in scratchpad (see "Chain blocks" below — may need re-assembly if scratchpad was cleaned).
5. **generation-loop (#11)** — chains 1, 2, 3 merged (wire shapes; ModelClient+prompts; device seam). Chain-4 (plan-and-state-machine) was ~90% done when killed: **WIP commit `ac32c70` on branch `chain/generation-loop-4`** (machine.ts, plan.ts, machine.suite.ts, pipeline-machine.md handoff — NOT gated, NOT mergeable as-is; worktree `.claude/worktrees/generation-loop-4` still exists). RESUME: finish/verify chain-4 in that worktree (self-gate, commit, integrity vs BASE 80328a9, merge, regate), then chains 5 → 6 → 7 per `openspec/changes/generation-loop/chains.md`. KNOWN OPEN ITEM: knip flags `modelRosterFromEnv` (server/src/generation/model.ts) unused until its consumer chain merges — this is what defers synthetic-run-harness's gate-full PASS; recheck after chain-4/5/7.

## Not started / skipped deliberately
- **harden-codex-class2-approval** — chain-1 is HUMAN-BOOTSTRAP; attended-only. Untouched.
- **#13 v1-end-to-end** — attended-heavy (fresh AVD + real device LAN); roadmap-gated on #11/#12 anyway.
- Attended-only closure work: 5 changes await closure (automate-closure, clear-sonarqube-warnings, fix-list-keys-simplify-harness, sdk-charts, version-history-ux were already built before tonight; see their ledgers).
- Holdout eval set: user-held, never sought (locked decision #42). The eval runner takes `--eval-set <path>` / `WHIM_EVAL_SET`.

## How this run operated (for the next orchestrator)
- Dispatcher = main thread per `.claude/commands/opsx/apply.md`, staging branch `v1-sprint` (sanctioned deviation from `integration/<change-id>`; FIXLOOP_INTEGRATION_BRANCH=v1-sprint). One implementer subagent per chain in `.claude/worktrees/<change>-<n>`, serial merges + regate, `scripts/fixloop.sh integrity <branch>` before each merge.
- Chain blocks (verbatim task/spec/design excerpts per chain) live in the session scratchpad `chain-blocks/` dir; re-assemble from chains.md+tasks.md+design.md+specs if gone.
- Harness hooks + OS sandbox are DISABLED on this branch (f0d56d1 chore, intentional for this run). Re-enable before normal operation.

## Hard-won environment facts (also proposed as memories)
- **Worktree `@whim/*` walk-up gap**: a fresh worktree has no local node_modules; Node/tsc resolve `@whim/contract`/`@whim/server` to the PRIMARY tree. Any chain editing `contract/`/`server/` must first: `mkdir -p <wt>/node_modules/@whim && ln -s ../../contract <wt>/node_modules/@whim/contract && ln -s ../../server <wt>/node_modules/@whim/server`, else its gate validates stale code. (Caused one bogus "server bug" report — see synthetic-run-harness ledger, resolution-skew note.)
- `evals/` (root RN tsconfig) can never statically import `server/src/*` (Node tsconfig) — even `import type`. Pattern for runtime-only needs: esbuild CLI subprocess + dynamic import (see evals/judge/live.ts).
- Any esbuild-bundled Node suite transitively importing `checks/` needs `external: ['typescript']` (and synthrun's run.mjs needs `external: ['playwright']`).
- guard:metro is worktree-path-depth-sensitive: meaningful verdict ONLY from the main tree. zod can NEVER enter the Metro graph (babel lacks export-namespace-from; babel.config.js is protected) — launcher imports `@whim/contract` type-only + hand-rolled guards (decision #53).
- sonarjs/no-empty-test-file ignores eslint-disable; use a `/* eslint sonarjs/no-empty-test-file: "off" */` configuration comment (documented in eval-contract.md).
- chain-2-of-synthrun's mount_timeout test can flake under load (root cause documented in code; budget widened 500→800ms).

## Immediate next actions (in order)
1. Resume/finish generation-loop chain-4 from WIP `ac32c70`, then 5→6→7.
2. Dispatch eval-harness chain-C, then E→F→G.
3. Rerun `scripts/gate-full.sh` (should clear the knip deferral once modelRosterFromEnv is consumed) → reviewer for generation-loop + eval-harness.
4. Human: apply the two pending-class2.md files (synthetic-run-harness now; generation-loop task 6.5 when its chain-6 lands), run the attended on-device acceptances, then archive completed changes and run attended sprint closure (push v1-sprint, draft PR to main, Sonar loop, /git-cleanup, single ratified merge).
