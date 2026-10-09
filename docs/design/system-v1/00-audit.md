# Design audit: what Whim looks, moves and sounds like today

Phase A of `design-system-v1`, written 2026-10-09 against `integration/beta-1` at `b4b45f1b`. Sources: every
file under `src/sdk/` and `src/host/launcher/` that draws pixels, `src/host/ui/whim-prose/`,
`build/assemble.mjs`, `fixtures/`, `docs/sdk-reference.md`, the generator prompt, the design handoff in
`docs/design/`, `docs/research/animation-options-2026-09.md`, `docs/mascot/`, and the September screenshots in
`docs/readme/`. The device capture (every screen in light and dark, Android emulator and iOS simulator)
arrives in Phase B. Anything that only a device can settle is marked **verify on device**.

## The short version

The shell has good ideas and no spine. The ideas worth keeping are real: liveness that never fakes
progress, skeletons that only promise what is coming, a confirm sheet whose safe choice is the big button,
plain copy, the prompt-as-history row, a colour per app, and the instinct that colour should carry meaning.
What is missing is one model those ideas hang from. Three token systems sit side by side. The type scale is a
stack of 25 numbered rulings that settle disagreements between a desktop-rendered HTML mockup and a README
table, instead of describing how text behaves on a phone. Everything the handoff never drew (sheets, back
buttons, pills, scrims, icons, motion, dark mode, iOS fonts, haptics) was solved locally, each time a little
differently.

The twelve problems a user actually feels, worst first:

1. **No dark mode, anywhere.** The shell palette is one light constant (`src/host/launcher/theme.ts:26-35`),
   the status bar is pinned to `dark-content` (`LauncherRoot.tsx:2513`), mini-apps get one light theme
   (`src/sdk/theme.ts:66-79`), and the runtime page hardcodes navy and white (`build/assemble.mjs:82,131,201`).
   A phone in dark mode gets a bright paper slab.
2. **Two typographic worlds, three on iOS.** The Android shell draws Instrument Sans, IBM Plex Mono and
   Newsreader. Every mini-app draws the system font, because the CSP leaves `font-src` at `'none'`
   (`build/assemble.mjs:17-27`). The iOS project bundles none of the TTFs (no `.ttf` in
   `ios/Whim.xcodeproj/project.pbxproj`, no `UIAppFonts` in `Info.plist`), so the iOS shell falls back to the
   system font while keeping metrics tuned for Instrument Sans. Confirmed by the capture: on the iOS simulator
   the title, the mono eyebrows and timestamps, and the Newsreader quote all render in SF Pro
   (`ios/01-home-first-launch-examples`, `ios/100-history-single-version`).
3. **Every app looks alike, and its one colour does little.** A mini-app's `primary` is the shell's ink violet
   for every app (`src/sdk/theme.ts:73`). The generator is told to put "the main content inside a Card, the
   headline number as display-size Text, a ProgressBar ..., a Badge ..., and a SegmentedControl"
   (`server/src/generation/prompts/index.ts:436-438`), so they all share a layout too. A tile is one colour
   plus two letters, and the colours collide: four of the ten tiles in `docs/readme/home.png` are the same
   orange, and two apps are both "TS / Tip Splitter".
4. **Nothing moves like a phone.** Screens swap by `setScreen` with no transition (`LauncherRoot.tsx`
   if-chain from line 2525). iOS has no edge-swipe back anywhere. Five sheet implementations open three
   different ways, and three of them vanish on close. Most buttons give TouchableOpacity's default press
   feedback, a drop to 20% opacity. Nothing honours Reduce Motion.
5. **The accent means "this is interactive, probably".** Ink violet `#3f3d8f` marks primary buttons, step
   bars, the liveness dot, selected pills, links, switches and the Android caret. Meanwhile the primary button
   is black in `ConfirmSheet.tsx:76`, `FailureScreen.tsx:232` and the consent "keep on" row
   (`ConsentScreen.tsx:179`). A user can't learn what the violet promises.
6. **Too many type sizes, too small.** 14 roles plus 9 one-off combinations; sizes include 9.5, 10, 10.5,
   11.5 and 13.5. Body copy is 13.5px (`design-tokens.ts:198`), smaller than either platform's body. Answer
   pills are about 31dp tall (`ClarifyStep.tsx:299-305` with `controlLabel` 13/13, `design-tokens.ts:204`).
7. **Contrast failures in the palette itself** (WCAG, computed): hedge text `#a8a29a` on paper 2.43:1; the
   SDK's `warning` role is the grey `#c9c3b8`, 1.68:1 as Badge text; teal `working` as text 3.59:1; white
   monograms on the gold and orange app colours 2.94:1 and 2.80:1; input boundaries (`#e0dcd4` on paper)
   1.31:1 against the 3:1 that WCAG 1.4.11 asks of a control's edge.
8. **Icons are typed characters.** `⚙︎ ✎︎ ⌂ ↺ ⚑︎ ✓` render in whatever font the platform picks, and
   `orb-actions.ts:58-59` admits `⌂` was never checked on Android. The history back chevron is a rotated box
   with two borders (`HistoryScreen.tsx:595-610`). The orb, the one control on screen over every app, is a
   hamburger (`Orb.tsx:109-111`).
9. **One concept, several names.** Fork and copy, Prompt again and Change it, History and Versions, Home and
   Back to your apps, Build and Make (table in section 13). And the copy calls the agent "Whim" in the third
   person ("Whim will ask if something is unclear", `copy.ts:75`) although the handoff settled that the agent
   says "I" and never refers to itself in the third person (`docs/design/README.md:183`).
10. **Haptics are wrong on iOS and absent from the shell.** Cues go through RN `Vibration`
    (`src/host/cue-backend.ts:12,20-24`), which ignores durations on iOS, so a `tap` is a full ~400 ms buzz.
    The shell itself never produces a haptic. **Verify on an iPhone.**
11. **Opening an app can flash three backgrounds.** Navy outer page (`build/assemble.mjs:201`), white iframe
    (`:82`, `:131`), paper `Screen` (`src/sdk/index.tsx:276`). The page also sets `maximum-scale=1` (`:204`).
12. **The docs disagree with the code and with each other.** `docs/sdk-reference.md:161,315-323` still
    teaches the generator about presets and shapes that #59 cut. `tileColor` is not in the reference at all,
    so the model learns it only from few-shot fixtures. The animation research cites two motion-absence test
    assertions (`docs/research/animation-options-2026-09.md:25`) that no longer exist in either suite.
    `docs/design/README.md` and `START_HERE.md` are an implementation plan that has already been executed.

## 1. Where values come from

Three token systems coexist, and none is complete.

| Source | What it holds | Who reads it |
|---|---|---|
| `src/sdk/design-tokens.ts` | Shell palette, status hues, kind-badge hues, `RADIUS` (14/18/22/28/999), `SPACING` (8/12/16/22/34), `MOTION` (two entries), three font families, `TYPE_SCALE` (14 roles), the app palette | Launcher, prose renderer |
| `src/sdk/tokens.ts` | `SPACE` (4/8/12/20/32), `TEXT_SIZE` (13/16/20/28/40), `WEIGHT`, `FONT` = `system-ui` | Mini-app SDK only |
| `src/sdk/design-tokens.ts:232-238` | `RADIUS_SCALE` (6/12/20/999) for mini-apps | Mini-app SDK only |
| Literals in screens | 26 distinct spacing values, 13 radii, 9 type combinations, 5 scrims, 7 disabled opacities | Wherever they were needed |

- Shell spacing (8/12/16/22/34) and SDK spacing (4/8/12/20/32) share only 8 and 12. Shell gutter 22, SDK
  gutter 20, History gutter 16 (`HistoryScreen.tsx:585,621,623`).
- `TYPE_SCALE` documents its own provenance as owner rulings R1, R2, R4, R5, R8, R11 and R13
  (`design-tokens.ts:12-33`); code comments cite mockup line numbers 35 times ("design html:388") and
  rulings in 10 files. Values are faithful to an HTML file instead of being derived from a rule, which is why
  `body` is 13.5 with a 20.925 line height and why four mono roles carry "NOT SETTLED" notes.
- Alpha is applied four ways: `inkAlpha()`/`withAlpha()` (`launcher/theme.ts:38-50`), a hex suffix on a
  colour string (`app-tile.tsx:47,159`; `FailureScreen.tsx:111` `'14'`; `surfaces.tsx:117` `'22'`), and raw
  `rgba()` literals (`ConfirmSheet.tsx:99`, `HomeScreen.tsx:439`, `Orb.tsx:197-198,216`).
- Disabled and de-emphasised opacities: 0.35, 0.45, 0.45, 0.5, 0.5, 0.6, 0.7 with no token
  (`BuildStep.tsx:42`, `HomeScreen.tsx:443`, `app-tile.tsx:248,251`, `ConfirmSheet.tsx:104`,
  `ReportSheet.tsx:405`, `HistoryScreen.tsx:675`).

## 2. Colour

**Shell palette** (`design-tokens.ts:43-54`): paper `#fbfaf8`, surface `#f1efea`, border `#e0dcd4`, ink
`#17171a`, text `#1c1917`, muted `#6b6560`, faint `#a8a29a`, accent `#3f3d8f`, yours `#a15c07`. Status
(`:58-71`): teal `#0d9488` for working and done, red `#b91c1c`, grey `#c9c3b8` for waiting.

What doesn't hold:

- **Surfaces separate by border only.** Surface on paper is 1.10:1 and border on paper 1.31:1, so every card
  draws fill plus a 1px line (plan rows, chips, composer, sheets, menus). In the mini-app shot a `List`
  inside a `Card` draws two nested outlines (`docs/readme/sourdough-app-entry.png`).
- **Three reserved hues are reserved by exact hex only.** `RESERVED_APP_COLORS` and `RESERVED_TILE_HUES`
  compare strings (`design-tokens.ts:247-258`, `tiles.ts:19-30`), so `#0d9489` sails through as a tile
  colour. The intent (an app may not look like a status) isn't enforced.
- **A second palette for one screen.** `KIND_BADGE_COLORS` adds violet `#7c3aed` and amber `#b45309`
  (`design-tokens.ts:84-94`) for history kind badges, and reuses the reserved teal for "Added" by recorded
  exemption. The status vocabulary leaks into a categorical label on the screen that uses Whim Syntax most.
- **The app palette is clear of reserved hues but not of each other.** Orange `#f97316` and gold `#ca8a04`
  sit next to the brown `yours`; with LLM-declared colours, orange dominates the grid. White on gold is
  2.94:1, on orange 2.80:1, on olive 3.09:1.
- **The mini-app theme maps roles onto shell meanings that don't fit.** `warning` resolves to the `waiting`
  grey (`src/sdk/theme.ts:77`), so `<Badge tone="warning">` is light grey on light grey (1.58:1 against its
  own tint) and a warning `ProgressBar` looks disabled. `on-primary` is hardcoded `#ffffff` (`:74`).
- **Five scrims.** `rgba(24,22,20,.5)` in `ConfirmSheet.tsx:99`, `RunDetailsSheet.tsx:33`, `Orb.tsx:216`;
  `rgba(0,0,0,.5)` in `HomeScreen.tsx:439` and the SDK `Modal` (`surfaces.tsx:364`); `inkAlpha(.5)` in
  `SheetModal.tsx:92`. None equals ink.
- **Orb menu swatches** `#e6e4f7` / `#e5e2db` are literals with no role (`orb-actions.ts:51-56`).
- **The brown is load-bearing but misnamed.** `yours` (`#a15c07`) means "the user's words" in prose, yet the
  Android app icon background is violet (`android/.../brand_colors.xml`), the launch screen is paper, and
  nothing in the brand uses the brown. The mascot sheet (`docs/mascot/mascot.txt`) proposes ember amber as the
  identity; nothing in code points that way.

## 3. Typography

Faces: Instrument Sans 400/500/600/700, IBM Plex Mono 400/500, Newsreader Italic
(`design-tokens.ts:131-139`). Android needs byte-copies named `_bold` and `_italic` to pick them at all
(`assets/fonts/README.md`). iOS ships none of them (see the summary). Mini-apps use `system-ui`
(`src/sdk/tokens.ts:39`).

| Role | Size / line | Notes |
|---|---|---|
| display | 34 / 34 | Home title "Whim" |
| headline | 30 / 33.6 | Compose only |
| stepTitle | 26 / 29.9 | Flow steps, Settings, Done, Failure, Update, Consent |
| screenTitle | 22 / 25.3 | History, confirm sheet, mini-app error, boot overlay |
| metric | 48 / 48 mono | Unused by any screen I found |
| body | 13.5 / 20.925 | Also sizes two TextInputs, so the user types at 13.5px |
| bodyEmphatic | 15 / 25.5 | Larger than body; used for buttons and question text |
| caption | 12 / 18.6 | |
| controlLabel | 13 / 13 | Line height equal to size; clips descenders at large font scale |
| eyebrow | 10.5 mono uppercase +1.47 | "YOUR APPS", "OR START FROM", plan row labels, section headers |
| kindBadge | 9.5 mono 600 | Weight synthesized; no Plex Mono 600 ships (`:208-211`) |
| metaPlain / metaWide | 10.5 / 10 mono | History timestamps and "YOU SAID" |
| quote | 17 Newsreader italic, brown | |

Plus literals outside the scale: tile name 11.5/14 and caption 10.5/13 (`app-tile.tsx:235-264`), monograms
19 and 62, glyph sizes 10, 15, 16 (`BuildStep.tsx:180`, `Orb.tsx:233`, `HomeScreen.tsx:406`), a 12/16 code
preview (`ReportSheet.tsx:401`).

- `bodyEmphatic` (15) is bigger than `body` (13.5), so emphasis changes size as well as weight.
- Monospace uppercase eyebrows appear on nearly every screen. Mono is meant for "anything measured"
  (`docs/design/README.md:78`) but labels like "WHAT IT IS" and "YOU SAID" measure nothing. The effect is a
  developer-tool texture on a consumer app.
- Tracking is stored in px pre-multiplied per size, which is fine, but only four roles track at all.
- Nothing caps or plans for font scaling. RN scales `Text` with the system setting by default, while buttons
  have fixed heights (52, 46, 56: `flow-chrome.tsx:142`, `BuildStep.tsx:182`, `ConfirmSheet.tsx:101`) and
  the settings glyph a 16/16 line in a 38×38 circle. **Verify at 200% text size.**
- Mini-apps: Button text is `600 17px` while body is 16px (`src/sdk/index.tsx:497`), inputs render at 20px
  (`controls.tsx:52`, `index.tsx:413`), segments at `500 14px` (`controls.tsx:403`). Five size tokens, seven
  rendered sizes (13, 14, 16, 17, 20, 28, 40).

## 4. Spacing and layout

- 26 distinct spacing literals across the launcher, including 2.5, 9, 10.5, 12.75, 13, 15, -13, -8. Only
  8/12/16/22/34 match the scale.
- Screen top paddings differ per step because each copies its mockup: 34 (compose), 28 (clarify), 26 (plan),
  34 (build), 22 (failure) (`ComposeStep.tsx:127`, `ClarifyStep.tsx:293`, `PlanStep.tsx:220`,
  `BuildStep.tsx:161`, `FailureScreen.tsx:266`). Moving between steps shifts the headline.
- Home grid: column gap 14, row gap 18 (`home-grid.ts:17-18`), side padding 22. Fluid tile width (106 on a
  390 frame). The loading skeleton draws fixed 88×88 tiles with one 14 gap both ways and no label rows
  (`flow-skeletons.tsx:62-75,122`, used at `LauncherRoot.tsx:2750`), so the grid jumps when it loads. That
  breaks the system's own rule that a skeleton is a promise.
- The orb reserves 54 + 22 + safe-area at the bottom of every mini-app (`orb-geometry.ts:13-28`), about
  110dp, and still floats over content on screens that don't scroll.

## 5. Shape

Shell radii: chip 999, field 14, card 18, tile 22, sheet 28 (`design-tokens.ts:98-104`). Literal radii 1, 2,
3, 4, 6, 8, 10, 11, 12, 13, 16, 19, 20 elsewhere: the composer is 20 (`HomeScreen.tsx:428`), the toast 16
(`HistoryScreen.tsx:673`), history buttons 12, history chips 8, kind badges 6, orb swatches 10. The failure
panel borrows `RADIUS.tile` (`FailureScreen.tsx:276`), a radius named for app icons. Mini-app radii are
6/12/20/999 with Button defaulting to 12.

There is no concentric rule (an inner shape's radius doesn't follow the outer one's minus its inset) and no
continuous corners on iOS (`borderCurve` is unused), so tiles read as rounded squares, not icons.

## 6. Depth and materials

- One iOS-only shadow (`Orb.tsx:191-194`; on Android the orb is a flat translucent disc), one `boxShadow`
  glow on the done tile (`app-tile.tsx:158-160`), zero elevation.
- Border widths 1, 1.5, 2, 2.4 and hairline.
- No elevation model: a sheet, a card, a menu row and a chip are all "fill plus 1px border".
- No translucency, which is fine; nothing depends on it.

## 7. Iconography

No icon system and no SVG library. Icons are text glyphs (`⚙︎` `HomeScreen.tsx:161`; `✎︎ ⌂ ↺ ⚑︎`
`orb-actions.ts:60-65`; `✓` `BuildStep.tsx:130`, `FailureScreen.tsx:121`, `controls.tsx:186`) or Views
pretending to be strokes (the composer plus, `HomeScreen.tsx:213-220`; step bars; the Settings chevron; the
History chevron; the orb's three bars). Glyph rendering depends on the platform font. The flow's back
affordance is the word "Back" (`flow-chrome.tsx:57-59`); History's is a 42px circle with a chevron. Two back
buttons, two places, two looks.

The app icon is a rounded white "W" on violet (`ios/.../AppIcon-1024.png`), unrelated to anything inside the
app.

## 8. Launcher components

**Buttons.** Six treatments for "the main thing to do": accent fill (flow `PrimaryAction`, Done, update,
age, mini-app error), ink fill (confirm sheet's Cancel, failure's Try again, consent keep-on), outlined
(Done's secondary, Build's Leave it running, failure's Back), danger outline (failure's Discard), plain text
(confirm's consequential action, Cancel build), and centred action-sheet rows. Heights 52, 56, 46, about 45
(failure, padding-based), 42, 38. The confirm sheet's rule "safe option big, consequential option as text"
is good and should become universal.

**Sheets.** Five implementations:

| Sheet | Container | Open | Close | Scrim |
|---|---|---|---|---|
| `SheetModal` (report, app link) | RN Modal, `animationType="none"` | 260 ms rise, 24px, opacity | instant | `inkAlpha(.5)` |
| `ConfirmSheet` | Modal `slide` | platform slide, scrim slides with it | platform slide | `rgba(24,22,20,.5)` |
| Home `ActionSheet` (3 uses) | Modal `fade` | whole sheet fades | fade | `rgba(0,0,0,.5)` |
| `RunDetailsSheet` | absolute View | 260 ms rise | instant | `rgba(24,22,20,.5)` |
| Orb menu | Modal `none` | 260 ms rise; rows refuse taps until it settles (`Orb.tsx:59-63,155`) | instant | `rgba(24,22,20,.5)` |

Only `RunDetailsSheet` shows a grabber, and it can't be dragged. None can be dragged or flicked away.

**Pills and chips.** Four styles: compose suggestions (body, radius 14, full width), clarify answers
(controlLabel 13/13, padding 8×16, about 31dp tall), history filters (caption, padding 6×12, ink when
selected), report reasons (caption, padding 6×12, accent when selected). Selected is accent in two places and
ink in one.

**Tiles.** `AppTile` (`app-tile.tsx`): app colour, 1px white inset border at 30%, two-letter monogram at 19
plus the same monogram at 62 bleeding off the top-right at 16% white. Variants: ghost (opacity 0.45, red
border when failed), busy (opacity 0.7), done (120px, colour glow, 400 ms rise), pill overlay, example
caption. The ghost letterform repeats information already printed under the tile, and "WI"/"CF" crop to
single letters at the edge.

**Headers.** Flow steps: "Back" text at left, three 18×3 step bars at right. Settings: same header, no bars.
History: circle chevron, app name in its colour plus "history" in ink, a bordered "Report" pill. Home: 34px
"Whim", mono "YOUR APPS", gear in a bordered 38px circle. Mini-apps: no header from the SDK at all.

**Toast.** One, in History: an ink slab 24px from the sides, 34 from the bottom, no motion, 2.2 s timeout
(`HistoryScreen.tsx:94,319-322,673`).

## 9. SDK components (what the generator gets)

23 components, all inline-styled DOM (`src/sdk/index.tsx`, `controls.tsx`, `surfaces.tsx`, `charts.tsx`).

- `Screen`: paper background, 16px system font, `user-select: none`, bottom padding for the orb. No title, no
  back affordance, no scroll edge, no safe-area awareness of its own (the host pads the top).
- `Stack` / `Row`: `Row` defaults to `align-items: baseline` and `justify-content: space-between`
  (`index.tsx:329-330`), so two children fly to opposite edges unless the model passes `justify`. A trap for
  the generator.
- `Text` / `Heading`: `Heading size="subtitle"` is bold 20; `Text size="subtitle"` is semibold 20. Two
  components for one job.
- `Button`: four variants, radius prop (default 12), 50% disabled, press = opacity 0.8 over 80 ms
  (`index.tsx:465-469,502`). No scale, no haptic.
- `TextInput`, `NumberInput`: 20px text, border-only boundary at 1.31:1.
- `Switch`: custom 44×24 track, 150 ms `ease` knob. Its label renders as muted caption
  (`controls.tsx:142`) while `Checkbox`'s label renders as 16px text; two toggle rows, two label styles.
- `Checkbox`: `✓` character at 14px bold (`controls.tsx:186`).
- `Slider`: pointer-captured custom track, thumb 22px, no press state, no detent feedback.
- `SegmentedControl`: selected segment fills with the accent, no motion between segments.
- `Card`, `List`, `ListItem`: surface plus border; nesting doubles the border; `ListItem` press tint has no
  transition.
- `Badge`: tone colour plus `22` alpha; `warning` is unreadable (section 2).
- `ProgressBar`: 8px with a border; no motion when the value changes.
- `EmptyState`: centred title and hint; no icon.
- `Modal`: bottom sheet that appears and vanishes with no motion, closes only by backdrop tap, has no
  handle and no close button (`surfaces.tsx:352-414`). On iOS a generated app that forgets its own close
  button traps the user until they find the orb.
- `Chart`: bar, line, heatmap. Fine as data display.
- Missing for the apps people actually ask for (timers, trackers, logs): an icon, a screen title/header, a
  date or time input, a picker/select, a stepper for counts, a toast or inline confirmation, list
  reordering or swipe actions. Phase B decides which earn their tokens.

`fixtures/style-gallery.app.tsx` exercises every export today. It has to keep doing that through every SDK
change (owner requirement, see `01-direction.md` §10).

## 10. Screens

| Screen | File | What's wrong |
|---|---|---|
| Home | `HomeScreen.tsx` | "Whim" title + mono "YOUR APPS" eyebrow say the same thing twice; gear glyph in a 38px bordered circle; grid of identical saturated squares with duplicated monograms; "Example" captions and "Forked from …" lines break the row rhythm; empty state is one muted line, `COPY.emptyTitle`; the composer is a fake input whose plus is violet |
| Long-press sheet | `HomeScreen.tsx:226-243` | Seven centred rows (Open, Fork, History, Prompt again, App link, Delete, Cancel), fades in from nowhere; Delete then jumps to a native `Alert` (`:133-139`) instead of the app's own confirm sheet |
| Compose | `ComposeStep.tsx` | Headline 30px Bold; field types at 13.5px; three suggestion rows styled like inputs; helper copy speaks of "Whim" in third person |
| Clarify | `ClarifyStep.tsx` | Echoed prompt in brown upright, not the quote style the doc reserves for "your words"; 31dp pills; "Decide for me" as a dashed pill that looks disabled until picked |
| Plan | `PlanStep.tsx` | Mono uppercase labels on every row ("WHEN A STEP ENDS" in the README shot); inline edit swaps the card border to 2px violet with 13px text actions |
| Build | `BuildStep.tsx` | The longest wait in the product is the least designed screen: title, a 4px bar, a checklist with `✓` glyphs, a caption that says "about a minute" (`copy.ts:114`), true at the median but wrong for the slowest tenth of runs (section 13); a large empty lower half; "Leave it running" as an outlined button |
| Done | `DoneStep.tsx` | The best moment gets a 400 ms 6px rise and nothing else; "Open it" is violet, not the app's colour |
| Failure | `FailureScreen.tsx` | Title in red; three stacked full-width buttons (black, outlined, red-outlined); a timeline under a checklist under an attempt bar; dense for a moment that should be calm |
| Mini-app | `MiniAppView.tsx` | Boot overlay is the app name, a breathing violet bar and "Opening…" on paper, then a cut to the app; no spatial link to the tile that was tapped; the orb's hamburger floats over content |
| Orb menu | `Orb.tsx` | Four rows with typed glyphs in tinted squares; rows ignore taps while rising; closes instantly |
| History | `HistoryScreen.tsx` | Different gutter (16) and back button from every other screen; four mono roles plus serif italic plus a two-colour title; six coloured kind badges; toast with no motion |
| Settings | `SettingsScreen.tsx` | Mono section headers; "This phone's ID" with a "Make a new ID" action sits at the top level under About (`:337-345`), while Advanced holds only the own-server switch (`:361`). The owner wants device ID and other diagnostic controls one level deeper; common settings first |
| Consent / Terms / Age | `ConsentScreen.tsx`, `TermsScreen.tsx`, `AgeScreen.tsx` | Up to three full screens before the first prompt; consistent "primary + plain text" footers, good; consent's "keep on" button is black, "agree" is violet |
| Update, link missing, screen error | `UpdateRequiredScreen.tsx`, `AppLinkMissingScreen.tsx`, `ScreenErrorFallback.tsx` | Consistent with each other, which shows the primary-plus-text footer works when it's applied |
| Report sheet | `ReportSheet.tsx` | Fourth pill style; native Switch tinted violet; a mono code preview |

## 11. Motion

There is no motion system. `MOTION` holds two entries, `breathe` (1.9 s, opacity 0.34-0.72) and
`sheetRise` (260 ms, `cubic-bezier(.2,.8,.2,1)`) (`design-tokens.ts:122-125`). Everything runs on RN core
`Animated`; Reanimated, Gesture Handler and SVG are not installed.

Inventory (from a full sweep of `src/`):

| Moment | Where | Parameters | Problem |
|---|---|---|---|
| Orb menu open | `Orb.tsx:66-79` | 260 ms bezier(.2,.8,.2,1), 24px rise + fade | Rows refuse taps until done; close is instant |
| SheetModal open | `SheetModal.tsx:56-67` | same | Close instant |
| RunDetailsSheet open | `RunDetailsSheet.tsx:64-76` | same | Close instant; grabber can't be dragged |
| ConfirmSheet | `ConfirmSheet.tsx:50` | platform `slide` | Scrim slides up with the card |
| Home action sheets | `HomeScreen.tsx:346` | platform `fade` | Sheet fades instead of rising |
| Skeleton breathe | `flow-skeletons.tsx:26-49` | 950 ms per leg, ease-in-out, loop, staggered 80-150 ms | Loops under Reduce Motion |
| Done tile rise | `app-tile.tsx:41-43,134-145` | 400 ms bezier(.25,.1,.25,1), 6px | Fixed timing on the best moment |
| Settings chevron | `SettingsScreen.tsx:83,129-138` | 200 ms ease-in-out rotate | Fine |
| Keyboard | `KeyboardShell.tsx:89-94` | LayoutAnimation, system curve, iOS only | Fine |
| SDK Button / Card press | `index.tsx:502`, `surfaces.tsx:48` | opacity 0.8, 80 ms | No scale |
| SDK Switch knob | `controls.tsx:117` | 150 ms `ease` | CSS `ease` on a toggle |
| SDK Checkbox | `controls.tsx:172` | 120 ms colour | Fine |
| Screen changes | `LauncherRoot.tsx` | none | Hard cuts everywhere |

No moment honours Reduce Motion (no `AccessibilityInfo.isReduceMotionEnabled`, no
`prefers-reduced-motion`). Nothing springs, nothing can be grabbed, nothing inherits a finger's velocity.
The only infinite loop is the skeleton.

## 12. Haptics and sound

- Shell: no haptics, no sound.
- Mini-apps: `cues.haptic('tap' | 'double' | 'heavy')` maps to `Vibration.vibrate(18)`,
  `[0,22,90,22]`, `[0,70,50,120]` (`src/host/cue-backend.ts:20-24`). On Android that is a raw vibrator
  pulse, not the platform's haptic feedback (it doesn't follow the touch-feedback setting the way
  `performHapticFeedback` does); on iOS `Vibration` ignores durations.
- Sounds: `tick`/`chime`/`alarm` from `ToneGenerator` on Android and synthesized WAVs on iOS
  (`WhimToneModule.kt:28-30`, `WhimToneModule.mm:45-58`). Fine for timers.

## 13. Copy and voice

The house voice works: short, plain, sentence case, no exclamation marks. Problems are consistency, not
tone.

| Concept | Names in use | Where |
|---|---|---|
| Make a second app from this one | Fork, Forking…, Forked from X, Start a copy here, Make the copy | `copy.ts:33,39,156,169,664-666` |
| Ask for a change | Prompt again, Change it, Change it from here, Make the change | `copy.ts:34,185,154,106` |
| The list of versions | History, Versions | `copy.ts:146,187` |
| The home grid | Home, Back to your apps, Your apps | `copy.ts:186,143,29` |
| Creating | Build it, Building…, Making it, Couldn't build this app | `copy.ts:104,46,111,245` |
| A failed attempt | Didn't finish, Interrupted, Couldn't build this app, Discard this attempt, Dismiss | `copy.ts:47,48,245,257,54` |

- Third person where the handoff settled first person: `copy.ts:75,86,95,151`.
- "This takes about a minute" (`copy.ts:114`) is true at the median and wrong for the slow runs. The
  production flowbench (`openspec/changes/beta-1/flowbench/after-visible.json`, 22 runs) measured generation
  at 53 s median, 144 s at the 90th percentile and 225 s at worst, and the line never changes as the wait
  grows. (An earlier draft of this audit cited an 87 s median; that figure is the engineer call with
  thinking on in a local run, `docs/research/generation-speed-2026-09.md`, not production.)
- Mono uppercase labels give microcopy a shouting register ("↑ YOU'RE ON THIS ONE").

## 14. Platform conventions

- **iOS back.** No interactive edge swipe on any screen; only visible buttons, in two styles.
- **Android back.** Hardware/gesture back is wired carefully (`back-policy.ts`, `use-system-back.ts`), but
  there is no predictive-back animation and screens cut.
- **System font and Dynamic Type.** See section 3. The iOS shell is already on the system font by accident.
- **Status bar.** Fixed dark content; mini-apps can't color the area above them.
- **Runtime page.** No `color-scheme`, no `viewport-fit=cover`, `maximum-scale=1`, three backgrounds.
- **Haptics.** `Vibration` instead of the platforms' haptic engines (`UIFeedbackGenerator`,
  `performHapticFeedback`).

## 15. Accessibility

- Touch targets under 44pt/48dp: clarify pills (~31), history and report pills (~31), the 38px settings
  button, plan row Cancel/Save (13px text, `hitSlop` 10), history's Report pill.
- Contrast failures listed in the summary, item 7.
- No Reduce Motion, Reduce Transparency or Increase Contrast handling anywhere.
- `controlLabel`'s line height equals its size, leaving no room for descenders. **Verify at large font
  scale.**
- Several `Pressable`s give no visual press state at all (`Orb.tsx:103,128,152`, `MiniAppView.tsx:125,151,158`).
- VoiceOver/TalkBack structure has had real care (sibling scrims, labelled rows; `HomeScreen.tsx:340-343`,
  `ConfirmSheet.tsx:11-13`). Keep that.

## 16. Docs drift

- `docs/design/README.md` and `START_HERE.md` are a handoff plan ("Start with the tokens: replace the
  placeholder values in `src/sdk/theme.ts`…") that `shell-redesign-v2` already executed. They read as current
  instructions and aren't.
- `docs/sdk-reference.md:161,315-323` describes `sharp`/`soft`/`round` shapes and theme presets that no
  longer exist, in the document the generator reads on every request.
- `AppSpec.tileColor` (`src/sdk/index.tsx:150-156`) is missing from the reference's `AppSpec`
  (`docs/sdk-reference.md:14-20`).
- `src/sdk/index.tsx:16-19` still calls the SDK "a minimal, functional fixture slice" with "dark mode,
  component polish" deferred.

## 17. What survives

These carry into v1, reworked where noted:

- **Honest liveness.** `WorkingLine`'s rule that motion follows real signals and a stall looks still
  (`flow-working.tsx:1-18`). It becomes the heart of the motion language.
- **Skeletons are promises.** Exact geometry, known counts, nothing for an empty result
  (`flow-skeletons.tsx:1-11`). Keep the rule; fix the home skeleton that breaks it.
- **The safe option is the big button.** `ConfirmSheet`'s pattern, applied everywhere.
- **Primary action at the bottom, plain-text secondary under it.** Already consistent across six screens.
- **A colour per app, declared at build time and extracted statically.** Keep the mechanism; constrain the
  value to a token (direction §3).
- **Whim Syntax's core idea**, marking prose by role instead of grammar, with the four-mark cap and the
  off-the-field rule. Its channels get simpler (direction §4).
- **Prompts as history**, the user's own words at the top of each version.
- **Plain voice**, sentence case, no exclamation marks, one acknowledgement per failure.
- **Accessibility structure** of sheets and menus (sibling scrims, one element per action).
- **The containment-first SDK shape**: tokens not values (#13), no DOM in the app's vocabulary (#11), hooks
  for time (#43), inert theme data (#45).
