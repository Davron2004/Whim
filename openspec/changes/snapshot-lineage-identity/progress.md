# Progress ledger: snapshot-lineage-identity

## Run metadata
- run-start: 2026-07-31 (overnight orchestrator, attended=false); staging branch v1-sprint (sprint-wide)
- chain DAG: chain-1 (engine-lineage-correctness) → chain-2 (retire-ui-guard) → chain-3 (docs-decision); task 5.2 = attended on-device, out of scope this run

## Dispositions (append-only)
- chain-1 (engine-lineage-correctness) DISPATCHED: BASE=6d10d29, worktree=.claude/worktrees/snapshot-lineage-1, branch=chain/snapshot-lineage-1, implementer=sonnet.
- chain-1 REPORT: complete 5/5, GATE PASS (vstore 112/112, launcher 1885/1885), commit e195904, contract handoff/lineage-correctness.md (75 lines). Deviation (A, adjudicated sound): D3's literal predicate refined to isLineageCorrect — ancestors-of-tip always kept (shared pre-divergence history incl. fork point), only descendants-of-tip gated by lineageOf(candidate)===activeLineage; matches spec scenario text, all scenarios green.
- chain-1 INTEGRITY: exit 0. MERGED onto v1-sprint, tasks 1.1/2.1/2.2/3.1/3.2 ticked, REGATE PASS.
