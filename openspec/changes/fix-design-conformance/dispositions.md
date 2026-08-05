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
| 3 | 2026-08-05 | `planners-dispatched` | L1–L6 | six read-only planners, no worktrees created |
| 4 | 2026-08-05 | `plan-received` | L3 | 6 findings. V4/V5/V6×3/V7/S3 actionable; **S4 = NO-OP** (both sites already on `TYPE_SCALE.body`, inherit L1's retarget). All structural → no test. Allowlist: 4 files, disjoint. Severity med/low |
| 5 | 2026-08-05 | `ruling-added` | — | **R9** (spacing literals are not R2's concern) and **R10** (a call site already on the right role needs no edit) appended to `findings.md`, prompted by L3's analysis. Binding on all lanes |
| 6 | 2026-08-05 | `plan-received` | L2 | 4 findings. V1/V2/S2 actionable; **V3 BLOCKED** — needs `size?: number` on `AppTileProps` in `app-tile.tsx`, owned by L5. Planner escalated instead of crossing the lane boundary (correct). All structural → no test |
| 7 | 2026-08-05 | `reorder` | L2 | **Wave order revised: L1 → [L3, L4, L5, L6] → L2.** L2 leaves the parallel wave and follows L5. Rationale: L5's B3 (120×120 done tile) and L2's V3 (fluid grid) need the same optional `AppTile` size prop — one piece of work, so L5 writes the contract and L2 consumes it. Cross-lane contract recorded in `plan.md`. Surfaced at planning time, read-only, before any worktree existed |
| 8 | 2026-08-05 | `plan-received` | L1 | 7 role changes + header amendment, all LIVE at HEAD. Test class: **STANDING INVARIANT** (first non-structural in the batch) — pins the four microcopy roles stay four distinct faces + every face names a shipped font asset. `body` resolved to 13.5/20.925 from a 3-vs-2-vs-1 instance count in the mockups, taking the top of R5's range on legibility grounds. Flags an unfixable asset gap: `kindBadge` wants mono 600, only Regular/Medium ship |
| 9 | 2026-08-05 | **`ruling-corrected`** | L1 | **R11 supersedes R3's `screenTitle` clause.** The planner enumerated the token's call sites and found the 26 → 22 retarget would REGRESS three currently-correct screens (clarify `:443`, plan `:475`, build `:498` all specify 26 in the mockups). Only V8/V13 were ever filed against it. Root cause is V10's defect one level up: one token serving two design roles, and a retarget picks a winner rather than splitting. Resolution: `screenTitle` → 22 scoped to history + confirm sheet; **ADD `stepTitle` 26/29.9/-0.65/700**, carrying `screenTitle`'s current numbers so every repointed site renders byte-identically. Orchestrator error caught at planning time, before any code was written |
| 10 | 2026-08-05 | `ruling-added` | L2 | **R12** — `SettingsScreen.tsx` had no mockup and no lane owner, yet consumed both retargeted tokens. It would have inherited both silently, unreviewed. Folded into L2 |
| 11 | 2026-08-05 | `ruling-added` | — | **R13** — the `body` retarget shrinks `TextInput` content and carets (`ComposeStep.tsx:81`, `SettingsScreen.tsx:72`), not just static prose. Lands per R1, added to the R4/R5 deferred list as its own question |
| 12 | 2026-08-05 | `plan-received` | L6 | 1 finding, LIVE. Test class: **BEHAVIORAL** — the batch's first. Extracts `orbRowGlyphColor` as a pure exported function so the decision logic is assertable without rendering RN, matching the suite's existing idiom for a component that embeds native modules. Clean import-boundary RED at HEAD. Severity low |
| 13 | 2026-08-05 | **`finding-split`** | L6 | **R14 — V15b (per-row direction hint) DROPPED as a non-defect.** Three converging reasons: `Orb.tsx:11-14` already lists it as a deliberate D12 negative requirement alongside the "hold to flick" caption that `findings.md` itself files under *Not flagged*; the existing green test `orb-menu.suite.ts:99-102` asserts no `up\|down\|left\|right` literal in that file, so building it breaks a standing invariant immediately; and with the wheel deferred the hint would advertise a gesture that does not exist. V15a (the glyph swatch) proceeds. The auditor had merged two items onto one line |
| 14 | 2026-08-05 | `ruling-added` | L6 | **R15** — the two Orb tints and the 10px icon radius stay local to `Orb.tsx`, scoped as `KIND_BADGE_COLORS` is. One consumer does not justify a shared token. Consistent with R9 |
| 15 | 2026-08-05 | `flag` | L6 | `⌂` (U+2302, the home glyph) needs Android glyph-coverage verification — carry it into the R8 on-device pass |
