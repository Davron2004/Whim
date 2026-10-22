# design-system-v1 verification

## 22.5 motion recordings

Archive (outside the repo): `/Users/davrondjabborov/Work/other/Whim-evidence/design-system-v1/motion/`,
one folder per platform (`android/`, `ios/`, `mockup/`). Each clip `<Mnn>-<name>-<scheme>.mp4` is the 0.25×
copy; `<same>-1x.mp4` beside it is the normal-speed original it was made from.

**Status: Android done (light, dark, Reduce Motion); iOS and the mockup references not yet recorded.**

### Method

- **Android** (emulator `Whim_Verify`, Android 16 arm64, `-gpu host`, 1344×2992, chain-22 tip + 22g2):
  `adb screenrecord` at 720×1600 (variable frame rate, up to 60 fps). Reanimated does **not** honour
  `animator_duration_scale`: at scale 4 the M2 open still ran in 0.18 s (0.29 s at scale 1). So the 0.25×
  clips are the normal-speed recordings slowed with `ffmpeg -vf setpts=4*PTS` (frames kept, none interpolated).
  Reduce Motion = `settings put global transition_animation_scale 0` (restored to 1.0 after).
- **iOS:** not recorded yet. Reanimated ignores the simulator's slow-animation toggle; the plan is the same
  normal-speed recording slowed with ffmpeg.
- **Mockup** (`docs/design/mockups/index.html#motion`): not recorded yet.

### Moments (Android)

| Moment | Android clip (light / dark / reduced) | iOS | Mockup | Note |
|---|---|---|---|---|
| M17 grid appears | `M17-grid-appears-light` / `-dark` / `-light-reduced` | — | — | Tiles rise and fade, 30 ms stagger, under the launch fade; reduced: at once |
| M18 delete + Undo | `M18-delete-undo-light` / `M18-delete-dark` | — | — | Tile goes, neighbours reflow on smooth; Undo plays it back |
| M2 open | `M02-open-M03-close-back-light` / `-dark` / `-light-reduced` | — | — | bg grows from the tile by transforms; reduced: 160 ms cross-fade |
| M2 back mid-open | `M02-back-mid-open-light` / `-dark` (`-light-before-fix-1x` = the bug) | — | — | Fixed in 22g2: the tile showed blank ~850 ms, then popped |
| M3 close (back, orb) | `M02-open-M03-close-back-*`, `M03-close-orb-light` / `-dark` | — | — | Page veiled on fade-out, bg shrinks into the tile on smooth |
| M3 touch catcher | `M03-touch-catcher-reopen-light` / `-dark` | — | — | Tap inside the shape mid-close reopens; outside (Tip Splitter) opens that app; during M2 inside does nothing, outside opens the other app |
| M6 composer → Describe, swipe back | `M06-composer-describe-*`, `M06-swipe-back-*`, `M06-composer-describe-swipe-light-reduced` | — | — | Capsule grows into the sheet; drag tracks 1:1, closes into the bar; reduced: cross-fade, drag still tracks |
| M6 mid-growth drag-close | `M06-midgrowth-drag-close-light` | — | — | The sheet follows the drag; the IME slides away on its own after release |
| M7 / M8 plan | `M07-M08-describe-plan-light` | — | — | Plan pushes in; the stub answers at once, so the skeleton swap is a single frame |
| M25 row edit | `M25-row-edit-save-light`, `M25-row-edit-cancel-light` | — | — | Grows into a text area on smooth (~0.35 s); Cancel and Save reverse on smooth |
| M9 Make it, M20 light, M5 leave, M4 ghost → tile | `M09-M20-M05-M04-make-light-leave-ghost-light`, `M09-make-it-light-reduced`, `M05-reverse-ghost-tap-light-reduced` | — | — | Flickers while tokens arrive and holds still in a 2.5 s pause; leaves into the ghost tile; the tint fills the ghost in ~0.17 s |
| M10 Ready | `M10-ready-light` | — | — | The ember turns into the tile, settles about 1 s on spark |
| M26 History | `M26-history-expand-collapse-light` | — | — | Expands on smooth (card edge 451 → 583 px over ~0.55 s); a collapse drops the card fill and actions at once. Only one version exists, so rows below were not seen moving |

Sheet drag: tracks 1:1 after slop, and a short slow drag springs back (M6 sheet). Real-finger flings can't be
injected (adb reports 0 velocity) → chain-24.

### Tap to first paint (Water Counter, warm WebView)

Each run is the app's own `tap to first paint` log line. A "one-frame miss" is a run more than 16.7 ms over
the median.

| Platform | Build | Runs | Median | Min / max | One-frame misses |
|---|---|---|---|---|---|
| Android (`-gpu host`) | baseline (staging c272ec55) | 30 | 71 ms | 68 / 180 ms | 3 |
| Android (`-gpu host`) | chain-22 | 30 | 71 ms | 66 / 90 ms | 2 |
| iOS simulator | baseline / chain-22 | — | not measured yet | | |

No regression on Android.
