# Design direction: Whim system v1

Phase A of `design-system-v1`. `00-audit.md` says what exists; this file says what Whim should become and
fixes the values the redesign builds on. Screen-by-screen work, the tile strategy, motion moments and flow
changes are in `02`–`06`, checked against the device capture. Everything here is a decision; the questions
Phase A left open are answered in §16.

## The moves, in one list

1. **One design system for the shell and every app.** Same type, spacing, shape, motion and neutrals in
   the launcher and inside the WebView. Apps differ by their tint, their glyph and their content. This
   reverses the handoff's "two systems, not one".
2. **System fonts everywhere.** SF Pro on iOS, Roboto on Android, `system-ui` in apps. Instrument Sans,
   IBM Plex Mono and Newsreader are retired.
3. **Light and dark**, following the phone's setting, in the shell and in apps. No in-app picker.
4. **Hue says who.** Ember is Whim at work. An app's cool tint is that app. Ink is you and the system. Red,
   amber and green are status, and status has a shape too: it never fills a button. Nothing is coloured for
   decoration.
5. **Ember replaces ink violet** as Whim's colour, and the ember becomes Whim's mark: an eyeless light on the
   orb, the app icon and the making page.
6. **Two signatures.** The person's own words, quoted, are the hero of every making screen; the ember is an
   ambient light that glows only while real work streams.
7. **Apps pick one of ten named tints, not a hex.** The tint colours the tile and becomes the app's `primary`.
8. **Real motion.** Springs, spatial transitions, the OS's own back gesture on shell screens, interruptible
   everything. Stack: Reanimated 4.6, Gesture Handler, SVG and the native stack on the host; WAAPI and a
   small rAF spring inside apps.
9. **Real haptics** in the shell through a small in-repo native module, in place of `Vibration`. Apps get
   haptics only through their gated `cues`.
10. **One icon set** for the shell and the SDK, drawn as SVG. No more typed characters.
11. **One vocabulary.** One name per concept. Whim says "I" only in prose while it is making something;
    controls speak as the person.

## 1. The feeling

Whim should feel like a warm light in a quiet workshop. You say what you want; a small light gets busy; a
thing that is yours appears. The emotion I'm designing for is the moment of "I made that": competence with
a small spark of delight, and calm while the work happens. Nothing about it should feel like a chat app, a
developer tool, or the purple sparkle every AI product wears this year.

Three tests for every screen:

- **Is it calm?** Neutral surfaces, one accent at a time, generous space, nothing moving that isn't telling
  you something.
- **Is it honest?** What it shows is what is happening. If Whim is stuck, it looks stuck.
- **Is it yours?** Your apps carry the colour; your words are quoted exactly; your choices are the strongest
  ink on the screen.

## 2. Principles

Eight, named in Whim's own terms. When two collide, the earlier one wins.

### 2.1 Apps first

The person's apps are the colour and the content. Whim's chrome stays neutral and steps back when an app is
on screen: the orb is small and quiet over a running app, Whim's ember never appears inside an app's
content, and the home grid is the most colourful thing in the shell because it is made of the user's apps.

### 2.2 Hue says who

Every hue answers "who is this?":

| Hue | Means | Examples |
|---|---|---|
| Ember | Whim is doing, or will do, the work | "Make it", "Make the change", "Try again", the orb, a tile being made, the make screen, "Decide for me" when picked |
| An app's tint (cool) | That app | Its tile, its name in prose, "Open it" on the ready screen, the app's own buttons inside the app |
| Ink | You, and the system | Your selected answers, your quoted words, "Agree to send descriptions", "Send report", the shell's switches, the safe button in a confirm sheet |
| Red (`danger`) | Danger | Delete, Discard, an error that stopped work |
| Amber (`warning`) | Take care | A notice that needs attention |
| Green (`positive`) | It worked | Ready, restored, verified |

Warm hues belong to Whim and to status; apps get the cool half of the wheel and two neutrals (§3.4). Status
also has a shape channel: a fill means `primary` and nothing else, so `danger` is never a filled button, and
status badges always carry their icon (§3.3).

If something is coloured and you can't answer "who?", it is decoration and gets removed. History's six
coloured kind badges go; kinds become neutral labels with icons.

### 2.3 Everything comes from somewhere

Things enter from where they live and leave the same way. An app opens out of its tile and closes back into
it. An app being made lives in its tile on the home grid, so leaving the make screen collapses into that
tile. Sheets rise from the bottom edge they return to; a long-press menu grows from the tile that was
pressed. Nothing appears from nowhere or vanishes without a trail.

### 2.4 Honest light

The ember moves only when real work moves. Its glow follows the generation stream's activity; when the
stream stalls, the light dims and holds still. Progress is never smoothed to look busier, time estimates
come from measurements, and a wait that takes four minutes never says "about a minute". This keeps the
spirit of the current `WorkingLine` (`flow-working.tsx:1-18`) and gives it a body.

### 2.5 The finger never waits

Feedback lands on touch-down. Every transition can be grabbed, reversed or retargeted mid-flight, starting
from where the thing is on screen, never from where it was going. Input is never blocked during an
animation. On shell screens back is the OS's own gesture from a native stack: edge and content-area swipe on
iOS, predictive back on Android. Over a running app the orb is the guaranteed exit (§14).

### 2.6 Native by default

System type with Dynamic Type, each platform's back gesture and back icon, the platforms' own haptic
engines, light and dark, Reduce Motion and Increase Contrast. This applies inside generated apps too, through
the theme init frame (§3.5) and the SDK's defaults, because the generator will never ask for it.

### 2.7 Plain words, one name per thing

Short, concrete, warm sentences. A concept has one name on every screen (glossary in §12). Whim speaks as
"I" only in prose while it is the maker at work; controls speak as the person; the product speaks of "Whim"
in settings and legal text.

### 2.8 Forgiving

Every change is a version, so most things can come back. Prefer an undo toast to an "are you sure": deleting
an app is a soft delete with a 10 s Undo. Confirm only what can't be undone (a new phone ID, switching to your
own server), and when you do, the safe choice is the big button. Nothing typed is lost to a closing sheet.

## 3. Colour

### 3.1 Neutrals and roles

Warm, low-chroma greys built in OKLCH (hue 60–75). Every text pair below was computed against WCAG 2.2.

| Role | Light | Dark | Use | Contrast |
|---|---|---|---|---|
| `bg` | `#F6F4F1` | `#100E0D` | Screen canvas | |
| `surface` | `#FFFFFF` | `#1B1917` | Cards, list groups, inputs on the canvas | |
| `sheet` | `#F6F4F1` (= `bg`) | `#1B1917` | Content sheets: making, Whim sheet, consent, report, failure, SDK `Modal` | |
| `sheet-group` | `#FFFFFF` | `#252220` | Grouped lists, question groups, plan rows, cards inside a sheet | |
| `raised` | `#FFFFFF` + shadow | `#252220` + top highlight | Menus, toasts, popovers, the orb; nothing grouped sits on it | |
| `fill` | `#EBE9E6` | `#2E2B28` | Secondary buttons, segmented track, chips | |
| `fill-strong` | `#E0DDDA` | `#3C3936` | Pressed fills, skeletons, the light-out ember | |
| `thumb` | `#FFFFFF` + `shadow-raised` | `#3C3936` | Segmented thumb, slider thumb, switch knob when off | |
| `separator` | `#E2DFDB` | `#34312F` | Hairlines between rows | |
| `border` | `#908B86` | `#6E6862` | Input and outlined-control edges | 3.37 / 3.19 on surface (WCAG 1.4.11) |
| `text` | `#1A1614` | `#F2F0EC` | Primary text | 16.2 / 15.2 |
| `text-2` | `#6D6660` | `#ADA8A3` | Secondary text, placeholders, waiting steps | ≥ 4.66 on bg, surface, fill / ≥ 6.56 |
| `text-3` | `#908B86` | `#78746E` | Disabled only | 3.05 / 3.77 |
| `ink` | `#1A1614` | `#F2F0EC` | The system's prominent fill | |
| `on-ink` | `#FFFFFF` | `#1A1614` | Label on `ink` | 17.9 / 15.8 |
| `scrim` | `rgba(26,22,20,0.32)` | `rgba(0,0,0,0.60)` | Behind sheets and menus | |

Surfaces separate from the canvas by tone, not by outlines. Borders are for inputs and outlined controls,
where WCAG asks for a 3:1 edge. In dark mode, higher means lighter: `bg` < `surface` = `sheet` < `raised` =
`sheet-group` < `fill` < `thumb`. In light mode a content sheet is the canvas tone and its groups are white,
as in iOS form sheets, so a group never sits white on white. `sheet`, `sheet-group` and `thumb` are new roles,
not new values.

### 3.2 Ember, Whim's colour

| Role | Light | Dark | Notes |
|---|---|---|---|
| `ember` | `#C14900` | `#F99549` | Fill of Whim's buttons |
| `on-ember` | `#FFFFFF` | `#1A1614` | 4.98 / 8.06 |
| `ember-text` | `#B14200` | `#F99549` | Text and icons; ≥ 4.75 on bg, surface, fill and `ember-soft` |
| `ember-soft` | `#FDEBDA` | `#3F2313` | Washes: a tile being made, a picked "Decide for me" |
| `glow-core` | `#FFC96A` | same | The light itself: the ember mark, the orb, the ambient light |
| `glow-mid` | `#FF9127` | same | |
| `glow-edge` | `#F25914` | same | |

Light mode uses the deep ember for fills because white text needs it; dark mode switches to the bright
ember with ink text, which reads as a lit button. The glow stops are decoration of the ember mark: they never
carry text and never mark state. The current-step marker and the 8 pt dot use `ember` (4.98:1 on white).

Warm hues are reserved: orange for Whim, red, amber and green for status. Apps take the cool half (§3.4). That
is the cost of making "ember means Whim" and "red means danger" true everywhere.

### 3.3 Status

| Role | Fill light / dark | On fill | Text light / dark | Soft light / dark |
|---|---|---|---|---|
| `positive` | `#1E8347` / `#5BCC80` | `#FFFFFF` / `#1A1614` | `#1A763F` / `#5BCC80` | `#DEF6E3` / `#193521` |
| `danger` | `#C9292F` / `#F66C6D` | `#FFFFFF` / `#1A1614` | `#C22630` / `#F66C6D` | `#FFE7E5` / `#472020` |
| `warning` | `#F3BA25` / `#ECBD3A` | `#1A1614` both | `#8A6000` / `#ECBD3A` | `#FDF2D0` / `#382C0C` |

Danger sits at OKLCH hue 24 and ember at 45, so the two read as red and orange side by side. Status hues
never stand alone; they carry a shape:

- A fill means `primary` and nothing else. `danger` is never a filled button, in the shell or the SDK: the
  danger button is `danger-text` on `danger-soft`, a capsule, with an icon when one fits (`trash`).
- Status badges always carry their icon: positive `check`, warning `triangle-alert`, danger `circle-alert`.

### 3.4 App tints

An app declares one tint by name. The tint colours the tile and is the app's `primary` inside the app. Warm
hues belong to Whim and to status, so the ten tints come from the cool half of the wheel plus two neutrals:
warm light is Whim and status, your apps are cool jewels. Each tint has exactly two values.

- **Light value**: fill, text, marks and the tile plate in light mode, with a white label.
- **Dark value**: fill, text and marks in dark mode, with an ink `#1A1614` label, like ember's lit button.

The light value is ≥ 4.56:1 on `fill`, so it is also the text and mark colour (progress, slider fill, chart
marks); there is no separate mark token.

Separation from every status fill and text form and from ember, in CIEDE2000, normal vision and Machado 2009
simulation at severity 1.0, nearest reserved colour in brackets:

| Tint | Light | Dark | Light: normal / deutan / protan / tritan | Dark: normal / deutan / protan / tritan |
|---|---|---|---|---|
| `slate` | `#535E6F` | `#B0B8C5` | 30.4 / 24.9 / 24.9 / 14.9 (positive-text) | 30.4 / 24.2 / 24.2 / 19.4 (positive) |
| `stone` | `#52443F` | `#B0A19A` | 24.2 / 13.3 / 11.1 / 17.0 (danger-text) | 22.1 / 11.6 / 11.7 / 16.4 (positive) |
| `ocean` | `#00445A` | `#A1CCDC` | 34.4 / 33.5 / 28.4 / 14.8 (positive-text) | 30.3 / 29.2 / 29.0 / 10.2 (positive) |
| `blue` | `#0852CB` | `#9DC7FE` | 42.5 / 46.8 / 45.9 / 14.2 (positive-text) | 41.6 / 38.6 / 37.0 / 10.8 (positive) |
| `indigo` | `#1E20A3` | `#909DEF` | 42.2 / 49.1 / 46.2 / 22.4 (positive-text) | 37.1 / 42.4 / 37.4 / 15.8 (positive) |
| `violet` | `#6758B4` | `#C1BBFC` | 36.8 / 40.7 / 41.9 / 19.4 (positive-text) | 34.9 / 38.0 / 37.4 / 21.7 (positive) |
| `purple` | `#662A8D` | `#C290F5` | 34.9 / 40.4 / 41.4 / 18.4 (warning-text) | 31.8 / 41.8 / 38.5 / 18.9 (warning) |
| `orchid` | `#9D469E` | `#FD91EC` | 29.2 / 34.2 / 38.8 / 10.5 (warning-text) | 26.4 / 34.7 / 36.3 / 10.7 (ember) |
| `berry` | `#661258` | `#E4B1DB` | 30.2 / 31.5 / 36.2 / 18.1 (warning-text) | 25.4 / 27.8 / 30.7 / 10.0 (warning) |
| `rose` | `#7C3856` | `#BD98AA` | 21.2 / 15.7 / 24.2 / 10.4 (warning-text) | 20.3 / 19.5 / 20.0 / 13.1 (warning) |

Thresholds: ≥ 20 from every reserved colour in normal vision, ≥ 10 under each simulation, and ≥ 10 tint to
tint in normal vision, in both modes. Measured floors: normal 20.3, deutan 11.6, protan 11.1, tritan 10.0.
Closest tint pairs (normal vision, the lower of the two modes): orchid–berry 10.7, berry–rose 11.0,
indigo–violet 11.0, blue–violet 11.0, purple–berry 11.4.

Under colour-blindness simulation tints can collapse into each other: the closest light pairs are ocean–berry
1.9 (deutan), blue–violet 2.8 (protan) and berry–rose 7.9 (tritan). The system doesn't claim tint-to-tint
separation under CVD; tiles also differ by glyph and name. What it does claim is that no tint is ever mistaken
for a status or for Whim.

WCAG contrast:

| Tint | White on light | Light on `fill` | Badge light | Ink on dark | Dark on `fill` | Badge dark | Plate on dark `bg` | Dark rim on `bg` |
|---|---|---|---|---|---|---|---|---|
| `slate` | 6.57 | 5.42 | 5.54 | 8.99 | 7.04 | 5.41 | 2.93 | 5.60 |
| `stone` | 9.30 | 7.68 | 7.67 | 7.20 | 5.64 | 4.56 | 2.07 | 4.18 |
| `ocean` | 10.64 | 8.78 | 8.62 | 10.43 | 8.17 | 6.03 | 1.81 | 4.89 |
| `blue` | 6.82 | 5.63 | 5.63 | 10.30 | 8.06 | 5.98 | 2.82 | 5.71 |
| `indigo` | 11.73 | 9.68 | 9.33 | 7.06 | 5.53 | 4.54 | 1.64 | 3.53 |
| `violet` | 5.78 | 4.77 | 4.91 | 10.08 | 7.89 | 5.87 | 3.33 | 6.31 |
| `purple` | 9.21 | 7.60 | 7.49 | 7.36 | 5.76 | 4.67 | 2.09 | 4.21 |
| `orchid` | 5.52 | 4.56 | 4.67 | 8.93 | 6.99 | 5.43 | 3.49 | 6.00 |
| `berry` | 11.72 | 9.67 | 9.37 | 9.93 | 7.78 | 5.83 | 1.64 | 4.41 |
| `rose` | 8.21 | 6.78 | 6.77 | 7.05 | 5.52 | 4.52 | 2.34 | 4.31 |

Floors: white on light ≥ 5.52, light value on `fill` ≥ 4.56, badge text on its soft fill ≥ 4.67 light and
≥ 4.52 dark, ink on dark ≥ 7.05, dark value on dark `fill` ≥ 5.52, dark rim on dark `bg` ≥ 3.53. The plate
alone is 1.64–3.49:1 on the dark canvas, which is why the rim exists. Labels stay readable under simulation
(WCAG ratio after simulating both colours, worst of deutan, protan and tritan):

| Tint | White on light | Ink on dark | Light on `fill` | Dark on `fill` |
|---|---|---|---|---|
| `slate` | 6.39 | 8.87 | 5.26 | 6.92 |
| `stone` | 9.17 | 7.09 | 7.55 | 5.55 |
| `ocean` | 9.90 | 10.08 | 8.15 | 7.86 |
| `blue` | 5.67 | 9.92 | 4.66 | 7.74 |
| `indigo` | 9.26 | 6.84 | 7.62 | 5.33 |
| `violet` | 5.54 | 9.93 | 4.56 | 7.74 |
| `purple` | 8.94 | 7.30 | 7.35 | 5.71 |
| `orchid` | 5.15 | 8.09 | 4.24 | 6.33 |
| `berry` | 10.96 | 9.54 | 9.03 | 7.47 |
| `rose` | 7.68 | 6.84 | 6.33 | 5.35 |

`palette-check.py` in this folder computes all three tables; any change to a tint reruns it.

- **Soft tint** (badges, selected rows): the light value at 12% over the surface in light mode, the dark
  value at 18% over `raised` in dark mode.
- **On a tint**, check marks and switch knobs take the on-tint colour: white in light, ink in dark.
- **Tile plate in dark mode**: the light value (deep, no glare) with a 1.5 px inner rim in
  mix(dark value, light value, 50%). The glyph stays white. Increase Contrast adds a `border` outline
  (3.07:1 on `bg`).
- **Names are forgiving.** An alias map resolves the names a model reaches for: red→`rose`,
  pink/magenta→`orchid`, grape→`purple`, sky→`blue`, cyan/teal/green/mint/lime→`ocean`, navy→`indigo`,
  yellow/orange/amber/brown/cocoa→`stone`, gray/grey/graphite/black→`slate`. An unknown name falls back
  deterministically to the tint at index (hash of the app id) mod 10 with a build diagnostic, never an error. An
  installed hex `tileColor` maps to the nearest light value by ΔE2000.
- **The host assigns.** The model returns up to three ranked tints; the host takes the first one not already
  used by any of the person's apps, else the least used. A copy takes the tint farthest (ΔE2000) from the
  original among the least used. "Customize tile" (a tint and glyph picker sheet) ships in v1, as the remedy
  for a bad pick.

Why a token instead of today's hex: decision #13 says tokens, not values; a named tint can't fail contrast,
collide with a reserved hue, or break in dark mode; and the generator chooses better from ten names than from
sixteen million hexes. The reserved-hue check that compares hex strings exactly (`tiles.ts:19-30`) goes away
because nothing can name a reserved hue.

### 3.5 Inside apps

A mini-app's theme stays inert data on the existing init frame (`__whimHostInit.theme`, decision #45). It
carries the resolved colour roles as today plus `sheet`, `sheet-group` and `thumb`, and gains `scheme`
(`'light'` or `'dark'`), `tint` (a closed name), `fontScale` (a number clamped to 0.85–2.0, default 1),
`reduceMotion` and `increaseContrast` (booleans, default false) and `platform` (`'ios'` or `'android'`).
`sanitizeTheme` checks every field with a fallback; the SDK reads the frame once at mount. No capability, no
CSP change, no new message kind. The SDK's colour roles keep their names, so every existing bundle re-themes
without a rebuild:

| SDK role | Resolves to |
|---|---|
| `bg`, `surface`, `border`, `text`, `text-muted` | `bg`, `surface`, `border`, `text`, `text-2` |
| `primary`, `on-primary` | the tint's value for the scheme and its on-tint colour |
| `positive`, `danger`, `warning` | status fills (and their text forms when used as text) |

Components choose the fill or the text form of a role themselves, so `<Text color="primary">` gets the
readable text colour and `<Button>` gets the fill. `Text color` accepts only `text`, `text-muted`, `primary`,
`positive`, `danger` and `warning`, so the generator can't produce an unreadable pairing. SDK `Card` and
`List` pick `sheet-group` by themselves inside `Modal`.

A change of the phone's appearance, text size or motion setting while an app is open applies at the app's
next open. There is no live theme frame: re-theming a running realm would need a new message kind (#45), and
recreating the realm would lose the app's navigation stack.

### 3.6 Colour rules

- One accent hue per control, one hue family per screen region. A screen may show ember and an app tint
  together (the ready screen) but never inside one control.
- A fill means `primary`. Status never fills a button.
- No gradients except the ember glow. No tinted shadows except the glow.
- Selection is ink: picked answers, the segmented thumb's label, the selected filter. The text caret is ink:
  a field belongs to the person.
- Disabled is `text-3` on `fill`, never a lowered opacity over a coloured control.
- The runtime page, the iframe and `Screen` paint the same `bg`, and the opening container is `bg` too (M2),
  so opening an app never flashes, in either mode.

## 4. Typography

### 4.1 One family, the system's

SF Pro on iOS, Roboto on Android, and `system-ui` inside apps, which resolves to the same two. Reasons, in
order of weight:

1. Apps can't load any other font. The CSP leaves `font-src` at `'none'`, and widening it is off the
   table. A custom shell face guarantees two typographic worlds.
2. The iOS shell already falls back to the system font; the custom faces were never bundled for iOS.
3. System fonts carry optical sizing and size-specific tracking, follow Dynamic Type, and ship real
   weights and italics on both platforms. The Android `_bold`/`_italic` file copies disappear.
4. Whim's identity comes from the ember, the person's quoted words, the tiles, the motion and the voice.
   Apple's own apps share one face and still look like themselves.

The cost: Whim looks less like a magazine. I'm fine with that; the magazine look was the developer-tool
texture the audit complains about.

### 4.2 Scale

One table for the shell and apps. Sizes in pt/dp. Tracking is in em, so it scales with the size.

| Token | Size / line | Weight | Tracking | Shell use | SDK token |
|---|---|---|---|---|---|
| `display` | 40 / 44 | 700 | −0.020em | Hero numbers in apps | `display` |
| `largeTitle` | 34 / 40 | 700 | −0.016em | Root screen titles | |
| `title1` | 28 / 34 | 700 | −0.012em | Step headlines, ready, failure | `title` |
| `title2` | 22 / 28 | 700 | −0.008em | Sheet and History titles | |
| `title3` | 20 / 25 | 600 | −0.004em | Card titles, clarify questions | `subtitle` |
| `headline` | 17 / 22 | 600 | 0 | Buttons, row titles, emphasis | |
| `body` | 17 / 24 | 400 | 0 | Prose, plans, prompts, inputs | `body` |
| `callout` | 15 / 20 | 400 | +0.004em | Secondary lines, helper text | |
| `footnote` | 13 / 18 | 400 (600 for section headers) | +0.008em | Meta, section headers, small print | `caption` |
| `caption` | 12 / 16 | 500 | +0.012em | Tile names, badges | |

- Twelve is the floor in the shell. SDK `caption` maps to `footnote` (13), so nothing inside an app is
  smaller than 13.
- Body and inputs are 17, so what the user types is the size of what they read.
- Leading is 1.29–1.41 on body sizes and tightens to 1.1 at display.
- Android renders weight 600 as 700 on devices without a variable Roboto. Every layout must look right
  at both.
- The tracking table is applied on both platforms. iOS already tightens SF by size, so the iOS values get
  checked on device; if titles look pinched, iOS display tracking drops to 0.

### 4.3 Type rules

- Hierarchy comes from size, weight and leading together; colour is the last resort.
- Numbers that count or tick (timers, totals, versions, timestamps) use tabular figures:
  `fontVariant: ['tabular-nums']` in RN, `font-variant-numeric: tabular-nums` in apps. Tabular figures
  replace the mono face as the mark of "a measure".
- Section headers are `footnote` 600 in sentence case. No uppercase-and-tracked mono eyebrows.
- The person's own words are one of Whim's two signatures. On plan, making, ready and History (each version's
  request) they are the hero: quoted exactly, italic, `title3` (20/25), `text` colour. Inline mentions
  elsewhere use the body italic in quotes. Not brown, not a serif, never paraphrased.
- Text scales with the system setting up to 200%. Containers grow with their text: buttons take
  `minHeight`, never `height`; single-line labels may truncate, prose never does.
- Accessibility sizes have their own layouts. From 135%: Home goes to three columns, the 128 ember mark drops
  to 64, paired buttons stack, ring labels move under the ring. From 200%: Home becomes a list.
- Inside apps the SDK multiplies its type tokens by the theme's `fontScale` (§3.5) and its layouts grow the
  same way (minHeight, wrapping, stacking from 135%). The runtime page drops `maximum-scale=1`, so pinch zoom
  works too; inputs are 17 px, so iOS doesn't zoom on focus.
- No text animates in. Streamed text appears as it arrives (kept from v2).

### 4.4 Whim Syntax, simplified

The idea survives: Whim's prose is marked by the role a span plays in the product, not by grammar, with the
four-marks-per-sentence cap and the rule that a field being typed is never marked. The channels change to
fit one family and "hue says who".

| Class | Before | Now |
|---|---|---|
| `app` | the app's tile hue | the app's tint text colour (unchanged idea) |
| `yours` | Newsreader italic, brown | italic, in quotes, `text` colour |
| `measure` | IBM Plex Mono | tabular figures, same face |
| `chg` | weight 500 | weight 600 |
| `state` | three status hues | only "ready" (positive) and "failed" (danger) |
| `hedge` | faint `#a8a29a` (2.43:1) | `text-2` (≥ 4.66:1) |

## 5. Space and layout

### 5.1 Scale

A 4-point grid. The shell names steps by number; the SDK keeps its five names so existing bundles don't
break, and those names point at values on the same grid.

| Step | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16 |
|---|---|---|---|---|---|---|---|---|---|---|
| pt | 4 | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 48 | 64 |
| SDK | `xs` | `sm` | `md` | | `lg` | | `xl` | | | |

### 5.2 Layout constants

| Constant | Value |
|---|---|
| Screen gutter | 20 |
| Card padding | 16 (20 for hero cards) |
| List row | min height 52, padding 12 × 16, separator inset 16 from the leading edge |
| Gap inside a group | 12 |
| Gap between groups | 24 |
| Gap between sections | 32 |
| Title to subtitle | 4 |
| Title block to content | 20 |
| Bottom action area | 16 above the buttons, 12 below them plus the safe area, at least 20 when there is no inset |
| Button height | 52, in the shell and the SDK |
| Touch target | 44 pt on iOS, 48 dp on Android. In the shell, `hitSlop` when the visual is smaller (36 minimum); adjacent small buttons get full targets or more space. Inside apps the DOM has no hit-slop, so SDK controls reach 44/48 with real padding |

Every screen in the making flow starts its headline at the same height, so moving between steps changes only
the content.

### 5.3 Screen anatomy

Every non-root screen has a header row with the back control at the leading edge in a 44 × 44 target: a
chevron on iOS, an arrow on Android, same place, same size. The title sits below it as `title1` or
`largeTitle`. The one primary action sits at the bottom, with at most one plain-text action under it. A
screen never has two filled buttons.

## 6. Shape

| Token | Radius | Use |
|---|---|---|
| `r-xs` | 6 | Badges, small tags |
| `r-sm` | 10 | Small controls, nested chips |
| `r-md` | 14 | Inputs, menu rows |
| `r-lg` | 20 | Cards, list groups |
| `r-xl` | 28 | Sheet tops, large panels |
| `r-full` | 999 | Buttons, pills, switches, the orb |

- Buttons are capsules, in the shell and by default in apps. Both platforms moved there (capsule buttons
  since iOS 26, full-round buttons in Material 3 Expressive).
- Concentric rule: a shape inside another takes the outer radius minus the inset, never below 6.
- iOS draws every radius of 10 or more with `borderCurve: 'continuous'`.
- App tiles are squircles: a superellipse whose corner is 22.5% of the side, drawn as one SVG path so iOS
  and Android get the same shape.
- The SDK's `sm`/`md`/`lg` radii become 10/14/20 (from 6/12/20).

## 7. Materials and depth

| Level | Light | Dark | What lives there |
|---|---|---|---|
| 0 | `bg` | `bg` | The canvas |
| 1 | `surface`, no shadow | `surface` | Cards, list groups, inputs on the canvas |
| 2 | `sheet` + `shadow-raised` | `sheet` + 1px top highlight `rgba(255,255,255,0.06)` + dark shadow | Content sheets |
| 2a | `sheet-group`, no shadow | `sheet-group` | Groups, plan rows and cards inside a sheet |
| 3 | `raised` + `shadow-raised` | `raised` + top highlight + dark shadow | Menus, toasts, popovers |
| 4 | `raised` + `shadow-floating` | as level 3, stronger shadow | The orb, the home composer bar |

Shadows (RN `boxShadow`, the same string in CSS):

- `shadow-raised`: light `0 1px 2px rgba(26,22,20,0.08), 0 8px 24px rgba(26,22,20,0.12)`; dark
  `0 1px 2px rgba(0,0,0,0.40), 0 8px 24px rgba(0,0,0,0.50)`.
- `shadow-floating`: light `0 2px 6px rgba(26,22,20,0.12), 0 12px 32px rgba(26,22,20,0.16)`; dark
  `0 2px 6px rgba(0,0,0,0.50), 0 12px 32px rgba(0,0,0,0.60)`.
- `glow-ember`: `0 0 0 1px rgba(255,145,39,0.35), 0 6px 28px rgba(255,145,39,0.45)`, the only coloured
  shadow, for the ember mark.

Rules:

- A modal task dims what's behind it with `scrim`; a non-blocking panel doesn't.
- Where floating chrome overlaps scrolling content, the content fades out over 16pt under it (a gradient of
  `bg`). No hairline under headers.
- **No blur in v1.** Backdrop blur needs another native dependency on Android, costs frames on mid-range
  WebViews, and Apple's own Reduce Transparency fallback is the solid surface this system uses anyway. If a
  later version adds glass, it adds it to level 3 only.
- Increase Contrast: level-1 and 2a surfaces and tile plates get a 1px `border` outline (3.07:1 on `bg`;
  `separator` is 1.21:1 and holds no edge), and `text-2` becomes `text`.

## 8. Iconography and the mark

### 8.1 Icons

- One set: a vendored subset of Lucide (ISC licence), stored as path data, drawn with `react-native-svg` in
  the shell and inline `<svg>` in apps (inline SVG is DOM, so the CSP is untouched). Lucide's names are names
  LLMs already know, which matters once apps can use icons.
- 24 grid, round caps and joins. Rendered stroke 1.5px at 16–20pt and 1.75px at 24–28pt, so small icons
  don't thin out.
- Sizes 16 (inline), 20 (rows and buttons), 24 (headers), 28 (empty states).
- Icons take the text colour of their role. Ember icons only where ember applies.
- Every icon has a label next to it or an accessibility label. Icon-only is allowed for back, close, more and
  add, nothing else.
- Never emoji, typed symbols (`✓ ⚙︎ ⌂`), box-border chevrons, or a sparkle meaning "AI".

### 8.2 The ember

Whim's mark is a light, not a character: the ember. The mascot study (`docs/mascot/`, with the large reference
sheets in the evidence archive `gs://anycognition-whim-evidence/docs/mascot.tar.zst`) is cut down to its glow.
The make wait lasts minutes and needs a presence that isn't a progress bar; the same shape is the orb and the
app icon, so it is one asset; and its glow is the liveness indicator, so it has a job (§2.4). Because it has
no face, it keeps the handoff's "no name, no face" rule and the animation research's "don't build a
character".

- **Shape.** One closed flame silhouette on a 48 grid: a round base and a tip that rises and curls slightly
  up, like a flame. It never trails down or sideways. No eyes, no face, no limbs, no poses.
- **Fill.** A radial gradient using exactly `glow-core` (upper centre) → `glow-mid` → `glow-edge` at the rim,
  with `glow-ember` around it.

Three states, all honest:

| State | When | Look |
|---|---|---|
| Working | The stream is running | Intensity follows the stream (§9.5) |
| Stuck | No bytes for 40 s | Dimmed to 35%, still |
| Out | Failure, a failed tile | Light out: a `fill-strong` silhouette, no glow |

Done is one `spark` flare as working ends.

- **Sizes:** 24, 48, 96 and 128. 128 on the making page and the empty home, 96 on failure and on Ready (where
  it settles into the 96 tile hero), 48 in the plan wait, 24 inline in a status line. The one exception is the
  orb, whose 44 pt disc carries a 20 pt mark at icon size. At text scale ≥ 135% the 128 drops to 64.
- **Where it appears:** the making page, the plan wait, Ready, failure, the empty home, the orb, the app icon,
  the launch screen, and as the ambient light (below).
- **Where it never appears:** inside an app's content, in settings or legal screens, as list decoration, with
  a speech bubble, or with a name.
- **Ambient light**, the second signature: a soft radial glow behind the making header and under the home
  composer, driven by the same activity signal as the mark. Still and dim when nothing streams, absent when
  nothing is being made.
- **App icon:** the ember on a warm dark ground (`#1A1614` to `#2A2420`), with iOS dark and tinted variants and
  an Android adaptive icon whose monochrome layer is the silhouette.
- **Silhouette test** (a C2 task): render it grey at 24 pt and check it reads as a flame or a light, not a
  tadpole, before it becomes the app icon.

## 9. Motion

### 9.1 Stack

- Host: `react-native-reanimated@4.6.0` with `react-native-worklets@0.12.2`, pinned exact (verified in the
  animation research), `react-native-gesture-handler` for draggable sheets and the orb,
  `react-native-svg` for icons, tiles and the ember, and `react-native-screens`' native stack for the shell's
  pushed screens (Settings, Advanced, History, Report), so their back gesture is the OS's. The OpenSpec change
  pins and re-verifies all of them against RN 0.85.3. RN `Animated` and `LayoutAnimation` are retired from
  `src/host/`. The other native work is listed in §15.
- Apps: springs are compiled into CSS `linear()` easing curves at build time, so a spring inside an app and the
  same spring in the shell trace the same path. `linear()` arrived in Safari 17.2 and the iOS floor stays 15.1,
  so the SDK gates it with `CSS.supports('animation-timing-function', 'linear(0, 1)')` and falls back to the
  nearest cubic-bezier. The Web Animations API plays fire-and-forget motion only; anything that can be
  retargeted (switch and slider thumbs, toggles, sheet drag) runs a small JavaScript spring on
  `requestAnimationFrame`, which keeps its velocity across a retarget.
- No Lottie, Rive, Skia or blur, as the research concluded.

### 9.2 Springs

Six named springs, critically damped unless the gesture carried momentum. Parameters are Apple's response
and damping ratio, with the mass-1 stiffness and damping that Reanimated's physics mode takes
(`stiffness = (2π / response)²`, `damping = 4π · ζ / response`). Always pass physics mode; never mix it with
Reanimated's `duration`/`dampingRatio` mode.

| Spring | Response | ζ | Stiffness | Damping | 95% at | Settles | Use |
|---|---|---|---|---|---|---|---|
| `instant` | 0.12 | 1.00 | 2741.6 | 104.72 | 91 ms | 215 ms | Press-in |
| `snappy` | 0.28 | 1.00 | 503.6 | 44.88 | 212 ms | 451 ms | Press-out, toggles, selection indicators, checkmarks |
| `smooth` | 0.40 | 1.00 | 246.7 | 31.42 | 302 ms | 616 ms | Push and pop, sheets opened by a tap, step changes, reflow, closing morphs |
| `fling` | 0.35 | 0.80 | 322.3 | 28.72 | 189 ms from rest | 521 ms | Anything released from a drag, with the finger's velocity |
| `morph` | 0.50 | 0.90 | 157.9 | 22.62 | 320 ms | 657 ms | Opening container transforms: tile to app, ghost to tile, composer to sheet |
| `spark` | 0.55 | 0.55 | 130.5 | 12.57 | 209 ms | 1145 ms, 12.6% overshoot | Rare celebrations only |

Timed values, for things that aren't motion:

| Token | Value | Use |
|---|---|---|
| `fade-in` | 160 ms, `cubic-bezier(0.23, 1, 0.32, 1)` | Content swaps, reduced-motion replacements |
| `fade-out` | 120 ms, same curve | |
| `color` | 150 ms, `cubic-bezier(0.25, 0.1, 0.25, 1)` | Colour and tint changes |
| `stagger` | 30 ms per item, first 6 items, the rest together | First appearance of a set only |
| `breathe` | 1900 ms cycle, opacity 0.34–0.72, after 300 ms | Skeletons for local loads |

### 9.3 Motion rules

- Press: buttons and rows scale to 0.97, tiles and cards to 0.96, icon buttons to 0.92, on touch-down with
  `instant`; release with `snappy`. Dragging 10pt off the control cancels the press; dragging back
  restores it.
- Every animation starts from the presentation value, and a new target retargets the running spring,
  keeping its velocity. Input is never disabled while something moves.
- Exits are faster than entrances. A morph opens with `morph` and closes with `smooth`.
- Things leave along the path they came in on.
- Drags track 1:1 after a 10pt slop. On release, project the end point (`current + (v / 1000) · 0.998 /
  (1 − 0.998)`), snap to the nearest target, and hand the finger's velocity to `fling`. Past a bound,
  rubber-band with constant 0.55.
- A gesture commits when its projected end passes the threshold and the release velocity doesn't point back.
  Position alone never commits.
- Back on shell screens is the native stack's: edge swipe and the iOS 26 content-area swipe on iOS, predictive
  back on Android (`android:enableOnBackInvokedCallback="true"`). Whim doesn't redraw it. Over a running app
  there is no edge swipe in v1 (#67); closing animates with `smooth` into the tile and isn't finger-tracked.
- No JS-driven layout per frame. Transform and opacity by default; a single leaf view's width, height and
  radius may animate on the UI thread through Reanimated (the opening morph, M2). No non-uniform scale on a
  rounded shape.
- The text of prose never animates (kept from v2).

### 9.4 Moment classes

The 12 moments in the animation research keep their numbers; Phase B (`05-motion.md`) gives each its
trigger and values. The mapping to springs:

| Research moment | Spring |
|---|---|
| 1 ghost becomes tile, 3 open app | `morph` |
| 4 close app, 6 orb menu close | `smooth` |
| 2 press feedback | `instant` in, `snappy` out |
| 5 home grid entrance | `smooth` + `stagger`, first load only |
| 6 orb menu open | `smooth`, or `fling` when dragged |
| 7 skeleton to content | `fade-in` |
| 8 skeleton breathe | `breathe` |
| 9 build-wait aliveness | the ember (§9.5) on the make screen and on the tile |
| 10 compose to clarify | `smooth` |
| 11 error | `fade-in` plus the ember going out, no shake |
| 12 in-app motion | the same springs through WAAPI |

The research put build aliveness only on the ghost tile and kept the build screen still. With honest light,
the making page gets the ember and the tile gets the same glow, smaller; both follow the stream, so neither is
theatre.

### 9.5 Honest light, specified

- Input: activity `a` from the stream's own signals, `a = clamp(tokensPerSecond / 40, 0, 1)`, with the 40
  calibrated against real runs. Reasoning tokens count as activity even though the user never sees them.
- Glow intensity `I = 0.55 + 0.45 · ã`, where `ã` is `a` smoothed by a critically damped spring with
  response 0.6 s.
- Flicker of amplitude `0.06 · ã`, only while a token arrived in the last 500 ms. Its timing comes from token
  arrivals, never from a timer.
- Stuck after 40 s with no bytes (`STALL_MS`): intensity eases to 0.35 over 1.5 s and holds still.
- Out (failure): the glow fades to nothing over `fade-out` and the `fill-strong` silhouette remains.
- The ambient light behind the making header and under the composer takes the same `I`, at lower opacity.
- Nothing about the ember loops on a clock. If no work arrives, nothing moves.

### 9.6 Reduce Motion

Follows the OS setting only; there is no in-app switch. Inside apps it arrives as the theme's `reduceMotion`
and applies at the next open.

| Normally | Reduced |
|---|---|
| Push, pop, sheets, morphs, flings | 160 ms cross-fade in place |
| Press scale | Opacity to 0.7, 100 ms |
| Stagger | Everything at once |
| `spark` | Plain `fade-in` |
| Ember flicker | A still intensity per state (working, stuck, out), changed by cross-fade |
| Skeleton breathe | Static at 0.6 |
| Sheet and orb drags | Still track the finger (direct manipulation stays), settle with a cross-fade |

## 10. Haptics

The shell uses the platforms' haptic engines through a small in-repo TurboModule (`WhimHaptics`, the same
pattern as `WhimTone`): `UIImpactFeedbackGenerator`, `UISelectionFeedbackGenerator` and
`UINotificationFeedbackGenerator` on iOS, prepared on touch-down; `View.performHapticFeedback` on Android,
which follows the user's touch-feedback setting and needs no permission. Haptics fire on the same frame as
the visual change they confirm.

| Moment | iOS | Android (API 34 constant, fallback) |
|---|---|---|
| Selection moves (answer pill, segment, filter, picker detent) | selection | `SEGMENT_TICK`, `CLOCK_TICK` |
| Switch toggles | impact light | `TOGGLE_ON` / `TOGGLE_OFF`, `CONTEXT_CLICK` |
| Long-press opens a menu | impact medium | `LONG_PRESS` |
| A drag crosses its commit point (sheet dismiss, orb corner) | impact rigid, intensity 0.6 | `GESTURE_THRESHOLD_ACTIVATE`, `CONTEXT_CLICK` |
| You hand work to Whim (Make it, Make the change, Try again) | impact medium | `CONFIRM` (API 30), `VIRTUAL_KEY` |
| App ready | notification success | `CONFIRM` |
| Making failed | notification error | `REJECT` (API 30), `LONG_PRESS` |
| An app deleted or an attempt discarded | notification warning | `REJECT` |
| Version restored, copy made | notification success | `CONFIRM` |

Never on plain taps, navigation, scrolling, typing, opening an app, or a sheet opened by a tap.

SDK controls emit no haptics on their own: haptics from apps are capability-gated. The only in-app haptics
are explicit `cues.haptic(...)` calls, gated by the manifest as today (#43), with the same closed set, now
played through `WhimHaptics`: `tap` is impact light (`EFFECT_CLICK`), `double` two light impacts 80 ms apart
(`EFFECT_DOUBLE_CLICK`), `heavy` impact heavy (`EFFECT_HEAVY_CLICK`). The host caps them at 10 per second
with a burst of 3; extra calls are dropped, not queued. Their latency is measured on device in C2.

## 11. Sound

None in the shell. Phones live on silent, every Whim moment already has a visual and a haptic, and the only
sounds that should mean something on this device are an app's own timer chimes and alarms. A finished
app reaching you while you're in another app is a job for a system notification later, not a sound now. App
cue sounds (`tick`, `chime`, `alarm`) stay as they are.

## 12. Voice and tone

### 12.1 Who speaks

- **The maker** (Whim at work: clarify, plan, make, failure, ready) may say "I" in prose, and mostly needs no
  pronoun at all: "Two quick questions." beats "I have two quick questions."
- **The product** (settings, consent, terms, store, errors unrelated to making) speaks of "Whim", and "we"
  where the company has to speak.
- **The person** is "you" in prose. Controls speak as the person: "Change my idea", "Decide for me",
  "Include what I asked for". Whim's "I" lives only in prose, never on a control label; a copy lint (C2) flags
  Whim's first person on controls.

### 12.2 One name per thing

| Concept | Say | Don't say |
|---|---|---|
| What Whim makes | app | mini-app, project |
| Creating one | make: "Make it", "Making…", "Couldn't make this" | build, generate, create |
| Asking for a change | change: "Change it", "What should change?" | prompt again, edit |
| The list of versions | History | Versions, timeline |
| One of them | version | snapshot, commit |
| Going back to one | "Use this version" on the button; "go back" in prose | restore, revert |
| Ending a make early | Stop | Cancel |
| Letting Whim answer a question | "Decide for me" | "I'll decide", skip |
| A second app from one | "Make a copy", "Copy of Tip Splitter" | fork, duplicate |
| The home grid | Your apps | Home, launcher |
| Throwing away an attempt | Discard | Dismiss |
| Removing an app | Delete | Remove |
| The floating button | no visible name; "Whim menu" for screen readers | orb, menu |

### 12.3 Rules

1. Say what happened in the person's terms. Never internals.
2. Sentence case. No exclamation marks, no emoji.
3. Buttons are verbs ("Make it", "Open it"); places are nouns ("Your apps", "History").
4. Time is measured. Show elapsed time; give estimates as ranges from real runs; never promise a duration
   the server doesn't keep.
5. Failure says what happened, what is safe, and the one next step. No whimsy. One apology at most.
6. Whimsy gets one vivid word per screen, only in waits, first run and success.
7. Numbers are numerals with short units: 2 min, 3 taps.
8. The person's words are quoted exactly, never paraphrased.
9. Headlines up to six words, helper text one line at 390pt, buttons up to three words (a name inside
   "Make X instead" doesn't count).

### 12.4 Before and after

| Now | Next |
|---|---|
| Making it · "This takes about a minute. You can leave and come back." | Making Pour Timer · "Usually 1–2 min. You can leave; it keeps going.", then a longer line as the wait passes the median and the 90th percentile |
| "Plain words are enough. Whim will ask if something is unclear." | "Plain words are enough. I'll ask if anything's unclear." |
| "Skip these and Whim will pick sensible answers." | "Skip any, and I'll choose." |
| Prompt again | Change it |
| Forked from Tip Splitter | Copy of Tip Splitter |
| Couldn't build this app | Couldn't make this |
| ↑ YOU'RE ON THIS ONE | Current |

The time lines come from the production flowbench (53 s median, 144 s at the 90th percentile); `06-ux.md` §1
has the table.

## 13. The SDK

The generator writes against the SDK, so the SDK's defaults are the design system for every app anyone makes.

1. **Right on the first try.** Every component works with no optional props. Props are tokens and closed
   unions. No `style`, no `className`, no raw values (#11, #13). A trap like `Row` spreading two children to
   opposite edges by default (`src/sdk/index.tsx:329-330`) is a bug.
2. **Feel comes from defaults.** Press scale, sheet motion, keyed list insert and remove (`<List items keyBy
   renderItem>`), dark mode, text size and the app's tint are built in, so a generated app with no motion code
   still moves correctly. SDK controls emit no haptics (§10). The generator prompt stops dictating layouts ("main content inside a
   Card, … a Badge …", `server/src/generation/prompts/index.ts:436-438`) and points at good defaults instead.
3. **Small but complete.** New components and motion primitives are welcome when they earn a place: a real
   app needs them and an LLM can use them correctly the first time. Duplicates merge (`Heading` and `Text`
   cover the same sizes today). Phase B proposes the additions and removals.
4. **The style gallery mirrors the SDK.** `fixtures/style-gallery.app.tsx` shows every component, every
   variant and every motion preset, always. A change that adds, changes or removes an SDK component isn't
   done until the gallery shows it. The OpenSpec change will carry this as an explicit task in every chain
   that touches an SDK component and as a requirement in its spec, and `docs/design/system.md` will say it.
   The gallery is also a few-shot example, so it must be idiomatic: split into screens by topic, each
   following the rules (one filled button per screen; `danger` shown in a "Delete all" row with `secondary`
   beside it; `List keyBy`). Two or three curated exemplar apps join the few-shot, and the navigation example
   is rewritten around `Screen title` with its automatic header back.
5. **The reference is the contract.** `docs/sdk-reference.md` describes exactly what the SDK does. A stale
   line there is a bug in what the generator learns (today: presets and shapes that no longer exist, and no
   word about `tileColor`).
6. **Names are forgiving.** Tints and icons are closed sets, but a near miss never costs a repair turn: an
   alias map resolves common and legacy names with a build diagnostic, and an unknown name falls back
   deterministically (§3.4, `04`). Never blank, never a crash.

## 14. Wayfinding and settings

- Every screen answers: where am I (the title), how do I get out, and what's the main thing to do here (the
  bottom action).
- Shell pushed screens (Settings, Advanced, History, Report) sit on the native stack: back is the header
  control and the OS gesture. Sheets close with their X, a drag or the scrim.
- Over a running app: the orb is the guaranteed exit (orb → Whim sheet → "Back to your apps"); the SDK header
  back pops in-app screens; Android system back pops in-app depth through the existing nav-depth seam and
  closes the app at depth 0. No edge swipe over the WebView in v1. A crashed app keeps the orb and adds a plain
  "Back to your apps".
- The orb is a 44 pt opaque `raised` disc with a 20 pt ember and a 52 pt target, `shadow-floating`. It drags
  between two snap points, bottom-trailing (default) and bottom-leading, chosen by momentum projection and
  remembered per app. Both corners sit inside the existing `chromeInsetBottom` reservation, which SDK `Screen`
  and SDK `Modal`'s action row honour, so app content never sits under it. It hides while the keyboard is up,
  on the host's own keyboard signal, and never hides or moves because an app said so. An 8 pt `ember` dot on
  it means "a new version is ready" or "your app finished".
- A destructive action either can be undone (deleting an app: a 10 s Undo toast, purged after) or sits behind
  a confirm sheet with a sentence explaining it ("Make a new ID", the own-server switch).
- Settings puts what people change first and diagnostics one level down: a "Language" row in the body, "AI
  features" with the subtitle "Review what's sent". Per the owner, "This phone's ID" (truncated in the middle)
  and "Make a new ID" live under Advanced, with error-detail sending and the own-server switch.

## 15. Reversals and bridge changes

For the decision entry and the C2 spec deltas.

### 15.1 Standing decisions

| Decision | Status | Was | Becomes | Source |
|---|---|---|---|---|
| #59 | Reversed | Two systems: fixed shell, free-form apps | One system, two renderers | #59, `docs/design/README.md:201-210` |
| #59 | Reversed | Instrument Sans, IBM Plex Mono, Newsreader italic | System fonts | #59 |
| #59 | Reversed | Ink violet accent | Ember for Whim, tint for apps, ink for the system | #59 |
| #59 | Reversed | Mono uppercase eyebrows, Whim Syntax on mono and serif | Sentence-case headers, simplified marks | #59 |
| #59 D4 | Reversed | Free hex `tileColor`, exact-match reserved hues | Ten named cool tints, aliases, host assignment | #59 D4, `tiles.ts` |
| #62 | Reversed | One fixed light palette as a module constant | Light and dark from the phone; still no picker | #62 |
| README | Reversed | Brown `yours` | Your words in italic quotes, `text`, `title3` as the hero | `docs/design/README.md:155-161` |
| Research §8.1 | Amended | The build screen stays still | The making page carries the ember, whose glow follows the stream | animation research §8.1 |
| #67 | Kept over running apps; amended for shell screens | D3: no edge-swipe back; D5: leave a running app through the orb | No edge swipe over the WebView in v1. Settings, Advanced, History and Report move to a native stack, so the OS gives them edge, content-area and predictive back. D3's reasons (WebView pan, PanResponder fighting scroll views) don't apply to a UINavigationController or Fragment stack. | #67 D3, D5, D7 |
| #42 | Realised | The orb affordance is draggable; seeded examples are labelled | The orb drags between two bottom corners; "Example" labels stay | #42 |
| #45 | Kept, extended | Theme is inert data on the init frame; no new message kinds | Same frame, more fields (§15.2 item 1); no new message kind | #45 |
| #43 | Kept | `cues.haptic` is manifest-gated | Still gated; SDK controls emit no haptics | #43 |
| #41 | Kept | Append-only registry | No syscall added or changed | #41 |
| #43b | Kept | A copy gets its own data | Copies start fresh; History asks no shared-data question | #43b, `HistoryScreen.tsx:228` |
| README, research §4 | Kept | "No name, no face"; "don't build a character" | The mark is a light with no face and no name | `docs/design/README.md:183`, animation research §4 |

### 15.2 Bridge, theme and haptics surfaces

Each item is one C2 spec delta (capability-bridge or sdk-runtime).

1. **Theme init frame gains fields.** Host to realm, on the existing `__whimHostInit.theme`: `scheme`
   (`'light'`|`'dark'`), `tint` (closed name), `fontScale` (number, clamped 0.85–2.0, default 1),
   `reduceMotion`, `increaseContrast` (booleans, default false), `platform` (`'ios'`|`'android'`), and the roles
   `sheet`, `sheet-group`, `thumb`. Inert data, sanitised field by field with fallbacks, read once at mount;
   changes apply at the next open. Authority: only the host writes the init frame. Forgery: a bundle that
   mutates the installed global only mis-themes itself (#45). No generation fence is needed because nothing is
   sent after mount.
2. **Runtime page.** The viewport drops `maximum-scale=1` (`build/assemble.mjs:204`); the page sets
   `color-scheme: light dark`, so native pickers and date inputs follow the scheme. No CSP change. The SDK's own
   CSS basics (`user-select: none` on controls only, `-webkit-tap-highlight-color: transparent`,
   `overscroll-behavior`, `touch-action`) are SDK internals, not a surface change.
3. **Opening uses the loader's existing post-mount control frame.** Realm to host, written by the trusted
   loader and nonce-authenticated as today; the host holds the opening morph until it arrives (cap 600 ms). If
   that frame turns out to precede paint, the loader adds a `firstPaint` field to it. A bundle can't forge a
   loader frame (F4); the worst a slow or hostile app can do is make the plate wait 600 ms. Fenced by
   generation like every other loader frame.
4. **`cues.haptic`.** Same syscall, same manifest gate, same closed set, played through `WhimHaptics`, with a
   host-side cap of 10 per second and a burst of 3 (extra calls dropped, not queued). Authority stays
   `ev.source === window.parent` (#41); the dispatcher's generation fence drops calls from a reset realm. The
   worst a hostile app with the cue grant can do is buzz ten times a second.
5. **Withdrawn from Phase B**, no frame added: live theme updates; scroll direction (M28); ungated UI haptics;
   a root-close request for an edge swipe; modal-open and input-focus reports. The orb's keyboard hiding uses
   the host's own keyboard signal, and the orb's corners sit inside `chromeInsetBottom`, so neither needs the
   app's word.

Post-v1 spike, not adopted: a host-owned native `UIScreenEdgePanGestureRecognizer` on the WebView's native
container, with the WKWebView scroll-view pan required to fail and live only at reported depth 0. Acceptance:
on a device, with an opaque-origin iframe, a leading-edge drag at depth 0 tracks a close; a slider and a
carousel at the leading edge still drag; a forged depth only toggles the convenience, and the orb still exits.

### 15.3 Native work

- `WhimHaptics` TurboModule (same pattern as `WhimTone`).
- `react-native-screens` native stack for shell pushed screens, plus
  `android:enableOnBackInvokedCallback="true"`. Verify on device that the pinned screens version supports
  predictive back and coexists with RN `BackHandler` (which the running app's back still uses).
- Launch screen hold: on iOS an overlay that copies the storyboard; Android 12+'s splash puts the icon in a
  circle mask, so the Android launch layout differs.
- Keyboard tracking: choose `useAnimatedKeyboard` or `react-native-keyboard-controller` against Reanimated
  4.6's current guidance.
- One warm WebView kept in a pool, not warmed on touch-down.
- Pins for Reanimated, worklets, Gesture Handler and SVG.

### 15.4 Phasing

1. Tokens, type, dark mode, icons, `Sheet`, copy, Settings.
2. Reanimated with sheet, press and native-stack push.
3. Container transforms and honest light.
4. SDK motion and cue haptics.

## 16. Settled in Phase B

| Question | Answer | Where |
|---|---|---|
| Tile identity | Tint plus one glyph, both picked by name, both with an alias map and a deterministic fallback; "Customize tile" in v1; live tiles later | `04-mini-app-icons.md` |
| Haptics from SDK controls | None. Apps get haptics only through gated `cues.haptic`, rate-capped by the host | §10 |
| The orb | One spec: 44 pt `raised` disc, 20 pt ember, 52 pt target; drags between the two bottom corners; the top capsule would cover every app's header | §14, `06-ux.md` §3 |
| Back over a running app | The orb and the SDK header back; Android back pops in-app depth; no edge swipe in v1 | §14, §15.1 |
| Clarify and plan | Merge into one page; changing starts inside the running app | `06-ux.md` §1, §2 |
| Home header | "Your apps" as the title; the brand lives in the composer's ambient light and the icon | `06-ux.md` §5 |
| Highlighting switch | Removed | `06-ux.md` §7 |
| Reduce Motion switch | Removed; the OS setting only | §9.6 |
| iOS tracking | Keep the table; the iOS capture renders SF, and the mockups show the table at 390pt. Re-check on a device in the implementation pass | `02-screens.md` |
| Time ranges | Measured percentiles in one constant, from the flowbench; live server percentiles later | `06-ux.md` §1 |
