# Progress ledger: eval-harness

## Run metadata
- run-start: 2026-07-30 (overnight orchestrator, attended=false); staging branch v1-sprint (sprint-wide, see synthetic-run-harness/progress.md)
- chain DAG: A → {B → C, D} → E → F; G (class2-bootstrap-record) floats, HUMAN-BOOTSTRAP-adjacent (record-only)
- holdout eval set is USER-HELD: never sought, never created; loader refuses without --eval-set/WHIM_EVAL_SET (locked, decision #42)
- chain-B depends on synthetic-run-harness interfaces via the single adapter; dispatch chain-B only after synthetic-run-harness chains merge far enough to expose its report shape (or per handoff/harness-core.md + observe-api.md)

## Dispositions (append-only)
- chain-A (contract-loader-corpus) DISPATCHED: BASE=ffef2db, worktree=.claude/worktrees/eval-harness-A, branch=chain/eval-harness-A, implementer=sonnet; brief includes holdout constraints + repo gotchas.
- chain-A REPORT: complete 6/6, GATE PASS + evals suite 39/39 (run directly; gate wiring is chain-G/Class-2), commit 1af7264, contract handoff/eval-contract.md (120 lines, at cap). Deviations (A): file layout + type field shapes designed by implementer and pinned in contract; sonarjs/no-empty-test-file needs per-file configuration comment (documented in contract); corpus slugs chosen + Slug column added to docs/app-corpus.md Tier-0 rows (design D11).
- chain-A INTEGRITY: exit 0, scope as declared. MERGED onto v1-sprint, tasks 1.1-1.6 ticked, REGATE PASS.
- chain-D (tier-c-judge-and-rubric) DISPATCHED next (needs only chain-A); chain-B HELD until synthetic-run-harness chain-2 (observe-api contract) merges.
- chain-D REPORT: complete 5/5, GATE PASS + evals 69/69, commit 2c72319, contract handoff/judge.md (93 lines). Deviations: B-resolved-in-scope — live judge cannot statically import server/src (RN vs Node tsconfig global conflict, even import type); construction-gating needs no import; score() shells to esbuild CLI + dynamic import (documented in judge.md closing section); A — rubric criteria originated (intent-fidelity/usability/robustness/polish, 1-5) per D8.
- chain-D INTEGRITY: exit 0. MERGED onto v1-sprint, tasks 4.1-4.5 ticked, REGATE PASS, evals suite green on merged tip.
- chains B/C/E/F: HELD pending synthetic-run-harness chain-5 (run-report shape) per DAG + adapter design.
- chain-B REPORT: complete 5/5, GATE PASS + evals 82/82, commit 46b4551, contract handoff/run-observation.md (73 lines). Deviations (A): run.mjs external:['typescript'] (pre-authorized); missing RuntimeDiagnostic.line defaults to 0 sentinel (documented); computeCaseVerdict excludes TierCResult by type signature ("Tier C never gates" compiler-enforced).
- chain-B INTEGRITY: exit 0. MERGED onto v1-sprint, tasks 2.1-2.5 ticked, REGATE PASS, evals green on merged tip.
- chain-C (tier-b-assertions) DISPATCHED next (after B).
- INTERRUPTION (monthly API spend limit): chain-C implementer killed just after start; no work lost, worktree+branch cleaned. Resume: dispatch chain-C fresh (block scratchpad/chain-blocks/eval-C.md or re-assemble), then E→F→G per chains.md. See HANDOFF-v1-sprint.md.
