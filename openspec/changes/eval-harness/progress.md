# Progress ledger: eval-harness

## Run metadata
- run-start: 2026-07-30 (overnight orchestrator, attended=false); staging branch v1-sprint (sprint-wide, see synthetic-run-harness/progress.md)
- chain DAG: A → {B → C, D} → E → F; G (class2-bootstrap-record) floats, HUMAN-BOOTSTRAP-adjacent (record-only)
- holdout eval set is USER-HELD: never sought, never created; loader refuses without --eval-set/WHIM_EVAL_SET (locked, decision #42)
- chain-B depends on synthetic-run-harness interfaces via the single adapter; dispatch chain-B only after synthetic-run-harness chains merge far enough to expose its report shape (or per handoff/harness-core.md + observe-api.md)

## Dispositions (append-only)
- chain-A (contract-loader-corpus) DISPATCHED: BASE=ffef2db, worktree=.claude/worktrees/eval-harness-A, branch=chain/eval-harness-A, implementer=sonnet; brief includes holdout constraints + repo gotchas.
