# Dispatch ledger: generation-observability

- run-start 2026-08-21 — staging branch `integration/generation-observability` cut from `v1-sprint` tip 9b05345 (NOT main 795c8bd: sprint precedent — v1-sprint is this sprint's integration target; main receives the sprint PR). FIXLOOP_INTEGRATION_BRANCH=integration/generation-observability inline on every fixloop.sh call.
- precondition-check — launcher-ghost-tiles MERGED (archived 2026-08-11; `pending-builds.ts` present at HEAD). chains.md's reads-paths for it now live under `openspec/changes/archive/2026-08-11-launcher-ghost-tiles/`. `test/observability-ui.suite.ts` at HEAD belongs to obs-v1 (host-observability), NOT this change — no collision.
- DAG: chain-1 → chain-2 → chain-3 → chain-4 → chain-5 (strictly serial).
- chain-1 dispatched — BASE 9b05345, worktree .claude/worktrees/generation-observability-1, branch chain/generation-observability-1.
- chain-1 report: complete, GATE PASS (6202 checks), commit 927b945. Deviations class A ×4: (a) extra `getLastRun(appId)` reader (needed by suite + chain-4); (b) throttle leading-edge, derived from newest aggregate entry, injected clock; (c) at-cap-with-no-aggregate append overshoots cap by one (spec scenario wins over design D4 literal), bounded; (d) appendTerminal re-projects failure to {reason, diagnostics:[{hint}]} so leaky Diagnostic objects can't reach storage. Note: type-only circular import prompt-flow↔run-journal is intentional, fully erased — do not "fix".
- chain-1 integrity exit 0 (6 files, all in scope). Merged 4cb53dc; tasks 1.1–2.3 ticked.
