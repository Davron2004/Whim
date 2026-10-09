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
5. **Only transform and opacity.** Colour changes use `color`. Layout reflow uses Reanimated layout
   transitions in the shell and FLIP in the SDK, both transform-based.
6. **Text never animates in.** Arriving prose appears as it arrives (kept from v2).
7. **Haptics land on the frame they confirm** (`01-direction.md` §10).

## Moments

M-numbers are referenced from `02`, `03` and `06`. The research's 12 moments (`docs/research/
animation-options-2026-09.md` §5) are noted as R-numbers.

### Touch

| # | Moment | Trigger | What moves | Spring | Interrupt | Reduced |
|---|---|---|---|---|---|---|
| M1 (R2) | Press | Touch-down on any pressable | Scale to 0.97 (buttons, rows), 0.96 (tiles, cards, chips), 0.92 (icon buttons) | In `instant`, out `snappy` | Dragging 10pt off cancels and springs back; dragging back re-presses | Opacity to 0.7 over 100 ms instead of scale |
| M15 (R12) | Selection controls | Chip, switch, segment, checkbox, stepper | Chip fill (`color`); switch knob x; segment thumb x; checkbox fill plus check stroke drawn over 160 ms; stepper digit rolls 6px with a cross-fade | `snappy` | Any new value retargets from the current position | Instant state change, colour cross-fade kept |

### Opening and closing apps

| # | Moment | Trigger | What moves | Spring | Interrupt | Reduced |
|---|---|---|---|---|---|---|
| M2 (R3) | Open an app | Tap a ready tile | A container in the tint grows from the tile's rect to the screen, scale-based (the container scales non-uniformly and its contents counter-scale, so nothing stretches). The glyph rides the centre and fades out over the last third. The WebView, pre-warmed on touch-down, stays hidden under the tint until the realm reports first paint, then cross-fades in over 160 ms | `morph` | Back or a swipe during the grow reverses from the current frame (M3) | 160 ms cross-fade from home to the app |
| M3 (R4) | Close an app | Orb → Your apps, Android back at the root, iOS edge swipe at the root | The reverse: the app shrinks into its tile's rect, its content fading under the tint, the tile un-hides at the end | `smooth`; a swipe tracks the finger 1:1 (scale 1 → 0.86 and toward the tile) and on release projects and hands velocity to `fling` | Re-opening during the shrink retargets to full screen | Cross-fade |
| M20 (R9) | Honest light | Stream activity while making or changing | Ember glow intensity and flicker on the making wisp, the ghost tile, a changing tile's ring and the orb | Smoothed by a critically damped spring, response 0.6 s; flicker from token arrivals only (`01-direction.md` §9.5) | Continuous | Three still states, swapped with a cross-fade |

### Making an app

| # | Moment | Trigger | What moves | Spring | Interrupt | Reduced |
|---|---|---|---|---|---|---|
| M6 | Composer to Describe | Tap the composer bar | The bar's capsule grows into the Describe sheet; its placeholder becomes the field's placeholder in place; the keyboard rises on its own curve | `morph` | Swipe down returns into the bar along the same path | Sheet cross-fades in |
| M7 (R10) | Describe to Plan | Continue | The flow sheet pushes the Plan page in from the trailing edge; the description travels from the field to the top of the plan as your quoted words | `smooth` | Back reverses mid-push | Cross-fade |
| M8 (R7) | Plan arrives | Questions (about 1.8 s) then plan rows (about 2.3 s more) | The thinking wisp sits at the top; each group replaces its skeleton with a 160 ms cross-fade; rows rise 8px with `stagger` the first time only | `fade-in` + `smooth` | New data replaces in place | Cross-fade, no rise |
| M25 | Edit a plan row | Tap a row | The row grows into a text area; Save and Cancel fade in under it | `smooth` | Cancel reverses | Instant |
| M9 | Make it | Tap Make it | The thinking wisp in the plan header travels and grows to the making wisp's place; the plan cross-fades out under it; steps fade in | `morph` | Back during the move leaves for home (M5) | Cross-fade |
| M5 | Leave it running | Back, swipe down, or "Back to your apps" | The making sheet shrinks into its ghost tile on the grid, ember first; the tile's glow takes over | `smooth` | Tapping the tile again reverses | Cross-fade |
| M10 | Ready | The app is delivered while the making view is open | The wisp's done pose: eyes turn to arcs, the glow flares (`spark`, scale 1 → 1.18 → 1). The app's tile rises out of the wisp from 0.6 to 1 with `spark`; the title and buttons fade in 80 ms apart | `spark` | Tapping Done at any point jumps to the end state and closes | Cross-fade to the final layout, no flare |
| M4 (R1) | Ghost becomes tile | Delivery while the home grid is visible | The ember tile flares once (`spark` on the glow); the squircle fills with the tint from the centre (a circle mask scaling from 0 to the tile's diagonal); the glyph fades in from 0.9 | Fill and glyph `morph`, glow `spark` | Opening the tile mid-way finishes it at once | Cross-fade from ember tile to app tile |
| M22 (R11) | Making fails | Terminal failure | The wisp moves to its failed pose (glow 40%, eyes droop) over `smooth`; the failure content cross-fades in. No shake | `smooth` + `fade-in` | n/a | Cross-fade; wisp still |

### Sheets, menus and screens

| # | Moment | Trigger | What moves | Spring | Interrupt | Reduced |
|---|---|---|---|---|---|---|
| M11 (R6) | Sheet | Present, dismiss, drag | Sheet y from off-screen; scrim opacity follows position. Drag tracks 1:1 after 10pt; release projects (`current + (v/1000)·0.998/(1−0.998)`), picks a detent or dismisses, hands velocity on | Tapped: `smooth`. Released: `fling` | Grab at any time, including mid-dismiss | Cross-fade; drag still follows the finger and commits with a cross-fade |
| M21 (R6) | Orb to Whim sheet | Tap the orb | The sheet rises from the bottom edge under the orb; the orb dims to 0.6 while the sheet is up | `smooth` | Tap the orb again or drag down | Cross-fade |
| M12 | Context menu | 350 ms long-press on a tile | Tile lifts to 1.06 with shadow (`snappy`), scrim fades in, menu grows from the tile edge (scale 0.92 → 1, transform origin at the tile) | `snappy` lift, `smooth` menu | Releasing before 350 ms is a normal tap; moving 10pt before then cancels; a second step swaps rows with a 120 ms cross-fade | Menu cross-fades; tile doesn't lift |
| M13 | Push and pop | Opening Settings, History, Advanced; back | iOS: new screen from the trailing edge, previous moves to −30% with a 0.12 dim. Android: shared X axis, the new screen slides in 8% of the width while fading | `smooth`; the iOS edge swipe tracks the finger and releases with `fling`; Android predictive back scales the screen to 0.92 and shifts it 8% toward the gesture edge while the gesture runs | Grab at any time | Cross-fade |
| M14 | Toast | Shown, auto-dismissed, swiped | Rises 16px from below with a fade; leaves the same way; swipe down tracks the finger | In and out `smooth`; swipe `fling` | A new toast replaces the current one in place | Cross-fade |
| M26 | History row | Tap a version | The row expands; following rows move down; actions fade in | `smooth` (layout transition) | Tap again to collapse from the current height | Instant |

### Home

| # | Moment | Trigger | What moves | Spring | Interrupt | Reduced |
|---|---|---|---|---|---|---|
| M17 (R5) | Grid appears | First launch and returning from onboarding only | Tiles rise 8px and fade in, `stagger` across the first six, the rest together | `smooth` | Touching the grid finishes it | Appear at once |
| M18 | Delete an app | Confirmed delete | The tile shrinks to 0.8 and fades (`fade-out`), then the tiles after it slide into place | `smooth` reflow | n/a | Remove at once, neighbours cross-fade |
| M19 (R8) | Skeleton | A local load that passes 300 ms | Opacity 0.34 ↔ 0.72 on a 1.9 s cycle | `breathe` | Content replaces it with `fade-in` | Static at 0.6 |
| M23 | Keyboard | Keyboard shows or hides | Sheets and bottom actions follow the keyboard frame by frame (Reanimated keyboard tracking on both platforms; replaces the iOS-only `LayoutAnimation` in `KeyboardShell.tsx:89-94`) | The keyboard's own curve | n/a | Same; it is not decorative |

### Inside apps (SDK)

| # | Moment | Trigger | What moves | Spring | Reduced |
|---|---|---|---|---|---|
| M24 (R12) | Screen push and pop | `nav.navigate`, `nav.back`, iOS edge swipe | As M13 (iOS style on iOS, shared axis on Android, from the platform in the theme data) | `smooth` / `fling` | Cross-fade |
| M24 | Modal | `visible` changes | As M11 | `smooth` / `fling` | Cross-fade |
| M24 | List rows | Keyed children mount or unmount after the first render | Enter: rise 8px and fade in. Leave: `fade-out`, then neighbours close the gap (FLIP) | `smooth` | Instant |
| M24 | Progress | `value` changes | Bar fill or ring arc | `smooth` | Instant |
| M24 | Toast | `toast()` | As M14 | `smooth` | Cross-fade |
| M24 | Controls | As M1 and M15 | | | |

The SDK runs the same springs: at build time each one is sampled at 60 Hz into a CSS `linear()` easing with
its settled duration, and WAAPI plays it. Interrupting a WAAPI animation reads the current computed transform,
cancels, and starts the new spring from there; for gesture-driven parts (sheet drag, slider, edge swipe) a
small `requestAnimationFrame` spring carries the velocity. Reduce Motion reaches the realm as part of the
inert theme data and each component honours it; the research's paired `getAnimations()` invariant (`docs/
research/animation-options-2026-09.md` §6) becomes the owner-authored test that proves it.

## What stays still

| Candidate | Why not |
|---|---|
| Streamed prose typing in or fading in | Text that moves is text you can't read; the arrival is the animation |
| Shimmer on skeletons | A travelling gradient is decoration; breathing says "loading" with less motion |
| Shaking a field or a screen on error | Multi-axis motion reads as alarm and is on Apple's reduce list; colour, icon and words carry errors |
| Charts drawing themselves in | People read charts; motion delays the reading |
| Parallax on the home grid or the plan | Decoration on the most-used surfaces |
| Jiggle-mode reordering | A pattern to add with reordering itself, later |
| Confetti on ready | The wisp's flare is the celebration; confetti is the AI-app cliché the direction rules out |
| Animating the switch between light and dark | Instant is what both platforms do in-app |
| The ember breathing while idle | Honest light: no work, no movement |

## How to check it

- Every spring is a named constant in one module per runtime; a static check rejects literal spring configs
  and any remaining `Animated.` or `useNativeDriver` in `src/host/` (the research's check, extended).
- Each moment gets a slow-motion recording (0.25×) on a mid-range Android device and an iPhone before it
  ships; the motion page in the mockups (`docs/design/mockups/index.html#motion`) is the reference to
  compare against.
- Reduce Motion is tested as a pair: with it off, the moment produces running animations; with it on, the same
  trigger produces only the reduced version.
- Opening an app is measured: touch-down to first paint, with and without the pre-warmed WebView, before and
  after the morph lands. No regression in time to first paint is allowed for the sake of the animation.
