## 1. W1: removals, low-risk bumps, pin register

- [x] 1.1 Remove jest, `@types/jest`, `@react-native/jest-preset`, `pako`, `@babel/preset-env` and the `test` script. Drop `"jest"` from `tsconfig` `types`. Grep for `@react-native/new-app-screen` imports and remove it if none exist (design D5). Clean `knip.json` of the removed names. `npm install` and commit.
- [x] 1.2 Bump every minor/patch-only package to its `latest` in all three workspaces: zod, hono, `@hono/node-server`, pino, pino-pretty, `@google-cloud/firestore`, firebase-tools, react-error-boundary, eslint-plugin-sonarjs, knip. `npm install` and commit.
- [x] 1.3 Fix every new knip 6.47 finding so `npx knip` exits 0 with no suppression added to `knip.json`.
- [x] 1.4 Add `dependency-pins.json` with the design D4 entries that apply today (`@fission-ai/openspec`, `@babel/core`, `@babel/runtime`), plus a static check under `checks/` wired through `checks/test/acceptance.ts`. It covers the spec `dependency-currency` scenarios: stale entry, reasonless pin, duplicate entry, lockfile outside the range. Red-check it against a register missing each field.
- [x] 1.5 Add `npm run deps:audit`. It queries the registry for every workspace dependency, exits non-zero on undeclared lag, and prints each pin beside its current `latest` and its lift condition. Add a test that drives it with a stubbed registry response for the "undeclared lag" and "fully current" scenarios. Confirm neither gate script calls it.

## 2. W2: Node 26

- [x] 2.1 Set `engines.node` to `>=26` in root, `contract/` and `server/`. Set `.nvmrc` to 26. `npm install` on Node 26 and commit.
- [x] 2.2 Move CI `setup-node`, the devcontainer image and `server/` Dockerfile base to Node 26. Update the spec text: the generation-server Purpose line "Node 22" becomes "Node 26".
- [x] 2.3 Run every Node suite on Node 26 (`gate.sh`, then `gate-full.sh`) and fix any failure at its cause.
- [x] 2.4 Build the server image locally, deploy it under the existing server-deployment protocol (smoke, one generation, rollback ready), and record the deployed tag in the change's progress file.

## 3. W3a: React Native 0.88 — JS and TypeScript side

- [x] 3.1 Move to the newest `react-native` 0.88.x patch. In lockstep move every `@react-native/*` package, `react`/`react-dom`/`react-test-renderer` 19.3.x, `@types/react`/`@types/react-test-renderer`, and typescript 6.0.x (add its `dependency-pins.json` entry). `metro-symbolicate` goes to RN's Metro line, `@react-native-community/cli` + `cli-platform-android` to 20.2.x (pin entries). Move the RN-coupled libraries to `latest`: react-native-webview 14.x, reanimated 4.8.x, worklets 0.14.x, screens, gesture-handler, keyboard-controller, svg, safe-area-context, mmkv, nitro-modules, react-native-logs. Also isomorphic-git 1.44.x. Apply the template's `metro.config.js`/`babel.config.js` changes, keeping `react-native-worklets/plugin` last. Remove `baseUrl` from `tsconfig`. `npm install` and commit.
- [x] 3.2 Fix every type error from the 0.87 Strict TS API and every use of an API removed in 0.87: `InteractionManager`, `Modal.animated`, StatusBar `backgroundColor`/`translucent`, `rn-get-polyfills`. Keep today's behavior. Use no deep imports and no `any` casts to silence a type.
- [x] 3.3 Update the launcher-suite stubs (`src/host/launcher/test/native-*.tsx`) so their exports mirror the upgraded libraries' public APIs. Make `launcher:test`, `sdk:test` and the remaining Node suites pass.
- [x] 3.4 `npm run build`, then `npm run invariants` and `npm run bridge:invariants`. React 19.3 now runs in the sandbox. Confirm every probe still reports contained and the negative controls still fire.
- [x] 3.5 `npm run guard:metro` passes, and the bundle stays above its 500,000-byte floor with no `react` duplication across workspaces.

## 4. W3b: React Native 0.88 — Android

- [ ] 4.1 Apply the 0.88 template Android diff: Gradle wrapper 9.4.1, AGP 9.2.1, Kotlin 2.2.0, compile SDK and buildTools 37, and the `android.builtInKotlin=false`/`android.newDsl=false` opt-outs. Keep JDK 21, arm64-only, `newArchEnabled`, `hermesEnabled` and `edgeToEdgeEnabled`. Commit.
- [ ] 4.2 Make the `offline` build type assemble: `npm run android:release -- --device emulator-5560`. Keep the `usesCleartextTraffic` workaround and the `RelWithDebInfo` CMake pin only if still needed, and say which in a code comment.
- [ ] 4.3 Re-verify the RN internals `MainActivity.kt` and `MainApplication.kt` rely on against the 0.88 sources: `ReactModalHostView.dialog`, `NativeDeviceInfoSpec` as `LifecycleEventListener`, `RNScreensFragmentFactory`, `DefaultReactActivityDelegate`, the single `RNCWebViewPackage` swap. Fix each at its cause. On device, the "Re-check … after a React Native upgrade" log line stays silent.
- [ ] 4.4 Keep the fourth containment leg intact. `NetworkDeniedWebViewManager` still subclasses the webview 14 manager and sets `blockNetworkLoads` in `createViewInstance`. `checks/test/release/native-network-deny.suite.ts` passes against the new symbols, and `RUN_NETDENY_PROBE` on Whim_Verify shows every network load refused.
- [ ] 4.5 Make the Android-reading static checks pass (`checks/test/release/android-project.suite.ts`, `checks/test/repo/android-edge-to-edge.suite.ts`), updating expected values only where the template changed them.

## 5. W3c: React Native 0.88 — iOS

- [ ] 5.1 Apply the 0.88 template iOS diff: Podfile, `Info.plist` keys (`RCTNewArchEnabled`, scene manifest), `AppDelegate.swift`/`SceneDelegate.swift` shape, `<React/RCTAppDelegate.h>` header paths. Run `bundle exec pod install` and commit `Podfile.lock`.
- [ ] 5.2 Build for the iOS simulator using the docs/release/mobile.md recipe, then restore any incidental `Podfile.lock` churn.
- [ ] 5.3 Re-verify the `WhimStatusBar` swizzle targets (`RCTStatusBarManager` selectors, `RCTFabricModalHostViewController`) and `WhimWebViewNetworkDeny.m`'s `WKWebView` initializer swizzle against 0.88 and webview 14. Keep `UIViewControllerBasedStatusBarAppearance` at the value that preserves today's status-bar behavior (design D8). The DEBUG assert stays silent on launch.
- [ ] 5.4 Make the five `.mm` TurboModules compile and register. Make `checks/test/release/ios-project.suite.ts` pass.

## 6. W3d: React Native 0.88 — device verification

- [ ] 6.1 On Whim_Verify, with the offline build and Settings → Advanced → own server pointed at a local stub, generate a mini-app end to end. Logcat shows the XHR SSE path (`fetchCanStream` false) and exactly one generation POST.
- [ ] 6.2 Run the on-device containment verdict and record CONTAINED with the probe count.
- [ ] 6.3 Run `RUN_VSTORE_PROBE`, `RUN_STORAGE_PROBE`, `RUN_BRIDGE_PROBE` and `RUN_DATA_COPY_PROBE`, one at a time, and record each result.
- [ ] 6.4 On the iOS simulator, launch, open a mini-app, and confirm it renders, haptics and cues fire, and the status bar matches the pre-upgrade build in screenshots.
- [ ] 6.5 Record every finding as a fix task in the change's progress file. Resolve each before W4 starts.

## 7. W4: op-sqlite 19

- [ ] 7.1 Before bumping, write a fixture database with op-sqlite 16.2.0 on Whim_Verify through the storage engine (tables, every field type, a burned field id) and pull the file into the change folder.
- [ ] 7.2 Move `@op-engineering/op-sqlite` to its `latest` 19.x. `npm install`, `pod install`, commit.
- [ ] 7.3 Adapt `src/host/storage-engine/bindings/op-sqlite.ts` to any changed result shape (`executeSync` rows, async API). `npm run storage:test` passes.
- [ ] 7.4 On Whim_Verify, open the 16.2.0 fixture with the 19.x build and confirm every row, field and `_meta` schema reads back identically. Run `RUN_STORAGE_PROBE`.

## 8. W5: esbuild, Playwright, CI

- [ ] 8.1 Move esbuild to its `latest` (root and server) and Playwright to its `latest` (root and server, kept equal per spec `generation-server`). Update the seven hard-coded Playwright references, including the seccomp profile filenames and the Dockerfile install. `npm install` and commit.
- [ ] 8.2 `npm run build` round-trips its source maps, and `tsconfigRaw: '{}'` still keeps `react/jsx-runtime` out of mini-app bundles (H1b). Regenerate the generated artifacts.
- [ ] 8.3 `npm run invariants`, `bridge:invariants` and `synthrun` pass on the new Chromium. A new probe failure is a finding to fix, never one to suppress.
- [ ] 8.4 Move the CI runner to the newest Ubuntu image (reverting ffb704a0's pin) if Playwright installs Chromium there. Otherwise keep the pin and record the failure in the workflow comment.
- [ ] 8.5 Rebuild and redeploy the server image so prod runs the new Chromium. Smoke-test it with one generation.

## 9. W6: ESLint 9 flat config, prettier 3

- [ ] 9.1 Rewrite `.eslintrc.js` as `eslint.config.mjs` on ESLint 9.39.x (pin entry) with `@react-native/eslint-config` 0.88.1 and sonarjs `recommended`. Carry over every custom `no-restricted-syntax` guard and override. Delete `.eslintrc.js`/`.eslintignore`. Move prettier to 3.x. Commit.
- [ ] 9.2 Prove each carried-over custom guard still fires by red-checking it with a deliberate violation. Fix new lint findings at their cause, with no blanket disables.
- [ ] 9.3 Update `CONFIG_SET` documentation references from `.eslintrc*` to `eslint.config.*` where docs name the file.

## 10. W7: docs and closure

- [ ] 10.1 Update CLAUDE.md (RN version, Node 26, the removed `npm test` line, the ESLint config name), docs/release/mobile.md and docs/harness.md wherever they name a changed version or command.
- [ ] 10.2 Append a decision-log entry recording the policy (latest stable or a documented pin), the waves, and the initial pin register.
- [ ] 10.3 Run `npm run deps:audit`. It exits 0, with every remaining lag covered by a pin entry.
- [ ] 10.4 Check whether any tester has a build (the latest TestFlight / Play internal-track build distributed to testers). If one does, run the release upgrade check (spec `release-upgrade-check`) from it to the final candidate on Whim_Verify: tiles, version counts, saved data, consent and device id unchanged. If none does, skip the check and record that in the progress file (owner decision 2026-11-20).
- [ ] 10.5 File the follow-ups as `ai-proposed` GitHub issues: OpenSpec 2.x spec-corpus migration, native CI build job, and any pin whose lift condition is already met. Then propose the WebView provenance change against the merged versions.
