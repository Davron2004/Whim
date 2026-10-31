# design-system-v1 verification

## 22.5 motion recordings

Archive (outside the repo): `/Users/davrondjabborov/Work/other/Whim-evidence/design-system-v1/motion/`,
one folder per platform (`android/`, `ios/`, `mockup/`). Each clip `<Mnn>-<name>-<scheme>.mp4` is the 0.25×
copy; `<same>-1x.mp4` beside it is the normal-speed original it was made from.

**Status: Android done (light, dark, Reduce Motion, 22g2); iOS (light, Reduce Motion, dark for M17 and M2/M3) and the mockup references done (22g3).**

### Method

- **Android** (emulator `Whim_Verify`, Android 16 arm64, `-gpu host`, 1344×2992, chain-22 tip + 22g2):
  `adb screenrecord` at 720×1600 (variable frame rate, up to 60 fps). Reanimated does **not** honour
  `animator_duration_scale`: at scale 4 the M2 open still ran in 0.18 s (0.29 s at scale 1). So the 0.25×
  clips are the normal-speed recordings slowed with `ffmpeg -vf setpts=4*PTS` (frames kept, none interpolated).
  Reduce Motion = `settings put global transition_animation_scale 0` (restored to 1.0 after).
- **iOS** (a clone of an iPhone 18 Pro Max simulator, iOS 27, Release build of chain-22 tip + 22g3, 440×956 pt):
  `simctl io recordVideo` at 1320×2868 (frames only on change, up to 60 fps), driven by `scripts/ios-ui-driver`.
  Reanimated ignores the simulator's slow-animation toggle, so the 0.25× clips are the normal-speed recordings
  slowed with `ffmpeg -vf setpts=4*PTS`. Reduce Motion = `defaults write com.apple.Accessibility
  ReduceMotionEnabled -bool true` on the clone + relaunch.
- **Mockup** (`docs/design/mockups/index.html#motion`, opened in ego-browser): the lab has no speed control, so the
  page's clock was slowed to 0.25× (its `performance.now`, `requestAnimationFrame` timestamps and `setTimeout`
  delays drive its JS springs; CDP `Animation.setPlaybackRate 0.25` for CSS), and frames were captured with CDP
  screenshots (~12–20 fps of the slowed page, timing kept). Light and dark = emulated `prefers-color-scheme`;
  reduced = the lab's own Reduce Motion toggle. The lab demos only some moments (open/close, ghost → tile, honest
  light, sheet drag); the others have no lab reference.

### Moments

| Moment | Android clip (light / dark / reduced) | iOS clip | Mockup ref | Note |
|---|---|---|---|---|
| M17 grid appears | `M17-grid-appears-light` / `-dark` / `-light-reduced` | `M17-grid-appears-light` / `-dark` | none | Tiles rise and fade, 30 ms stagger, under the launch fade; reduced: at once. Compared: Matches Android: tiles fade and rise under the launch fade. No lab demo |
| M18 delete + Undo | `M18-delete-undo-light` / `M18-delete-dark` | not recorded (budget) | none | Tile goes, neighbours reflow on smooth; Undo plays it back. Compared: No lab demo |
| M2 open | `M02-open-M03-close-back-light` / `-dark` / `-light-reduced` | `M02-open-M03-close-catcher-light`, `M02-open-M03-close-dark` | `M02-open-M03-close-light` / `-dark` / `-light-reduced` | bg grows from the tile by transforms; reduced: 160 ms cross-fade. Compared: Matches the lab on both platforms: the bg grows from the tile (size and radius, no stretch), the tint plate fades as the page paints. Reduced: lab and devices cross-fade in place |
| M2 back mid-open | `M02-back-mid-open-light` / `-dark` (`-light-before-fix-1x` = the bug) | skipped: iOS has no system back over a running app (the orb is the way back; the driver cannot tap mid-open) | `M02-reversed-mid-open-light` / `-dark` | Fixed in 22g2: the tile showed blank ~850 ms, then popped. Compared: Lab: a tap mid-open reverses from where it is; Android's back mid-open does the same since the 22g2 fix |
| M3 close (back, orb) | `M02-open-M03-close-back-*`, `M03-close-orb-light` / `-dark` | `M02-open-M03-close-catcher-light`, `M03-close-then-tile-tap-light`, `M02-open-M03-close-dark` | `M02-open-M03-close-*` | Page veiled on fade-out, bg shrinks into the tile on smooth. Compared: Matches: the page veils and the bg shrinks into the tile on smooth (~0.4 s) |
| M3 touch catcher | `M03-touch-catcher-reopen-light` / `-dark` | `M03-close-then-tile-tap-light` (see the side finding below) | none | Tap inside the shape mid-close reopens; outside (Tip Splitter) opens that app; during M2 inside does nothing, outside opens the other app. Compared: No lab demo |
| M6 composer → Describe, swipe back | `M06-composer-describe-*`, `M06-swipe-back-*`, `M06-composer-describe-swipe-light-reduced` | `M06-composer-describe-swipe-light`, `M06-composer-describe-drag-close-keyboard-light-reduced` | `M06-sheet-drag-light` / `-dark` / `-light-reduced` / `-dark-reduced` | Capsule grows into the sheet; drag tracks 1:1, closes into the bar; reduced: cross-fade, drag still tracks. Compared: Lab: a slow short drag springs back, past half closes, Open sheet rises on smooth; reduced: it jumps open/closed with a fade. Devices match. On iOS the keyboard stays drawn over the sheet while the finger drags (system keyboard window); on release it goes as the sheet shrinks into the bar. Reduced (iOS, after the 22g3 fix): the keyboard is gone in the release frame, the sheet fades after it |
| M6 mid-growth drag-close | `M06-midgrowth-drag-close-light` | not injectable (the driver's drag starts after the growth ends) | none | The sheet follows the drag; the IME slides away on its own after release. Compared: No lab demo |
| M7 / M8 plan | `M07-M08-describe-plan-light` | not recorded on iOS (the plan arrived off camera) | none | Plan pushes in; the stub answers at once, so the skeleton swap is a single frame. Compared: No lab demo |
| M25 row edit | `M25-row-edit-save-light`, `M25-row-edit-cancel-light` | `M25-row-edit-cancel-save-light` | none | Grows into a text area on smooth (~0.35 s); Cancel and Save reverse on smooth. Compared: No lab demo |
| M9 Make it, M20 light, M5 leave, M4 ghost → tile | `M09-M20-M05-M04-make-light-leave-ghost-light`, `M09-make-it-light-reduced`, `M05-reverse-ghost-tap-light-reduced` | `M09-M20-M05-M04-M10-make-leave-ghost-light`, `M09-M05-M04-make-leave-ghost-light-reduced` | `M20-honest-light-light` / `-dark` / `-light-reduced`; `M04-M10-ghost-to-tile-light` / `-dark` / `-light-reduced` / `-dark-reduced` | Flickers while tokens arrive and holds still in a 2.5 s pause; leaves into the ghost tile; the tint fills the ghost in ~0.17 s. Compared: M20: lab and devices flicker only with tokens and hold still in a pause; the lab also dims to 35 % after a 2 s stall with a stalled line, which the product does only after its own stall time (not reached in these clips). M4: lab and devices flare the ember, fill the tint from the centre (~0.2 s) and settle the glyph; reduced: at once |
| M10 Ready | `M10-ready-light` | in `M09-M20-M05-M04-M10-make-leave-ghost-light` (the ghost turns into the tile, then the "is ready · Open" toast) | `M04-M10-ghost-to-tile-*` | The ember turns into the tile, settles about 1 s on spark. Compared: Matches the lab's spark + morph |
| M26 History | `M26-history-expand-collapse-light` | `M26-history-expand-collapse-light` | none | Expands on smooth (card edge 451 → 583 px over ~0.55 s); a collapse drops the card fill and actions at once. Only one version exists, so rows below were not seen moving. Compared: iOS, two versions: a row opens on smooth growing down, the row below moves with it; a collapse drops the card fill at once and the row below moves up on smooth; Use this version / Make a copy fade in. No lab demo |

Sheet drag: tracks 1:1 after slop, and a short slow drag springs back (M6 sheet), on both platforms. Real-finger
flings can't be injected (adb and the iOS driver report no release velocity) → chain-24.

Making sheet under Reduce Motion, first frame ~10 dp off (22g1's item 3): not reproducible on either platform
(Android in 22g2; iOS in 22g3, `M09-M05-M04-make-leave-ghost-light-reduced`: the ember and the title sit in place
from the first frame of the cross-fade). Closed.

Reduce Motion keyboard (22g3 fix): a sheet that starts to close under Reduce Motion now cuts its keyboard away at
once, unanimated (`KeyboardController.dismiss({ animated: false })`), by every route; before, the keyboard slid
away on its own for ~0.3 s after the 120 ms fade had taken the sheet (seen on Android in 22g2). Device-checked on
iOS (the clip above); not re-checked on the Android emulator (budget).

Left for chain-24 (real finger or a human on the device): flings on every sheet; the M6 mid-growth drag-close
keyboard case (adb and the driver can't time it); the Reduce Motion keyboard fix on Android; M2 back mid-open on
iOS; the dark Undo on Android (`M18` dark Undo is still missing); M18 and M7/M8 on iOS; a tile tap right after
Back to your apps on iOS (side finding below).

### Tap to first paint (Water Counter, warm WebView)

Each run is the app's own `tap to first paint` log line. A "one-frame miss" is a run more than 16.7 ms over
the median.

| Platform | Build | Runs | Median | Min / max | One-frame misses |
|---|---|---|---|---|---|
| Android (`-gpu host`) | baseline (staging c272ec55) | 30 | 71 ms | 68 / 180 ms | 3 |
| Android (`-gpu host`) | chain-22 | 30 | 71 ms | 66 / 90 ms | 2 |
| iOS simulator (iPhone 18 Pro Max, iOS 27, Release) | baseline (staging c272ec55) | 40 | 118 ms | 101 / 119 ms | 0 |
| iOS simulator (iPhone 18 Pro Max, iOS 27, Release) | chain-22 (+22g3) | 40 | 102 ms | 101 / 202 ms | 3 |

No regression on either platform. On iOS the values sit on frame steps (101–103 or 118–120 ms); the chain lands a frame earlier in most runs. Runs were two interleaved rounds of 20 per build on one simulator.

### Side findings (22g3)

- **A change on the stub ending "The change didn’t work" (22g2):** stub configuration, not a product bug. The stub's
  log shows `/v1/generate` answered 429 `daily_limit` (the per-device generation limit) and once a network failure
  through the timing proxy. With `WHIM_LIMIT_GENERATIONS_PER_DEVICE_DAY` raised, a change of a running app on iOS
  ended in "New version ready · Reload" and History showed v2.
- **iOS: a tile tap ~0.75 s after Back to your apps does nothing** (`M03-close-then-tile-tap-light`): the app has
  shrunk into its tile by then (~0.4 s) and Home is idle, yet the tap neither reopens nor opens the app; the same
  tap 2 s after opens it. The driver's tap latency (~0.75 s) makes the exact window unknown. Needs a finger check
  (chain-24) before it is called a bug.

## 24.6 haptics (DONE, ruling 34)

Guided session with the owner on an iPhone 15 Plus, 2026-10-30: build 1.0.0 (435735) at staging `51e18158` plus
throwaway logging (branch `device/24-6` @ `946b4388`, never merged). Evidence, outside the repo:
`/Users/davrondjabborov/Work/other/Whim-evidence/design-system-v1/haptics/`: `analysis.txt` (log analysis),
`owner-notes-2026-10-30.md` (how each haptic felt), `session-iphone15plus.log` (the session log).

- Latency, JS call → native engine call: median 0.9 ms, p95 2.2 ms, max 3.2 ms (n = 380). The touch itself has no
  timestamp in the log, so input → JS handler is not included.
- Cue rate cap (burst 3, 10/s) held: 88 drops, at most 12 cues in any 1 s window (limit 13).
- No haptic outside §5; every moment mapped to its §5 kind; the failure path (selection, handoff ×2, failure) was
  checked against the stub.
- Found and filed: #234 (sheet commit haptic before the real commit point), #235 (orb commit ticks repeatedly near
  the middle), #236 (iOS native switch: system haptic plus ours), #237 (Home back-menu entry has no title). Fixed in
  shift 4; the owner re-feels #234–#236 at PR review (`owner-checklist.md`).
- The phone ran against production for most of the session ("Your own server" not set; ruling 36): a few real
  generations, harmless pre-launch.
