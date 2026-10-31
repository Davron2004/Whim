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

## 24.1–24.5 device verification (chain-24)

Evidence (outside the repo): `/Users/davrondjabborov/Work/other/Whim-evidence/design-system-v1/chain-24/<id>/`; builds in
`.../chain-24/artefacts/{android,ios}` (tip 77c3d132) and `.../artefacts-20d7a0f9/{android,ios}`. Verdicts are
`handoff/24-<id>.md` (copied from the `device/<id>` branches, since removed; the verdict commit SHAs below are from those branches); triage: `handoff/triage-chain-24.md` (Opus, shift 4b). Later rechecks supersede earlier runs.

| Run | Device | Tip tested | Verdict commit | Evidence | Items |
|---|---|---|---|---|---|
| a1 | Android API 37 (Whim_Verify, swiftshader) | 77c3d132 | e79e592b | `a1/` | 24.1, #236 #239 #240 #241 |
| a2 | Android API 37 | 77c3d132 | b43a7b85 | `a2/` | 24.2 (100/135/200%), 24.3, M18 dark toast |
| a3 | Android API 37 | 77c3d132 | 5c2ca71a | `a3/` | 24.2 (Reduce Motion, HC text), 24.3, 24.4, 24.5 |
| a3r | Android API 37 | 20d7a0f9 | 6ad99178 | `a3r/` | a3 remaining + rechecks, 24.2, 24.4 |
| a4 | Android API 29 + API 34 (Pixel 6 AVDs) | 20d7a0f9 | 4fef1ccd | `a4/` | 24.1, 24.4, keyboard + ring comparisons |
| i1 | iOS 27.0 sim (iPhone 17 clone) | 77c3d132 | bc8c20fc | `i1/` | PARTIAL: #237 #240 #241, 24.1 part (machine overloaded) |
| i2 | iOS 27.0 sim (iPhone 17 clone) | 20d7a0f9 | d9f47c8c | `i2/` | #239 #240 #241, 24.1, 24.2, 24.3 |
| i3 | iOS 27.0 sim (iPhone 17 clone) | 20d7a0f9 | 5f961c06 | `i3/` | 24.4, 24.5, M18, M7/M8 |
| r4a | Android API 37/34/29 | 99016857 | d6b1b778 | `r4a/` | recheck: F1 (FAIL), Back during rise, F3 (not reproduced), F5, F7 |
| r4i | iOS 27.0 sim clone | c77add77 | aa278445 | `r4i/` | recheck: F2, F4, F5, F6, F7 |
| r4b | Android API 37/34/29 | 90a6e363 | 7333f643 | `r4b/` | recheck: F1 (PASS), Back during rise, F4, F6, F3 (reproduced) |
| i4b | iOS 27.0 sim clone (build + smoke) | 90a6e363 | 55b55f46 | — | WhimKeyboard codegen on iOS |
| r4c | Android API 34 + 37 | 723030c2 | 61d4af50 | `r4c/` | recheck: F3 (PASS), nav bar, sheets after a flip |

iOS 27.0 is the only runtime installed (no "oldest" runtime). Verdict-vs-ledger: none disagree on results; the ledger gives i3's
"loading" opens as "within 1.5 s of launch", the verdict gives taps at 0.5 s and 1.5 s (1937, 1835 ms) and 4 s (518 ms, still `loading`).

### 24.1 light and dark, contrast, bars, fonts
- Android API 37: PASS (partial) a1 (all main screens L+D; gallery 4 screens L+D; Home empty, Update-required, Link-missing,
  app-crashed, delete/undo, copy sheet not in a1, later covered by a2/a3/a3r). API 29: PASS L+D (a4; app-crashed screen seen).
  API 34: PASS (a4; Making missed; status-bar icons FAIL after a live flip = F3). iOS 27.0: PASS (partial) i1 + i2.
- Contrast: sampled pixels equal the `system.md` tokens on API 37 (a1), API 29 (a4), iOS (i2); no floor breached.
- Tick wording (verbatim): `24.1 PASS (partial: iOS 27.0 only, no oldest runtime; not seen in dark on iOS: History, Report, Describe, Plan, Making, Whim sheet; API 34 Making page and API 29 dark running app/Whim sheet beyond the gallery not seen; app-crashed seen on API 29 only; Age and screen-error fallback not reached (needs a dev trigger))`
- Findings: F3 (a4 API 34 persistent, a1 API 37 transient), F4 (a1), F5 (a1 a2 i1), F6 (a1), F7 (a1); #239/#240/#241/#236/#237 PASS (a1 a2 a4 i1 i2).
- Recheck (shift 4c): F3 NOT REPRODUCED on r4a (99016857, API 34/37), REPRODUCED on r4b (90a6e363, API 34: MainActivity window kept `apr=LIGHT_STATUS_BARS` after the flip) → cause: react-native-keyboard-controller 1.22.6 overrides RN's StatusBarManager and writes only legacy systemUiVisibility flags on API 30–34 (androidx Impl30), leaving the platform appearance stale → s4c-bar `b3519a03` (`MainActivity.agreeBarAppearance()` on API 31–34 in the pre-draw listener; static guards in android-project.ts) → r4c (723030c2) PASS: API 34 recipe 6/6, reverse 5/5, cold light/dark, no-app flip 3/3 + 1, light mini-app 2/2, nav bar agrees in every state (gesture nav only), tile menu + Customize sheet after a flip; API 37 PASS (partial: 3 flips, no Modal/cold variants). Ticked 24.1.

### 24.2 text size, Reduce Motion, Increase Contrast, high-contrast text
- Android 100/135/200%: PASS (partial) a2 a3 a3r (Update-required, consent, Controls, `[[future:update]]` 135% grid, Making ember 135/200%, empty state 100/200%).
  Android Reduce Motion: PASS (partial) a3 (keyboard cut on close: IME down at first sample vs ~0.45 s at scale 1.0), a3r (low-fps strips). HC text: PASS (partial) a3, a3r.
- iOS xxxl (~135%) + AX2 (~194%): PASS (partial) i2; Reduce Motion from stills (Making ember byte-identical over 6 shots); Increase Contrast on Home, Settings, Surfaces.
- Ring number sits under the ring at 200% on Android 29/34/37 and iOS xxxl/AX2 (inside at default): ACCEPT, equals system.md §6 + §7.2.
- Tick wording (verbatim): `24.2 PASS (partial: iOS xxxl and AX2 only; 135% empty state not shot; Reduce Motion judged from low-fps strips (Android) and stills (iOS), toast exit and History/Whim-sheet morphs not seen; Increase Contrast on Home, Settings and Surfaces only (iOS); high-contrast text not on Settings sub-screens; AX2 SDK button row deferred (issue))`
- Findings: F4 title (a1), F6 Verified (a1); DEFER #250 (AX2 button row), #251 (Chart labels), #252 (200% list gap, 135% ember frame), #253 (IC tinted plates).
- Recheck (shift 4c): F4 in-content titles PASS on r4b (Android 37 light/dark 100/200%, live font scale, header back arrow only; 34 light 100%) and r4i (iOS light/dark, default/AX2; long-press back menu names the screens); F6 Verified check + Unreachable circle-alert PASS (both); F5 PASS (r4a, r4i); F7 PASS (r4a, r4i; AX2 dot centred on the wrapped row → #261). iOS build with the new Android-only WhimKeyboard spec: i4b (90a6e363) BUILD SUCCEEDED, no WhimKeyboard warning; Home, Advanced and Describe keyboard smoke PASS.

### 24.3 keyboard flows
- Android API 37: Describe, Whim-sheet send, Report note, Advanced address, in-app input with emoji IME PASS (a2 a3); plan row edit FAIL (a2, a3r) = F1. API 29 + 34: plan row edit PASS (a4).
- iOS: Describe first open, plan row, Whim-sheet send, Advanced, Report note, in-app input PASS (i2); Describe from Home composer after a make started FAIL 3/3 (i2) = F2 (i3 did not cleanly reproduce; i1 first saw it).
- Rotation not applicable (portrait-locked).
- Tick wording (verbatim): `24.3 PASS (partial: Android IME height change checked on API 37 only (emoji IME), not 29/34 (#129); app is portrait-locked, so rotation is not applicable)`
- Findings: F1, F2; SPEC-ALIGN "first back with the keyboard up only closes the keyboard" (a3); iOS Done bar deliberate (i2).
- Recheck (shift 4c): F1 FAILED on r4a (99016857: 37 12/16, 34 3/8, 29 3/8; the ask named the previous page's field, "not served") → s4c-kb (WhimKeyboard.showFor by view tag) → r4b (90a6e363) PASS 37 16/16, 34 16/16, 29 16/16; Back during the rise ≤1 re-raise (37: 8 trials, 34: 5), second Back puts it away; Describe / Whim sheet / Advanced / Report keyboards PASS (37). F2 PASS on r4i (c77add77): after a make 3/3 (i2 0/3), first after consent, change mode. LOW once on 37: a Back right after typing in Advanced left the screen (not reproduced).

### 24.4 exits (tap + system back / edge swipe / swipe down)
- Android tables: a3 (API 37), a3r (Update-required, consent, copy sheet), a4 (API 29 + 34, incl. app-crashed exits on 29). Predictive back on 34 and 37: arrow only (D7 fallback, #164). BackHandler over a running app PASS on 29/34/37.
- iOS table: i3 (all screens above; edge swipe only leaves nav pushes).
- Tick wording (verbatim): `24.4 PASS (partial: app-crashed exits on API 29 only; iOS edge swipe on Making and consent not tried; first-run consent from the composer not walked on iOS; predictive back is the D7 fallback, arrow only, #164)`
- Findings: SPEC-ALIGN (History Back lands on the app; Report-from-Whim-sheet Back goes to the sheet; 14.2 / #164 wording; keyboard-first-back); i3 tile tap after "Back to your apps" -> #224.

### 24.5 tap to first paint
- Paint ordering PASS (partial): a3 (Android, ±1-2 frames), i3 (iOS, content painted before the fade-in, no white flash, no empty page).
- Tick wording (verbatim): `24.5 PASS (partial: paint-before-first-frame shown by frames, not on one clock; no 'cold' WebView launch produced on either platform; Android timings on swiftshader not comparable to the host table; iOS 'loading' opens 1.8–1.9 s, no baseline)`

### Recorded measurements (all from the verdicts)
- iOS warm open (i3, n=15, Hello App, simulator Release): median 122 ms, min 118, max 186; paintMs 57-104; matches the 22.5 iOS rows (102-118 ms).
- iOS `webView: 'loading'` open right after launch (i3): 1937 ms (tap 0.5 s), 1835 ms (1.5 s), 518 ms (4 s). No `'cold'` ever logged. Recorded, not a baseline.
- Android swiftshader + screenrecord (a3, not comparable to the host table's 71 ms): warm n=7 median 444 ms (264-934); killed-reopen n=6 median 587 ms (327-682). a3r single reads: 330 ms warm, 743 ms back+reopen.
- M18 dark toast: #F2F0EC on #252220 = 13.9:1 (a2), 13.89 (i3); Undo the same; light #1A1614 on #FFFFFF 17.97 (i3). Dark pill vs page #100E0D about 1.2:1, no outline.
- Contrast samples: text-2 #6D6660 on bg #F6F4F1 5.14 (floor 4.66), on white 5.65; dark text-2 #ADA8A3 on #100E0D 8.17 (floor 5.97); ember-text #B14200 on bg 5.24; on-ember white on #C14900 4.98; input edge dark 3.88; needs-update #8A6000 on bg 5.1 (light), #ECBD3A on #100E0D 10.9 (dark); "No progress" 5.14 (a1).
- Tile tap after "Back to your apps" (i3): dropped 4/5 within ~1.5 s, 12/12 opened at >= 2 s; morph ~0.4 s; driver latency ~0.7 s.

### Findings -> disposition (MEDIUM/LOW; nits only where the triage names them)
| Finding | Source (sev) | Disposition |
|---|---|---|
| Plan row edit: no keyboard, API 37 only | a2 MED, a3r MED (a4: 29/34 PASS) | FIX-NOW F1 |
| iOS Home composer Describe unfocused after a make | i1 LOW, i2 MED | FIX-NOW F2 |
| API 34 status-bar icons dark on dark after live flip | a4 MED, a1 LOW | FIX-NOW F3 |
| Settings/Advanced/AI features/Report no large title | a1 MED | FIX-NOW F4 (Q1: in-content title like History) |
| Consent icon row centred on tall row | a1, a2, i1 LOW/nit | FIX-NOW F5 |
| Advanced "Verified" green text without a check | a1 nit | FIX-NOW F6 |
| See why row lacks danger dot | a1 LOW | FIX-NOW F7 |
| Report has no "What gets sent" row until a reason is chosen | a1 LOW | SPEC-ALIGN (system.md §9 Report) |
| Predictive back arrow only; tasks 14.2 ticked wrongly | a3 LOW | SPEC-ALIGN (14.2 reworded, #164 open, Q2) |
| Report from Whim sheet: Back -> sheet, Close -> app | a3 nit, i3 INFO | SPEC-ALIGN (content-reporting MODIFIED) |
| First back with keyboard up only closes keyboard | a3 note | SPEC-ALIGN (launcher-screen-exits) |
| Whim sheet -> History -> Back lands on the app | a4 LOW, i2 INFO, i3 | SPEC-ALIGN (app-launcher delta, system.md §9) |
| iOS "Done" accessory bar above keyboard | i2 LOW | SPEC-ALIGN (system.md §6) |
| Ring number below ring at 200% | a2 MED, a3r MED, a4 MED, i2 | ACCEPT (§6 + §7.2) |
| Update-required back takes ~2 s | a3r LOW | ACCEPT (swiftshader) |
| Blank sheet after consent | a2 LOW | ACCEPT (swiftshader, not reproduced) |
| HC halos behind text | a3, a3r nit | ACCEPT (platform) |
| Delete has no confirm | a3 note | ACCEPT (§9 by design) |
| Fixed-size glyphs / Controls stepper at 200% | a2, a3r nit | ACCEPT (ruling 6; §7.2) |
| iOS `loading` open 1.8-1.9 s | i3 LOW | ACCEPT, recorded above |
| Link-missing ignores swipe; WebView form bar; API 29 light keyboard; keyboard behind back menu | i3, i2, a4, i1 | ACCEPT (platform/simulator) |
| Tile tap dropped <= 1.5 s after Back to your apps | i3 MED | DEFER #224 (comment with data) |
| API 29 WebView 91 renderer crash | a4 MED | DEFER #249 (no gate for beta, Q3) |
| AX2 two-button row does not stack | i2 LOW | DEFER #250 |
| Chart bar labels truncate | a2 LOW | DEFER #251 |
| 200% list rows nearly touch; 135% ember entrance frame | a2 nit, a3r nit | DEFER #252 |
| IC: tinted tile plates lack outline | i2 INFO | DEFER #253 (Q5: outline per §6) |

### Not in the triage
- a3 LOW "Change didn't ..." cut in the Home 100% grid: closed by the a3r recheck on 20d7a0f9.
- i2 INFO: no Home composer outline under Increase Contrast: added to #253.
- Not run anywhere: app-crashed on API 34 and iOS, a forced `webView: 'cold'` launch, the Age / screen-error fallback (named in the tick wording).

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
