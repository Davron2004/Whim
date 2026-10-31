# s4b-shell: chain-24 triage F3, F4, F6 (builder, BASE 365b1b76)

## F3 MED: Android status-bar icons dark on dark after a live flip, once an app was opened. NOT FIXED (class B)
Not in the JS; the native code gave no explanation I could trust, so I made no speculative native change.
- JS is right. Proven by a new test in `mini-app-delivery.suite.tsx` ("frame: once an app has been opened, the status bar on Home
  follows a live scheme flip..."). It flips inside a light app, then goes back to Home: dark strip, `light-content`. It also opens and
  leaves an app in light, then flips on Home: dark strip, `light-content`. `shellFrame` (LauncherRoot.tsx:476) and `<StatusBar>`
  (:3990) re-render on every flip. RN's `StatusBar.componentDidUpdate` → `_updatePropsStack` sends `setStyle` to native on
  every Android update, with no same-value skip (node_modules/react-native/Libraries/Components/StatusBar/StatusBar.js:471-474).
  So Back to Home sends `light-content` again, and on API 34 the icons still stayed dark.
- Who writes the activity's status-bar appearance: only RN's `StatusBarModule.setStyle`. Above API 30 it calls the platform
  `window.insetsController.setSystemBarsAppearance` (StatusBarModule.kt:137-150). react-native-screens' window traits are inert:
  no Screen sets `statusBarStyle`/`statusBarHidden`. react-native-keyboard-controller's StatusBar module is never called from JS.
  `MainActivity.mirrorBarAppearance` writes only to the activity's dialog windows (MainActivity.kt:107-122), never to the activity.
- An API-split defect is real and matches the 34-persistent / 37-brief split, but I could not tie it to dark status icons.
  androidx core 1.18 `WindowInsetsControllerCompat$Impl30` (used on API 30-34, from `javap` of the gradle-cache jar) is built
  with a Window. Its `isAppearanceLight*` reads only the legacy `decorView.systemUiVisibility` flags, and its
  `setAppearanceLight*` writes only those flags, never the platform controller. Impl35 (API 35+) uses the platform controller.
  So on 30-34:
  `MainActivity.activityBars` (:64) → `matchNavigationBarToStatusBar` (:66) reads a legacy status flag that RN never sets.
  It therefore copies a stale value onto the navigation bar, by a legacy write that the platform ignores once RN has
  controlled the appearance. RN's `ReactModalHostView.updateSystemAppearance` (ReactModalHostView.kt:438) does the same
  stale read for a dialog's status bar. By my reading this gives white icons, not dark ones, so it does not account for F3 by itself.
- `onConfigurationChanged` (:237) only resets the window background on `uiMode`; JS re-sends the bar style anyway (above).
- Ask the device recheck (API 34, `Whim_Verify` or a 34 AVD) to capture this at the moment the icons are dark on dark:
  `adb -s <serial> shell dumpsys window windows`: every Whim window (`com.anycognition.whim`) with its
  `mAppearance`/`insetsFlags.appearance`, and whether any dialog window (`Window{... Dialog}` or a second Whim window) is visible
  `adb -s <serial> shell dumpsys activity service com.android.systemui/.SystemUIService | grep -A8 LightBarController`
  (`mAppearance`, `mStatusBarMode`). Repro: light phone, open any app, Back, `cmd uimode night yes`, then compare with a cold
  start in dark. If the activity window shows no APPEARANCE_LIGHT_STATUS_BARS (8) while SystemUI tints dark, the fault is
  SystemUI/WM (emulator). If a dialog window holds 8, it is the dialog mirror. Either way the fix goes into MainActivity.kt.

## F4 MED: in-content titles on Settings, Advanced, AI features, Report (Q1). FIXED
- `NativeStack.headerFor`: a pushed entry with a title keeps the header (back control, `title` for the iOS back label and
  long-press menu). It gets an empty `ScreenStackHeaderCenterView` as the header's child, which blanks the inline title on
  both platforms: iOS draws the centre view in the title's place, and rn-screens Android sets `toolbar.title = null` for a
  centre subview (ScreenStackHeaderConfig.kt:385-389). `StackEntry.largeTitle` is removed (no native iOS large title), and so
  are the dead title font props. Contract `handoff/navigation.md` is updated in place.
- Screens: Settings `<Text type="largeTitle">Settings</Text>`, Advanced `title1` "Advanced", Report (screen) `title1`
  "Report a problem" (`ReportForm`'s existing title slot: `title1` on the screen, `title2` in the Whim sheet as before).
  `Text` gives header roles to these types (Text.tsx:81). Type roles scale with the system font.
- AI features: the screen already draws `title1` ("Before Whim makes apps for you", ConsentScreen.tsx:113), so I added
  no second title1. Deviation A: the back label is "AI features" and the in-content title1 is the disclosure headline.
- Test: `native-stack-ui.suite.tsx` "Settings (largeTitle), Advanced, AI features and Report (title1)...". For each screen it
  checks: header shown; `title` = the screen's name; no `largeTitle`; the header's only child is an empty centre view; and the
  screen's content draws exactly one title of the right type and words, with role `header`.
  Red-checks: Advanced's title emptied → FAIL ("advanced: the screen draws its own title1"). The centre view swapped for a
  native largeTitle → 8 FAIL.

## F6 LOW: Advanced "Verified" check. FIXED
- AdvancedScreen: a row puts a 16 pt `check` (§3.1 inline size, §2.3 positive's icon) in `positive-text` before the words.
  It is centred on the first text line at the current font scale and decorative (`Icon` without a label; the words speak).
  Unverified and unreachable lines are unchanged.
- Test: `settings-screen.suite.tsx` "'Verified' never stands on its colour alone...". It checks the glyph, and its colour against the
  `COLORS.light['positive-text']` token, before the words, for verified only. Red-check: icon removed → FAIL.

## Checks (watchdog)
Targeted suites: 353 passed. Full launcher suite: see the report. typecheck OK. eslint on 9 touched files: exit 0. No build
inputs changed. F3 JS-test red-check: Home keeps the last app's pinned frame (null frame ignored, kind check dropped) → 3 FAIL.
Side finding (not fixed, outside scope): Advanced "Unreachable" is `danger-text` with no `circle-alert`, which breaks §2.3 too.

## Fix pass (review findings 1-3)
1. Advanced check line: `PROBE_GLYPH` maps verified to `check` and unreachable to `circle-alert`, each in its role text colour
   (`PROBE_COLOR`) through the existing `checkLine`/`checkGlyph`; "Unverified" (`text-2`) stays without one. The §2.3 row in
   `settings-screen.suite.tsx` now expects the danger `circle-alert`. Red-check: unreachable glyph dropped from the map -> that test
   fails (`got []`); restored.
2. `MainActivity.kt`: `refreshStackHeaders`, its call in `onConfigurationChanged`, its `ScreenStackHeaderConfig` import and the #218
   comment are deleted. The pushed header now draws only the back control, a blank centre view and the cleared Android toolbar title,
   so nothing in it depends on the font scale; the #218 sp title size no longer exists. `configChanges` untouched; no check file lost
   assertions.
3. `docs/design/system.md` §2.8 says the header row's inline title stays blank (no fade-in; Q1 of triage-chain-24). No delta spec stated
   the fade-in, so no spec change.
Checks (watchdog): targeted suites 318 passed, 0 failed; full launcher suite, typecheck, eslint: see the report.
