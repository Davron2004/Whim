# Whim design system

The one design system for the Whim shell and every app it makes. A builder implements from this file
without asking; where it and the code disagree, this file wins until the token module lands, then the
module's values win and this file's tables are checked against it.

- **Mockups:** [`mockups/index.html`](mockups/index.html), every screen on iOS and Android, light and
  dark, plus a motion lab. `#s-…` ids below open a screen there.
- **Palette proof:** [`system-v1/palette-check.py`](system-v1/palette-check.py) (`python3 -I
  docs/design/system-v1/palette-check.py`) prints every contrast and separation table in §2.
- **Why it is this way:** decision #75 in [`docs/decisions.md`](../decisions.md) (reversals, deferrals)
  and the critique record [`system-v1/07-critique-response.md`](system-v1/07-critique-response.md).
- **Build plan:** OpenSpec change `openspec/changes/design-system-v1/`.
- `reference/` holds the superseded v2 handoff (`*.dc.html`), kept only because old code comments cite
  its line numbers. Don't build from it.

**Token source.** Every value in §2–§5 lives in one module, `src/design/tokens.ts`. The RN shell
imports it; `npm run build` emits the runtime page's CSS custom properties and the SDK's theme from it;
the mockup's token block and the tables here are checked against it by a static check. Nobody copies a
value by hand.

## 1. Principles

Whim should feel like a warm light in a quiet workshop: you say what you want, a small light gets busy,
a thing that is yours appears. Not a chat app, not a developer tool, no purple AI sparkle. Three tests
for every screen: **is it calm** (neutral surfaces, one accent at a time), **is it honest** (if Whim is
stuck, it looks stuck), **is it yours** (your apps carry the colour, your words are quoted exactly).

Eight principles; when two collide, the earlier wins.

| # | Principle | Means |
|---|---|---|
| 1 | Apps first | The person's apps are the colour and the content; chrome stays neutral and steps back over a running app; the ember never enters an app's content |
| 2 | Hue says who | Every hue answers "who is this?" (below). Coloured with no answer = decoration = removed |
| 3 | Everything comes from somewhere | Things leave the way they came: an app opens from its tile and closes into it, a making sheet collapses into its ghost tile, a menu grows from the pressed tile |
| 4 | Honest light | The ember moves only when real work moves (§4.6); progress is never smoothed; time estimates are measured |
| 5 | The finger never waits | Feedback on touch-down; every transition can be grabbed, reversed or retargeted from where it is; input is never blocked by animation |
| 6 | Native by default | System type and Dynamic Type, each platform's back gesture and icon, its haptic engine, light and dark, Reduce Motion, Increase Contrast; inside apps too, through the theme init frame and SDK defaults |
| 7 | Plain words, one name per thing | §8 |
| 8 | Forgiving | Undo over "are you sure"; confirm only what can't come back (a new phone ID, your own server), safe choice as the big button; nothing typed is lost to a closing sheet |

| Hue | Means | Examples |
|---|---|---|
| Ember | Whim is doing, or will do, the work | "Make it", "Make the change", "Try again", the orb, a tile being made, picked "Decide for me" |
| An app's tint (cool) | That app | Its tile, its name in prose, "Open it" on Ready, the app's own buttons |
| Ink | You and the system | Selected answers, quoted words, "Agree to send descriptions", "Send report", shell switches, a confirm sheet's safe button |
| `danger` red | Danger | Delete, Discard, an error that stopped work |
| `warning` amber | Take care | A notice that needs attention |
| `positive` green | It worked | Ready, restored, verified |

Warm hues belong to Whim and status; apps get the cool half of the wheel plus two neutrals. Status also
has a shape: **a fill means `primary` and nothing else**, so `danger` never fills a button, and status
badges always carry their icon.

## 2. Tokens

### 2.1 Neutrals and roles

Warm low-chroma greys (OKLCH hue 60–75). Contrast is WCAG 2.2.

| Role | Light | Dark | Use | Contrast |
|---|---|---|---|---|
| `bg` | `#F6F4F1` | `#100E0D` | Screen canvas; runtime page, iframe, SDK `Screen`, opening container | |
| `surface` | `#FFFFFF` | `#1B1917` | Cards, list groups, inputs on the canvas | |
| `sheet` | `#F6F4F1` | `#1B1917` | Content sheets (making, Whim sheet, consent, failure, SDK `Modal`) | |
| `sheet-group` | `#FFFFFF` | `#252220` | Groups, question groups, plan rows, cards inside a sheet | |
| `raised` | `#FFFFFF` + `shadow-raised` | `#252220` + top highlight | Menus, toasts, popovers, the orb, the composer | |
| `fill` | `#EBE9E6` | `#2E2B28` | Secondary buttons, segmented track, chips | |
| `fill-strong` | `#E0DDDA` | `#3C3936` | Pressed fills, skeletons, tracks | |
| `thumb` | `#FFFFFF` + `shadow-raised` | `#3C3936` | Segmented thumb, slider thumb, switch knob when off | |
| `separator` | `#E2DFDB` | `#34312F` | Hairlines between rows (holds no edge: 1.21:1) | |
| `border` | `#908B86` | `#6E6862` | Input and outlined-control edges | 3.37 / 3.19 on `surface` |
| `text` | `#1A1614` | `#F2F0EC` | Primary text | 16.2 / 15.2 |
| `text-2` | `#6D6660` | `#ADA8A3` | Secondary text, placeholders, waiting steps | ≥ 4.66 on bg/surface/fill / ≥ 6.56 |
| `text-3` | `#908B86` | `#78746E` | **Disabled only** | 3.05 / 3.77 |
| `ink` | `#1A1614` | `#F2F0EC` | The system's prominent fill | |
| `on-ink` | `#FFFFFF` | `#1A1614` | Label on `ink` | 17.9 / 15.8 |
| `scrim` | `rgba(26,22,20,0.32)` | `rgba(0,0,0,0.60)` | Behind sheets and menus | |

Surfaces separate by tone, not outlines. In dark mode higher is lighter: `bg` < `surface` = `sheet` <
`raised` = `sheet-group` < `fill` < `thumb`. In light mode a sheet is canvas-toned and its groups are
white, so a group never sits white on white.

### 2.2 Ember

| Role | Light | Dark | Notes |
|---|---|---|---|
| `ember` | `#C14900` | `#F99549` | Fill of Whim's buttons; the current-step marker and 8 pt dots |
| `on-ember` | `#FFFFFF` | `#1A1614` | 4.98 / 8.06 |
| `ember-text` | `#B14200` | `#F99549` | Text and icons; ≥ 4.75 on bg, surface, fill, `ember-soft` |
| `ember-soft` | `#FDEBDA` | `#3F2313` | Washes: a tile being made, picked "Decide for me" |
| `glow-core` / `glow-mid` / `glow-edge` | `#FFC96A` / `#FF9127` / `#F25914` | same | The light itself. Never carries text, never marks state |

### 2.3 Status (reserved hues)

| Role | Fill light / dark | On fill | Text light / dark | Soft light / dark | Icon |
|---|---|---|---|---|---|
| `positive` | `#1E8347` / `#5BCC80` | `#FFFFFF` / `#1A1614` | `#1A763F` / `#5BCC80` | `#DEF6E3` / `#193521` | `check` |
| `danger` | `#C9292F` / `#F66C6D` | `#FFFFFF` / `#1A1614` | `#C22630` / `#F66C6D` | `#FFE7E5` / `#472020` | `circle-alert` |
| `warning` | `#F3BA25` / `#ECBD3A` | `#1A1614` both | `#8A6000` / `#ECBD3A` | `#FDF2D0` / `#382C0C` | `triangle-alert` |

Danger sits at OKLCH hue 24, ember at 45: red and orange side by side. The danger button is
`danger-text` on `danger-soft`, a capsule, with `trash-2` when it fits. Status hues never stand alone.

### 2.4 App tints

An app has one tint, by name. It colours the tile and is the app's `primary` inside the app. Each tint
has two values: the **light value** (fill, text, marks and tile plate in light mode, white label; ≥ 4.56:1
on `fill`, so it is also the mark colour, no separate mark token) and the **dark value** (fill, text and
marks in dark mode, ink `#1A1614` label).

| Tint | Light | Dark | ΔE2000 to nearest reserved colour, light / dark (normal vision) | White on light | Ink on dark | Dark rim on dark `bg` |
|---|---|---|---|---|---|---|
| `slate` | `#535E6F` | `#B0B8C5` | 30.4 / 30.4 | 6.57 | 8.99 | 5.60 |
| `stone` | `#52443F` | `#B0A19A` | 24.2 / 22.1 | 9.30 | 7.20 | 4.18 |
| `ocean` | `#00445A` | `#A1CCDC` | 34.4 / 30.3 | 10.64 | 10.43 | 4.89 |
| `blue` | `#0852CB` | `#9DC7FE` | 42.5 / 41.6 | 6.82 | 10.30 | 5.71 |
| `indigo` | `#1E20A3` | `#909DEF` | 42.2 / 37.1 | 11.73 | 7.06 | 3.53 |
| `violet` | `#6758B4` | `#C1BBFC` | 36.8 / 34.9 | 5.78 | 10.08 | 6.31 |
| `purple` | `#662A8D` | `#C290F5` | 34.9 / 31.8 | 9.21 | 7.36 | 4.21 |
| `orchid` | `#9D469E` | `#FD91EC` | 29.2 / 26.4 | 5.52 | 8.93 | 6.00 |
| `berry` | `#661258` | `#E4B1DB` | 30.2 / 25.4 | 11.72 | 9.93 | 4.41 |
| `rose` | `#7C3856` | `#BD98AA` | 21.2 / 20.3 | 8.21 | 7.05 | 4.31 |

**Thresholds the proof enforces** (any tint change reruns `palette-check.py`): ≥ 20 ΔE2000 from every
status fill and text form and from ember in normal vision, ≥ 10 under Machado-2009 deutan, protan and
tritan simulation (measured floors 20.3 / 11.6 / 11.1 / 10.0), ≥ 10 tint to tint in normal vision.
Contrast floors: white on light ≥ 5.52; light value on `fill` ≥ 4.56; dark value on dark `fill` ≥ 5.52;
badge text on its soft fill ≥ 4.67 light, ≥ 4.52 dark; ink on dark ≥ 7.05; dark rim on dark `bg` ≥ 3.53.
Tints may collapse into each other under CVD (ocean–berry deutan 1.9); glyph and name tell tiles apart.
What the system claims is that no tint is ever mistaken for a status or for Whim.

- **Soft tint** (badges, selected rows): light value at 12% over the surface in light; dark value at 18%
  over `raised` in dark.
- **On a tint**, checks and knobs take the on-tint colour: white in light, ink in dark.
- **Tile plate**: the light value in both modes. In dark mode a 1.5 px inner rim in mix(dark value, light
  value, 50%). The glyph is white. Increase Contrast adds a 1 px `border` outline (3.07:1 on `bg`).
- **Aliases** (resolve with a build diagnostic, never an error): red→`rose`; pink, magenta→`orchid`;
  grape→`purple`; sky→`blue`; cyan, teal, green, mint, lime→`ocean`; navy→`indigo`; yellow, orange,
  amber, brown, cocoa→`stone`; gray, grey, graphite, black→`slate`.
- **Unknown name** → the tint at (djb2 hash of the app id, the hash `appColor` uses today) mod 10, in table order, with a build
  diagnostic. **An installed hex `tileColor`** maps to the nearest light value by ΔE2000.
- **The host assigns.** The model returns up to three ranked tints; the host takes the first not used by
  any installed app, else the least used (ties: the model's order, then table order). A copy takes the
  tint farthest (ΔE2000 of light values) from the original among the least used. "Customize tile" stores
  a host-side override (tint and glyph) that survives changes.

### 2.5 Inside apps: the theme init frame

The theme stays inert data on `__whimHostInit.theme` (#45). It carries the resolved colour roles plus
`sheet`, `sheet-group`, `thumb`, and: `scheme` (`'light'`|`'dark'`), `tint` (closed name), `fontScale`
(clamped 0.85–2.0, default 1), `reduceMotion` and `increaseContrast` (default false), `platform`
(`'ios'`|`'android'`). `sanitizeTheme` checks each field with a fallback; the SDK reads it once at mount.
A change of appearance, text size or motion setting applies at the app's **next open**; there is no live
theme frame. SDK role names don't change, so installed bundles re-theme without a rebuild:

| SDK role | Resolves to |
|---|---|
| `bg`, `surface`, `border`, `text`, `text-muted` | `bg`, `surface`, `border`, `text`, `text-2` |
| `primary`, `on-primary` | the tint's value for the scheme, and its on-tint colour |
| `positive`, `danger`, `warning` | status fills; text forms when used as text |

Components pick the fill or text form themselves (`<Text color="primary">` gets the readable text
colour, `<Button>` the fill). SDK `Card` and `List` pick `sheet-group` inside a `Modal`.

### 2.6 Colour rules

- One accent hue per control, one hue family per screen region. Ember and a tint may share a screen
  (Ready), never a control.
- No gradients except the ember glow; no tinted shadows except `glow-ember`.
- Selection is ink: picked answers, the segmented thumb's label, the text caret.
- Disabled is `text-3` on `fill`, never lowered opacity over colour.
- The runtime page, the iframe, `Screen` and the opening container all paint `bg`: no flash in either mode.

### 2.7 Type

One family, the system's: SF Pro on iOS, Roboto on Android, `system-ui` in apps (the CSP keeps
`font-src 'none'`). Instrument Sans, IBM Plex Mono and Newsreader are retired, with their bundled files.
Sizes in pt/dp; tracking in em.

| Token | Size / line | Weight | Tracking | Shell use | SDK `Text size` |
|---|---|---|---|---|---|
| `display` | 40 / 44 | 700 | −0.020 | Hero numbers in apps | `display` |
| `largeTitle` | 34 / 40 | 700 | −0.016 | Root titles (Your apps, Settings) | |
| `title1` | 28 / 34 | 700 | −0.012 | Step headlines, Ready, failure, pushed screens | `title` |
| `title2` | 22 / 28 | 700 | −0.008 | Sheet titles | |
| `title3` | 20 / 25 | 600 | −0.004 | Card titles, questions, the quoted hero | `subtitle` |
| `headline` | 17 / 22 | 600 | 0 | Buttons, row titles | |
| `body` | 17 / 24 | 400 | 0 | Prose, plans, inputs | `body` |
| `callout` | 15 / 20 | 400 | +0.004 | Secondary lines, helper text | |
| `footnote` | 13 / 18 | 400 (600 headers) | +0.008 | Meta, section headers | `caption` |
| `caption` | 12 / 16 | 500 | +0.012 | Tile names, badges in the shell | |

- 12 is the shell floor; 13 (SDK `caption`) is the in-app floor. Body and inputs are 17, so what you
  type is the size of what you read.
- Android renders 600 as 700 without variable Roboto; every layout must look right at both. The tracking
  is applied on both platforms; if iOS titles look pinched on device, iOS display tracking drops to 0.
- Hierarchy from size, weight and leading; colour last. Counting and ticking numbers (timers, totals,
  versions, timestamps) use tabular figures (`fontVariant: ['tabular-nums']`, `font-variant-numeric`).
- Section headers: `footnote` 600, sentence case. No uppercase tracked eyebrows.
- **The person's words** are a signature: on Plan, Making, Ready and each History version they are the
  hero, quoted exactly, italic, `title3`, `text`. Inline mentions: body italic in quotes. Never
  paraphrased, never coloured.
- Text scales to 200%. Containers take `minHeight`, never `height`; single-line labels may truncate,
  prose never does. Accessibility layouts in §6.
- No text animates in; streamed text appears as it arrives.

**Whim Syntax, simplified.** Whim's prose is marked by the role a span plays, not grammar. Four
system marks per sentence at most (`yours` exempt); one channel per span; one colour per sentence; marks
only in Whim's prose, never in labels, buttons, headings or a field being typed; every string must read
unambiguously rendered flat. `app`, `measure`, `yours` and `state` are applied by the client lexer;
`chg` and `hedge` come tagged from the summariser, capped by the renderer.

| Class | Channel |
|---|---|
| `app` | The app's tint text colour |
| `yours` | Italic, in quotes, `text` |
| `measure` | Tabular figures |
| `chg` | Weight 600 |
| `state` | Only "ready" (`positive-text`) and "failed" (`danger-text`) |
| `hedge` | `text-2` |

### 2.8 Space and layout

4-pt grid. The SDK keeps its five names on the same grid.

| Step | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|
| pt | 4 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 48 | 64 |
| SDK | `xs` | `sm` | `md` | | `lg` | | `xl` | | | |

| Constant | Value |
|---|---|
| Screen gutter | 20 |
| Card padding | 16 (20 hero) |
| List row | min 52, padding 12 × 16, separator inset 16 (52 with icons) |
| Gaps | 12 inside a group, 24 between groups, 32 between sections, 4 title to subtitle, 20 title block to content |
| Bottom action area | 16 above the buttons, 12 below plus the safe area, ≥ 20 with no inset |
| Button height | 52 large, 44 medium, 34 small visual with a 44 target |
| Touch target | 44 pt iOS, 48 dp Android. Shell: `hitSlop` when the visual is smaller (36 min); adjacent small buttons keep 12 between targets. SDK: real padding (the DOM has no hit-slop) |

**Screen anatomy.** Every non-root screen: a 44 pt header row with the back control (44 × 44, iOS
`chevron-left`, Android `arrow-left`) at the leading edge and up to two icon buttons or one text button
trailing; the title under it (`largeTitle` on roots, `title1` elsewhere) at the gutter with an optional
`callout` `text-2` subtitle; one primary action at the bottom with at most one plain or danger action
under it. **Never two filled buttons on a screen.** Each making-flow page starts its headline at the
same height. When the title scrolls under the row, an inline `headline` title fades in on it (centred on
iOS, after back on Android); content fades out over 16 pt under floating chrome; no hairlines.

### 2.9 Shape

| Token | Radius | Use |
|---|---|---|
| `r-xs` | 6 | Badges, small tags, chart bar tops |
| `r-sm` | 10 | Small controls, checkboxes |
| `r-md` | 14 | Inputs, menu rows, notices |
| `r-lg` | 20 | Cards, list groups, context menu |
| `r-xl` | 28 | Sheet tops |
| `r-full` | 999 | Buttons, pills, switches, the orb |

Buttons are capsules in the shell and apps. Concentric rule: inner radius = outer − inset, never below 6.
iOS draws radii ≥ 10 with `borderCurve: 'continuous'`. Tiles are superellipses (corner 22.5% of side),
one SVG path on both platforms. SDK `sm`/`md`/`lg` radii become 10/14/20.

### 2.10 Materials, depth, elevation

| Level | Light | Dark | What |
|---|---|---|---|
| 0 | `bg` | `bg` | Canvas |
| 1 | `surface` | `surface` | Cards, groups, inputs on the canvas |
| 2 | `sheet` + `shadow-raised` | `sheet` + top highlight `rgba(255,255,255,0.06)` 1 px + dark shadow | Content sheets |
| 2a | `sheet-group` | `sheet-group` | Groups inside a sheet |
| 3 | `raised` + `shadow-raised` | `raised` + highlight + dark shadow | Menus, toasts, popovers |
| 4 | `raised` + `shadow-floating` | as 3, stronger shadow | The orb, the composer |

| Shadow | Light | Dark |
|---|---|---|
| `shadow-raised` | `0 1px 2px rgba(26,22,20,0.08), 0 8px 24px rgba(26,22,20,0.12)` | `0 1px 2px rgba(0,0,0,0.40), 0 8px 24px rgba(0,0,0,0.50)` |
| `shadow-floating` | `0 2px 6px rgba(26,22,20,0.12), 0 12px 32px rgba(26,22,20,0.16)` | `0 2px 6px rgba(0,0,0,0.50), 0 12px 32px rgba(0,0,0,0.60)` |
| `glow-ember` | `0 0 0 1px rgba(255,145,39,0.35), 0 6px 28px rgba(255,145,39,0.45)` | same |

Shadows use RN `boxShadow` (works on both platforms; `shadow*` props are iOS-only) and the same string in
CSS. A modal task dims behind with `scrim`; a non-blocking panel doesn't. **No blur in v1** (another
Android native dependency, frame cost in mid-range WebViews; the solid surface is Reduce Transparency's
own answer); if glass comes later, level 3 only.

## 3. Iconography, tiles and the mark

### 3.1 Icons

- One vendored subset of Lucide (`lucide-static@0.460.0`, ISC, attribution kept), stored as path data,
  drawn with `react-native-svg` in the shell and inline `<svg>` in apps (DOM, so no CSP change).
- 24 grid, round caps and joins; rendered stroke 1.5 px at 16–20 pt, 1.75 px at 24–28 pt. Sizes 16
  (inline), 20 (rows, buttons), 24 (headers), 28 (empty states). Icons take their role's text colour.
- Every icon has a label beside it or an accessibility label. Icon-only only for back, close, more, add,
  settings and send.
- Never emoji, typed symbols (`✓ ⚙︎ ⌂`), box-border chevrons, or a sparkle meaning "AI".

**Two lists ship.** The **glyph set** (147, below) is what the generator may name for a tile or `Icon`.
The **chrome set** is what shell and SDK components draw: `chevron-left` `chevron-right` `chevron-down`
`arrow-left` `arrow-up` `x` `check` `plus` `minus` `ellipsis` `settings` `search` `copy` `share`
`external-link` `info` `circle-alert` `triangle-alert` `circle-check`, plus `circle` (fallback only).
`Icon name` resolves against both; a tile glyph resolves against the glyph set only.

| Group | Glyphs |
|---|---|
| Time | `timer` `alarm-clock` `hourglass` `clock` `watch` `calendar` `calendar-check` `calendar-days` |
| Food and drink | `coffee` `cup-soda` `glass-water` `droplet` `utensils` `chef-hat` `cookie` `apple` `carrot` `pizza` `wheat` `egg` `salad` `croissant` |
| Nature and weather | `leaf` `sprout` `flower` `flower-2` `trees` `tree-pine` `sun` `moon` `cloud` `cloud-rain` `snowflake` `thermometer` `wind` `umbrella` `flame` `zap` `waves` `mountain` |
| Body and health | `heart` `heart-pulse` `activity` `dumbbell` `bike` `footprints` `pill` `stethoscope` `bed` `brain` `smile` `baby` |
| Animals | `dog` `cat` `paw-print` `fish` `bird` `bug` |
| Home | `house` `sofa` `lamp` `key` `lock` `plug` `battery` `bell` `recycle` `trash-2` `shirt` `glasses` `scissors` |
| Money and shopping | `shopping-cart` `shopping-bag` `gift` `tag` `receipt` `wallet` `piggy-bank` `coins` `banknote` `credit-card` `calculator` `percent` |
| Goals and lists | `chart-column` `chart-line` `chart-pie` `trending-up` `target` `trophy` `medal` `flag` `star` `list-checks` `list-todo` `square-check` `clipboard-list` |
| Play and make | `dice-5` `dices` `puzzle` `gamepad-2` `music` `headphones` `mic` `guitar` `piano` `film` `camera` `image` `palette` `brush` |
| Learn and write | `pencil` `pen-tool` `book` `book-open` `notebook-pen` `graduation-cap` `languages` `lightbulb` `sticky-note` `file-text` `folder` `inbox` |
| People | `users` `user` `hand-heart` `handshake` `mail` `message-circle` `phone` `megaphone` |
| Places and travel | `map` `map-pin` `compass` `plane` `car` `bus` `train-front` `tent` `anchor` `globe` |
| Tools | `ruler` `scale` `wrench` `hammer` `repeat` `shuffle` `hash` |

Left out on purpose: `sparkles` and wands, brand marks, country flags, weapons, culture-bound meanings.

**Forgiving names.** An alias map resolves legacy Lucide names and synonyms with a diagnostic
(`home`→`house`, `check-square`→`square-check`, `alert-circle`→`circle-alert`, `bar-chart-3`→
`chart-column`, `drop`→`droplet`, `cart`→`shopping-cart`, `checklist`→`list-checks`, `trash`→`trash-2`;
the full map ships with the set). An unknown name falls back deterministically: the keyword table on the
name's parts, then on the app's name, else `circle`. Never blank, never a crash. The eval tracks the
invalid-icon rate.

| Words (whole, lower-cased) | Glyph | Words | Glyph |
|---|---|---|---|
| timer, countdown, pomodoro | `timer` | water, drink, hydrat* | `glass-water` |
| alarm, wake | `alarm-clock` | coffee, espresso, pour-over | `coffee` |
| habit, streak, routine | `calendar-check` | tip, bill, split | `receipt` |
| todo, task, checklist | `list-checks` | budget, spend*, expense | `wallet` |
| dice, roll | `dice-5` | coin, flip | `coins` |
| plant, garden | `sprout` | recipe, cook, meal | `chef-hat` |
| workout, gym, reps | `dumbbell` | run, walk, steps | `footprints` |
| sleep, nap | `bed` | mood, feel* | `smile` |
| book, read* | `book-open` | note, journal, log | `notebook-pen` |
| score, game | `trophy` | pet, dog | `paw-print` |

### 3.2 Tiles

A tile is a squircle plate in the app's tint (light value, both modes) with one white glyph, both named
in `defineApp({ tint: ['stone','rose','slate'], icon: 'timer', … })`. Both are static literals the build
extracts the way it extracts `capabilities`. `tileColor` is deprecated (§7.2).

| Part | Spec |
|---|---|
| Grid | 4 columns, tile 64 on every width; column = (screen − 40) / 4; 20 between a label and the next tile. From 135% text 3 columns; from 200% a list of rows with the 40 tile and the full name |
| Sizes | 24 inline, 40 sheets and headers, 64 grid, 96 hero (Ready, History). No others |
| Glyph | 50% of the tile, centred, white, stroke 2 on the 24 grid |
| Label | `caption` 12/16 500, `text`, centred, two lines, 4 pt side padding, then ellipsis; names ≤ 24 characters; the full name heads the menu and is the a11y label |
| State line | Under the label, only for state, `caption` in the role's text colour |
| Badge | 18 pt at the top-trailing corner (failed, change failed) |
| Touch | The whole cell, at least 64 × 84 |

| State | Tile | State line | Tap | Menu |
|---|---|---|---|---|
| Ready | Tint + glyph | none ("Example" on seeds, #42) | Opens the app (M2) | Open, Change it, History, Make a copy, Customize tile, Share link, then Delete |
| Being made | `ember-soft` squircle, 24 ember with the stream | "Making…" `ember-text` | Making page | Details, Stop |
| Queued | Same, ember still and dim | "Waiting…" `text-2` | Making page | Details, Stop |
| Failed | `fill` squircle, ember out, badge `circle-alert` `danger` | "Didn't work" `danger-text` | Failure page | What happened, Try again, Discard |
| Stopped | `fill` squircle, ember out | "Stopped" `text-2` | Failure page, Try again first | Try again, Discard |
| Older than a day (failed/stopped) | One `fill` squircle, ember out, end of grid | "2 didn't work" `text-2` | A list of them | Discard all |
| Needs update | `fill` squircle, ember out | "Needs update" `warning-text` | Update screen | Update Whim, Discard |
| Changing | The app's tile with a 2 pt `ember` superellipse ring 3 pt outside, glowing with the stream | "Changing…" `ember-text` | Opens the app | Details, Stop the change |
| Change failed | The app's tile with the badge | "Change didn't work" `danger-text` | Opens the app | What happened, Try again, Discard the change |
| Copy | Tint farthest from the original | "Copy" `text-2` | Opens the app | As Ready |

A tile being made is named by the plan's proposed name, else the description's first three words without
a leading "A", "An" or "The". The glyph is decorative to screen readers; the label is "Pour Timer,
making" with the hint "Opens the app" or "Shows progress". Live tiles are not in v1.

### 3.3 The ember

Whim's mark is a light, not a character: one closed flame silhouette on a 48 grid, a round base and a
tip that rises and curls slightly up, no face, no eyes, no name. Fill: radial `glow-core` (upper centre)
→ `glow-mid` → `glow-edge`, with `glow-ember` around it.

| State | When | Look |
|---|---|---|
| Working | The stream runs | Intensity follows the stream (§4.6) |
| Stuck | No bytes for 40 s | 35%, still |
| Out | Failure, failed or stopped tile | 1.5 pt `text-2` outline of the silhouette, no fill, no glow |

Done is one `spark` flare. Sizes 24, 48, 96, 128 (128 drops to 64 from 135% text); the orb carries a
20 pt mark. It appears on the making page (128), the plan wait (48), Ready and failure (96), the empty
home (128), inline status (24), the orb, the app icon and the launch screen; never inside an app's
content, in settings or legal, as decoration, with a speech bubble or a name. **Ambient light**, the
second signature: a soft radial glow behind the making header and under the composer, same signal,
lower opacity, absent when nothing is made. **App icon**: the ember on warm dark `#1A1614`→`#2A2420`,
iOS dark and tinted variants, Android adaptive icon with the silhouette as the monochrome layer. Before
it becomes the icon it passes a silhouette test: grey at 24 pt reads as a flame, not a tadpole.

## 4. Motion

### 4.1 Stack

- **Shell:** `react-native-reanimated@4.6.0` + `react-native-worklets@0.12.2` (exact pins),
  `react-native-gesture-handler` (sheet and orb drags), `react-native-svg`, and `react-native-screens`'
  native stack for Settings, Advanced, AI features, History and Report. RN `Animated`,
  `LayoutAnimation` and `useNativeDriver` are retired from `src/host/` (a static check enforces it).
  No Lottie, Rive, Skia or blur.
- **Apps:** springs are sampled at build time at 60 Hz into CSS `linear()` easings with their settled
  durations; the SDK checks `CSS.supports('animation-timing-function', 'linear(0, 1)')` once and falls
  back to the nearest cubic-bezier (iOS floor 15.1 predates `linear()`). WAAPI plays fire-and-forget
  motion only. Anything retargetable (switch knob, segment and slider thumbs, sheet drag) runs a small
  `requestAnimationFrame` spring that keeps its velocity.
- Every spring is a named constant in the token module; literal spring configs are rejected by a check.

### 4.2 Springs and timings

Physics mode, mass 1: `stiffness = (2π/response)²`, `damping = 4π·ζ/response`. Never mix with
Reanimated's `duration`/`dampingRatio` mode.

| Spring | Response | ζ | Stiffness | Damping | 95% / settled | Use |
|---|---|---|---|---|---|---|
| `instant` | 0.12 | 1.00 | 2741.6 | 104.72 | 91 / 215 ms | Press-in |
| `snappy` | 0.28 | 1.00 | 503.6 | 44.88 | 212 / 451 ms | Press-out, toggles, selection, checkmarks |
| `smooth` | 0.40 | 1.00 | 246.7 | 31.42 | 302 / 616 ms | Push/pop, tapped sheets, step changes, reflow, closing morphs |
| `fling` | 0.35 | 0.80 | 322.3 | 28.72 | 189 / 521 ms | Anything released from a drag, with its velocity |
| `morph` | 0.50 | 0.90 | 157.9 | 22.62 | 320 / 657 ms | Opening container transforms |
| `spark` | 0.55 | 0.55 | 130.5 | 12.57 | 209 / 1145 ms, 12.6% overshoot | Rare celebrations |

| Timing | Value | Use |
|---|---|---|
| `fade-in` / `fade-out` | 160 / 120 ms, `cubic-bezier(0.23, 1, 0.32, 1)` | Content swaps, reduced-motion replacements |
| `color` | 150 ms, `cubic-bezier(0.25, 0.1, 0.25, 1)` | Colour and tint changes |
| `stagger` | 30 ms per item, first 6, the rest together | First appearance of a set only |
| `breathe` | 1900 ms cycle, opacity 0.34–0.72, after 300 ms | Skeletons for local loads |

### 4.3 Rules

1. **Earned by frequency.** Things touched often are fast and critically damped; bounce only for rare
   moments.
2. **Start from what's on screen.** Read the presentation value, retarget the running spring with its
   velocity. Never restart from a stored value; never disable input while something moves.
3. **Same path out as in**, faster out: a morph opens with `morph`, closes with `smooth`.
4. **No JS-driven layout per frame.** Transform and opacity by default; shell reflow uses Reanimated
   layout transitions; one leaf view's width, height and radius may animate on the UI thread (M2). The
   SDK uses FLIP. No non-uniform scale on a rounded shape.
5. **Press:** scale 0.97 (buttons, rows), 0.96 (tiles, cards, chips), 0.92 (icon buttons) on touch-down
   with `instant`, release with `snappy`; 10 pt off the control cancels, back re-presses.
6. **Drags** track 1:1 after 10 pt slop. Release projects `current + (v/1000)·0.998/(1−0.998)`, snaps to
   the nearest target, hands velocity to `fling`; past a bound rubber-band with 0.55. **A gesture commits
   when its projected end passes the threshold and the release velocity doesn't point back.** Position
   alone never commits.
7. **Haptics land on the frame they confirm.** SDK motion carries no haptics.
8. **Text never animates in.** Back on shell screens is the native stack's; Whim never redraws it.

### 4.4 Moments

Numbers are stable; R-numbers are the animation research's (`docs/research/animation-options-2026-09.md`
§5). "Reduced" is what Reduce Motion shows.

| # | Trigger | What moves | Spring | Interrupt | Reduced |
|---|---|---|---|---|---|
| M1 (R2) Press | Touch-down on any pressable | Scale per §4.3 rule 5 | `instant` / `snappy` | Drag off cancels | Opacity 0.7 over 100 ms |
| M15 (R12) Selection | Chip, switch, segment, checkbox, stepper | Chip fill (`color`), knob/thumb x, check stroke drawn over 160 ms, stepper digit rolls 6 px | `snappy` (rAF spring in apps) | New value retargets with velocity | Instant state, colour fade kept |
| M2 (R3) Open an app | Tap a ready tile | A `bg` container grows from the tile rect to the screen (width, height, radius on the UI thread, one leaf view); the tint stays a tile-sized plate with its glyph and fades as the app paints. The pooled warm WebView stays hidden until the opening signal (§7.4), cap 600 ms, then fades in over 160 ms. "Opening…" only after 1.5 s | `morph` | Back reverses from the current frame | 160 ms cross-fade |
| M3 (R4) Close an app | Orb → "Back to your apps"; Android back at depth 0 | The reverse into the tile; not finger-tracked | `smooth` | Reopening retargets | Cross-fade |
| M20 (R9) Honest light | Stream activity | Glow and flicker on the making mark, ambient lights, ghost tile, changing ring, orb (§4.6) | Smoothing spring 0.6 s | Continuous | Still intensity per state, cross-faded |
| M6 Composer → Describe | Tap the composer | The capsule grows into the sheet; the placeholder stays in place; the keyboard rises on its own curve | `morph` | Swipe down returns into the bar | Cross-fade |
| M7 (R10) Describe → Plan | Continue | Plan pushes in from the trailing edge; the description travels to the top as the quote | `smooth` | Back reverses | Cross-fade |
| M8 (R7) Plan arrives | Questions (~1.8 s), then rows (~2.3 s more) | Skeletons swap with `fade-in`; rows rise 8 px with `stagger` the first time; answered questions collapse when scrolled past | `fade-in` + `smooth` | Reopen retargets | Cross-fade |
| M25 Edit a plan row | Tap a row | The row grows into a text area; Save and Cancel fade in | `smooth` | Cancel reverses | Instant |
| M9 Make it | Tap Make it | The 48 ember travels and scales to the making 128; plan fades out; words and steps fade in; the marker moves to a repair row with `snappy` | `morph` | Closing leaves for home (M5) | Cross-fade |
| M5 Leave it running | Close X, back, swipe down, scrim | The sheet shrinks into its ghost tile, ember first | `smooth` | Tapping the tile reverses | Cross-fade |
| M10 Ready | Delivery with the sheet open | Ember flares (1 → 1.18 → 1) and settles into the 96 tile rising 0.6 → 1; name, words, buttons fade in 80 ms apart | `spark` | Done jumps to the end | Cross-fade, no flare |
| M4 (R1) Ghost → tile | Delivery with the grid visible | Glow flares; a circle mask fills the squircle with the tint from the centre; glyph fades in from 0.9 | `morph`, glow `spark` | Opening finishes it | Cross-fade |
| M22 (R11) Making fails | Terminal failure | Glow fades (`fade-out`), outline remains; content fades in; no shake | `fade-out` + `fade-in` | | Cross-fade |
| M11 (R6) Sheet | Present, dismiss, drag | y from off-screen; scrim follows position; release per rule 6, dismiss past half height | Tap `smooth`, release `fling` | Grab any time | Cross-fade; drag still tracks |
| M21 (R6) Orb → Whim sheet | Tap the orb | Sheet rises under the orb; orb dims to 0.6 | `smooth` | Tap orb or drag down | Cross-fade |
| M12 Context menu | 350 ms long-press | Tile lifts to 1.06 + `shadow-floating`, scrim, menu grows from the tile edge 0.92 → 1; closes `fade-out` + 0.96 | `snappy` lift, `smooth` menu | Release before 350 ms = tap; 10 pt cancels; a second step swaps rows in 120 ms | Menu cross-fades, no lift |
| M13 Push and pop | Settings, Advanced, AI features, History, Report; back | The native stack's own transition, iOS edge and content-area swipe, Android predictive back | Platform | Platform | Platform |
| M16 Orb corner | Drag the orb | 1:1 after 10 pt; projects to bottom-trailing or bottom-leading; remembered per app | `fling` | Grab any time | Tracks, settles by cross-fade |
| M14 Toast | Show, auto-dismiss, swipe | Rises 16 px with a fade; swipe down tracks | `smooth`; swipe `fling` | A new toast replaces in place | Cross-fade |
| M26 History row | Tap a version | Expands; rows below move; actions fade in | `smooth` layout | Tap again collapses | Instant |
| M17 (R5) Grid appears | First launch, back from onboarding | Tiles rise 8 px and fade, `stagger` | `smooth` | Touch finishes it | At once |
| M18 Delete an app | Delete in the menu | Tile to 0.8 and fades, neighbours reflow; Undo plays it back | `smooth` reflow | Undo retargets | Removed, neighbours cross-fade |
| M19 (R8) Skeleton | Local load past 300 ms | `breathe` | | Content replaces with `fade-in` | Static 0.6 |
| M27 Launch → home | Cold start | Native launch screen holds until Home's first frame, then fades 160 ms (iOS: an overlay copying the storyboard; Android 12+: the system splash) | `fade-in` | | Same |
| M23 Keyboard | Keyboard shows/hides | Sheets and bottom actions follow the keyboard frame by frame (Reanimated keyboard tracking, both platforms); the orb fades with the host's keyboard signal | Keyboard curve | | Same |
| M24 (R12) In apps | `nav.navigate`/`back`, `Modal`, keyed `List` rows, progress, `toast()`, controls | Push from trailing (previous −30%, 0.12 dim) on iOS, shared X axis on Android; Modal as M11; rows enter rising 8 px, leave with `fade-out` then FLIP close; progress fill | `smooth` / `fling` | Retargetable via rAF | Cross-fade / instant |

**What stays still:** streamed prose, skeleton shimmer, shaking on error, charts drawing in, parallax,
jiggle reordering, confetti, the orb shrinking on scroll, animated light/dark switches, an idle ember.

### 4.5 Reduce Motion

The OS setting only; no in-app switch. In apps it arrives as `reduceMotion` at the next open, and each
component honours it. Push, pop, sheets, morphs and flings become a 160 ms cross-fade in place; press
scale becomes opacity 0.7 over 100 ms; stagger and `spark` go; the ember is a still intensity per state;
skeletons sit at 0.6; drags still track the finger and settle with a cross-fade.

### 4.6 Honest light

- Activity `a = clamp(tokensPerSecond / 40, 0, 1)` from the stream's own signals, reasoning tokens
  included; the 40 is calibrated against real runs.
- Intensity `I = 0.55 + 0.45·ã`, `ã` = `a` smoothed by a critically damped spring, response 0.6 s.
- Flicker amplitude `0.06·ã`, only while a token arrived in the last 500 ms; timing from token
  arrivals, never a timer.
- Stuck after 40 s with no bytes (`STALL_MS`): `I` eases to 0.35 over 1.5 s and holds still. Out: fades
  over `fade-out`, the outline stays. Nothing loops on a clock.

### 4.7 How motion is checked

Each moment gets a 0.25× recording on a mid-range Android device and an iPhone, compared with the
mockup's motion lab (`mockups/index.html#motion`). Reduce Motion is tested as a pair: off produces
running animations, on produces only the reduced version (`getAnimations()` in apps). Opening an app is
measured tap-to-first-paint with and without the warm WebView; the animation may not regress it.

## 5. Haptics

The shell plays the platforms' engines through the in-repo TurboModule `WhimHaptics` (the `WhimTone`
pattern): `UIImpactFeedbackGenerator` / `UISelectionFeedbackGenerator` /
`UINotificationFeedbackGenerator` prepared on touch-down on iOS; `View.performHapticFeedback` on Android
(follows the touch-feedback setting, no permission). RN `Vibration` is retired.

| Moment | iOS | Android (API 34 constant, fallback) |
|---|---|---|
| Selection moves (answer chip, segment, picker detent) | selection | `SEGMENT_TICK`, `CLOCK_TICK` |
| Switch toggles | impact light | `TOGGLE_ON`/`TOGGLE_OFF`, `CONTEXT_CLICK` |
| Long-press opens a menu | impact medium | `LONG_PRESS` |
| A drag crosses its commit point | impact rigid 0.6 | `GESTURE_THRESHOLD_ACTIVATE`, `CONTEXT_CLICK` |
| Work handed to Whim (Make it, Make the change, Try again) | impact medium | `CONFIRM` (API 30), `VIRTUAL_KEY` |
| App ready; version restored; copy made | notification success | `CONFIRM` |
| Making failed | notification error | `REJECT` (API 30), `LONG_PRESS` |
| App deleted, attempt discarded, confirm sheet's consequential choice | notification warning | `REJECT` |

Never on plain taps, navigation, scrolling, typing, opening an app or a tapped sheet.

**Apps** get haptics only through `cues.haptic(...)`, manifest-gated as today (#43), same closed set,
now played by `WhimHaptics`: `tap` = impact light (`EFFECT_CLICK`), `double` = two light impacts 80 ms
apart (`EFFECT_DOUBLE_CLICK`), `heavy` = impact heavy (`EFFECT_HEAVY_CLICK`). The host caps them at 10
per second with a burst of 3; extra calls are dropped, not queued. SDK controls emit none.

**Sound:** none in the shell. App cue sounds (`tick`, `chime`, `alarm`) stay.

## 6. Accessibility

- **Contrast floors:** text ≥ 4.5:1 (every text role and tint text form passes, §2); control edges and
  glyphs ≥ 3:1 (`border`, plates, rims); `text-3` is for disabled only, never content; the glow never
  carries text or state.
- **Selection never by colour alone:** selected chips carry `check`; status badges carry their icon;
  danger is a capsule shape, never a fill.
- **Dynamic Type** to 200%, shell and apps (apps via `fontScale`; the runtime page drops
  `maximum-scale=1` so pinch zoom works; inputs are 17 px so iOS doesn't zoom on focus). From **135%**:
  Home 3 columns, the 128 ember drops to 64, paired buttons stack, ring labels move under the ring, SDK
  rows wrap and stack. From **200%**: Home becomes a list of 40 tiles with full names.
- **Increase Contrast:** level-1 and 2a surfaces and tile plates get a 1 px `border` outline; `text-2`
  becomes `text`. Apps get it as `increaseContrast`.
- **Reduce Motion** per §4.5. **Reduce Transparency:** nothing to do, there is no blur.
- **Targets** per §2.8. **Screen readers:** every sheet is modal (focus to its title, the rest hidden,
  close reads "Close"); each menu row and each sheet row is its own element (never one element for a whole
  menu); toasts announce politely and pause while a screen reader runs, and every Undo stays reachable
  from History; the orb is "Whim menu" plus its state, with the action "Move to the other corner".
- **Keyboard:** a focused field always scrolls to sit 16 pt above the keyboard, in screens and sheets;
  sheets lift on the keyboard's own curve; Escape closes a sheet on a hardware keyboard.

## 7. Components

### 7.1 Shell (React Native)

**Button.** Capsule, optional 20 pt leading icon, label `headline` (small: `callout` 600). Pressed: M1,
filled variants darken 8%. Disabled: `fill` + `text-3`. Busy: the label becomes the busy words
("Sending…") and taps are ignored; no bare spinner. Focus: 2 pt `text` ring 2 pt outside. Labels wrap to
two lines (`minHeight`); paired buttons stack from 135%. Busy and disabled are announced. Replaces
`PrimaryAction` and every inline button treatment.

| Variant | Fill / label | Use |
|---|---|---|
| `ember` | `ember` / `on-ember` | Hands work to Whim |
| `ink` | `ink` / `on-ink` | The system's main action |
| `tint` | app light/dark value / on-tint | Enters an app ("Open it") |
| `secondary` | `fill` / `text` | |
| `plain` | none / `text` 600 | Secondary text action |
| `plain-ember` | none / `ember-text` | A secondary action asking Whim for something |
| `danger` | `danger-soft` / `danger-text`, icon | Never a solid fill |

| Component | Spec |
|---|---|
| Icon button | 44 × 44; `plain` (icon in `text`) or `filled` (36 pt `fill` circle); icon 24 in headers, 20 elsewhere; press 0.92; always labelled. The back control follows §2.8; on pushed screens the native stack's header supplies it |
| Sheet | The one presentation container (replaces `SheetModal`, `ConfirmSheet`'s modal, Home's `ActionSheet`, `RunDetailsSheet`, the orb menu). `sheet` surface, top `r-xl`, `shadow-raised` (dark: top highlight); contents on `sheet-group`. Grabber 36 × 5 `fill-strong`, 6 pt from the top, always. Optional `title2` title 12 pt under it; a close `x` icon button trailing on both platforms, nothing else beside it. Detents `fit` (to 92%) and `large` (92%; the making flow). Scrim follows position. Drag from grabber, header or a scroll view at its top (M11). Lifts on the keyboard's curve; its scroll area pads by the keyboard height. Closes by scrim, close, Android back, Escape or drag; the making sheet keeps its draft. Modal to screen readers |
| Confirm sheet | A `fit` sheet for exactly two things: make a new phone ID, use your own server. `title2` ("Make a new ID?"), `body` `text-2` saying exactly what changes, the safe choice as a large `ink` button ("Keep this ID"), the consequential one as `danger` under it (warning haptic). Delete, use-this-version and copy happen at once with Undo, so the native delete `Alert` goes |
| Context menu | 350 ms long-press (M12). Card `raised`, `r-lg`, `shadow-raised`, width 248, under the tile (above when no room), 8 pt away, never over the names of the row it opens from; headed by the app's full name (`footnote` 600 `text-2`). Rows 48 pt, 20 pt icon + `body` in `text`; a separator, then the destructive row in `danger-text`. A row may swap the card to a second step with a back row. Announced as a menu; each row its own button |
| Toast | Capsule, `raised`, `shadow-floating`, max width 360, min height 48, padding 12 × 16, 12 pt above whatever floats (composer, orb, safe area). `callout`; an optional `headline` text action (`text`, or `ember-text` when it asks Whim). 4 s, 6 s with an action, 10 s for delete Undo; pauses while touched and under a screen reader; swipe down dismisses (M14). Announced politely |
| Chip | Capsule 36 high (44 target), 14 pt side padding, `callout` 500. Unselected `fill`/`text`; selected `ink`/`on-ink` with a 16 pt `check`, single and multi alike. "Decide for me": unselected `fill` + `ember-text`, selected `ember-soft` + `ember-text` + `check`; selected by default on every question; exclusive in multi-select. Suggestion chips: `fill`/`text`, no selected state. Press 0.96; fill changes with `color`; selection haptic. Replaces four pill styles |
| Text field / area | `surface`, 1 px `border`, `r-md`, padding 12 × 14 (area 14 × 16, 3 lines growing to 8, then scrolls), text `body` 17. Label `footnote` 600 `text-2` 6 pt above; placeholder `text-2`. Focus: 2 pt `text` border, ink caret. Error: 2 pt `danger`, helper in `danger-text` with an icon. Clear button on non-empty single-line fields; the Whim sheet's send area has a 32 pt `ember` `arrow-up` button inside its trailing edge |
| Grouped list | Group `surface` (canvas) or `sheet-group` (sheet), `r-lg`, no border, separators per §2.8. Row min 52, padding 12 × 16, optional 20 pt `text-2` icon, title `body`, subtitle `footnote` `text-2`; trailing value (`callout` `text-2`), `chevron-right`, switch, `external-link` or copy button; pressed `fill`; destructive title `danger-text`. Section header `footnote` 600 `text-2` 8 pt above, footer `footnote` `text-2` 8 pt under. Shell switches are the platform's own, on-track `ink` |
| App tile | Props `app`, `state`, `size` (`inline` 24, `menu` 40, `grid` 64, `hero` 96), `activity` (0–1). Exports its geometry so the home skeleton draws the same cells. §3.2 |
| Composer bar | Capsule 52 high, `raised` + `shadow-floating`, full width inside the gutters, 12 pt above the bottom safe area; 24 ember leading, then "Make an app…" (`body` `text-2`) or "Continue "A timer for my…"" when a draft waits. One button, not a field; morphs into Describe (M6). Ambient light under it while something is made |
| Ember, AmbientLight | `size`, `state`, `activity` per §3.3; hidden from screen readers (the status line carries the label) |
| Orb | 44 pt opaque `raised` disc, `shadow-floating`, 20 pt ember, 52 pt target, 16 pt from the edge and the bottom safe area. Bottom-trailing (default) or bottom-leading, both inside the existing `chromeInsetBottom` that SDK `Screen` and `Modal`'s action row pad by; drag M16, remembered per app. Hides while the keyboard is up, on the host's own keyboard signal; never hides or moves because an app said so. States: rest; making a change (ember follows the stream); change failed (8 pt `danger` dot); new version ready or an app finished (8 pt `ember` dot after one flare). Tap opens the Whim sheet (M21) |
| Status line | (was `WorkingLine`) 8 pt `ember` dot or the 24 ember, driven by the stream; the phrase in `callout` `text-2`; elapsed time tabular. Stuck: the dot dims to 35% and stops |
| Step list | Four steps, 20 pt icon + `body`, 12 pt apart. Done: `circle-check` `text`, label `text-2`. Current: 8 pt `ember` dot in a 20 pt `ember` ring, label `text` 600, elapsed time trailing. Waiting: empty 20 pt `text-2` ring, label `text-2`. On a `repair` event a "Fixing a problem · try 2 of 3" row appears under the current step and the marker moves down to it (`snappy`), never back up |
| Question row | The question in `headline`, optional `footnote` hint ("Pick any that fit"), options, "Decide for me", then "Other" when allowed. Every option ≤ 20 characters: wrapping chips; otherwise every option is a full-width radio (single) or checkbox (multi) row on `sheet-group`, wrapping. Answered and scrolled past: one line ("Brewer · V60") with a chevron; tap reopens |
| Plan row | `sheet-group` row: label `footnote` 600 `text-2` (written for the app, ≤ 3 words, sentence case) over `body` text (≤ 2 sentences, ~140 characters), 16 pt `pencil` trailing. Tap edits in place (M25) with small Save (`ink`) and Cancel (`plain`) at full targets. An edited row shows the person's words and "Edited" instead of the pencil |
| Notice | `r-md`, `fill` (neutral) or `danger-soft`, 20 pt `info` or `circle-alert`, `callout`, optional tabular retry countdown. Replaces `ServiceNotice` |
| Timeline row (History) | 2 pt `separator` rail at x = 27, a 10 pt dot per version (current: `ink` with a 3 pt `bg` ring), stopping at v1. Your words as the hero; Whim's summary (`callout` `text-2`, prose renderer); meta `footnote` `text-2` tabular ("v4 · 2 days ago"); a neutral kind chip (`caption` 500 `text-2` on `fill`, 12 pt icon: `plus` Added, `pencil` Changed, `minus` Removed, `palette` Look, `wrench` Fixed, `flag` Start); `Current` badge (`ink`). Tap expands (M26): past versions get "Use this version" (`secondary`, medium) and "Make a copy from here" (`plain`), the current one "Change it" (`ember`, medium). If going back would hide saved data: "Some saved data won't show in this version. It isn't deleted and comes back when you return." |
| Skeleton | `fill-strong` blocks with the exact geometry and count of what they stand in for (exported constants); `breathe` after 300 ms; nothing for an empty result. A skeleton is a promise |

### 7.2 SDK (inside apps)

Every component renders from the theme init frame (§2.5), takes no style, class, hex or pixel value, and
works with no optional props. Type tokens multiply by `fontScale`; layouts grow with it. Controls reach
44 (iOS) / 48 (Android) with real padding and set `user-select: none` and
`-webkit-tap-highlight-color: transparent`; text stays selectable. The runtime page sets
`color-scheme: light dark`; `Screen` sets `overscroll-behavior: none`; `Modal` content `contain`.

| Change | What |
|---|---|
| Add | `Icon`, `Stepper`, `DateInput`, `Picker`, `toast(text)`, `Screen` `title`/`action`, `icon` on `Button`/`ListItem`/`EmptyState`, `ProgressBar` `variant: 'ring'` + `label`, `defineApp` `tint`/`icon`, `List` `items`/`keyBy`/`renderItem` |
| Change | `Text`/`Icon` `color` narrowed to `text`, `text-muted`, `primary`, `positive`, `danger`, `warning`; `Row` defaults `align="center"`, `justify="start"`; every size, colour, radius and motion |
| Deprecate (kept working, gone from the reference) | `Heading` (alias of `Text size="title"`); `Button`/`Card` `radius` (accepted, ignored); `defineApp` `tileColor` (nearest light value by ΔE2000) |
| Rejected | `Reveal`, `useMotion`, `Morph`, `useReducedMotion`, `TabBar`, `Image`, confetti, `Canvas` |

No export is removed; every installed bundle keeps working.

| Component | Spec |
|---|---|
| `Screen` | Props `title?`, `action?: { icon; label; onPress }`, `padding = 'lg'`. `bg`, 17 px system font. With `title`: a header row (back control when the app's stack is deeper than one, calling `nav.back()`; `action` as a trailing icon button) and `title1` under it. Bottom padding adds `chromeInsetBottom`. Push/pop M24. No edge swipe inside apps (#67); Android back pops via the nav-depth seam and closes at depth 0 |
| `Stack`, `Row`, `Grid`, `Spacer`, `Divider` | Gaps default `md` (12); `Row` `align="center"`, `justify="start"`, wraps; `Divider` a `separator` hairline |
| `Text` | `size`: `caption` 13/18, `body` 17/24 (default), `subtitle` 20/25 600, `title` 28/34 700, `display` 40/44 700 (tabular by default); `color` per the narrowed set, each its readable text form; `weight` `regular`/`medium`/`semibold`/`bold`; `align` `start`/`center`/`end` |
| `Button` | `label`, `onPress`, `variant: 'primary' \| 'secondary' \| 'ghost' \| 'danger' = 'primary'`, `icon?`, `disabled?`. Capsule 52, label 17 600. `primary` tint fill + on-tint; `secondary` `fill` + `text`; `ghost` no fill, tint text; `danger` `danger-text` on `danger-soft` (never a fill). Disabled `fill` + `text-3`. Two in a row stack from 135%. Native `<button>` |
| `TextInput`, `NumberInput` | Field anatomy of §7.1 at 17 px; focus ring in the tint; ink caret; `NumberInput` `inputmode="decimal"`, tabular |
| `Stepper` (new) | `label?`, `value`, `onChange`, `min = 0`, `max?`, `step = 1`. Label left; a `fill` capsule group with `minus`, tabular `subtitle` value, `plus`, buttons 44 × 36 visual in 44/48 boxes. Hold repeats after 400 ms at 8/s; bounds disable. Digit roll M15. Role `spinbutton`, buttons "Decrease"/"Increase" |
| `DateInput` (new) | `label?`, `value: number \| null` (epoch ms), `onChange`, `mode: 'date' \| 'time' \| 'datetime' = 'date'`. Locale-formatted field with `calendar`/`clock`; opens the native picker; `date` mode stores local midnight |
| `Picker` (new) | `label?`, `options: string[]`, `value`, `onChange`, `placeholder?`; field with `chevron-down`, native list. 2–4 options: the reference points to `SegmentedControl` |
| `Switch` | iOS or Material shape from `platform`. Off `fill-strong` track + `thumb` knob; on tint track + on-tint knob; rAF spring; whole row is the target, label `body` `text`. Role `switch` |
| `Checkbox` | 24 pt, `r-sm`, 2 px `border`; checked: tint fill, on-tint `check` drawn over 160 ms; whole row, 44/48 high. Role `checkbox` |
| `Slider` | 6 pt `fill-strong` track, tint fill, 28 pt `thumb`; optional label and tabular value; `touch-action: none`; pointer capture 1:1; tap springs the thumb (rAF) |
| `SegmentedControl` | `fill` capsule track 36 visual (44/48 target), `thumb` under the selected option, labels `callout` 600 `text`; rAF thumb. Role `radiogroup` |
| `Card` | `surface` (`sheet-group` in a `Modal`), `r-lg`, padding 20, no border; `onPress` adds press 0.98 |
| `List`, `ListItem` | Inset group, `separator` inset 16; `ListItem` `title`, `subtitle?`, `trailing?`, `icon?`, `onPress?` (adds `chevron-right`), min 52, pressed `fill`. `<List items keyBy renderItem>` animates enter/leave (M24); `keyBy` is a property name or function. Children-style `<List>` is static. Duplicate or index-shaped keys give a dev diagnostic and switch motion off |
| `Badge` | Capsule, 13/18 600, padding 3 × 9, soft fill + tone text: `neutral`, `primary`, `positive`, `warning`, `danger`; status tones carry their icon |
| `ProgressBar` | `value` 0–1, `tone`, `variant: 'bar' \| 'ring' = 'bar'`, `label?`. Bar 6 pt, `fill-strong` track, tint mark. Ring 120 pt, 10 pt round-capped stroke, tabular `title` label centred (under it from 135%). Moves with `smooth` |
| `EmptyState` | `icon?`, `title`, `hint?`; 32 pt icon in a 64 pt `fill` circle, `subtitle` title, `callout` `text-2` hint, centred, padding 32 |
| `Modal` | Sheet anatomy painted `sheet`: grabber, `title2`, a close button that always calls `onClose`, drag to dismiss (rAF), scrim; action row pads by `chromeInsetBottom` |
| `Chart` | Bar, line, heatmap; tint colours, `separator` gridlines, `footnote` `text-2` tabular labels, `r-xs` bar tops; never animates |
| `Icon` (new) | `name: string`, `size: 'sm' \| 'md' \| 'lg' = 'md'` (16/20/24), `color? = 'text'`, `label?` (none = decorative). Resolves per §3.1 |
| `toast(text)` (new) | Module-level like `nav`. Capsule above the orb's footprint, 4 s, paused under a screen reader, a second call replaces the first; ignored during first render |

**Built-in feel.** Press feedback on every pressable; push, pop, Modal, keyed rows and toast motion,
interruptible; light/dark, text size and Increase Contrast from the phone at next open; the tint on every
`primary`; Reduce Motion inside each component. No haptics from components.

**The style gallery mirrors the SDK.** `fixtures/style-gallery.app.tsx` shows every component, every
variant, every state worth seeing (disabled, empty, error) and every prop, always. A change that adds,
changes or removes an SDK component is not done until the gallery shows it. The gallery is also a
few-shot example, so it is idiomatic: screens by topic reached with `nav` around `Screen title` (Text and
buttons; Controls; Surfaces; Modal and toast), in tint `purple`, one filled button per screen, `danger` as
a "Delete all" row with `secondary` beside it, `List keyBy` with an add/remove pair. Two or three curated
exemplar apps join it in the few-shot set.

## 8. Voice and copy

**Who speaks.** The **maker** (Whim at work: plan, making, failure, ready) may say "I" in prose and
mostly needs no pronoun ("Two quick questions."). The **product** (settings, consent, terms, store) says
"Whim", and "we" where the company must speak. The **person** is "you" in prose. **Controls speak as the
person** ("Change my idea", "Decide for me", "Include what I asked for"); Whim's "I" never appears on a
control label (a copy lint enforces it). Whim never introduces itself, has no name or face, and never
refers to itself in the third person in the maker's prose.

| Concept | Say | Don't say |
|---|---|---|
| What Whim makes | app | mini-app, project |
| Creating one | make: "Make it", "Making…", "Couldn't make this" | build, generate, create |
| Asking for a change | change: "Change it", "What should change?" | prompt again, edit |
| The versions | History | Versions, timeline |
| One of them | version | snapshot, commit |
| Going back | "Use this version" (button), "go back" (prose) | restore, revert |
| Ending a make early | Stop | Cancel |
| Letting Whim answer | "Decide for me" | "I'll decide", skip |
| A second app from one | "Make a copy", "Copy of Tip Splitter" | fork, duplicate |
| The home grid | Your apps | Home, launcher |
| Throwing away an attempt | Discard | Dismiss |
| Removing an app | Delete | Remove |
| The floating button | no visible name; "Whim menu" for screen readers | orb, menu |

**Rules.** (1) Say what happened in the person's terms, never internals. (2) Sentence case; no
exclamation marks, no emoji. (3) Buttons are verbs, places are nouns. (4) Time is measured: elapsed time,
ranges from real runs, never a promise the server doesn't keep. (5) Failure says what happened, what is
safe, the one next step; one apology at most; no whimsy. (6) Whimsy is one vivid word per screen, only in
waits, first run and success; if the playful version is longer, it is padding. (7) Numerals with short
units: 2 min, 3 taps; format with the app's language, never the machine locale. (8) The person's words
are quoted exactly. (9) Headlines ≤ 6 words, helper text one line at 390 pt, buttons ≤ 3 words (a name
inside "Make X instead" doesn't count).

**Making-time lines** (production flowbench, 22 runs: 53 s median, 144 s p90, 225 s worst; the
thresholds live in one constant with the run that measured them):

| Elapsed | Line |
|---|---|
| 0–75 s | "Usually 1–2 min. You can leave; it keeps going." |
| 75–150 s | "Taking longer than most. Still going." |
| Over 150 s | "This one's slow. I'll keep at it; you can leave." |
| No bytes for 40 s | "No word from the server for 40 s. Still waiting." (ember stuck) |
| In line | "Waiting for a free spot. You're next." / "2 ahead of you." (ember still, dim) |

**Failure kinds** (server reason strings map to these; unknown reasons show the server's text):

| Kind | Body | Primary | Plain |
|---|---|---|---|
| Couldn't run; rewording helps | "I tried 3 times and couldn't get it to run. Describing it differently often helps." | Change the description (`ink`) | Try again as it is |
| Couldn't run; rewording won't help | "I tried 3 times and couldn't get it to run." | Try again (`ember`) | |
| Server refused for now | The server's reason as a `Notice` with a countdown | Try again, disabled until the window ends | |
| Needs a newer Whim | "Finishing this needs the latest Whim." | Update Whim (`ink`) | Not now |
| Stopped when Whim closed | "Making stopped when Whim closed." | Try again (`ember`) | |
| Connection dropped | "I lost the connection to the server partway through." Never suggests rewording | Try again (`ember`), enabled when back online | |

A connection problem before anything was made (plan can't reach the server) is not a failure: the page
stays and shows a `Notice` with Try again. Changing an app adds "Your current version still works."
Discard is a `danger` button in the body; discarding shows a 6 s Undo toast.

## 9. Screens and flows

Four kinds of surface, one way in and out each: **root** (Your apps); **full screen** (a running app,
Update required, Link missing; left by the orb or Android back at depth 0); **pushed** (History,
Settings, Advanced, AI features, Report, on the native stack; left by back and the OS gesture: iOS edge
and content-area swipe, Android predictive back); **sheet** (the making flow, the Whim sheet, confirm
sheets, first-run consent; left by close, drag, scrim, Android back). The context menu is the one
anchored surface. **No edge swipe over a running app in v1 (#67).**

| Screen | Spec (mockup id) |
|---|---|
| Your apps (`#s-home`) | `settings` icon button trailing; "Your apps" `largeTitle`; grid per §3.2; search under the title from 13 apps; composer at the bottom; scroll-edge fades top and bottom. Order: being made, then failed/stopped from the last day, then apps, each newest first; older attempts collapse into one tile at the end; an app doesn't move when it changes. Offline: "Offline. Your apps still work; making new ones needs a connection." under the title, following connectivity live. Skeleton: real title, composer, one cell per known app. Empty (`#s-home-empty`): the 128 ember, still, "Make your first app", one line of examples, three idea chips |
| Delete (`#s-delete-confirm`) | No dialog: soft delete, tile leaves (M18), "Water Counter deleted · Undo" 10 s, purged after |
| Share link | The platform share sheet |
| First run (`#s-consent`) | One large sheet on the first composer tap: "Before Whim makes apps for you", a lead sentence, three icon rows (what's sent, what stays on your phone, what we never do), Privacy policy, Full details (expands in place) and Language rows, then a checkbox row "I accept the Terms of use", unticked, Terms link outside its hit area; **Agree to send descriptions** (`ink`, enabled once ticked) and **Not now**. Two acts on purpose (GDPR art. 7(2)), both recorded with their versions. Age stays silent unless blocked |
| Describe (`#s-describe`) | "What should it do?" `title1`; a 17 pt area focused with the keyboard up; "Plain words are enough. I'll ask if anything's unclear."; **Continue** (`ember`) riding the keyboard; three idea chips when empty and no keyboard. Change mode: the 24 tile and "Changing Water Counter" over "What should change?" |
| Plan (`#s-plan-thinking`, `#s-plan`, `#s-plan-edit`) | Clarify and plan are one page: "Here's the plan", your words as the hero, **A few choices** (question rows, shown as soon as they land) then **What I'll make** (plan rows; skeletons until they land), **Make it** (`ember`). Rows never restate an answer; answers travel as `clarifications`. A server notice sits above Make it. No step bars |
| Can't make as asked (`#s-plan-limit`) | "I can't make this as asked", the quote, the reason in plain words, a card "I could make this instead…"; **Make that instead** (`ember`), **Change my idea** (`plain`) |
| Making (`#s-making`, `-stuck`, `-queued`) | 128 ember with ambient light; "Making Pour Timer" `title1` (or "Changing…"); your words; the time line (§8); the step list; **Stop** (`plain`) at the bottom; the close X is the way out (M5). Keyed by the run's own id, so a second build's page never shows another's progress |
| Ready (`#s-ready`) | The 96 tile hero (M10), name `title1`, your words, "It's on your home screen.", **Open it** (`tint`), **Done** (`plain`). No live preview in v1. Report lives in the Whim sheet and History |
| Didn't work (`#s-failure`) | The 96 ember out; "Couldn't make this" `text`; one sentence by kind (§8); a `sheet-group` list with "Your other apps are untouched" (or "Your current version still works") and a collapsed "What happened"; primary and plain per kind; **Discard** (`danger`) in the body |
| Opening (`#s-app-opening`) | M2; the status bar follows the scheme |
| Running app (`#s-app-timer`) | The app's tint is its primary; the orb per §7.1 |
| Whim sheet (`#s-whim-sheet`, `#s-whim-plan`) | `fit` sheet: 40 tile, name, "Version 4 · changed 2 days ago"; a "New version ready · Reload" row on top while one waits; "What should change?" send field; History, Report a problem, Back to your apps. Sending grows the sheet into the change's plan with **Make the change**; then it collapses into the orb. Report pushes inside the sheet on its own small stack |
| Changing in use (`#s-app-changing`) | The app keeps running; the orb's ember glows; on landing "Pour Timer changed · Reload" (nothing reloads by itself; Reload recreates the realm); missed toast → `ember` dot and the Whim-sheet row; failure → `danger` dot and "The change didn't work · See why" |
| App crashed (`#s-app-error`) | `circle-alert` in a `fill` circle, "Pour Timer ran into a problem", "It stopped and can't carry on right now. Your saved data is safe.", **Reload** (`ink`), **Ask Whim to fix it** (`plain-ember`, opens the change field prefilled "Fix the error that stops this app." with the error attached), **Back to your apps** (`plain`). The orb stays |
| History (`#s-history`, `#s-history-undo`) | Native stack; "Report" text button in the header; "History" `title1`, the 40 tile, the name in its tint, "4 versions"; timeline rows (§7.1), ordered by the version chain, not the clock. Use this version → "Back on version 3 · Undo". Make a copy → immediate, "Copy made · Open"; a copy starts with its own fresh data. No kind filters |
| Settings (`#s-settings`) | `largeTitle`; "AI features" with subtitle "Review what's sent" ›; "Language" ›; About: Privacy policy, Terms of use, Support (`external-link`), Version; **Advanced** ›. No Highlighting or Reduce Motion switches |
| Advanced (`#s-settings-advanced`) | "Send error details" switch with its explanation as the footer; **This phone**: Phone ID truncated in the middle with a copy button, "Make a new ID" (confirm sheet); **Server**: "Whim's server" ✓ and "Your own server" › (the one-time acknowledgement, #70, then the address field and its check line; the address stays saved when you switch back) |
| Report a problem (`#s-report`) | Pushed (from History, Settings or inside the Whim sheet); "What went wrong?" chips, a note, "Include what I asked for" switch, "What gets sent" collapsed, the ID line as footer, **Send report** (`ink`), **Cancel**; "Sending…"; sent: a check and "Thanks. We'll look into it." (naming no company when your own server is set), **Done**. A send failure is a `Notice` at the end of the scroll, above the buttons |
| Update needed (`#s-update`) | "Whim needs an update", one sentence, **Update Whim** (`ink`), **Not now** |
| Launch (`#s-launch`) | The 128 ember on `bg`, still (iOS); Android 12+ the icon in the system splash mask; holds until Home's first frame (M27) |

**Changing an app** starts where you are: inside the app, orb → send → Make the change → Reload (4
taps, the app stays open); from Home, tile menu → Change it; from History, the current version's Change
it. **Closing the making sheet keeps the draft**: the composer reads "Continue "…"" and reopening
restores text, answers and plan edits. **Platform:** iOS sheets close by drag, close or scrim; Android
adds back everywhere; inside a running app Android back goes back in the app, then closes it.

## 10. Do and don't

| Do | Don't |
|---|---|
| Take every value from the token module | Copy a hex, size or spring into a component |
| One filled button per screen; ember when Whim acts, ink for the system, the tint for an app | Fill a button with `danger`, or show two fills |
| Use `text-2` for placeholders and waiting steps | Put content in `text-3` or the glow |
| Quote the person's words exactly, italic, as the hero | Paraphrase them or colour them |
| Offer Undo | Ask "are you sure?" for something that can come back |
| Start every animation from the presentation value | Disable input during a transition |
| Use the native stack's back on shell screens | Draw a custom back gesture, or add one over a running app |
| Give apps `tint` + `icon` by name | Accept a hex, or fail a build on an unknown name |
| Show a skeleton only for something known to arrive | Skeleton an empty result |
| Make every SDK control 44/48 with padding | Rely on hit-slop inside the DOM |
| Update the style gallery with every SDK component change | Ship a component the gallery doesn't show |
| Keep haptics on the moments in §5 | Buzz on taps, scrolling or opening an app |
