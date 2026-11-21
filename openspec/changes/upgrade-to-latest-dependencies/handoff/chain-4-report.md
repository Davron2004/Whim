# chain-4 (rn-w3b-android): Android on React Native 0.88.1

Branch `chain/upgrade-to-latest-dependencies-chain-4`, BASE 33d89fde. No emulator/adb/install was run.

## Files changed and why

| file | change |
|---|---|
| `android/gradle/wrapper/gradle-wrapper.properties` | `gradle-9.3.1-bin` → `gradle-9.4.1-bin` (AGP 9.2 needs Gradle ≥ 9.4.1); adds `distributionSha256Sum` = Gradle's published `gradle-9.4.1-bin.zip.sha256` (`2ab2958f…`) |
| `android/gradle/wrapper/gradle-wrapper.jar` | the 9.4.1 wrapper jar, byte-copied from `node_modules/@react-native/gradle-plugin/gradle/wrapper/` (RN's own 9.4.1 wrapper). `gradlew`/`gradlew.bat` unchanged: they differ from RN's only in a comment URL and the Meta licence header |
| `android/build.gradle` | `buildToolsVersion` 36.0.0 → 37.0.0, `compileSdkVersion` 36 → 37, `kotlinVersion` 2.1.20 → 2.2.0. `targetSdkVersion` 36, `minSdkVersion` 24, `ndkVersion` 27.1.12297006 stay as they are (they match `node_modules/react-native/gradle/libs.versions.toml`) |
| `android/gradle.properties` | adds `android.builtInKotlin=false` and `android.newDsl=false` with a comment. JDK 21 pin, `reactNativeArchitectures=arm64-v8a`, `newArchEnabled`, `hermesEnabled` and `edgeToEdgeEnabled` all unchanged |
| `android/app/build.gradle` | `proguard-android.txt` → `proguard-android-optimize.txt`, as the template does (inert while minify is off). The two `offline` workarounds are kept, each with a comment saying why |
| `android/app/src/main/java/com/whim/MainActivity.kt` | `DefaultReactActivityDelegate(this, mainComponentName)`: the 3-argument `fabricEnabled` constructor is `@Deprecated` in 0.88.1 and ignores its flag; the `fabricEnabled` import is dropped |

AGP 9.2.1 / KGP 2.2.0 come from `@react-native/gradle-plugin` 0.88.1. AGP warns both opt-outs are
deprecated (removed in AGP 10); no warnings in `com.whim` sources.

## Workarounds: both kept, each tested by removing it

- **`manifestPlaceholders.usesCleartextTraffic = "false"` on `offline`**: kept. RN 0.88.1's
  `AgpConfiguratorUtils.configureBuildTypesForApp` still sets the placeholder in `finalizeDsl`, and
  only on `debug`/`release`/`debugOptimized`. With the line removed, `:app:processOfflineMainManifest`
  fails: "Attribute application@usesCleartextTraffic … requires a placeholder substitution but no value
  for <usesCleartextTraffic> is provided".
- **`-DCMAKE_BUILD_TYPE=RelWithDebInfo` on `offline`**: kept. With it removed, `:app:assembleOffline`
  fails at the app's native link with `ld.lld: undefined symbol: facebook::react::Sealable::Sealable()`,
  `~Sealable()`, `vtable for facebook::react::DebugStringConvertible` and `Sealable::ensureUnsealed()`,
  from the codegen `Props.cpp`. These are debug-only symbols the release `react-android-0.88.1` AAR does
  not export. RN's own `debugOptimized` still pins `-DCMAKE_BUILD_TYPE=Release` the same way.

## Build result

`android/gradlew -p android :app:assembleOffline --no-daemon --max-workers=4` exits 0.
APK: `android/app/build/outputs/apk/offline/app-offline.apk`, 41,370,430 bytes (arm64-v8a only).
- Default parallelism hit a 6144 MB watchdog cap mid native build; 8192 MB with `--max-workers=4` passed.
- op-sqlite 16.2.0 declares no `ndkVersion`, so AGP 9.2.1 gave it NDK 28.2.13676358 (two STL
  versions in one APK). Review fix: `android/build.gradle` forces every `com.android.library` onto
  `rootProject.ext.ndkVersion` (`plugins.withId` + `finalizeDsl`; `afterEvaluate` breaks under RN's
  root plugin). After a clean rebuild every library `.cxx/**/arm64-v8a/CMakeCache.txt` shows
  `CMAKE_ANDROID_NDK` = `ndk/27.1.12297006` and the packaged `libop-sqlite.so` reads `r522817b` /
  clang 18.0.2 (was r530567e). Rebuilt APK 41,354,046 bytes. No W4 fold needed.
- **Post-build check to repeat**: `^CMAKE_ANDROID_NDK:` in each fresh `.cxx` CMakeCache must be 27.1,
  and `grep -a -o r522817b` on the APK's `libop-sqlite.so` must match (28.2 or `r530567e` = regressed).
- No static check for the pin: a regex over Groovy would only restate the line.

## 4.3: RN internals that MainActivity/MainApplication rely on (0.88.1 sources)

| internal | 0.88.1 location | verdict |
|---|---|---|
| `ReactModalHostView.dialog` | `react-native/ReactAndroid/src/main/java/com/facebook/react/views/modal/ReactModalHostView.kt:76` `public var dialog: ComponentDialog?` | unchanged: public, `.window` still reachable |
| Modal dialog scrim turned on per prop apply | same file `:374` `updateProperties()` → `:397` `dialogWindow.enableEdgeToEdge()`; `views/view/WindowUtil.kt:188` sets `isNavigationBarContrastEnforced` | unchanged: the MainActivity comment still holds |
| Activity scrim turned on in delegate | `ReactActivityDelegate.java:142` `updateEdgeToEdgeFeatureFlag` → `WindowUtil.kt:67` `enableEdgeToEdge()` | unchanged |
| Preallocated Modal shown early | `views/modal/ReactModalHostManager.kt:113-115` `onAfterUpdateTransaction` → `showOrUpdate()` | unchanged |
| `NativeDeviceInfoSpec` as `LifecycleEventListener` | `modules/deviceinfo/DeviceInfoModule.kt:30-31` `DeviceInfoModule : NativeDeviceInfoSpec(…), LifecycleEventListener`; `:117` `onHostResume()` re-reads `fontScale` and emits only on change | unchanged |
| `RNScreensFragmentFactory` | `react-native-screens/android/src/main/java/com/swmansion/rnscreens/fragment/restoration/RNScreensFragmentFactory.kt:3` | unchanged |
| keyboard-controller `StatusBarManager` | `react-native-keyboard-controller/…/modules/statusbar/StatusBarManagerCompatModuleImpl.kt:140` `NAME = "StatusBarManager"`, `:108` sets via `WindowInsetsControllerCompat`; RN `WindowUtil.kt:101` `setStatusBarStyle` uses `insetsController` when `SDK_INT > R` | unchanged: the API 31–34 two-store reconciliation still applies |
| `DefaultReactActivityDelegate` | `defaults/DefaultReactActivityDelegate.kt:22-48`: the 2-argument primary constructor; the `fabricEnabled` overloads are `@Deprecated` and ignore the flag; `DefaultNewArchitectureEntryPoint.kt:132` `fabricEnabled` is always `true` | **changed**: switched to the 2-argument constructor; behaviour unchanged |
| single `RNCWebViewPackage` swap | generated `android/app/build/generated/autolinking/…/PackageList.java:77`: exactly one `new com.reactnativecommunity.webview.RNCWebViewPackage()` | unchanged |

## 4.4: the fourth containment leg (react-native-webview 14.0.1, new-arch source set)

- `android/src/newarch/com/reactnativecommunity/webview/RNCWebViewManager.java:37` `public class
  RNCWebViewManager extends ViewGroupManager<RNCWebViewWrapper>`, public no-arg constructor `:43`,
  `:62` `protected RNCWebViewWrapper createViewInstance(@NonNull ThemedReactContext)`; no 4-arg override.
- RN 0.88.1 `uimanager/ViewManager.java:205-229`, the only creation path: `createViewInstance(reactContext)`
  (`:224`) runs before `updateProperties` (`:229`), so `blockNetworkLoads` precedes any `source` prop.
- `RNCWebViewWrapper.kt:23` `val webView: RNCWebView` is public. `RNCWebViewPackage.java:20-22` returns
  one `new RNCWebViewManager()`; `NetworkDeniedWebViewPackage` inherits its module providers unchanged.
- `checks:test` passes (`native-network-deny`, `android-project`, `android edge to edge`); no regex changed.

## DEVICE RUNNER BRIEF (Whim_Verify, emulator-5560 only)

1. **Build and install** from this branch tip in your own checkout, which needs its own node_modules
   (`scripts/worktree.sh provision`): `npm run android:release -- --device emulator-5560`, run with
   Node 26. The first native build in a fresh checkout went over 6 GB. Use an 8 GB cap, and if you
   need to bound parallelism, set `GRADLE_OPTS=-Dorg.gradle.workers.max=4` in your environment rather
   than editing a file. Expect `app-offline.apk` at about 41 MB.
2. **Startup crash guard.** Grep logcat for `FATAL EXCEPTION` and for
   `react-native-webview autolinking must provide exactly one RNCWebViewPackage`. Either one is a FAIL.
3. **The one Android "Re-check … after a React Native upgrade" line.** It is logged with tag `Whim`
   at level W, and contains `Re-check this re-read after a React Native upgrade`
   (`adb -s emulator-5560 logcat -s Whim:W`). It can only fire when the font scale changes while Whim
   is resumed. Bring Whim to the front, then run
   `adb -s emulator-5560 shell settings put system font_scale 1.3`, then set it back to `1.0`.
   PASS: the line never appears and the text re-lays out at the new size without a restart.
   FAIL: the line appears (it names the module object that is not a `LifecycleEventListener`).
4. **RUN_NETDENY_PROBE.** In your scratch checkout only (never commit it), set `App.tsx:30`
   `const RUN_NETDENY_PROBE = true;`, then rebuild and install as in step 1.
   - On the Mac, start `node scripts/netdeny/run.mjs canary --expect zero --seconds 180` before you
     launch the app. It serves on 127.0.0.1:8765 and 8766, and the app reaches it as `10.0.2.2`.
   - The screen `Whim · network-deny probe (whim-netdeny-probe-marker-v1)` runs 7 variants, 5 s each;
     each row shows `bundle=fetched`, its messages and errors, and the screen ends with `done`.
     Logcat (`ReactNativeJS`) shows `netdeny variant finished` for each variant, then `netdeny probe done`.
   - **The verdict is the canary's last line**: `NETDENY PASS expect=zero bundles=<n> hits=0 tls=0`.
     Every variant's bundle must be fetched, with zero hits and zero TLS connections. Any hit, TLS
     connection or `missing=` is a FAIL.
   - If the rows show `bundle=error: …`, the emulator's route to `10.0.2.2` is dead and the run proves
     nothing. Use `adb -s emulator-5560 reverse tcp:8765 tcp:8765` (and the same for 8766), plus
     `NETDENY_CANARY_HOST_OVERRIDE = '127.0.0.1'` in `src/host/NetworkDenyProbeScreen.tsx:63`, both
     scratch-only.
