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
4. **Hue says who.** Ember is Whim at work. An app's tint is that app. Ink is you and the system. Red is
   danger, green is done. Nothing is coloured for decoration.
5. **Ember replaces ink violet** as Whim's colour, and the amber wisp from `docs/mascot/` becomes Whim's
   mark: the orb, the app icon, and the presence on the make screen.
6. **Apps pick a named tint, not a hex.** The tint colours the tile and becomes the app's own `primary`.
7. **Real motion.** Springs, spatial transitions, back gestures on both platforms, interruptible everything.
   Stack: Reanimated 4.6, Gesture Handler and SVG on the host; WAAPI inside apps.
8. **Real haptics** through a small in-repo native module, in place of `Vibration`.
9. **One icon set** for the shell and the SDK, drawn as SVG. No more typed characters.
10. **One vocabulary.** One name per concept, and Whim says "I" only while it is making something.

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
| An app's tint | That app | Its tile, its name in prose, "Open it" on the done screen, the app's own buttons inside the app |
| Ink | You, and the system | Your selected answers, your quoted words, "Agree and continue", "Send report", the shell's switches, the safe button in a confirm sheet |
| Red | Danger | Delete, Discard, an error that stopped work |
| Green | It worked | Ready, restored, verified |

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
animation. Back is a gesture on both platforms: an edge swipe on iOS, predictive back on Android.

### 2.6 Native by default

System type with Dynamic Type, each platform's back gesture and back icon, the platforms' own haptic
engines, light and dark, Reduce Motion and Increase Contrast. This applies inside generated apps too, and it
has to come from the SDK's defaults, because the generator will never ask for it.

### 2.7 Plain words, one name per thing

Short, concrete, warm sentences. A concept has one name on every screen (glossary in §12). Whim speaks as
"I" when it is the maker at work, and the product speaks of "Whim" in settings and legal text.

### 2.8 Forgiving

Every change is a version, so most things can come back. Prefer an undo toast to an "are you sure". Confirm
only what can't be undone (deleting an app and its data), and when you do, the safe choice is the big button.

## 3. Colour

### 3.1 Neutrals and roles

Warm, low-chroma greys built in OKLCH (hue 60–75). Every text pair below was computed against WCAG 2.2.

| Role | Light | Dark | Use | Contrast |
|---|---|---|---|---|
| `bg` | `#F6F4F1` | `#100E0D` | Screen canvas | |
| `surface` | `#FFFFFF` | `#1B1917` | Cards, list groups, inputs | |
| `raised` | `#FFFFFF` + shadow | `#252220` + top highlight | Sheets, menus, toasts, orb | |
| `fill` | `#EBE9E6` | `#2E2B28` | Secondary buttons, segmented track, chips | |
| `fill-strong` | `#E0DDDA` | `#3C3936` | Pressed fills, skeletons | |
| `separator` | `#E2DFDB` | `#34312F` | Hairlines between rows | |
| `border` | `#908B86` | `#6E6862` | Input and outlined-control edges | 3.37 / 3.19 on surface (WCAG 1.4.11) |
| `text` | `#1A1614` | `#F2F0EC` | Primary text | 16.2 / 15.2 |
| `text-2` | `#6D6660` | `#ADA8A3` | Secondary text | ≥ 4.66 on bg, surface, fill / ≥ 6.56 |
| `text-3` | `#908B86` | `#78746E` | Placeholders and disabled only | 3.05 / 3.77 |
| `ink` | `#1A1614` | `#F2F0EC` | The system's prominent fill | |
| `on-ink` | `#FFFFFF` | `#1A1614` | Label on `ink` | 17.9 / 15.8 |
| `scrim` | `rgba(26,22,20,0.32)` | `rgba(0,0,0,0.60)` | Behind sheets and menus | |

Surfaces separate from the canvas by tone, not by outlines. Borders are for inputs and outlined controls,
where WCAG asks for a 3:1 edge. In dark mode, higher means lighter: `bg` < `surface` < `raised`.

### 3.2 Ember, Whim's colour

| Role | Light | Dark | Notes |
|---|---|---|---|
| `ember` | `#C14900` | `#F99549` | Fill of Whim's buttons |
| `on-ember` | `#FFFFFF` | `#1A1614` | 4.98 / 8.06 |
| `ember-text` | `#B14200` | `#F99549` | Text and icons; ≥ 4.75 on bg, surface, fill and `ember-soft` |
| `ember-soft` | `#FDEBDA` | `#3F2313` | Washes: a tile being made, a picked "Decide for me" |
| `glow-core` | `#FFC96A` | same | The light itself: wisp, orb, make-screen glow |
| `glow-mid` | `#FF9127` | same | |
| `glow-edge` | `#F25914` | same | |

Light mode uses the deep ember for fills because white text needs it; dark mode switches to the bright
ember with ink text, which reads as a lit button. The glow stops never carry text.

Orange from OKLCH hue 35 to 70 is reserved for Whim. Apps can't use it (§3.4). That is the cost of making
"ember means Whim" true everywhere.

### 3.3 Status

| Role | Fill light / dark | On fill | Text light / dark | Soft light / dark |
|---|---|---|---|---|
| `positive` | `#1E8347` / `#5BCC80` | `#FFFFFF` / `#1A1614` | `#1A763F` / `#5BCC80` | `#DEF6E3` / `#193521` |
| `danger` | `#C9292F` / `#F66C6D` | `#FFFFFF` / `#1A1614` | `#C22630` / `#F66C6D` | `#FFE7E5` / `#472020` |
| `warning` | `#F3BA25` / `#ECBD3A` | `#1A1614` both | `#8A6000` / `#ECBD3A` | `#FDF2D0` / `#382C0C` |

Danger sits at OKLCH hue 24 and ember at 45, so the two read as red and orange side by side. Danger always
comes with words or an icon, never colour alone.

### 3.4 App tints

An app declares one tint by name. The tint is the tile's fill and the app's `primary` inside the app.
Thirteen tints, each with a fill, a label colour on that fill, and text colours for each mode.

| Tint | Fill | On fill | Text light | Text dark |
|---|---|---|---|---|
| `red` | `#CA322E` | white | `#C52C2A` | `#F97770` |
| `pink` | `#C63170` | white | `#C02B6C` | `#F57FA7` |
| `grape` | `#A03FA7` | white | `#A03FA7` | `#D78ADB` |
| `violet` | `#764EC7` | white | `#764EC7` | `#B199F4` |
| `indigo` | `#4B53C2` | white | `#4B53C2` | `#95A4F6` |
| `blue` | `#136ED0` | white | `#096ACB` | `#67B0F9` |
| `sky` | `#007EB0` | white | `#01729F` | `#61C1ED` |
| `teal` | `#00807B` | white | `#007671` | `#55CEC0` |
| `green` | `#278445` | white | `#217B3E` | `#6CCD83` |
| `lime` | `#A8E051` | `#1A1614` | `#507308` | `#AADF5B` |
| `yellow` | `#F8CC2F` | `#1A1614` | `#866300` | `#F4CD4B` |
| `cocoa` | `#846047` | white | `#846047` | `#CEA98B` |
| `graphite` | `#51565B` | white | `#51565B` | `#ACB2B7` |

Every white label on a fill is ≥ 4.55:1, every ink label ≥ 11:1, every text colour ≥ 4.8:1 on its
background. Tile fills stay the same in both modes; tiles are objects, like icons. `cocoa` is a low-chroma
brown (C 0.06), so a coffee or sourdough app gets a warm colour without borrowing ember.

Why a token instead of today's hex: decision #13 says tokens, not values; a named tint can't fail contrast,
collide with a reserved hue by one digit, or break in dark mode; and the generator chooses better from
thirteen names than from sixteen million hexes. The reserved-hue check that compares hex strings exactly
(`tiles.ts:19-30`) goes away because nothing can name a reserved hue. Apps installed with a hex `tileColor`
map to the nearest tint in OKLCH: greys to `graphite`, low-chroma browns to `cocoa`, and ember-range hues to
`red` or `yellow`, whichever is closer.

### 3.5 Inside apps

A mini-app's theme stays inert data on the existing init frame (decision #45): the host sends the resolved
scheme (light or dark) and the app's tint, `sanitizeTheme` checks them field by field, and the SDK resolves
tokens from them. No capability, no CSP change. The SDK's colour roles keep their names, so every existing
bundle re-themes without a rebuild:

| SDK role | Resolves to |
|---|---|
| `bg`, `surface`, `border`, `text`, `text-muted` | `bg`, `surface`, `border`, `text`, `text-2` |
| `primary`, `on-primary` | the app's tint fill and its on-fill colour |
| `positive`, `danger`, `warning` | status fills (and their text forms when used as text) |

Components choose the fill or the text form of a role themselves, so `<Text color="primary">` gets the
readable text colour and `<Button>` gets the fill. The generator can't produce an unreadable pairing.

A change of the phone's appearance while an app is open reaches the realm as a new theme frame, fenced by
generation like every other host frame. Recreating the realm would also work but loses the app's
navigation stack, so it is the fallback, not the plan.

### 3.6 Colour rules

- One accent hue per control, one hue family per screen region. A screen may show ember and an app tint
  together (the done screen) but never inside one control.
- No gradients except the ember glow. No tinted shadows except the glow.
- Selection is ink: picked answers, the segmented thumb's label, the selected filter.
- Disabled is `text-3` on `fill`, never a lowered opacity over a coloured control.
- The runtime page, the iframe and `Screen` paint the same `bg`, so opening an app never flashes.

## 4. Typography

### 4.1 One family, the system's

SF Pro on iOS, Roboto on Android, and `system-ui` inside apps, which resolves to the same two. Reasons, in
order of weight:

1. Apps can't load any other font. The CSP leaves `font-src` at `'none'`, and widening it is off the
   table. A custom shell face guarantees two typographic worlds.
2. The iOS shell already falls back to the system font; the custom faces were never bundled for iOS.
3. System fonts carry optical sizing and size-specific tracking, follow Dynamic Type, and ship real
   weights and italics on both platforms. The Android `_bold`/`_italic` file copies disappear.
4. Whim's identity comes from the ember, the wisp, the tiles, the motion and the voice. Apple's own apps
   share one face and still look like themselves.

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

- Twelve is the floor. Nothing is smaller, anywhere.
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
- The user's own words are set in the body face's italic inside quotation marks, in `text`. Not brown, not a
  serif.
- Text scales with the system setting up to 200%. Containers grow with their text: buttons take
  `minHeight`, never `height`; single-line labels may truncate, prose never does.
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
| Touch target | 44 pt on iOS, 48 dp on Android, reached with `hitSlop` when the visual is smaller (36 minimum) |

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
| 1 | `surface`, no shadow | `surface` | Cards, list groups, inputs |
| 2 | `raised` + `shadow-raised` | `raised` + 1px top highlight `rgba(255,255,255,0.06)` + dark shadow | Sheets, menus, toasts, popovers |
| 3 | `raised` + `shadow-floating` | as level 2, stronger shadow | The orb, the home composer bar |

Shadows (RN `boxShadow`, the same string in CSS):

- `shadow-raised`: light `0 1px 2px rgba(26,22,20,0.08), 0 8px 24px rgba(26,22,20,0.12)`; dark
  `0 1px 2px rgba(0,0,0,0.40), 0 8px 24px rgba(0,0,0,0.50)`.
- `shadow-floating`: light `0 2px 6px rgba(26,22,20,0.12), 0 12px 32px rgba(26,22,20,0.16)`; dark
  `0 2px 6px rgba(0,0,0,0.50), 0 12px 32px rgba(0,0,0,0.60)`.
- `glow-ember`: `0 0 0 1px rgba(255,145,39,0.35), 0 6px 28px rgba(255,145,39,0.45)`, the only coloured
  shadow, for the orb and the wisp.

Rules:

- A modal task dims what's behind it with `scrim`; a non-blocking panel doesn't.
- Where floating chrome overlaps scrolling content, the content fades out over 16pt under it (a gradient of
  `bg`). No hairline under headers.
- **No blur in v1.** Backdrop blur needs another native dependency on Android, costs frames on mid-range
  WebViews, and Apple's own Reduce Transparency fallback is the solid surface this system uses anyway. If a
  later version adds glass, it adds it to level 3 only.
- Increase Contrast: level-1 surfaces get a 1px `separator` outline and `text-2` becomes `text`.

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

### 8.2 The wisp

The mascot study (`docs/mascot/`) gets adopted, cut down to what can be drawn from simple geometry and
animated by moving, not redrawing. This overrides the animation research's "don't build a character"
(`docs/research/animation-options-2026-09.md` §4) for three reasons: the make wait lasts minutes and needs a
presence that isn't a progress bar; the eyeless version doubles as the orb and the app icon, so it is one
asset family rather than a separate character pipeline; and its glow is the liveness indicator, so it has a
job (§2.4).

- **Body.** One closed silhouette: a round head that tapers into a curling tail, on a 48 grid. Filled with a
  radial gradient from `glow-core` (upper left) through `glow-mid` to `glow-edge` at the rim, with
  `glow-ember` around it.
- **Eyes.** Two vertical ovals in `#1A1614` with a white catchlight. No brows, no mouth, no limbs. Eyes appear
  only at 48pt and above; smaller, the wisp is the eyeless ember.
- **Poses**, all made by moving the same parts:

| Pose | When | Change |
|---|---|---|
| Listening | Empty home, compose | Eyes open, slow random blinks (4–9 s) |
| Thinking | Clarify and plan waits | Eyes up and to the side, body tilts 6° |
| Making | Make screen | Eyes down, glow follows the stream (§9.5) |
| Stuck | No bytes for 40 s | Glow dims to 35%, eyes half closed, body sinks 4% |
| Failed | Failure screen | Glow 40%, eyes droop, tail curls under |
| Done | App ready | Eyes become arcs, the glow flares once (`spark`) |

- **Where it appears:** the make screen (about 120pt), the clarify and plan waits (48pt next to the
  working line), failure (64pt), the ready moment, the first-run empty home, the orb (eyeless, 28pt on a
  52pt `raised` disc), the app icon, the launch screen.
- **Where it never appears:** inside an app's content, in settings or legal screens, as list decoration,
  with a speech bubble, or with a name. The handoff's "no name" rule stays; its "no face" rule doesn't.
- **App icon:** the wisp with eyes on a warm dark ground (`#1A1614` to `#2A2420`), with iOS dark and tinted
  variants and an Android adaptive icon whose monochrome layer is the silhouette.

## 9. Motion

### 9.1 Stack

- Host: `react-native-reanimated@4.6.0` with `react-native-worklets@0.12.2`, pinned exact (verified in the
  animation research), `react-native-gesture-handler` for the back swipe and draggable sheets, and
  `react-native-svg` for icons, tiles and the wisp. The OpenSpec change pins and re-verifies all four against
  RN 0.85.3. RN `Animated` and `LayoutAnimation` are retired from `src/host/`.
- Apps: the Web Animations API. Springs are compiled into CSS `linear()` easing curves at build time, so a
  spring inside an app and the same spring in the shell trace the same path. Gesture-driven parts of SDK
  components (slider thumb, sheet drag) run a small JavaScript spring on `requestAnimationFrame`, which the
  sandbox allows.
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
- iOS back: an edge swipe from the leading 20pt. The screen tracks the finger, the previous screen slides
  in from −30% and its dim fades from 0.12 to 0. It commits past 50% of the width or above 500 pt/s.
- Android back: predictive back. While the gesture runs, the screen scales to 0.92 and shifts 8% toward the
  gesture edge; release commits with `smooth`.
- Only `transform` and `opacity` animate. Never layout properties, never in either runtime.
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
| 11 error | `fade-in` plus the wisp's failed pose, no shake |
| 12 in-app motion | the same springs through WAAPI |

The research put build aliveness only on the ghost tile and kept the build screen still. With honest light,
the make screen gets the wisp and the tile gets the same glow, smaller; both follow the stream, so neither is
theatre.

### 9.5 Honest light, specified

- Input: activity `a` from the stream's own signals, `a = clamp(tokensPerSecond / 40, 0, 1)`, with the 40
  calibrated against real runs. Reasoning tokens count as activity even though the user never sees them.
- Glow intensity `I = 0.55 + 0.45 · ã`, where `ã` is `a` smoothed by a critically damped spring with
  response 0.6 s.
- Flicker of amplitude `0.06 · ã`, only while a token arrived in the last 500 ms. Its timing comes from token
  arrivals, never from a timer.
- Stuck after 40 s with no bytes (`STALL_MS`): intensity eases to 0.35 over 1.5 s and the pose changes.
- Nothing about the ember loops on a clock. If no work arrives, nothing moves.

### 9.6 Reduce Motion

Honoured from the OS setting, plus an in-app switch that can only add reduction
(`effective = userToggle || system`), as the research proposed.

| Normally | Reduced |
|---|---|
| Push, pop, sheets, morphs, flings | 160 ms cross-fade in place |
| Press scale | Opacity to 0.7, 100 ms |
| Stagger | Everything at once |
| `spark` | Plain `fade-in` |
| Ember flicker and pose motion | Three still states (working, quiet, stuck), changed by cross-fade |
| Skeleton breathe | Static at 0.6 |
| Back gesture | Still tracks the finger (direct manipulation stays), commits with a cross-fade |

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
| A drag crosses its commit point (back swipe, sheet dismiss) | impact rigid, intensity 0.6 | `GESTURE_THRESHOLD_ACTIVATE`, `CONTEXT_CLICK` |
| You hand work to Whim (Make it, Make the change, Try again) | impact medium | `CONFIRM` (API 30), `VIRTUAL_KEY` |
| App ready | notification success | `CONFIRM` |
| Making failed | notification error | `REJECT` (API 30), `LONG_PRESS` |
| Delete or discard confirmed | notification warning | `REJECT` |
| Version restored, copy made | notification success | `CONFIRM` |

Never on plain taps, navigation, scrolling, typing, opening an app, or a sheet opened by a tap.

Apps keep the closed `cues.haptic` set, now played through the same module: `tap` is impact light
(`EFFECT_CLICK`), `double` two light impacts 80 ms apart (`EFFECT_DOUBLE_CLICK`), `heavy` impact heavy
(`EFFECT_HEAVY_CLICK`).

## 11. Sound

None in the shell. Phones live on silent, every Whim moment already has a visual and a haptic, and the only
sounds that should mean something on this device are an app's own timer chimes and alarms. A finished
app reaching you while you're in another app is a job for a system notification later, not a sound now. App
cue sounds (`tick`, `chime`, `alarm`) stay as they are.

## 12. Voice and tone

### 12.1 Who speaks

- **The maker** (Whim at work: clarify, plan, make, failure, ready) may say "I", and mostly needs no pronoun
  at all: "Two quick questions." beats "I have two quick questions."
- **The product** (settings, consent, terms, store, errors unrelated to making) speaks of "Whim", and "we"
  where the company has to speak.
- **The person** is "you".

### 12.2 One name per thing

| Concept | Say | Don't say |
|---|---|---|
| What Whim makes | app | mini-app, project |
| Creating one | make: "Make it", "Making…", "Couldn't make this" | build, generate, create |
| Asking for a change | change: "Change it", "What should change?" | prompt again, edit |
| The list of versions | History | Versions, timeline |
| One of them | version | snapshot, commit |
| Going back to one | "Go back to this version" | restore, revert |
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
| Making it · "This takes about a minute. You can leave and come back." | Making Pour Timer · "Usually about a minute. You can leave; it keeps going.", then a longer line as the wait passes the median and the 90th percentile |
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
2. **Feel comes from defaults.** Press scale, sheet motion, list insert and remove, selection haptics where
   the containment model allows them, dark mode and the app's tint are built in, so a generated app with no
   motion code still moves correctly. The generator prompt stops dictating layouts ("main content inside a
   Card, … a Badge …", `server/src/generation/prompts/index.ts:436-438`) and points at good defaults instead.
3. **Small but complete.** New components and motion primitives are welcome when they earn a place: a real
   app needs them and an LLM can use them correctly the first time. Duplicates merge (`Heading` and `Text`
   cover the same sizes today). Phase B proposes the additions and removals.
4. **The style gallery mirrors the SDK.** `fixtures/style-gallery.app.tsx` shows every component, every
   variant and every motion preset, always. A change that adds, changes or removes an SDK component isn't
   done until the gallery shows it. The OpenSpec change will carry this as an explicit task in every chain
   that touches an SDK component and as a requirement in its spec, and `docs/design/system.md` will say it.
5. **The reference is the contract.** `docs/sdk-reference.md` describes exactly what the SDK does. A stale
   line there is a bug in what the generator learns (today: presets and shapes that no longer exist, and no
   word about `tileColor`).

## 14. Wayfinding and settings

- Every screen answers: where am I (the title), how do I get out (back in one place, by gesture on both
  platforms), and what's the main thing to do here (the bottom action).
- Destructive actions live on a screen with a sentence explaining them, never one tap away in a menu.
- Settings puts what people change first and diagnostics one level down. Per the owner, "This phone's ID"
  and "Make a new ID" move under Advanced, together with error-detail sending and the own-server switch.
  Phase B lays out the rest.

## 15. What this reverses

For the decision entry in Phase C:

| Was | Becomes | Source of the old rule |
|---|---|---|
| Two systems: fixed shell, free-form apps | One system, two renderers | `docs/design/README.md:201-210`, #59 |
| Instrument Sans, IBM Plex Mono, Newsreader italic | System fonts | #59 |
| One fixed light palette as a module constant | Light and dark resolved from the phone; still no picker | #62 |
| Ink violet accent | Ember for Whim, tint for apps, ink for the system | #59 |
| Brown `yours` | Your words in italic quotes, ink | `docs/design/README.md:155-161` |
| Free hex `tileColor` with exact-match reserved hues | Named tint token | #59 D4, `tiles.ts` |
| "No name, no face" for the agent | A face (the wisp), still no name | `docs/design/README.md:183` |
| "Don't build a mascot; the build screen stays still" | The wisp, driven by honest light | animation research §4, §8.1 |
| Mono uppercase eyebrows, Whim Syntax on mono and serif | Sentence-case headers, simplified marks | #59 |

## 16. Settled in Phase B

| Question | Answer | Where |
|---|---|---|
| Tile identity | Tint plus one glyph, both picked by name; monogram letter as the fallback; live tiles later | `04-mini-app-icons.md` |
| Haptics from SDK controls | Selection-strength only, through the host, rate-limited, without `cues`; heavier haptics stay gated | `03-components.md`, end |
| The orb | Stays bottom-trailing as a 44pt ember disc; the top capsule would cover every app's header | `06-ux.md` §3 |
| Clarify and plan | Merge into one page; changing starts inside the running app | `06-ux.md` §1, §2 |
| Home header | "Your apps" as the title; the brand lives in the composer's ember and the icon | `06-ux.md` §5 |
| Highlighting switch | Removed | `06-ux.md` §7 |
| iOS tracking | Keep the table; the iOS capture renders SF, and the mockups show the table at 390pt. Re-check on a device in the implementation pass | `02-screens.md` |
| Time ranges | Measured percentiles in one constant, from the flowbench; live server percentiles later | `06-ux.md` §1 |
