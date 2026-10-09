# Contract: platform (chain-9)

Interface only. Values come from `src/design/tokens.ts` (handoff/design-tokens.md); rules from system.md §2.6, §3.3, §4.4 M27.

## `hideLaunchScreen()` — `src/host/launch-screen.ts`

```ts
export function hideLaunchScreen(): void;            // Home calls it on its first frame (task 15.2)
export interface LaunchScreen { hide(): void }
export function createLaunchScreen(native: Spec | null): LaunchScreen;  // for suites; hideLaunchScreen uses the registry module
```

- Cold start only: both platforms hold their launch screen (the ember on the scheme's `bg`) past React
  Native's first frame until `hide` runs, then fade it out over 160 ms (iOS overlay; Android 12+ system
  splash; below 12 the system removes the launch window at the first draw, no fade).
- Idempotent; never throws (null module = no-op, a throwing module is logged on `whim:screen` and swallowed).
  A warm start (process alive, activity/scene recreated) does not hold: calling `hide` then does nothing.
- **Cap: if `hide` never runs, each platform ends the hold itself after 3 s** (`LaunchScreen.CAP_MS`,
  `WhimLaunchScreenOverlay.capSeconds`). `LauncherShell` calls it (prop `hideLaunchScreen`) on the frame
  after its first real screen commits, Home or a link's landing; 15.2 keeps that call at the shell root.
- Call it from an effect after Home's first commit (not during render). Calling it earlier (e.g. at
  `LauncherRoot` mount) ends the hold before Home has drawn.

Native module (TurboModule `WhimLaunchScreen`, spec `src/native/NativeWhimLaunchScreen.ts`):

```ts
export interface Spec extends TurboModule { hide(): void }
export default TurboModuleRegistry.get<Spec>('WhimLaunchScreen');   // null on a build without it
```

- Android: `com.whim.launch.{LaunchScreen, WhimLaunchScreenModule, WhimLaunchScreenPackage}`; package added
  in `MainApplication.kt`; `LaunchScreen.hold(this)` in `MainActivity.onCreate` after `super.onCreate`.
  The hold withholds the window's first draw (a pre-draw listener on `android.R.id.content`): no
  dependency, no `core-splashscreen`.
- iOS: `ios/Whim/WhimLaunchScreen.swift` (`WhimLaunchScreenOverlay.cover(window)` from
  `AppDelegate.startReactNative`, a copy of `LaunchScreen.storyboard` added to the window) and
  `WhimLaunchScreenModule.mm` (`RCT_EXPORT_MODULE(WhimLaunchScreen)`; no `package.json` change).
- The launcher test host registers no `WhimLaunchScreen`: `hideLaunchScreen()` is a no-op in Node suites.

## Night resources (Android)

- `MODE_NIGHT_NO` is gone: `AppTheme` (DayNight) follows the phone, so `useColorScheme()` reports the
  phone's scheme on Android too.
- `values/` = light, `values-night/` = dark, for: `launch_background` (`brand_colors.xml`, generated:
  `bg`), `whim_caret` (`text`; `colorAccent`: caret, handles, switches) and `whim_selection` (`text` at
  30%; `android:textColorHighlight`) in `colors.xml`. `whim_accent`/`whim_accent_highlight` no longer exist.
- `MainActivity.onConfigurationChanged` (uiMode is a handled config change, no recreation) re-sets the
  navigation-bar icon appearance (`!night` → dark icons) and the window background from the new scheme.
  The status bar's icons stay the JS `<StatusBar barStyle>`'s (chain-14: `t.barStyle`).
- Launch: below 12 `Theme.Whim.Launch` draws `drawable/launch_screen.xml` (`launch_background` + 256 dp
  `launch_mark`); 12+ `values-v31` sets `windowSplashScreenBackground` = `launch_background` and
  `windowSplashScreenAnimatedIcon` = `@mipmap/ic_launcher_foreground`.
- Adaptive icon: background `@drawable/ic_launcher_background` (generated gradient shape), foreground and
  monochrome `@mipmap/…` PNGs. The `ic_launcher_background` colour resource no longer exists.

## iOS

- No `UIUserInterfaceStyle` override. `LaunchBackground` colour set: light `bg`, dark appearance = dark `bg`.
  `LaunchMark` image set: 256 pt (the ember at 128). `AppIcon`: light (no alpha), `dark` appearance
  (transparent), `tinted` appearance (grey on black).

## `release/assets/brand.json` keys

```json
{ "iconBackground": { "top": "#2A2420", "bottom": "#1A1614" },
  "launchBackground": { "light": "<COLORS.light.bg>", "dark": "<COLORS.dark.bg>" } }
```

- `iconBackground`: the icon plate's vertical gradient, top to bottom (system.md §3.3).
- `launchBackground.light|dark` must equal `COLORS.light.bg` / `COLORS.dark.bg` (case-insensitive);
  `checkAssets` reports `release/assets/brand.json's launchBackground.<scheme> is "<x>", but the <scheme> bg
  token is "<y>"`, one finding per drifting scheme.
- `release/assets/icon-foreground.svg` must contain a `<path class="mark" … d="EMBER_PATH">`
  (`src/design/icons/ember.ts`), else a finding naming the SVG. Class `glow` marks the halo; the generator
  renders the monochrome layer with `.glow` hidden and `.mark` white, the tinted icon in greyscale on black.
- Regenerate with `node scripts/release/run.mjs generate-assets` (Playwright Chromium; deterministic).

## Fonts

- No font file ships (`assets/fonts/`, `android/app/src/main/assets/fonts/` deleted; iOS never bundled any).
  `TYPE_SCALE` faces carry no `fontFamily` (`TypeFace.fontFamily` is optional, never set).
- Still present until 21.4: `FONT_FAMILY` (names only) and its consumers (`app-tile.tsx`, `ClarifyStep.tsx`,
  `HomeScreen.tsx`, `Orb.tsx`, `ReportSheet.tsx`, `ui/whim-prose/styles.ts`, `whim-prose.suite.ts`). With no
  file behind them, those names draw the system font on both platforms.

## Evidence

- Ember grey at 24 pt (owner's silhouette check, task 9.5):
  `/Users/davrondjabborov/Work/other/Whim-evidence/ds-chain-9/ember-24pt-grey@{1x,2x,3x}.png` and
  `ember-24pt-grey-sheet@3x.png` (on light `bg`, white, dark `bg`).
