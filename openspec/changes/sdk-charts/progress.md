# Progress ledger: sdk-charts

Dispatcher-owned run ledger. Append every disposition as it happens. The ledger + the chain/wip branches are the resume state if the dispatcher's context dies mid-change.

## Run metadata

- **run-start** (2026-07-18): staging branch `integration/sdk-charts`, MAIN_TIP `80816964c81469eb6d9130c991f818a6514f2163`
- schema: whim-harness
- chains: 3 (linear DAG: chain-1 → chain-2 → chain-3)
- FIXLOOP_INTEGRATION_BRANCH=integration/sdk-charts (passed inline to every fixloop.sh invocation this run)

## Chain DAG

| Chain | Tasks | Depends on | Scope |
|---|---|---|---|
| chain-1 sdk-chart-geometry | 1.1–1.5 | — | new geometry module in `src/sdk/`, Node suite |
| chain-2 sdk-chart-component | 2.1–2.5 | chain-1 (chart-geometry.md) | `src/sdk/charts.tsx`, `src/sdk/index.tsx` |
| chain-3 gallery-docs-closeout | 3.1–3.4 | chain-2 (chart-props.md) | `fixtures/style-gallery.app.tsx`, `docs/*.md` |

## Dispositions

<!-- append below, newest last -->

- **dispatched** chain-1 sdk-chart-geometry — BASE `80816964c81469eb6d9130c991f818a6514f2163` (= staging tip = MAIN_TIP), worktree `.claude/worktrees/sdk-charts-1`, branch `chain/sdk-charts-1`
- **report** chain-1 — STATUS complete, GATE PASS, commit `5cd00c5`. 5/5 tasks. Suite wired into `sdk:test` auto-glob (`src/sdk/test/*.acceptance.ts` via run.mjs) — no package.json edit. Class-A deviations: `.acceptance.ts` naming (SDK idiom, not launcher `.suite.ts`); pure explicit-`endDate` calendar anchor (no wall-clock, honors D7); stricter real-day-in-month validation; line zero-span mark centered at 0.5. Handoff `chart-geometry.md` written (75 lines).
- **integrity** chain-1 — exit 0, INTEGRITY OK. 3 files vs BASE, all in scope (`src/sdk/chart-geometry.ts`, `src/sdk/test/chart-geometry.acceptance.ts`, handoff). Main tree clean.
- **merged** chain-1 → `integration/sdk-charts` @ `c9adc28` (`--no-ff`). Ticked tasks 1.1–1.5.
- **regate-pass** chain-1 — `FAST GATE PASSED` on merged tip. Cleaned up worktree + branch.
- **dispatched** chain-2 sdk-chart-component — BASE `c9adc280095c80716a5866577d2fce3256f1a1df` (staging tip post chain-1), worktree `.claude/worktrees/sdk-charts-2`, branch `chain/sdk-charts-2`
- **report** chain-2 — STATUS complete, GATE PASS, commit `639aa06`. 5/5 tasks. Theme role→hex via `tokens.ts#color()` (same as controls/surfaces); `ChartTone ⊂ ColorToken`, no new tokens. Class-A deviation: used `switch (props.kind)` instead of cascading if/else — forced by a real TS discriminated-union narrowing limit (else-branch doesn't narrow to `heatmap`), documented in-source, no interface change. No wall-clock read; heatmap anchors to latest date in data. Handoff `chart-props.md` (68 lines).
- **integrity** chain-2 — exit 0, INTEGRITY OK. 3 files vs BASE, all in scope (`src/sdk/charts.tsx` new, `src/sdk/index.tsx` +6 re-export, handoff).
- **merged** chain-2 → `integration/sdk-charts` @ `5822c0d` (`--no-ff`). Ticked tasks 2.1–2.5.
- **regate-pass** chain-2 — `FAST GATE PASSED` on merged tip. Committed bookkeeping (tasks/ledger) as its own commit. Cleaned up worktree + branch.
- **dispatched** chain-3 gallery-docs-closeout — BASE `b5ea8ec08aeab292ffa0ff3722cff6e54614ca16` (staging tip post chain-2 + bookkeeping), worktree `.claude/worktrees/sdk-charts-3`, branch `chain/sdk-charts-3`
- **report** chain-3 — STATUS complete, GATE PASS, commit `cc9f38c`. 4/4 tasks. Gallery Charts section (bar/line/heatmap + empty-data placeholder) added to existing `style-gallery.app.tsx`, no new fixture file, `capabilities: []` preserved. `decisions.md` #47; `v1-roadmap.md` #4 → implemented 2026-07-18; `capabilities.md` pointer wording aligned (stale proposal row updated, not duplicated). Docs mirror source exactly. Class-A deviation: reworded existing capabilities.md pointer instead of adding a dup.
- **integrity** chain-3 — exit 0, INTEGRITY OK. 5 files vs BASE, all in scope (4 docs + `fixtures/style-gallery.app.tsx`).
- **merged** chain-3 → `integration/sdk-charts` @ `bdf568b` (`--no-ff`). Ticked tasks 3.1–3.4.
- NOTE for archive: `capabilities.md` still points at `openspec/changes/sdk-charts/specs/...`; the pointer needs a final flip to `openspec/specs/sdk-charts/` when `/opsx:archive` syncs the spec (chain-3 flagged this).
