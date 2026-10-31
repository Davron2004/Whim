# s4c-bar: F3, API 34 status-bar icons dark on dark after a live flip. FIXED (native only), BASE f7f5daf0
## Cause (probe build with temporary logging, evidence `Whim-evidence/design-system-v1/s4c-bar/probe1.log`, `probe2-noapp.log`)
- react-native-keyboard-controller 1.22.6 registers a module named `StatusBarManager`
  (`StatusBarManagerCompatModuleImpl.NAME`), which takes over React Native's. While the `KeyboardProvider`'s view is
  `active` (App.tsx, enabled by default), its `setStyle` writes through `WindowInsetsControllerCompat(window, decor)`.
  On API 30–34 that is androidx core 1.18 `Impl30`, which reads and writes only the legacy `systemUiVisibility` light flags.
- React Native's first style, sent before the provider is active, sets the platform appearance (`apr=0x8`) and so
  `APPEARANCE_CONTROLLED`. After that the platform ignores the legacy flags, and every later JS style lands in them.
- Log, cold start in light: `apr=0x8 sysui=0x100` (RN's own module), then `sysui=0x2100` (the compat module). On the
  flip JS renders `light-content`, the legacy flag clears (`sysui=0x110`), and `apr` stays `0x8` → dark icons.
- Opening an app is NOT needed. A cold start in light, then a flip with no app opened, reproduced it
  (`probe-noapp-flip.png`). r4b's control was effectively a dark cold start, where `apr` was never set.
- API 35+ compat (`Impl35`) uses the platform controller, so 37 never had it.
- Same root cause: in light, the navigation bar's copy (`matchNavigationBarToStatusBar`, a compat legacy write) never
  reached the platform either. Before the fix `apr` had no `LIGHT_NAVIGATION_BARS`; now it has.
## Fix (`MainActivity.kt`)
- New `agreeBarAppearance()`, API 30–34 only, run in the activity pre-draw before and after `matchNavigationBarToStatusBar`.
  For each bar, a light bit that the legacy flags changed since the last agreement wins; otherwise the platform's bit wins.
  The result is written to whichever store differs. It is seeded in `onCreate` from the platform appearance.
  Both writers (RN's module → platform, keyboard-controller's → legacy) now reach SystemUI.
  `dialogBarAppearance` and RN's `ReactModalHostView` stale legacy read now see agreed values.
- `configChanges` unchanged. All probe logging removed (`git diff f7f5daf0` = MainActivity.kt only).
## Device counts (Whim_API34, Pixel 6, API 34 google_apis, emulator-5562; AVD deleted after)
Verdict = `dumpsys window` MainActivity `apr=` + SystemUI `LightBarController mAppearance`, plus a screenshot.
- Recipe (light, Tip Splitter, Back, `night yes`, 6 s): 6/6 had no `apr`, SystemUI not light, white icons
  (`fix-recipe-1..6.png`; trial 1 started cold).
- Reverse (dark, app, Back, `night no`): 4/4 had `apr=LIGHT_STATUS_BARS LIGHT_NAVIGATION_BARS`, matching SystemUI.
- Cold start light: LIGHT both bars. Cold start dark: no `apr`. Flip with no app opened: no `apr`.
- Flip while inside a light app: the app keeps its frame (`apr` LIGHT both). Back to the dark Home: no `apr` (`fix-inapp-*`).
- Not run: Whim_Verify API 37, because the fix returns early above API 34. API 29 is also untouched (it returns early below R).
## Checks
- APK `:app:assembleOffline` EXIT 0 (covers compileReleaseKotlin). `npm run -s typecheck` EXIT 0.
- checks `--only release --only repo/android-edge-to-edge.suite`: PASS 268, FAIL 0.
- There is no Node test: the fix is Kotlin-only, with no pure helper the Node runners can import. Verification relies on the device counts.
## Reviewer: check
- The per-bit rule in `agreeBarAppearance`: `legacyChanged = legacy xor agreed`, then `agreed' = legacy on changed bits, else platform`.
  It does not loop, because after a write both stores equal `agreed`.
- If both writers change the same bit in one frame, legacy wins (keyboard-controller is the steady-state writer).
- A keyboard-controller upgrade that writes the platform controller would make this a no-op, not a conflict.
## Fix pass (review LOWs 1-3)
- `agreeBarAppearance` now returns below API 31 (`Build.VERSION_CODES.S`) as well as above 34: RN writes the platform store only from 31, so API 30 has one store. Comment corrected (31-34).
- Comment records: with both stores changed in one frame the legacy value wins, wrong only if KeyboardProvider toggles active between two `setStyle` calls in a frame; App.tsx never toggles `enabled`.
- `checkNavigationBarIcons` (scripts/release/lib/android-project.ts): doc updated; new guards that the `onCreate` pre-draw listener calls `agreeBarAppearance()` before and after `matchNavigationBarToStatusBar`, and that it is gated to 31-34.
- 4 cases in checks/test/release/android-project.suite.ts (before/after call removed, lower bound R, upper bound dropped). Red-check: deleted the second call in the real MainActivity.kt: 3 failures (real project, fixture, mutation case); restored.
- Checks: `--only release --only repo/android-edge-to-edge.suite` PASS 272/0, typecheck 0, eslint 0, `:app:compileReleaseKotlin` 0. Not re-run on a device (gate narrows API 30 only; the 31-34 behaviour is unchanged).

## Fix pass 2
- checkNavigationBarIcons now matches the agreeBarAppearance 31-34 gate as ONE condition (`S || > UPSIDE_DOWN_CAKE) return`); a never-true `&&` gate no longer passes.
- Added a 5th mutation case (`&&` join) in android-project.suite.ts; red-check with MainActivity.kt `&&` fails the real-project case.
