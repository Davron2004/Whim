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

Ordering: **L1 merges before any other lane starts.** L2–L6 consume the token roles L1 adds.

**Revised wave order (updated 2026-08-05 after the L2 plan surfaced a cross-lane dependency):**

    L1  →  [L3, L4, L5, L6]  →  L2

L2 is no longer in the parallel wave. Its V3 finding (fluid 3-up grid) cannot be closed from
`HomeScreen.tsx` alone: the 88px is hardcoded three times inside `app-tile.tsx`
(`root.width` `:52`, `tile.width`/`tile.height` `:56-57`) and `AppTileProps` `:26-33` exposes no
size prop. Widening only `HomeScreen`'s `cell` wrapper leaves the tile pinned at 88px and
left-aligned inside the larger box — worse than the current state, not a fix.

`app-tile.tsx` belongs to L5, and L5's B3 (the 120×120 done tile) needs the *same* optional size
prop. So one piece of work serves both findings. **L5 owns the contract; L2 consumes it.**

**Cross-lane contract — SUPERSEDED, see R23. L5 has landed; this is the delivered interface.**

L5 shipped `size?: 'done'` — a string-literal VARIANT (120x120 preset, colour-matched glow, rise-in,
no name label). It does NOT carry a numeric width, so L2's V3 fluid grid cannot consume it. The
earlier prediction here (`size?: number` defaulting to 88) was wrong and is struck.

**What L2 actually does** (ruling R23): add a SECOND, orthogonal prop `width?: number` to
`AppTileProps`, optional, defaulting to `APP_TILE_SIZE` (88), threaded into `root.width`,
`tile.width`, `tile.height`. Do NOT widen to `size?: number | 'done'` — one prop meaning both
"which variant" and "how wide" reads fine at the call site and rots at the definition.
L2 then computes cell width from `useWindowDimensions` minus horizontal padding and column gaps,
divided by 3, and passes `width={cellWidth}`.

L2's allowlist is `HomeScreen.tsx`, `SettingsScreen.tsx`, `app-tile.tsx`, plus two paths granted
mid-lane after it stopped CLASS B rather than skip a test: **`home-grid.ts`** (NEW — the cell-width
derivation needs a Node-importable home, and all three original files import `react-native` at module
scope) and **`test/tile-colour.suite.ts`** (the assertions belong beside the existing `AppTile`
geometry pins). Safe because
L2 runs after L5 merges, so no two lanes hold that file at once. The guarantee still binds: `width`
optional, default rendering unchanged.

**TRAP for L2 — `test/tile-colour.suite.ts:78-86` pins JSX SOURCE TEXT that L2 will edit.**
It requires `size?: 'done';`, `const isDone = size === 'done';`, four `isDone ? styles.X : null`
names each appearing EXACTLY ONCE, and `{!isDone && <Text style={styles.name}`. Adding `width?:
number` is safe — none of those lines change — but any reformat of the tile's style arrays or of
the name label goes red for a correct edit. Same class as R18 and `prompt-flow-screens.suite.ts:282`.

- [ ] **L1 — token roles** · `src/sdk/design-tokens.ts`, `src/sdk/test/theme.acceptance.ts`
      Covers R3 **as corrected by R11**. Add: `headline` (30/33.6/-0.75/700),
      `stepTitle` (26/29.9/-0.65/700 — **added by R11**), `controlLabel` (13/13/0/500),
      `kindBadge` (9.5/9.5/0.95/600/upper), `metaPlain` (10.5/10.5/0/400, no upper, no tracking),
      `metaWide` (10/10/1.2/400/upper). RETARGET `screenTitle` 26 → 22/25.3/-0.44/700 and
      `body` 15/25.5 → 13.5/20.925. Add the R1 header comment, and AMEND the existing line-10
      claim that values are "copied verbatim" — it now asserts the opposite of R1.
      Test: STANDING INVARIANT (not behavioral, not no-test) — pin that the four microcopy roles
      stay four distinguishable faces and that every face names a shipped `FONT_FAMILY` asset.
      Pin the role vocabulary, never the mockup numbers; those are still under R4/R5 review.
      Adds no call-site changes. `after:` — none.

      **Known asset gap, flagged not fixed:** `kindBadge` wants mono 600, but only IBM Plex Mono
      Regular and Medium ship. Android will synthesize the weight off `monoMedium`. Do NOT name a
      nonexistent `IBMPlexMono-SemiBold` — RN resolves by exact file base name and would fall back
      to the system font silently. Judged in the R8 pass.

- [ ] **L2 — home and settings** · `src/host/launcher/HomeScreen.tsx`,
      `src/host/launcher/SettingsScreen.tsx`
      V1 header paddingTop 8 → 20/22/14 · V2 `+` glyph 12 → 17/400 (local style, not a new
      TYPE_SCALE role — no role fits a one-off icon glyph, matching the `app-tile.tsx:71,77`
      precedent) · S2 composer row paddingVertical 12 → 14/16 · V3 fluid 3-up grid, which
      consumes L5's `size` prop · **R12**: repoint `SettingsScreen.tsx:56` at `stepTitle` to
      preserve its current rendering.
      Also eyeball `HomeScreen.tsx:81` — the `⚙` glyph is sized off `body` and shrinks 1.5px
      with L1's retarget.
      `after:` **L5** (not L1 — see the wave order above).

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
