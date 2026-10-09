# Contract: native-deps (chain-7)

## Pinned versions (`package.json` `dependencies`, exact, no range)

| Package | Pin | Peer ranges it declares |
|---|---|---|
| `react-native-reanimated` | `4.6.0` | `react-native: 0.83 - 0.87`, `react-native-worklets: 0.12.x` |
| `react-native-worklets` | `0.12.2` | `react-native: 0.83 - 0.87` |
| `react-native-gesture-handler` | `3.3.0` | `react-native: *` (iOS pod depends on `RNWorklets >= 0.8.0`) |
| `react-native-svg` | `15.15.5` | `react-native: *` |
| `react-native-screens` | `4.28.0` | `react-native: *` |
| `react-native-keyboard-controller` | `1.22.6` | `react-native: *`, `react-native-reanimated: >=3.0.0` |

Reanimated and worklets move together: a Reanimated minor fixes its worklets minor. Re-check the pairing
(`npm view react-native-reanimated@<v> peerDependencies`) before any bump; `latest` was already 4.7.1 /
0.13.0 when these were pinned. One `react` (19.2.3) and one `react-native` (0.85.3) in the tree.

`babel.config.js`: `plugins: ['react-native-worklets/plugin']`, which must stay the last plugin. No
`metro.config.js` change.

## Root wrappers (`App.tsx`)

```tsx
enableScreens(true);   // module scope, react-native-screens; logs at startup if RNSScreen isn't linked

<RootErrorBoundary onError={recordRenderCrash}>
  <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <KeyboardProvider>
        <ReducedMotionConfig mode={ReduceMotion.System} />
        {content /* LauncherRoot or a probe screen */}
      </KeyboardProvider>
    </SafeAreaProvider>
  </GestureHandlerRootView>
</RootErrorBoundary>
```

- Every gesture (`react-native-gesture-handler` 3 `GestureDetector`) and every `useKeyboard*` hook from
  `react-native-keyboard-controller` works anywhere under `LauncherRoot`; no screen adds its own root.
- `ReducedMotionConfig` makes every Reanimated animation follow the OS Reduce Motion setting. It does not
  reach RN `Animated` or the sandboxed iframe (which gets `reduceMotion` from the theme frame).
- `KeyboardProvider` runs edge to edge (`react-native-is-edge-to-edge` reports true, so it forces
  `statusBarTranslucent`/`navigationBarTranslucent`/`preserveEdgeToEdge`): it pads nothing. RN's own
  `Keyboard` events and `KeyboardFrameReporter.kt` keep working as before. Its Android modal watcher sets
  `SOFT_INPUT_ADJUST_NOTHING` on RN `Modal` windows; frames pad themselves by the keyboard already
  (`keyboard-shell.ts`), so a modal must not rely on window resize.

## Android native setting

`MainActivity.onCreate` sets `supportFragmentManager.fragmentFactory = RNScreensFragmentFactory()` before
`super.onCreate` (react-native-screens: restored stack fragments are dropped after process death instead
of crashing). `MainApplication.kt` is unchanged: all six packages autolink; #74's network-deny WebView
manager replacement and `WhimTonePackage()` stand (`native-network-deny.suite.ts` green).
`edgeToEdgeEnabled=true`, `newArchEnabled=true`, `hermesEnabled=true`, `reactNativeArchitectures=arm64-v8a`
unchanged; no Gradle property was needed.

## `Icon` (`src/host/ui/Icon.tsx`)

```ts
import type { IconName } from '../../design/icons/names';
export interface IconProps {
  name: IconName;   // typed: glyph, chrome or 'circle'; resolve free text with resolveIcon/resolveGlyph first
  size?: number;    // pt, default 20 (16 inline, 20 rows and buttons, 24 headers, 28 empty states)
  color: string;    // a resolved colour value; Icon reads no theme
  label?: string;   // screen-reader label; absent = decorative
  stroke?: number;  // stroke in 24-grid units; overrides the size default (tile glyphs pass 2)
}
export function Icon(props: Readonly<IconProps>): JSX.Element;
```

- Draws `ICON_PATHS[name]` as one `Path` in an `Svg` of `size × size`, `viewBox="0 0 24 24"`,
  `fill="none"`, `stroke={color}`, round caps and joins.
- Default stroke renders 1.5 pt below 24 pt and 1.75 pt from 24 pt (system.md §3.1):
  `strokeWidth = rendered × 24 / size`.
- Wrapped in a `View` of `size × size`. With `label`: `accessible`, `accessibilityRole="image"`,
  `accessibilityLabel={label}`. Without: `accessible={false}`, `accessibilityElementsHidden`,
  `importantForAccessibility="no-hide-descendants"`.

## Tests

- `src/host/launcher/test/icon-ui.suite.tsx` (registered in launcher `acceptance.ts`): path per name,
  outline props, stroke per size parsed from system.md §3.1, grid-stroke override, a11y.
- The launcher Node runner aliases `react-native-svg` to `src/host/launcher/test/native-svg.tsx` (`Svg`
  default export and `Path` as host elements). A suite rendering Reanimated, Gesture Handler, screens or
  keyboard-controller components needs its own alias in `run.mjs`; none exists yet.

## iOS native setting

`ios/Podfile` `post_install`, after `react_native_post_install`: raises every pod's resource-bundle target
to `min_ios_version_supported` (never lowering). RN's own bump skips bundle targets, and react-native-svg's
`RNSVG-RNSVGFilters` bundle declares iOS 12.4, which Xcode 27 rejects (`BUILD FAILED` without it).

## Build notes

- `npm install` inside the tree, then `cd ios && bundle exec pod install` (adds RNReanimated, RNWorklets,
  RNGestureHandler, RNSVG, RNScreens, react-native-keyboard-controller). Commit only the lockfile's new pods,
  the `ReactCodegen` and `PODFILE CHECKSUM` lines; restore the path-dependent `hermes-engine`,
  `React-Core-prebuilt`, `ReactNativeDependencies` checksums (their local podspecs embed the checkout path)
  and the `project.pbxproj`/`PrivacyInfo.xcprivacy` reordering.
- Android: `./gradlew :app:assembleOffline` (JDK 21, node 22) builds Reanimated's and worklets' CMake;
  arm64 `.so` added: libreanimated 1.6 MB, libworklets 1.1 MB, rnscreens 1.3 MB (with codegen), rnsvg
  codegen 0.8 MB, gesturehandler 0.5 MB (with codegen), uncompressed.
- `guard:metro` runs from a chain worktree with its own `node_modules`; the release JS bundle is
  3,472,863 bytes with these deps.
- Boot logs ~80 benign `ViewManagerPropertyUpdater: Could not find generated setter` warnings on Android
  (core RN and `com.whim.webview` log the same); not an error.
