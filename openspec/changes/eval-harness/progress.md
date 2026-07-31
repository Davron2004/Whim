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
