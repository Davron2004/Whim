# Progress ledger: snapshot-lineage-identity

## Run metadata
- run-start: 2026-07-31 (overnight orchestrator, attended=false); staging branch v1-sprint (sprint-wide)
- chain DAG: chain-1 (engine-lineage-correctness) → chain-2 (retire-ui-guard) → chain-3 (docs-decision); task 5.2 = attended on-device, out of scope this run

## Dispositions (append-only)
- chain-1 (engine-lineage-correctness) DISPATCHED: BASE=6d10d29, worktree=.claude/worktrees/snapshot-lineage-1, branch=chain/snapshot-lineage-1, implementer=sonnet.
- chain-1 REPORT: complete 5/5, GATE PASS (vstore 112/112, launcher 1885/1885), commit e195904, contract handoff/lineage-correctness.md (75 lines). Deviation (A, adjudicated sound): D3's literal predicate refined to isLineageCorrect — ancestors-of-tip always kept (shared pre-divergence history incl. fork point), only descendants-of-tip gated by lineageOf(candidate)===activeLineage; matches spec scenario text, all scenarios green.
- chain-1 INTEGRITY: exit 0. MERGED onto v1-sprint, tasks 1.1/2.1/2.2/3.1/3.2 ticked, REGATE PASS.
- chain-2 REPORT: complete 1/1, GATE PASS (launcher 1886), commit 8a9cefd. Deviation (A): added §10b fork roll-forward test beyond literal task wording (capability was previously unobservable). Noted: stale comment in store-access.suite.ts §20b (engine edge case now fixed) — dispatcher amends chain-3 scope to fix it.
- chain-2 INTEGRITY: exit 0. MERGED onto v1-sprint, task 4.1 ticked, REGATE PASS.
- chain-3 REPORT: complete (5.1 + authorized scope amendment), GATE PASS, commit 1e53875. Decision #54 appended (corrects #48 via append-only convention); §20b stale comment fixed; roadmap has no sli entry (skipped per instruction). Task 5.2 attended, unticked.
- chain-3 INTEGRITY: exit 0. MERGED onto v1-sprint, task 5.1 ticked. gate-full on merged tip: FULL GATE PASSED. Whole-change reviewer DISPATCHED.
- REVIEWER (whole change): verdict CLEAN, no findings. Report honesty verified against diff + live suite re-runs (vstore 112, launcher 1886). D3 refinement confirmed to satisfy all spec scenarios; trailer round-trip proof real; no git vocabulary leaks; decision #54 claims match code.

## Closing summary
- Chains run: 1, 2, 3 — all merged onto v1-sprint, regated green. Redispatches: 0. Deviations: one Class A (D3 predicate refined, reviewer-confirmed sound), one dispatcher-authorized scope amendment (stale §20b comment).
- gate-full: PASSED. Reviewer: CLEAN.
- Remaining: task 5.2 on-device acceptance (ATTENDED, user-run) → then /opsx:archive. Closure deferred to attended sprint closure.
