# Findings: RN implementation vs. design handoff (Whim redesign v2)

Ground truth: `whim-design-handoff/reference/Whim Design System.dc.html` (token tables reproduced verbatim in `README.md`) + `whim-design-handoff/reference/Whim Mobile.dc.html` screens `2a`, `2b`, `3b`, `4a`, `4c`, `4d` (ignoring `1a`-`1d`, `3a`, `4b`).

**Tokens verified clean:** `SPACING` (`src/sdk/design-tokens.ts:84-90`), `TYPE_SCALE` (`:137-149`), and `MOTION` (`:99-102`) all match the design doc's tables byte-for-byte (including the em→px letter-spacing math). No findings against the token file itself.

---

## RULINGS (owner decision, 2026-08-05) — read before fixing

**R1. Mockups beat the token table, wholesale.** Where a mockup value conflicts with `TYPE_SCALE`, the mockup wins. Rationale: the mockups are the artifact the owner reviewed and approved; deciding per-finding would leave the app matching neither source. `src/sdk/design-tokens.ts` therefore STOPS being byte-exact to the README token table — add a header comment recording this ruling and its date so a future reader doesn't "fix" it back.

**R2. The root cause is a missing role→token mapping, not wrong values.** Two distinct defect shapes appear below and they get different fixes:
  - *Bypass* — screen imports no tokens, uses raw literals (`FailureScreen.tsx`, `MiniAppView.tsx`). Fix: route through tokens.
  - *Wrong role* — screen reached for the nearest legal token because no correct one exists (`caption` for control labels; `eyebrow` doing duty for four distinct microcopy roles). Fix: ADD the missing named role to `TYPE_SCALE`, then point the screen at it. Do NOT inline a literal at the call site.

**R3. Roles to add to `TYPE_SCALE`** (names are suggestions, keep them semantic — never size-named):
  - `headline` — 30 / 1.12 / -.025em / 700 (compose headline)
  - `screenTitle` — RETARGET 26 → 22 / 1.15 / -.02em / 700 (history title, confirm-sheet title; design uses one size for both)
  - `controlLabel` — 13 / 1 / 500 (Back labels, clarify answer pills)
  - `kindBadge` — 9.5 / .1em / uppercase / 600  ← see R4
  - `metaPlain` — 10.5 / 1 / 400, NOT uppercase, no letter-spacing (when, version)  ← see R4
  - `metaWide` — 10 / .12em / uppercase / 400 (origin)  ← see R4

**R4. Three roles are NOT settled — defer to the screenshot pass.** `kindBadge` (9.5px), `metaWide` (10px), `metaPlain` (10.5px) are below what is trustworthy on a ~411dp Android screen, and the mockups were rendered in a desktop browser, never on a device. Implement them at the mockup values, then TAG these three for explicit judgement in the final on-device screenshot pass. Do not silently round them up.

**R5. `body` stays under R1 too** — adopt the design's 13–13.5 / 1.5–1.55, but flag it alongside R4 in the screenshot pass; it is the largest single legibility risk in this set.

**R6. `FailureScreen.tsx` is OUT OF SCOPE for this pass.** It is a blocking finding below, but the observability change (`obs-v1`) is rebuilding that file to design `3b` spec — attempt-progress bar, checklist rows with status icons — because the diagnostic surface and the design spec are the same screen. Build it once, there. LEAVE THE FILE UNTOUCHED HERE. `MiniAppView.tsx:92-99` (SUBTLE) is the same story; leave it to `obs-v1` as well.

**R7. Findings dropped by these rulings:** none. R1 means every size finding below stands as written. The two `FailureScreen`/`MiniAppView` findings are deferred, not dropped.

**R9. R2 is scoped to TYPE_SCALE, not to SPACING.** (Added 2026-08-05 after lane L3 surfaced it.)
Design values with no `SPACING` counterpart — 24, 26, 28 (L3), 20/22/14 (L2), 14/15 (L4) — are written
as literals with an inline comment citing the design html line. Do NOT add one-off `SPACING` tokens for
them and do NOT edit `design-tokens.ts` from a non-L1 lane. Rationale: R2 exists to kill the *wrong-role*
bypass (one `eyebrow` doing four typographic jobs), which is a semantic defect. A one-off pixel pad is not
a semantic role, and minting a token per value would inflate the scale past the point where it means
anything. This matches the codebase's existing convention (`flow-chrome.tsx`'s `bar: { width: 18, height: 3 }`,
`PlanStep.tsx`'s `PLAN_ROW_MIN_HEIGHT = 74`). Typography still follows R2 without exception.

**R10. A finding that the L1 token retarget already resolves needs NO call-site edit.**
Where a call site already references the correct semantic role and only the role's *value* was wrong,
L1's retarget propagates automatically. Record it as `NO-OP: inherits L1 retarget` in the lane's plan and
write no diff. Confirmed cases: S4 at `PlanStep.tsx:94` and `ClarifyStep.tsx:69` (both already on
`TYPE_SCALE.body`). Check for the same at `HistoryScreen.tsx:204,440,441` before planning an edit there.

**R11. CORRECTION to R3 — `screenTitle` was doing two jobs; split it.** (2026-08-05, after lane L1
enumerated the call sites. This supersedes R3's `screenTitle` clause.)

R3 retargeted `screenTitle` 26 → 22 on the strength of findings V8 and V13 alone. But the token has
**six** call sites, and the mockups run a second, larger title face at `700 26px/1.15/-.025em` on the
clarify (`:443`), plan (`:475`) and build (`:498`) screens — all three currently CORRECT at 26. The
retarget would have shrunk them by 4px to fix the two that were broken. Same defect shape as V10's
`eyebrow`: one token serving two design roles, and retargeting picks a winner instead of splitting.

Resolution:
- `screenTitle` → **22 / 25.3 / -0.44 / 700**, scoped to its two real users: `HistoryScreen.tsx:204`
  (V8) and the confirm-sheet title `HistoryScreen.tsx:440` (V13).
- **ADD `stepTitle` — 26 / 29.9 / -0.65 / 700.** Literally the numbers `screenTitle` holds today, so
  every site repointed at it renders byte-identically to the current build. Call sites to repoint:
  `ClarifyStep.tsx:58` and `PlanStep.tsx:79` (lane L3); `BuildStep.tsx:55` and `DoneStep.tsx:33`
  (lane L5); `SettingsScreen.tsx:56` (lane L2, see R12).
- `DoneStep.tsx:33` — the mockup wants 24/1.2/-.02em (`:525`), so `stepTitle` leaves it 2px large.
  That is exactly the status quo and no finding was ever filed against it. Do NOT mint a one-off role;
  note it for the R8 pass instead.
- `obs-v1` owns `FailureScreen.tsx` (ruling R6) and design `3b:306` needs 26 — it uses `stepTitle` too.
  Flagged to that change so it does not re-derive a literal.

**R12. `SettingsScreen.tsx` joins lane L2.** It has no mockup and was owned by no lane, yet it consumes
both retargeted tokens (`screenTitle` at `:56`, `body` at `:72,:83`) and would have silently inherited
both with no design basis and no reviewer. L2 repoints its title at `stepTitle` to preserve current
rendering. Its `body` inheritance is accepted — the token is shared and there is no reason to exempt one
screen — but `:72` is a `TextInput`, so it goes on the R4/R5 deferred list.

**R13. The `body` retarget shrinks typed text and carets.** `ComposeStep.tsx:81` and
`SettingsScreen.tsx:72` are `TextInput`s sized off `body`. Dropping 15 → 13.5 shrinks what the user
types, not just what they read. Land it per R1, but add it to the R4/R5 deferred list explicitly — it is
a different legibility question from static prose and deserves its own look on-device.

**R14. V15 is two findings; only one is real. Split it.** (2026-08-05, on lane L6's recommendation.)
- **V15a — the 30×30 tinted glyph swatch per menu row: REAL.** Fix it. Note the design markup is
  `border-radius:10px` — a rounded square, not the circle the finding's wording implies.
- **V15b — the per-row direction hint: NOT A DEFECT. Do not build it, in any lane.** `Orb.tsx:11-14`
  already names "per-row direction hints" as a deliberate negative requirement under design D12,
  in the same breath as the "hold to flick" caption that `findings.md` itself lists under
  *Not flagged*. An existing green test (`orb-menu.suite.ts:99-102`) asserts no `up|down|left|right`
  literal appears in that file — implementing the hint breaks a standing invariant on day one. And
  the design's stated purpose for it is "so the menu teaches the wheel"; with the wheel deferred,
  the hint advertises a gesture that does not exist, which is worse than silence.
  The auditor merged two items onto one line. Recording the split so a later pass does not read
  V15b as unfinished scope.

**R15. Two Orb values have no token and should NOT get one yet.** The row tints (`#e6e4f7`, `#e5e2db`)
and the 10px icon radius have no `SHELL_COLORS` / `RADIUS` counterpart. They stay local to `Orb.tsx`,
scoped exactly as `KIND_BADGE_COLORS` is scoped to the history badge. One consumer does not justify a
shared role; revisit if a second surface wants the same shape. Consistent with R9's reasoning.

**R8. The final screenshot pass** renders the `.dc.html` screens as the baseline (no PNGs ship in the handoff) and compares against the Android emulator. It is also where OpenSpec task `I1` in `shell-redesign-v2` — on-device verification, never done, the reason that change is unarchived — gets ticked.

---

## BLOCKING

- `src/host/launcher/FailureScreen.tsx` (whole file, styles at lines 70-81) — corresponds to design screen `3b` but imports no design tokens at all (no `TYPE_SCALE`/`RADIUS`/`SPACING`/`FONT_FAMILY`); uses raw RN literals (`fontSize:18,fontWeight:'800'`, `fontSize:14`, `borderRadius:12`, etc.). Design `3b` (`Whim Mobile.dc.html:306-333`) specifies a `screenTitle`-class 26px/1.15/-.025em title with a dynamic colour (`rpTitleColor`), an attempt-progress bar row (`rpShowAttempts`/`rpAttempts`, lines 309-316), and a bordered 20px-radius panel of checklist rows each with a coloured ring/mark icon (`rpRows`, lines 318-324) — none of this exists in the implementation, which renders a plain bulleted `FlatList` of hint strings.
- `src/host/launcher/HistoryScreen.tsx` (`HistoryRowView`, lines 279-389) — the entire `4a` "timeline" motif is missing: design's absolute-positioned connecting vertical line plus a per-row coloured dot marker with a ring (`Whim Mobile.dc.html:28,31`) has no counterpart anywhere in the row rendering.
- `src/host/launcher/DoneStep.tsx:32` — reuses the shared `AppTile` (88×88, radius 22) for the "done" celebratory tile, but design's `isDone` tile (`Whim Mobile.dc.html:520-524`) is `width:120px;height:120px;border-radius:32px` with a colour-matched box-shadow glow (`0 8px 22px rgba(13,148,136,.3)`) and its own entrance animation (`animation:rise .4s ease both`) — none of that is reachable through the shared component as built.
- `src/host/launcher/BuildStep.tsx:52-90` — design's build-progress bar (`Whim Mobile.dc.html:500`: `height:4px;border-radius:2px;background:#e0dcd4` track with an accent-filled `width:{{ pct }}` bar) has no counterpart at all; the screen renders only the 4-step marker list and a sentence, no percent/progress indicator.

## VISIBLE

- `src/host/launcher/HomeScreen.tsx:172-175` (`header.paddingTop: SPACING.xs` = 8) vs design `padding:20px 22px 14px` (`Whim Mobile.dc.html:384`) — header sits 12px closer to the screen top than spec'd.
- `src/host/launcher/HomeScreen.tsx:122` (`+` glyph uses `TYPE_SCALE.caption`, 12px) vs design's composer `+` glyph `font:400 17px/1` (`:402`) — icon renders noticeably smaller than spec.
- `src/host/launcher/HomeScreen.tsx:186` (`cell: { width: APP_TILE_SIZE }`, fixed 88px) vs design `2a`'s home grid `grid-template-columns:repeat(3,1fr)` filling the 390px frame (`:388`, computing to ~106px tiles) — RN tiles never grow past 88px regardless of device width.
- `src/host/launcher/ComposeStep.tsx:63` (`TYPE_SCALE.display`, 34px/-1.02) vs design's compose headline `font:700 30px/1.12...letter-spacing:-.025em` (`:417`) — renders larger than spec, and doesn't match either documented type-scale entry (Display 34 or Screen title 26).
- `src/host/launcher/flow-chrome.tsx:33` (Back label uses `TYPE_SCALE.caption`, 400/12px) vs design's Back label `font:500 13px/1` (`:413,439,471`) — lighter weight, smaller size than spec'd.
- `src/host/launcher/flow-chrome.tsx:82-89` combined with `ComposeStep.tsx:115`, `ClarifyStep.tsx:115`, `PlanStep.tsx:109` (no `paddingTop` on `content`, so the only gap above each headline is the header's own 16px `paddingBottom`) vs design's dedicated top-padding wrapper around each headline: 34px (compose, `:416`), 28px (clarify, `:442`), 26px (plan, `:474`) — roughly half the intended breathing room above every flow headline.
- `src/host/launcher/ClarifyStep.tsx:97` (answer pill text uses `TYPE_SCALE.caption`, 400/12px) vs design's pill text `font:500 13px/1` (`:451`) — regular weight and 1px smaller than spec'd.
- `src/host/launcher/HistoryScreen.tsx:204` (`TYPE_SCALE.screenTitle`, 26px/-0.65) vs design's `4a` title `font:700 22px/1.15...letter-spacing:-.02em` (`:24`) — renders ~4px larger than the design's dedicated size (again not matching either documented scale entry).
- `src/host/launcher/HistoryScreen.tsx:200-202` (plain `‹ Back` text link) vs design's `4a` back control: a 42×42 circular button with an SVG chevron and no text label (`:23`) — replaced with a text-only affordance.
- `src/host/launcher/HistoryScreen.tsx:326-327,329,349,365` — "when"/"version"/"origin"/"what it touched" mono microcopy all share `TYPE_SCALE.eyebrow` (500 weight, 10.5px, uppercase, 1.47 letter-spacing), but design specifies three distinct, lighter treatments: kind badge `600 9.5px...letter-spacing:.1em` (`:34`), when/version `400 10.5px/1` plain (not uppercase, no letter-spacing) (`:35-36`), origin `400 10px...letter-spacing:.12em uppercase` (`:38`) — four differentiated design roles collapse onto one over-weighted, over-spaced token.
- `src/host/launcher/HistoryScreen.tsx:383` (`color: p.accent` → `SHELL_COLORS.accent` #3f3d8f indigo) vs design's "you're on this one" marker `color:#0d9488` (teal, the working/done status hue) (`:55`) — wrong hue family.
- `src/host/launcher/HistoryScreen.tsx:238-241` (toast: `backgroundColor: p.card` #f1efea, `color: p.text` dark ink, 1px border, radius 12) vs design's toast `background:#1c1917;color:#fff`, no border, radius 16 (`:73`) — light/dark and bordered/borderless are inverted from spec.
- `src/host/launcher/HistoryScreen.tsx:440` (confirm-sheet title uses `TYPE_SCALE.bodyEmphatic`, 500/15px) vs design's sheet title `font:700 22px/1.25...letter-spacing:-.02em` (`:63`) — renders far smaller and lighter-weight than spec'd.
- `src/host/launcher/HistoryScreen.tsx:489` (`sheetSafeBtn: borderRadius:14`, i.e. `RADIUS.field`) vs design's Cancel button `border-radius:18px` (`:66`, i.e. `RADIUS.card`) — wrong radius token.
- `src/host/launcher/Orb.tsx:116-120` (menu row renders label text only) vs design's tapped-menu row (`3a`/`3c`, `:220-224`): a 30×30 tinted icon-glyph circle per action plus a right-aligned direction hint — both entirely absent from the implementation.
- `src/host/launcher/DoneStep.tsx:70` (`secondary: { height: 46 }`) vs design's "Back to your apps" button `height:52px` (`:528`, same height as "Open it" beside it) — secondary button is 6px shorter than both the design and its sibling primary button.

## SUBTLE

- `src/host/launcher/app-tile.tsx:64,68` (tile `padding:8`, ghost monogram `top:-12`) vs design `2b` spec `padding:9px` / `top:-13px` (`Whim Mobile.dc.html:543-546`) — 1px off on both.
- `src/host/launcher/HomeScreen.tsx:202` (composer row `paddingVertical: SPACING.sm`=12) vs design `padding:14px 16px` (`:401`) — 2px short vertically.
- `src/host/launcher/flow-chrome.tsx:95` (`primary.marginBottom: SPACING.lg`=22) vs design's compose CTA container bottom padding of 24px (`:427`) — 2px short.
- Recurring pattern across `PlanStep.tsx:94`, `ClarifyStep.tsx:69-75` (echo), `HistoryScreen.tsx:441` — body-role text uses `TYPE_SCALE.body` (15px/25.5 line-height) where design specifies 13-13.5px/1.5-1.55 line-height for the equivalent role (e.g. `Whim Mobile.dc.html:41,64,307`) — a consistent ~2px oversize and looser line-height wherever this body role appears through the flow/history screens.
- `src/host/launcher/HistoryScreen.tsx:471` (row card `padding: SPACING.sm`=12 both axes) vs design `padding:14px 15px` (`:32`).
- `src/host/launcher/BuildStep.tsx:103` (step marker `borderWidth: 2`) vs design's step marker `border:1.5px solid` (`:504`).
- `src/host/launcher/MiniAppView.tsx:92-99` (`errorRoot`/`errorTitle`/etc.) — hardcoded `fontSize`/`fontWeight`/`borderRadius` literals (20/600, 15, 8) instead of `TYPE_SCALE`/`RADIUS`, the same pattern as `FailureScreen.tsx`. No design mockup exists for this specific launch-failure state, so capped at SUBTLE, but flagged since every other screen in scope resolves through the shared tokens and this one doesn't.

## Not flagged (verified correct or explicitly out of scope)

- `KIND_BADGE_COLORS` — documented exemption.
- `SHELL_COLORS`/`STATUS_COLORS`/`RADIUS`/`SPACING`/`TYPE_SCALE`/`MOTION` in `src/sdk/design-tokens.ts` — all verified byte-exact against the design doc.
- `whim-prose/lex.ts`, `render.ts`, `styles.ts` — the six-class Whim Syntax system (priority order, one-colour/four-mark caps, `yours` exemption, `hedge`/`chg` producer-only marks, `isOffering` guard) faithfully implements every discipline rule in the design doc; no divergence found.
- `ClarifyStep.tsx`'s upright-brown prompt echo — matches the design system's explicit "yours" rule even though the `2a` interactive mockup's literal CSS for that span (`Whim Mobile.dc.html:444`) codes it as plain muted grey; treated the design-system prose as authoritative over the mockup's literal here.
- `Orb.tsx`'s missing "hold the button next time to flick" caption and lack of wheel-gesture geometry — explicitly documented in the file's own header comment as a deliberate, spec-cited negative requirement (design D12), not a defect.
- Copy strings (`copy.ts`) — spot-checked headline/body copy against the design doc's literal text; verbatim matches throughout.
