# Progress ledger: synthetic-run-harness

## Run metadata

- run-start: 2026-07-30, dispatcher = overnight orchestrator session (Fable), attended=false (user asleep, standing authorization for this sprint run)
- staging branch: `v1-sprint` (DEVIATION from `integration/<change-id>`, sanctioned: user pre-created the sprint staging branch; `main` untouched until attended closure; FIXLOOP_INTEGRATION_BRANCH=v1-sprint for all fixloop.sh invocations)
- MAIN_TIP ancestor: 795c8bd (main); staging tip at run start: f0d56d1 (= main + hooks/sandbox-off chore)
- harness hooks + OS sandbox: DISABLED repo-wide this run (commit f0d56d1, intentional). Protected-file discipline enforced by dispatcher policy instead.
- chain DAG: linear, chain-1 → chain-2 → chain-3 → chain-4 → chain-5 (per chains.md `after:` lines)
- external ordering for chain-4 (sdk-navigation merged) SATISFIED: archived 2026-07-18, in main history.
- task 5.3 (package.json scripts entry) = HUMAN-BOOTSTRAP: implementer records the exact line, dispatcher writes pending-class2.md; NOT applied this run.

## Dispositions (append-only)
- chain-1 (core-builder-session) DISPATCHED: BASE=f0d56d1, worktree=.claude/worktrees/synthetic-run-harness-1, branch=chain/synthetic-run-harness-1, implementer=sonnet, chain block via scratchpad file.
- chain-1 REPORT: complete 4/4, GATE PASS, commit 6661dc5, contract handoff/harness-core.md (98 lines). Deviations (all Class A): early writes landed in primary tree (corrected mid-run via dispatcher message, verified clean); concurrency scoped to SessionOptions not RunOptions (matches D4); dir name synthrun/ chosen; local env.d.ts ambient node types (repo carries no @types/node); process.cwd() over import.meta.url (bundling collapses the latter). Live Chromium smoke-test beyond gate (suite not yet wired into gate — task 5.3 Class-2).
- chain-1 INTEGRITY: exit 0, scope as declared. MERGED onto v1-sprint, tasks 1.1-1.4 ticked, REGATE PASS.
- chain-2 (observers-watchdog) DISPATCHED: BASE=f4a05c4, worktree=.claude/worktrees/synthetic-run-harness-2, branch=chain/synthetic-run-harness-2, implementer=sonnet; brief includes chain-1 gotchas (env.d.ts ambient types, process.cwd(), path discipline).
- chain-2 REPORT: complete 4/4, GATE PASS + synthrun suite 26/26 (~25 repeat runs, no flake), commit 40ae746, contract handoff/observe-api.md. Deviations: B-resolved-in-scope — post-navigation observer attach was racy vs instant-throw candidates; added RunOptions.beforeNavigate hook (the exact seam harness-core.md reserved for chain-3) + attachObserversEarly/finish split; A — RunContext gained sourceMap (threads BuildCandidateResult.map through); A — paint frame fires on render() double-rAF regardless of React commit → async-only hang ≠ mount_timeout (documented in observe-api.md); A — test bundler needs external:['playwright'].
- chain-2 INTEGRITY: exit 0, scope as declared. MERGED onto v1-sprint (05952c2), tasks 2.1-2.4 ticked, REGATE PASS, synthrun 26/26 on merged tip.
- chain-3 (capability-wiring) DISPATCHED: BASE=05952c2, worktree=.claude/worktrees/synthetic-run-harness-3, implementer=sonnet; brief mandates beforeNavigate composition per chain-2's directive.
