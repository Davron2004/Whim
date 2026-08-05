# Dispositions ledger — fix-design-conformance

Append-only. Every disposition is recorded AS IT HAPPENS, never batched at the end.
This ledger plus the lane branches are the resume state if orchestrator context is lost.

## Run header

| Field | Value |
|---|---|
| Batch id | `fix-design-conformance` |
| Schema | `whim-fixloop` |
| Run type | STANDALONE (attended) |
| Staging branch | `integration/design-conformance` |
| Cut from | `redesign` @ `e18c1bf1ce837461a11b2f37dad52270c4c61554` |
| Closure target | **`redesign`** (not `main`) |
| Findings source | `findings.md`, 25 findings, owner rulings R1–R8 binding |
| Lanes | 6 (L1 serial, then L2–L6 as one parallel wave) |

## Preconditions

| Check | Result |
|---|---|
| `.claude/settings.json` → `worktree.baseRef: "head"` | PASS (line 38-40) |
| `scripts/gate.sh`, `gate-full.sh`, `fixloop.sh` present + committed clean | PASS |
| `git branch --list 'integration/*'` empty at run start | **FAIL → resolved**, see D3 |

## Deviations from the runbook (recorded, owner-approved)

**D1 — lane grouping instead of per-finding dispatch.**
The runbook dispatches one `fix-worker` per finding. This batch dispatches one per *file-owned
lane*. Rationale: 9 of 25 findings are in `HistoryScreen.tsx` and 7 more consume
`design-tokens.ts`; 23 concurrent worktrees would contend on ~6 files, and the per-finding
isolation the runbook buys would be spent on merge conflicts instead. Each lane's allowlist is
disjoint from every other lane's, which preserves the property the runbook actually depends on
(no two parallel writers touch one file). Cost accepted: a lane is reverted as a unit, so a
single bad finding inside a lane takes its siblings with it.

**D2 — staging branch cut from `redesign`, closure targets `redesign`, not `main`.**
Owner-approved. `redesign` is 153 commits ahead of `main`; `main` is 0 ahead of `redesign`.
Every finding cites line numbers in code that exists only on `redesign`, so a staging branch cut
from `main` would fail the stale-check on all 25. The harness's "`main` is the published branch"
rule is suspended for this run only — `redesign` is the effective publish target while it is
unmerged. One ratified merge per run still holds; the target differs.

**D3 — two stale `integration/*` branches deleted at run start.**
`integration/fix-generate-stream-transport` (`04478c8`, 2026-08-01) and
`integration/fix-phase0-obs` (`e18c1bf`, 2026-08-02). Both verified fully merged into `redesign`
via `git merge-base --is-ancestor` before deletion; deleted with the safe `-d` form, which would
have refused otherwise. Leftovers from completed runs whose post-merge teardown never ran — not
evidence of a concurrent run. No parked `wip/` branches, no pending grants.

**D4 — Class-2 protection is NOT enforced on this branch.**
`.claude/hooks/protect-harness.sh` is present and executable, but no `PreToolUse` hook is wired
in `.claude/settings.json` or `.claude/settings.local.json`. Confirmed with the owner. Practical
effect on this run: nil — no lane declares a protected file, and `src/sdk/design-tokens.ts` is
ordinary source. Recorded because the `integrity` check's exit-3 tamper signal is the only thing
still guarding protected paths here, so it must not be waved through if it fires.

## Ledger

| # | UTC | Event | Lane | Detail |
|---|---|---|---|---|
| 1 | 2026-08-05 | `run-start` | — | staging branch cut from `redesign` @ `e18c1bf` |
| 2 | 2026-08-05 | `bookkeeping` | — | change created, `findings.md` / `plan.md` / ledger initialized |
