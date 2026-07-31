# Progress ledger: generation-loop

## Run metadata
- run-start: 2026-07-31 (overnight orchestrator, attended=false); staging branch v1-sprint (sprint-wide)
- chain DAG: {1 ∥ 2} → {3 ∥ 4} → 5 → 6 → 7; HUMAN-BOOTSTRAP touchpoint task 6.5 (pending-class2.md record only); task 7.6 attended on-device.
- PRECONDITION SCOPING (dispatcher decision): chains.md's "synthetic-run-harness fully merged before ANY chain" precondition is scoped to chains 5–7 per its own stated rationale (RunReport/harness interface consumption); chains 1–4 touch no synthrun interface and are dispatched against their declared file scopes. Chains 5–7 remain hard-blocked until synthetic-run-harness chain-5 merges.

## Dispositions (append-only)
- chain-1 (contract-wire-shapes) DISPATCHED: BASE=3e52c17, worktree=.claude/worktrees/generation-loop-1, implementer=sonnet.
- chain-2 (model-client-and-prompts) DISPATCHED: BASE=3e52c17, worktree=.claude/worktrees/generation-loop-2, implementer=sonnet.
- chain-1 REPORT: complete 4/4, GATE PASS, commit fd7f8d6, contract handoff/wire-shapes.md. Deviation (A, HARNESS-CRITICAL finding): fresh worktrees resolve @whim/contract|server to the PRIMARY tree via node_modules walk-up — worktree must create local @whim symlinks or self-gate validates stale code. Chain-1 fixed locally; dispatcher warned chain-2 mid-flight; all future contract/server-editing chains get symlink setup up front. MEMORY + docs/harness.md gap noted for closure.
- chain-1 INTEGRITY: exit 0. MERGED onto v1-sprint, tasks 1.1-1.4 ticked, REGATE PASS (primary tree regate resolves @whim/* to itself — merged code validated correctly here).
- chain-3 (device-seam) DISPATCHED: BASE=c81306c (includes chain-1 wire shapes), worktree=.claude/worktrees/generation-loop-3, implementer=sonnet; @whim symlinks pre-created by dispatcher per chain-1's walk-up finding.
- chain-2 REPORT: complete 7/7, GATE PASS, commit 241946d, contract handoff/model-client.md (109 lines). Deviations: A — symlink warning received pre-gate, all verification post-fix; A — prompts.suite covers adapter/no-network scenarios beyond literal 2.5 list (in-scope spec excerpt); A — per-turn context types split from PromptInputs (I/O boundary); B flagged forward — server/test/run.mjs needs external:['typescript'] when chain-7 wires prompts.suite into acceptance (suite verified standalone 84/84, documented in handoff for chain-7).
- chain-2 INTEGRITY: exit 0. MERGED onto v1-sprint, tasks 2.1-2.7 ticked, REGATE PASS.
- chain-4 (plan-and-state-machine) DISPATCHED next (after chain-2).
- chain-3 REPORT: complete 7/7, GATE PASS x2, commit d9a32bd, contract handoff/device-seam.md (97 lines). Deviations (A): buildGenerateRequest extracted to generation-request.ts (LauncherRoot un-importable under Node; mirrors history-logic split — behavioral tests over source-grep); activeSource now Promise<string|undefined> per spec (absence is honest, not an error); op-sqlite device path cannot guarantee no-file-created-on-peek (no fs-existence API; Node path fully honors it; documented, no DDL either way).
- chain-3 INTEGRITY: exit 0. MERGED onto v1-sprint, tasks 3.1-3.7 ticked, REGATE PASS.
- INTERRUPTION (monthly API spend limit): chain-4 implementer killed near completion. Partial work preserved as WIP commit ac32c70 on chain/generation-loop-4 (worktree retained): machine.ts, plan.ts, machine.suite.ts, handoff/pipeline-machine.md — NOT gated, NOT mergeable as-is. Resume per HANDOFF-v1-sprint.md: finish+gate in worktree, integrity vs BASE 80328a9, merge, regate; then chains 5→6→7. Knip's modelRosterFromEnv deferral clears when its consumer merges.
