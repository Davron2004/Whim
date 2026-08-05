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

**R16. Four residuals are ACCEPTED as-is. Do not mint roles for them.** (2026-08-05, on lane L4's
analysis.) Each is a design face with no matching token, and each is within ~2px of a legitimate
existing role. Adding a role per value would push `TYPE_SCALE` past the point where it means anything —
the same reasoning as R9 and R15 — and all four sit in territory R4/R5 already flagged for on-device
judgement, so minting roles now that the screenshot pass may overturn is churn. Land them on the nearest
correct role, record them, and let R8 decide:
- `HistoryScreen.tsx:383` (current-version marker) stays on `eyebrow`. Design html:55 wants
  `500 11px/1 .1em upper mono`; `eyebrow` is 10.5/500/1.47-upper. V11 changes its colour only.
- The toast face stays on `bodyEmphatic` (15/500). Design html:73 wants `500 13px/1.3`.
- `HistoryScreen.tsx:449` (consequential-action label) inherits L1's `body` shrink. Design html:67
  wants `500 14px/1`.
- The confirm-sheet title takes `screenTitle`'s 1.15 line-height where html:63 wants 1.25. R3 already
  ruled one role serves both titles; do NOT add a local `lineHeight` override to re-litigate it.

**R17. V10's line list in the findings is imprecise — the design lines are authoritative.**
`:365` is `TYPE_SCALE.caption`, not `eyebrow`, and has no design counterpart; leave it alone. `:323`
(the kind badge) IS an `eyebrow` site and the finding's prose names it, but the line list omits it.
The correct mapping is six sites → three roles plus one residual:
`:323` → `kindBadge` (html:34) · `:326`, `:327` → `metaPlain` (html:35,36) ·
`:329`, `:349` → `metaWide` (html:38 and html:42, which are character-identical) ·
`:383` → stays `eyebrow` per R16.

**R18. B2's restructure must keep a pre-existing test green.**
`src/host/launcher/test/history-logic.suite.ts:284-289` reads `HistoryScreen.tsx` as *source* and
asserts three literal substrings survive: `onPress={onToggle}`,
`await access.rollback(app, row.id);`, `await access.fork(app, row.id);`. B2 restructures the component
hosting the first. Preserve all three character-for-character — reformatting or rewrapping that
`TouchableOpacity` turns a standing invariant red. This is not a test invented for this batch; it pins
expand-not-restore, confirm-gated restore, and fork-from-the-viewed-version.

**R19. V16 is two-sided — fix `primary` too.** (2026-08-05, lane L5.) The finding names only
`DoneStep.tsx:70` `secondary.height: 46`, but design html:527-528 puts BOTH CTAs at 52 and `primary`
is currently 54 — also off-spec, just unfiled. Moving only `secondary` to 52 leaves the pair mismatched
at 52-vs-54, which is the visible defect the finding was actually pointing at. Fix both. Same file,
same lane, no scope expansion beyond `DoneStep.tsx`.

**R20. The done tile renders in THE APP'S OWN HUE. SETTLED — owner decision, 2026-08-05.**

**This ruling was reversed by the owner and is now closed. It is NOT an R8 question.**

The earlier reading — that the celebration tile takes the fixed `STATUS_COLORS.done` teal — was
inferred from the mockup writing `#0d9488` as a bare literal at html:520 where every sibling value is
a `{{ }}` binding, reinforced by `RESERVED_TILE_HUES` forbidding any app's `tileColor()` from resolving
to that hue. The owner overruled it. **Continuity of app identity across two adjacent screens wins over
the mockup's literal.** A prototype hardcodes whatever colour its example app happened to have; the
binding pattern is evidence about the prototype's plumbing, not about product intent.

What L5 implements:
- Fill stays `tileColor(name, manifest)` — the app's own colour, exactly as today. **No `STATUS_COLORS`
  import is needed for the done tile's fill.**
- The glow is colour-matched to **the app's own hue**, not teal. The design's
  `box-shadow: 0 8px 22px rgba(13,148,136,.3)` is its teal at 30%, so the RN translation is
  `shadowColor: <the tile's own resolved colour>` with `shadowOpacity: 0.3` — which is what
  "colour-matched glow" meant in the first place.
- Everything else in B3 is unchanged: 120×120, radius 32, the rise-in entrance, no name label.
- **`app-tile.tsx`'s header comment — "The delivered app's own tile in its own colour" — is CORRECT.
  Leave it exactly as it is.** The earlier instruction to rewrite it as false is WITHDRAWN.

**R21. `src/host/launcher/prompt-flow.ts` is granted to lane L5.** No lane claimed it and L3's allowlist
(the only plausible competitor) does not include it. `buildProgressFraction` belongs beside its three
sibling derivations (`activeBuildStepIndex`, `buildStepStatuses`, `currentActionSentence`) rather than
duplicated inside a screen. It is also the only way the fraction gets a real test: `BuildStep.tsx`
imports `react-native` at module scope and is therefore not importable under the Node harness — a
constraint this repo already records at `tile-colour.suite.ts:5-7`. `prompt-flow.ts` has no RN import
and is already behaviorally tested in `prompt-flow-screens.suite.ts`.

The derivation must stay honest: each passed step is a full quarter, the active step a half quarter,
so the bar reads 12.5 / 37.5 / 62.5 / 87.5 and **never fabricates 100% before the done screen replaces
it**. Do not smooth it with a timer to look busier — that would misrepresent real progress, which is
the whole failure mode `obs-v1` exists to end.

**R22. `flow-chrome.tsx`'s `primary.height` 54 → 52, and the header's padding is part of V6.**
(2026-08-05, lane L3's review.) Two corrections beyond what was filed:
- **The header leg of V6.** Design html:412/438/470 is `padding:16px 22px 0` — bottom padding ZERO. The
  whole gap above each headline is the content wrapper's 34/28/26. `flow-chrome.tsx` kept
  `paddingBottom: 16`, so adding the content padding shipped 50/44/42 — the finding inverted, not
  closed. Set `header.paddingBottom: 0` and `header.paddingTop: SPACING.md` (16). The finding's own
  text names the header as part of the defect site, so this is in scope, not scope creep.
- **`primary.height` 54 → 52** (html:428/460/488). Unfiled, but R19 moves DoneStep's CTAs to 52, so
  leaving this at 54 ships the same visual control at two heights one screen apart — exactly the
  mismatch R19 exists to prevent.

**R23. Lane L2 gains `src/host/launcher/app-tile.tsx` and adds `width?: number`.**
(2026-08-05, from L5's delivered contract.) L5 implemented `size?: 'done'` — a string-literal VARIANT
(120x120 preset, glow, rise-in, no label). L2's V3 fluid 3-up grid needs a numeric width, which that
prop cannot express. `plan.md` had predicted `size?: number`; the two are not reconcilable in one prop.

Resolution: **two orthogonal props, each with one job.** `size?: 'done'` stays as the variant selector.
L2 adds `width?: number` for the grid dimension. Do NOT widen to `size?: number | 'done'` — a prop
meaning both "which variant" and "how wide" is the kind of overload that reads fine at the call site
and rots at the definition.

This is safe because L2 runs AFTER L5 merges (the wave order already required that), so no two lanes
hold `app-tile.tsx` at once. L2's allowlist becomes `HomeScreen.tsx`, `SettingsScreen.tsx`,
`app-tile.tsx`. The same guarantee still binds: `width` optional, default rendering unchanged.

**R24. `buildProgressFraction(null, false)` is 0.125, not 0 — the orchestrator's spec contradicted
itself.** (2026-08-05, lane L5.) The spec's assertion list said 0, but the verbatim function body it
also gave yields 0.125, because `activeBuildStepIndex(null, ...)` is 0 — identical to `'plan'` — so
step 1 already reads `active`. The worker implemented the body and asserted 0.125. That is correct:
special-casing null to 0 would render an empty bar beside an already-active first step. R21's binding
constraint is unaffected — the bar must never reach 100% before the done screen replaces it.

**F1 — NEW, UNFILED FINDING (not fixed this batch).** The CTA sits 18px lower than the design on all
three flow screens. Design html:427/459/487 puts 16px above the CTA with the content wrapper's bottom
at zero; RN instead carries `content.paddingBottom: SPACING.xl` (34) on each step with no `marginTop`
on `primary`. Present at BASE `f4eee30`, found by L3's reviewer while re-deriving V6's arithmetic.

Deliberately NOT folded into L3, and the distinction is the point: V6's header leg was in scope because
the finding explicitly named `flow-chrome.tsx:82-89` as part of the defect site. F1 is named by no
finding. Widening an accepted lane on the strength of a reviewer's incidental observation is how scope
discipline erodes — it goes to a later pass through the same rulings process everything else did.

Worth noting what it implies about the audit: this is the same defect shape as V6 (a wrapper's padding
doing a sibling's job) one element lower in the same file, and the audit caught the 16px instance and
missed the 18px one. The pass found what was *visible*, not what was *wrong*. Remaining drift of this
magnitude is probably not zero.

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
