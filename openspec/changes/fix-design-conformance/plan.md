# Plan — fix-design-conformance

Staging branch: `integration/design-conformance`, cut from `redesign` @ `e18c1bf`.
Closure target: **`redesign`**, not `main` (see Deviation D2 in `dispositions.md`).

Source findings: `findings.md` (25 findings — 4 BLOCKING, 15 VISIBLE, 6 SUBTLE),
owner rulings R1–R8 at the top of that file are binding and must not be re-litigated.

## Ground-truth path — READ THIS BEFORE OPENING ANY REFERENCE

`findings.md` cites the design reference as `whim-design-handoff/reference/…`. That directory is
**untracked**, so it does not exist inside a worktree. Use the tracked copy instead:

    docs/design/reference/Whim Mobile.dc.html          ← screens 2a, 2b, 3b, 4a, 4c, 4d
    docs/design/reference/Whim Design System.dc.html   ← tokens, type scale, Whim Syntax
    docs/design/README.md                              ← the token tables

Verified byte-identical to the handoff copies with `cmp`, so **every line number quoted in
`findings.md` resolves unchanged** against these paths.

## Lane decomposition (Deviation D1)

The runbook dispatches one worker per finding. This batch groups findings into
**file-owned lanes** instead: 9 of the 25 findings are in `HistoryScreen.tsx` and
7 more consume `design-tokens.ts`, so per-finding worktrees would collide on a
handful of files. Each lane below owns a disjoint file set — no two lanes name the
same path in their allowlist, which is what makes them safe to run in parallel.

Ordering: **L1 merges before any other lane starts.** L2–L6 consume the token roles
L1 adds; they are mutually independent and run as one parallel wave.

- [ ] **L1 — token roles** · `src/sdk/design-tokens.ts`
      Covers R3 in full: add `headline` (30/1.12/-.025em/700), `controlLabel` (13/1/500),
      `kindBadge` (9.5/.1em/upper/600), `metaPlain` (10.5/1/400, no upper, no tracking),
      `metaWide` (10/.12em/upper/400); RETARGET `screenTitle` 26 → 22/1.15/-.02em/700;
      RETARGET `body` to the design's 13–13.5/1.5–1.55. Add the R1 header comment recording
      that this file is deliberately no longer byte-exact to the README token table.
      Adds no call-site changes. `after:` — none.

- [ ] **L2 — home** · `src/host/launcher/HomeScreen.tsx`
      V1 header paddingTop 8 → 20/22/14 · V2 `+` glyph 12 → 17/400 ·
      V3 fixed 88px cell → 3-up fluid grid · S2 composer row paddingVertical 12 → 14/16.
      `after:` L1.

- [ ] **L3 — flow chrome and steps** · `src/host/launcher/flow-chrome.tsx`,
      `ComposeStep.tsx`, `ClarifyStep.tsx`, `PlanStep.tsx`
      V4 compose headline → `headline` · V5 Back label → `controlLabel` ·
      V6 headline top padding 34/28/26 per step · V7 clarify pill → `controlLabel` ·
      S3 primary marginBottom 22 → 24 · S4 (compose/clarify/plan share of the body role).
      `after:` L1.

- [ ] **L4 — history** · `src/host/launcher/HistoryScreen.tsx`
      B2 timeline motif (connecting line + per-row dot marker with ring) ·
      V8 title → retargeted `screenTitle` · V9 text Back → 42×42 circular chevron button ·
      V10 split the one `eyebrow` into `kindBadge`/`metaPlain`/`metaWide` ·
      V11 current-version marker indigo → teal `#0d9488` · V12 toast → dark `#1c1917`/white,
      borderless, radius 16 · V13 confirm-sheet title → retargeted `screenTitle` ·
      V14 sheetSafeBtn radius 14 → 18 · S4 (history share) · S5 row card padding → 14/15.
      Largest lane; nine findings, one file. `after:` L1.

- [ ] **L5 — build, done, tile** · `src/host/launcher/BuildStep.tsx`, `DoneStep.tsx`,
      `app-tile.tsx`
      B3 done tile 120×120/radius 32/colour-matched glow/rise animation · B4 build progress
      bar (4px track `#e0dcd4`, accent fill) · V16 secondary button height 46 → 52 ·
      S1 tile padding 8 → 9, monogram top -12 → -13 · S6 step marker border 2 → 1.5.
      `app-tile.tsx` is in this lane, not its own, because B3 likely needs an AppTile size
      variant — keeping both in one lane avoids a cross-lane write. `after:` L1.

- [ ] **L6 — orb** · `src/host/launcher/Orb.tsx`
      V15 menu rows gain a 30×30 tinted icon-glyph circle per action and a right-aligned
      direction hint. Do NOT build the wheel gesture — design D12 defers it deliberately and
      `Orb.tsx`'s own header comment records that as a negative requirement.
      `after:` L1.

## Explicitly out of scope

- `src/host/launcher/FailureScreen.tsx` (BLOCKING) and `src/host/launcher/MiniAppView.tsx`
  (SUBTLE) — ruling R6. The `obs-v1` change owns both files; its chain D rebuilds
  `FailureScreen` to design `3b` with the attempt bar and checklist rows. Any worker that
  edits either file trips scope violation.
- The wheel-gesture orb (design `3a`), history screen `4b`, and baseline screens `1a`–`1d`.

## Deferred to the on-device screenshot pass

Per R4/R5, these land at the mockup values now but are NOT settled — they are tagged for
judgement against a real emulator, not a desktop browser render:
`kindBadge` 9.5px · `metaWide` 10px · `metaPlain` 10.5px · `body` 13–13.5px.
That pass is also where `shell-redesign-v2` task I1 finally gets ticked.
