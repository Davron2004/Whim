# Motion

Phase B of `design-system-v1`. Every moment that moves: what triggers it, what moves, which spring, how it is
interrupted, and what Reduce Motion shows instead. Springs and timing tokens are fixed in
`01-direction.md` §9.2:

| Spring | Response, ζ | Stiffness, damping (mass 1) | 95% / settled |
|---|---|---|---|
| `instant` | 0.12, 1.00 | 2741.6, 104.72 | 91 / 215 ms |
| `snappy` | 0.28, 1.00 | 503.6, 44.88 | 212 / 451 ms |
| `smooth` | 0.40, 1.00 | 246.7, 31.42 | 302 / 616 ms |
| `fling` | 0.35, 0.80 | 322.3, 28.72 | 189 / 521 ms from rest |
| `morph` | 0.50, 0.90 | 157.9, 22.62 | 320 / 657 ms |
| `spark` | 0.55, 0.55 | 130.5, 12.57 | 209 / 1145 ms, 12.6% overshoot |

`fade-in` 160 ms and `fade-out` 120 ms use `cubic-bezier(0.23, 1, 0.32, 1)`; `color` is 150 ms; `stagger`
is 30 ms for the first six items.

## Rules that apply to every moment

1. **Earned by frequency.** Things touched tens of times a day (press, navigation, toggles) are fast and
   critically damped. Bounce and longer beats are kept for rare moments: an app becoming ready, the first app.
2. **Start from what's on screen.** Every animation reads the presentation value and retargets the running
   spring with its velocity. Nothing restarts from a stored start value, and nothing jumps.
3. **Never block input.** A tap during a transition goes to where the thing is now. The orb's "rows refuse
   taps while rising" (`Orb.tsx:59-63`) goes away: the menu becomes a sheet whose rows are where they look.
4. **Same path out as in.** Exits run on `smooth` or `fade-out` and are faster than entrances.
5. **No JS-driven layout per frame.** Transform and opacity by default; colour changes use `color`. Layout
   that has to animate runs on the UI thread: Reanimated layout transitions for reflow in the shell, and a
   single leaf view's width, height and radius for the opening container (M2). The SDK uses FLIP. No
   non-uniform scale on a rounded shape.
6. **Text never animates in.** Arriving prose appears as it arrives (kept from v2).
7. **Haptics land on the frame they confirm** (`01-direction.md` §10). SDK motion carries no haptics.
8. **Gestures commit by projection.** A drag commits when its projected end passes the threshold and the
   release velocity doesn't point back; position alone never commits.

## Moments

M-numbers are referenced from `02`, `03` and `06`. The research's 12 moments (`docs/research/
animation-options-2026-09.md` §5) are noted as R-numbers. What moves today is inventoried in `00-audit.md` §11 and, with
recordings, in the capture index (`Whim-evidence/design-audit-2026-10-09/INDEX.md` §2–3); the two agree.

### Touch

| # | Moment | Trigger | What moves | Spring | Interrupt | Reduced |
|---|---|---|---|---|---|---|
| M1 (R2) | Press | Touch-down on any pressable | Scale to 0.97 (buttons, rows), 0.96 (tiles, cards, chips), 0.92 (icon buttons) | In `instant`, out `snappy` | Dragging 10pt off cancels and springs back; dragging back re-presses | Opacity to 0.7 over 100 ms instead of scale |
| M15 (R12) | Selection controls | Chip, switch, segment, checkbox, stepper | Chip fill (`color`); switch knob x; segment thumb x; checkbox fill plus check stroke drawn over 160 ms; stepper digit rolls 6px with a cross-fade | `snappy` (in apps, knobs and thumbs on the rAF spring) | Any new value retargets from the current position with its velocity | Instant state change, colour cross-fade kept |

### Opening and closing apps

| # | Moment | Trigger | What moves | Spring | Interrupt | Reduced |
|---|---|---|---|---|---|---|
| M2 (R3) | Open an app | Tap a ready tile | A `bg` container (the app's canvas) grows from the tile's rect to the screen: its width, height and corner radius animate on the UI thread as one leaf view (Reanimated), so corners stay round and nothing scales non-uniformly. The tint stays a tile-sized plate with its glyph at the centre. The WebView comes from a pool of one kept warm; it stays hidden until the loader's existing post-mount control frame arrives (cap 600 ms; the loader adds a `firstPaint` field to that frame if it precedes paint), then cross-fades in over 160 ms while the plate fades | `morph` | Back during the grow reverses from the current frame (M3) | 160 ms cross-fade from home to the app |
| M3 (R4) | Close an app | Orb → Back to your apps, Android back at depth 0 | The reverse: the app shrinks into its tile's rect, the plate returning over its content, the tile un-hides at the end. Not finger-tracked; there is no edge swipe over a running app in v1 | `smooth` | Re-opening during the shrink retargets to full screen | Cross-fade |
| M20 (R9) | Honest light | Stream activity while making or changing | Ember glow intensity and flicker on the making page's mark and ambient light, the composer's ambient light, the ghost tile, a changing tile's ring and the orb | Smoothed by a critically damped spring, response 0.6 s; flicker from token arrivals only (`01-direction.md` §9.5) | Continuous | A still intensity per state (working, stuck, out), swapped with a cross-fade |

### Making an app

| # | Moment | Trigger | What moves | Spring | Interrupt | Reduced |
|---|---|---|---|---|---|---|
| M6 | Composer to Describe | Tap the composer bar | The bar's capsule grows into the Describe sheet; its placeholder becomes the field's placeholder in place; the keyboard rises on its own curve | `morph` | Swipe down returns into the bar along the same path | Sheet cross-fades in |
| M7 (R10) | Describe to Plan | Continue | The flow sheet pushes the Plan page in from the trailing edge; the description travels from the field to the top of the plan as your quoted words | `smooth` | Back reverses mid-push | Cross-fade |
| M8 (R7) | Plan arrives | Questions (about 1.8 s) then plan rows (about 2.3 s more) | The 48 ember sits at the top; each group replaces its skeleton with a 160 ms cross-fade; rows rise 8px with `stagger` the first time only. An answered question collapses to its summary line once scrolled past; tapping it reopens | `fade-in` + `smooth` | New data replaces in place; a reopen retargets the collapse | Cross-fade, no rise |
| M25 | Edit a plan row | Tap a row | The row grows into a text area; Save and Cancel fade in under it | `smooth` | Cancel reverses | Instant |
| M9 | Make it | Tap Make it | The 48 ember in the plan header travels and scales to the making page's 128; the plan cross-fades out under it; the person's words and the steps fade in; the step marker later moves down to a "Fixing" row on `repair` with `snappy` | `morph` | Closing during the move leaves for home (M5) | Cross-fade |
| M5 | Leave it running | The close X, back, swipe down or scrim tap | The making sheet shrinks into its ghost tile on the grid, ember first; the tile's glow takes over | `smooth` | Tapping the tile again reverses | Cross-fade |
| M10 | Ready | The app is delivered while the making view is open | The ember flares (`spark`, scale 1 → 1.18 → 1) and settles into the 96 tile as the tile rises from 0.6 to 1 with `spark`; the name, the person's words and the buttons fade in 80 ms apart | `spark` | Tapping Done at any point jumps to the end state and closes | Cross-fade to the final layout, no flare |
| M4 (R1) | Ghost becomes tile | Delivery while the home grid is visible | The ember tile flares once (`spark` on the glow); the squircle fills with the tint from the centre (a circle mask scaling from 0 to the tile's diagonal); the glyph fades in from 0.9 | Fill and glyph `morph`, glow `spark` | Opening the tile mid-way finishes it at once | Cross-fade from ember tile to app tile |
| M22 (R11) | Making fails | Terminal failure | The ember goes out: the glow fades over `fade-out` and the `fill-strong` silhouette remains; the failure content cross-fades in. No shake | `fade-out` + `fade-in` | n/a | Cross-fade; ember still |

### Sheets, menus and screens

| # | Moment | Trigger | What moves | Spring | Interrupt | Reduced |
|---|---|---|---|---|---|---|
| M11 (R6) | Sheet | Present, dismiss, drag | Sheet y from off-screen; scrim opacity follows position. Drag tracks 1:1 after 10pt; release projects (`current + (v/1000)·0.998/(1−0.998)`) and picks the nearest detent, or dismisses when the projected end passes half the height and the velocity doesn't point back up; velocity is handed on | Tapped: `smooth`. Released: `fling` | Grab at any time, including mid-dismiss | Cross-fade; drag still follows the finger and commits with a cross-fade |
| M21 (R6) | Orb to Whim sheet | Tap the orb | The sheet rises from the bottom edge under the orb; the orb dims to 0.6 while the sheet is up | `smooth` | Tap the orb again or drag down | Cross-fade |
| M12 | Context menu | 350 ms long-press on a tile | Tile lifts to 1.06 with shadow (`snappy`), scrim fades in, menu grows from the tile edge (scale 0.92 → 1, transform origin at the tile) | `snappy` lift, `smooth` menu | Releasing before 350 ms is a normal tap; moving 10pt before then cancels; a second step swaps rows with a 120 ms cross-fade | Menu cross-fades; tile doesn't lift |
| M13 | Push and pop | Opening Settings, Advanced, History, Report, AI features; back | The native stack's own transition (`react-native-screens`): UINavigationController push with edge and iOS 26 content-area swipe; Fragment transitions with predictive back on Android (`enableOnBackInvokedCallback`). Whim draws none of it | The platform's | The platform's | The platform's |
| M16 | Orb moves corner | Drag the orb | The orb tracks the finger 1:1 after 10pt; release projects and snaps to bottom-trailing or bottom-leading, both inside `chromeInsetBottom`; the corner is remembered per app | `fling` | Grab at any time | Tracks the finger, settles with a cross-fade |
| M14 | Toast | Shown, auto-dismissed, swiped | Rises 16px from below with a fade; leaves the same way; swipe down tracks the finger | In and out `smooth`; swipe `fling` | A new toast replaces the current one in place | Cross-fade |
| M26 | History row | Tap a version | The row expands; following rows move down; actions fade in | `smooth` (layout transition) | Tap again to collapse from the current height | Instant |

### Home

| # | Moment | Trigger | What moves | Spring | Interrupt | Reduced |
|---|---|---|---|---|---|---|
| M17 (R5) | Grid appears | First launch and returning from onboarding only | Tiles rise 8px and fade in, `stagger` across the first six, the rest together | `smooth` | Touching the grid finishes it | Appear at once |
| M18 | Delete an app | Delete in the tile menu | The tile shrinks to 0.8 and fades (`fade-out`), then the tiles after it slide into place; Undo plays it backwards | `smooth` reflow | Undo retargets from the current frame | Remove at once, neighbours cross-fade |
| M19 (R8) | Skeleton | A local load that passes 300 ms | Opacity 0.34 ↔ 0.72 on a 1.9 s cycle | `breathe` | Content replaces it with `fade-in` | Static at 0.6 |
| M27 | Launch to home | Cold start | The native launch screen holds until Home has drawn its first frame, then cross-fades over 160 ms. iOS: an overlay copying the storyboard (the ember on `bg`); Android 12+: the system splash, icon in its circle mask | `fade-in` | n/a | Same |
| M23 | Keyboard | Keyboard shows or hides | Sheets and bottom actions follow the keyboard frame by frame (Reanimated keyboard tracking on both platforms, `useAnimatedKeyboard` or `react-native-keyboard-controller`, chosen in C2; replaces the iOS-only `LayoutAnimation` in `KeyboardShell.tsx:89-94`). Over a running app the orb fades out as the keyboard rises and back as it falls, on the host's own keyboard signal | The keyboard's own curve | n/a | Same; it is not decorative |

### Inside apps (SDK)

| # | Moment | Trigger | What moves | Spring | Reduced |
|---|---|---|---|---|---|
| M24 (R12) | Screen push and pop | `nav.navigate`, `nav.back`, the header back, Android back | iOS style on iOS (new screen from the trailing edge, previous to −30% with a 0.12 dim), shared X axis on Android, from the theme's `platform`. No edge swipe in v1 | `smooth` | Cross-fade |
| M24 | Modal | `visible` changes | As M11 | `smooth` / `fling` | Cross-fade |
| M24 | List rows | Items of `<List items keyBy renderItem>` mount or unmount after the first render. Children-style `List`, and duplicate or index-shaped keys, don't animate (dev diagnostic) | Enter: rise 8px and fade in. Leave: `fade-out`, then neighbours close the gap (FLIP) | `smooth` | Instant |
| M24 | Progress | `value` changes | Bar fill or ring arc | `smooth` | Instant |
| M24 | Toast | `toast()` | As M14 | `smooth` | Cross-fade |
| M24 | Controls | As M1 and M15 | | | |

The SDK runs the same springs. At build time each one is sampled at 60 Hz into a CSS `linear()` easing with
its settled duration. `linear()` needs Safari 17.2 and the iOS floor is 15.1, so the SDK checks
`CSS.supports('animation-timing-function', 'linear(0, 1)')` once and otherwise uses the nearest
cubic-bezier. WAAPI plays fire-and-forget motion only (enter, leave, push, toast, progress). Anything that can
be retargeted (switch knobs, segment and slider thumbs, sheet drag) runs a small `requestAnimationFrame` spring
that keeps its velocity, since a WAAPI retarget restarts at zero velocity. Reduce Motion reaches the realm on
the inert theme init frame (`reduceMotion`, at the next open) and each component honours it; the research's
paired `getAnimations()` invariant (`docs/research/animation-options-2026-09.md` §6) becomes the
owner-authored test that proves it.

## What stays still

| Candidate | Why not |
|---|---|
| Streamed prose typing in or fading in | Text that moves is text you can't read; the arrival is the animation |
| Shimmer on skeletons | A travelling gradient is decoration; breathing says "loading" with less motion |
| Shaking a field or a screen on error | Multi-axis motion reads as alarm and is on Apple's reduce list; colour, icon and words carry errors |
| Charts drawing themselves in | People read charts; motion delays the reading |
| Parallax on the home grid or the plan | Decoration on the most-used surfaces |
| Jiggle-mode reordering | A pattern to add with reordering itself, later |
| Confetti on ready | The ember's flare is the celebration; confetti is the AI-app cliché the direction rules out |
| The orb shrinking while an app scrolls | It would move on every scroll of every app; the orb stays still and opaque |
| Animating the switch between light and dark | Instant is what both platforms do in-app |
| The ember breathing while idle | Honest light: no work, no movement |

## How to check it

- Every spring is a named constant in one module per runtime; a static check rejects literal spring configs
  and any remaining `Animated.` or `useNativeDriver` in `src/host/` (the research's check, extended).
- Each moment gets a slow-motion recording (0.25×) on a mid-range Android device and an iPhone before it
  ships; the motion page in the mockups (`docs/design/mockups/index.html#motion`) is the reference to
  compare against, and uses the same values (reduced-motion press opacity 0.7, flare 1.18, projection
  commits).
- Reduce Motion is tested as a pair: with it off, the moment produces running animations; with it on, the same
  trigger produces only the reduced version.
- Opening an app is measured: tap to first paint, with and without the warm WebView from the pool, before and
  after the morph lands. No regression in time to first paint is allowed for the sake of the animation.
