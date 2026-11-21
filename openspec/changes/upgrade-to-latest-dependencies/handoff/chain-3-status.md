# chain-3 status (builder 3A → 3B)

3A did 3.1 (c39df157) and 3.2 (b2442b1e). 3B owns 3.3–3.5.

## Resolved in package-lock.json (Node 26.13.1, npm 11.20)
- react-native 0.88.1 · hermes-compiler 260318099.0.5
- react / react-dom / react-test-renderer 19.3.1 · @types/react 19.3.0 · @types/react-test-renderer 19.3.1
- every `@react-native/*` 0.88.1 (babel-preset, eslint-config, metro-config, typescript-config declared;
  codegen, community-cli-plugin, gradle-plugin, js-polyfills, virtualized-lists, ... transitive). One copy each.
- metro / metro-runtime / metro-symbolicate 0.87.3 (RN 0.88.1 asks `^0.87.1`)
- @react-native-community/cli + cli-platform-android 20.2.0
- typescript 6.0.3, root AND server (server pinned it exactly at 5.9.3; moved to exact 6.0.3 so the pin's
  range holds for every workspace)
- webview 14.0.1, reanimated 4.8.0, worklets 0.14.0, screens 4.30.1, gesture-handler 3.5.0,
  keyboard-controller 1.23.1, svg 15.16.1, safe-area-context 5.11.1, mmkv 4.3.2, nitro-modules 0.37.2,
  react-native-logs 5.6.0, isomorphic-git 1.44.17. Each keeps its old specifier style (exact or caret).
- `npm ls react react-native react-dom`: one copy of each. `npm ls jest`: empty.
- Untouched (later chains): op-sqlite 16.2.0, esbuild, playwright, eslint 8, prettier 2.

## Pins added to dependency-pins.json
| package | range | reason (short) |
|---|---|---|
| typescript | ^6.0.3 | TS 7.0 has no compiler API; server checker, checks/, typescript-eslint, knip import it; 0.88 template pins ^6.0.3 |
| metro-symbolicate | ^0.87 | must match the Metro line RN 0.88.1 resolves (^0.87.1); 0.88.0 is `latest` |
| @react-native-community/cli | ~20.2.0 | 0.88 template pins 20.2.0; CLI 21 states no 0.88 support |
| @react-native-community/cli-platform-android | ~20.2.0 | lockstep with cli |
`npm run checks:test -- --only dependency-pins`: 10/10 pass.

## Config
- metro.config.js, babel.config.js: unchanged. The community template's files are byte-identical between
  0.85.3 and 0.88.1 (diffed the npm tarballs); `react-native-worklets/plugin` stays last.
- tsconfig.json: `baseUrl` removed; `paths` (`vc-sdk` → `./src/sdk`) now resolves relative to the tsconfig.
  Nothing loosened.

## Removed 0.87 APIs
None used anywhere in src/, App.tsx, index.js, build/, scripts/: no `InteractionManager`, no
`Modal.animated`, no StatusBar `backgroundColor`/`translucent` (the one `<StatusBar>` passes only
`barStyle`; `Modal statusBarTranslucent` is a still-supported Modal prop), no `rn-get-polyfills`.

## Strict TS API fixes (behavior unchanged; no casts added, no deep imports)
- Refs: `useRef<View|ScrollView|TextInput|Text>` → `ViewInstance` / `ScrollViewInstance` /
  `TextInputInstance` / `TextInstance`; the Pressable ref in AppTile → `PressableInstance`. Same for the
  exported `useKeyboardOverlap`/`useKeyboardInset`/`revealTarget`/`scrollRef` parameter types.
- KeyboardShell: dropped the `inner as React.RefObject<View>` cast; 0.88 types `innerViewRef` as a
  nullable `Ref`, so the cast and its comment were no longer true.
- `TurboModuleRegistry.get` now returns `T | null | undefined`: haptics.ts and launch-screen.ts pass
  `?? null` into factories typed `Spec | null` (absent module = null, as before).
- `Linking.getInitialURL()` resolves `string | null | undefined`: LauncherRoot's handler takes `undefined`
  too (`!url` already returned on it).
- `TextLayoutEventData` is no longer exported: ui/Text.tsx uses `TextLayoutEvent` (the same type).
- `FlexStyle` is no longer exported: app-crashed-ui.suite.tsx asserts through `ViewStyle`.
- react-native-webview 14.0.1's hand-written `index.d.ts` declares `class WebView<P = undefined>
  extends Component<WebViewProps & P>`; `WebViewProps & undefined` is `never`, so a bare `<WebView>`
  accepts no props. New `src/host/webview.ts` exports `WebView = LibraryWebView<object>` (an
  instantiation expression: same class at runtime) plus the matching type; the four users
  (MiniAppView, useMiniAppHost, DevProbeScreen, NetworkDenyProbeScreen) import from it.

## Checks run by 3A (all exit 0)
build · typecheck (tsc + typecheck-tests, 175 suite files) · lint · knip · checks:test (478/478) ·
server:test (5594/5594, includes tsc of contract/ and server/ on TS 6.0.3) · sdk:test (all PASS) ·
launcher:test (20354/20354) · vstore:test (120/120). gate.sh NOT run (3B's).

## Peer warnings
None from `npm install`. One EBADENGINE, pre-existing: superstatic@10.0.0 (firebase-tools) wants node 20/22/24.

## For 3B
- launcher:test and sdk:test already pass with today's stubs; 3.3 is to make the stubs mirror the
  upgraded libraries' public APIs (webview 14, reanimated 4.8, screens 4.30, gesture-handler 3.5,
  keyboard-controller 1.23, svg 15.16, safe-area 5.11, mmkv 4.3.2), not to fix failures.
- react-test-renderer 19.3.1 prints "react-test-renderer is deprecated" to stderr on every create
  (1383 lines in one launcher run). Noise only; nothing fails on it.
- `src/host/platform/install-diagnostics.ts` keeps its pre-existing, lint-disabled runtime
  `require('react-native/Libraries/promiseRejectionTrackingOptions')`; the file still exists in 0.88.1.
  Not a TS import, so the Strict API does not flag it. Worth a look in 3.5 (guard:metro bundles it).
- Comments that say "RN 0.85" as history (device-acceptance.ts, xhr-transport.ts, OverlayModal.tsx,
  native-host.tsx, crash-capture.ts, hermes-polyfills.ts, NativeWhimTone.ts) were left alone: they record
  where something was measured. No numeric version check in checks/, scripts/, src/, server/ or build/
  asserts the old RN/React/webview version.

## 3B (3.3–3.5)
- Stubs compared against each library's published typings/source in node_modules. Export names the
  host imports all exist in both stub and library (tsc checks host↔library, esbuild host↔stub, so no
  extra check was added). Behavior that changed upstream, now mirrored:
  - reanimated 4.8: a worklet holds the animated ref's Shareable, so `ref()` on the UI thread throws;
    `measure` of a ref never on a view answers null (4.6 crashed); ref observers re-run only for a
    new tag, cleanup a microtask after detach; `layout` registered before each update's commit.
  - gesture-handler 3.5: `onDeactivate`/`onFinalize` carry `canceled: boolean` (stub `pan()` and the
    suites' hand-played ends now send it); stub `PanConfig` lists what the host sets (`minDistance`
    in, unused `failOffsetX` out).
  - native-host: dead `KeyboardAvoidingView`, RN `Animated`/`Easing` (+ `finishAnimations`) removed;
    webview container comment re-verified against 14.
- Product fix this exposed: `SheetAnchor.measured` called `ref()` inside a worklet (the 4.6 guard),
  a TypeError on 4.8's UI thread during every sheet morph. It now calls `measure(ref)`. Red-checked:
  the old body fails sheet-morph-ui/app-morph-ui with `animatedRef is not a function`.
  HistoryScreen's comment on transition registration corrected (logic unchanged).
- Gate fix outside the chain's files: `scripts/test/fixloop-preflight.test.sh` failed 4 cases at BASE
  (5f6663fa made worktree.sh run `npm ci` when `node_modules/.package-lock.json` is missing or older
  than the lockfile; the test's fake primary install had no stamp, so `npm ci` ran on the fake
  lockfile). The fixture now writes npm's stamp; 89/89 pass. worktree.sh untouched.
- install-diagnostics deep require: still valid in 0.88.1 (same default export, same RN caller,
  `exports` serves `./Libraries/*`). No change.
- Results: launcher:test 20363/20363 · invariants 22/22 · bridge:invariants 14/14 · guard:metro
  4,005,738 bytes on Metro 0.87.3 · gate.sh FAST GATE PASSED. Contract: handoff/rn-088-versions.md.
