# Contract: React Native 0.88 versions (chain-3 → chains 4, 5, 6, 8)

Source of truth is `package-lock.json` on the chain-3 branch. Node 26.13.1 / npm 11.20 resolved it.
One copy of each package below (no nested duplicates); `npm ls react react-native react-dom` shows one each.

## Resolved versions

| package | specifier in package.json | resolved |
|---|---|---|
| react-native | 0.88.1 | 0.88.1 |
| react, react-dom, react-test-renderer | 19.3.1 | 19.3.1 |
| @types/react / @types/react-test-renderer | ^19.3.0 / ^19.3.1 | 19.3.0 / 19.3.1 |
| @react-native/babel-preset, eslint-config, metro-config, typescript-config | 0.88.1 | 0.88.1 |
| @react-native/* transitive (asset-utils, babel-plugin-codegen, codegen, community-cli-plugin, debugger-frontend, debugger-shell, dev-middleware, eslint-plugin, gradle-plugin, js-polyfills, metro-babel-transformer, normalize-colors, virtualized-lists) | — | 0.88.1 |
| hermes-compiler | transitive (react-native) | 260318099.0.5 |
| metro, metro-runtime, metro-config | transitive | 0.87.3 |
| metro-symbolicate | 0.87.3 | 0.87.3 |
| @react-native-community/cli, cli-platform-android | 20.2.0 | 20.2.0 |
| @react-native-community/cli-platform-ios | transitive | 20.2.0 |
| react-native-webview | ^14.0.1 | 14.0.1 |
| react-native-reanimated | 4.8.0 | 4.8.0 |
| react-native-worklets | 0.14.0 | 0.14.0 |
| react-native-screens | 4.30.1 | 4.30.1 |
| react-native-gesture-handler | 3.5.0 | 3.5.0 |
| react-native-keyboard-controller | 1.23.1 | 1.23.1 |
| react-native-svg | 15.16.1 | 15.16.1 |
| react-native-safe-area-context | ^5.11.1 | 5.11.1 |
| react-native-mmkv | ^4.3.2 | 4.3.2 |
| react-native-nitro-modules | ^0.37.2 | 0.37.2 |
| react-native-logs | 5.6.0 | 5.6.0 |
| @op-engineering/op-sqlite | ^16.2.0 | 16.2.0 (unchanged by this chain) |
| isomorphic-git | 1.44.17 | 1.44.17 |
| typescript | ^6.0.3 (root and server) | 6.0.3 |

Peer facts: react-native 0.88.1 peers `react ^19.3.0`; reanimated 4.8.0 and worklets 0.14.0 peer
`react-native 0.87 - 0.89`; reanimated 4.8.0 peers `react-native-worklets 0.14.x`.

## Pins added by chain-3 (`dependency-pins.json`)

| package | range | reason | lifts when |
|---|---|---|---|
| typescript | ^6.0.3 | 7.0 ships no compiler API; the server checker, checks/, typescript-eslint and knip import it; the 0.88 template pins ^6.0.3 | a stable 7.x with a compiler API typescript-eslint supports |
| metro-symbolicate | ^0.87 | must match the Metro line RN 0.88.1 resolves (`^0.87.1`); 0.88.0 is `latest` | an RN release on Metro 0.88+ |
| @react-native-community/cli | ~20.2.0 | the 0.88 template pins 20.2.0; CLI 21 states no 0.88 support | a template pinning CLI 21, or CLI notes stating 0.88 support |
| @react-native-community/cli-platform-android | ~20.2.0 | lockstep with cli | same as cli |

No RN-coupled native library needed a pin on the JS side (D4's screens 4.30.1 caveat is a native
build question: chain-4/5 add a pin entry with the observed failure if it does not build).

## Facts chains 4–6 must honor

1. **Metro line is 0.87.x** (0.87.3). `metro.config.js` and `babel.config.js` are unchanged and
   byte-identical to the 0.88.1 community template's; `react-native-worklets/plugin` stays last.
2. **WebView typing seam:** every host use of the WebView imports it from `src/host/webview.ts`
   (`WebView = LibraryWebView<object>`), never from `react-native-webview` directly; webview 14's
   `index.d.ts` makes a bare `WebView` accept no props.
3. **WebView 14, Android, as visible from the package** (what `android/app/.../webview/
   NetworkDeniedWebViewManager.kt` subclasses): class `com.reactnativecommunity.webview.RNCWebViewManager`
   still exists (new-arch source `android/src/newarch/...`), public no-arg constructor,
   `protected RNCWebViewWrapper createViewInstance(ThemedReactContext)`, `getName()` = `"RNCWebView"`;
   `RNCWebViewWrapper.webView` is a public `val` of `RNCWebView`. Codegen: component `RNCWebView`,
   module `RNCWebViewModule`, `javaPackageName` `com.reactnativecommunity.webview`. Whether it
   compiles is chain-4's to verify.
4. **WebView 14 container:** still draws the native view inside a `View` styled
   `[{ flex: 1, overflow: 'hidden' }, containerStyle]` on both platforms (unchanged from 13).
5. **Reanimated 4.8 animated refs:** a worklet receives the ref's Shareable (`.value` holds the shadow
   node wrapper), not a function: calling `ref()` on the UI thread throws, and `measure` of a ref on
   no view answers null with a `logger.warn` on every call. Host code does neither: every view the UI
   thread measures is a `PlaceRef` from `usePlace()` (`src/host/ui/SheetAnchor.tsx`): `{ ref, on,
   attach }`, `attach` is the view's callback ref, `on` a shared value set true after the ref takes
   the view and false before it lets it go (both reach the UI queue in that order), and
   `measured(place)` is `on.value ? measure(ref) : null`. Sheet frame, anchors and their embers,
   travel layer/source/target and the mini-app frame all use it. Expected on device: no "view with
   tag null is not a valid argument for measure()" warning during M5/M6 sheet opens/closes, M9/M10
   travels or M2/M3 app opens/closes. Chain-6 must flag: any such warning (a place measured off a
   view, or the ordering assumption wrong on device), and any `... is not a function` from a worklet.
6. **Reanimated 4.8 layout transitions** are registered before the commit that sets them is drawn
   (`getSnapshotBeforeUpdate`), except the mounting commit (registered after, in `componentDidMount`).
7. **Gesture Handler 3.5:** `onDeactivate`/`onFinalize` events always carry `canceled: boolean`.
8. **Deep require kept:** `src/host/platform/install-diagnostics.ts` requires
   `react-native/Libraries/promiseRejectionTrackingOptions` in `__DEV__`; in 0.88.1 the file exists,
   its default export is still `{ allRejections, onHandled, onUnhandled }`, RN's `polyfillPromise.js`
   still passes it to `HermesInternal.enablePromiseRejectionTracker`, and the package `exports` map
   serves `./Libraries/*` → `./Libraries/*.js`.
9. **React 19.3 in the sandbox:** the WebView runtime bundles React 19.3.1. Desktop Chromium results
   are below; the authoritative verdict is chain-6's on-device CONTAINED.
10. `react-test-renderer` 19.3.1 prints "react-test-renderer is deprecated" on every create: noise.
11. **The sandbox's ES floor is not tsc's:** `@react-native/typescript-config` 0.88.1 adds
    `es2022.error`, `es2024.promise`, `esnext.promise` to `lib`, so tsc accepts `Promise.withResolvers`
    in `src/sdk`. The guard is `checks/test/repo/webview-floor.suite.ts`: it scans the built
    `sdkInject` and every `src/runtime/web` part against `POST_FLOOR_BUILTINS` (checks/contract.ts).

## Verification results on this branch (desktop)

- `npm run build`: runtime HTML 461 KiB, carries React/ReactDOM 19.3.1 (version strings in
  `src/runtime/generated/runtime-html.ts`).
- `npm run invariants`: 22/22 PASS against the retained build, every probe contained; the
  verdict-channel, broken-CSP and INV-TIMER negative controls fire.
- `npm run bridge:invariants`: 14/14 PASS; the broken-gate negative control is flagged.
- `npm run guard:metro`: Metro v0.87.3, Android release bundle 4,005,738 bytes (floor 500,000);
  `npm ls react react-dom react-native --all`: every dependent dedupes to the single root copy.
