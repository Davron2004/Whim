# handoff: native-filter (chain-4, native-main-frame-filter)

Interface of the native second layer (design D6, D9). Consumers: the build runner (task 4.6 build
half) and the on-device chain (5.1-5.3).

## Files

| File | Role |
|---|---|
| `android/app/src/main/java/com/whim/webview/MainFrameOnlyWebView.kt` | `RNCWebView` subclass; overrides `createRNCWebViewBridge` |
| `android/app/src/main/java/com/whim/webview/NetworkDeniedWebViewManager.kt` | now creates `MainFrameOnlyWebView` via a second `RNCWebViewManagerImpl(true)`'s public `createViewInstance(context, webView)`; `blockNetworkLoads = true` unchanged |
| `android/app/build.gradle` | `WHIM_FORCE_JS_INTERFACE_BRIDGE` BuildConfig field; `implementation("androidx.webkit:webkit:${whimWebkitVersion}")`, the version read from the library's `ReactNativeWebView_webkitVersion` (root ext first, fallback = the library's value; compile classpath for `WebViewCompat`) |
| `ios/Whim/WhimWebViewMainFrame.m` (+ `ios/Whim.xcodeproj/project.pbxproj`, Whim Sources phase) | `+load` swizzles on `RNCWebViewImpl` |
| `checks/test/release/webview-main-frame.suite.ts` (+ `release/index.ts`) | static check |
| `checks/test/release/native-network-deny.suite.ts` | helpers exported; manager creation line may be the two-argument form |
| `docs/security/upstream-react-native-webview-main-frame.md` | upstream issue text, owner files it |

## Behaviour

Android, `MainFrameOnlyWebView.createRNCWebViewBridge(webView)`:
- `BuildConfig.WHIM_FORCE_JS_INTERFACE_BRIDGE == true` (debug only): `addJavascriptInterface` of a
  bridge mirroring the library's `RNCWebViewBridge.postMessage` (`onMessage(message, getUrl())`,
  posted to the UI thread, only while messaging is enabled); `super` is not called.
- else, `WEB_MESSAGE_LISTENER` supported and `bridgeListener == null`: registers its own listener
  under `JAVASCRIPT_INTERFACE`, `Set("*")`; the listener returns when `isMainFrame` is false, else
  `onMessage(data, sourceOrigin)`. It sets `bridgeListener` first, so `super` registers nothing and
  only runs its injected-object tail.
- else: `super` unchanged (library fallback, no frame identity; token check alone refuses).

iOS, `WhimWebViewMainFrame +load` (once, `dispatch_once`), on `NSClassFromString(@"RNCWebViewImpl")`:
- `userContentController:didReceiveScriptMessage:` returns early when `!message.frameInfo.isMainFrame`,
  whatever `message.name` (chain-8: the library's `ReactNativeHistoryShim` handler, `RNCWebViewImpl.m:490-492`,
  is exposed to every frame and fires `onLoadEnd`, `:790-796`); otherwise calls the original.
  Android: the library exposes only `ReactNativeWebView` (`RNCWebView.java:56, 259, 269`); no change.
- `webView:decidePolicyForNavigationAction:decisionHandler:` calls
  `decisionHandler(WKNavigationActionPolicyCancel)` and returns when `targetFrame != nil`,
  `!targetFrame.isMainFrame`, and `request.URL.absoluteString` is not in
  `WhimSubFrameNavigationAllowlist()` = `@[ @"about:srcdoc", @"about:blank" ]`. Whole-string
  comparison: `about:blank#x`, `about:srcdoc?x` are refused. `targetFrame == nil` (new window)
  and main-frame navigations go to the original. Narrowing to `data:`/`blob:` (owner fallback) is
  a change to that one function plus the suite's `SUB_FRAME_ALLOWLIST` and the check's
  "exact allowlist" rule.
- A missing class/selector logs `WhimMainFrame: ...` via NSLog and installs nothing; a DEBUG build also `NSCAssert(NO, …)`s (under `#if DEBUG`), so a library upgrade stops the first simulator run.

## Force-fallback switch

- `defaultConfig`: `buildConfigField "boolean", "WHIM_FORCE_JS_INTERFACE_BRIDGE", "false"`.
- `buildTypes.debug`: `true` iff Gradle property `WHIM_FORCE_JS_INTERFACE_BRIDGE=true`.
  `release` and `offline` (`initWith release`) cannot set it.
- Build a debug APK with it on (debug loads JS from Metro: `npm start`, then
  `adb -s emulator-5560 reverse tcp:8081 tcp:8081`):
  ```sh
  (cd android && ./gradlew :app:assembleDebug -PWHIM_FORCE_JS_INTERFACE_BRIDGE=true)
  adb -s emulator-5560 install -r android/app/build/outputs/apk/debug/app-debug.apk
  ```
  or through the wrapper, which spawns Gradle with the caller's environment:
  `ORG_GRADLE_PROJECT_WHIM_FORCE_JS_INTERFACE_BRIDGE=true npm run android -- --device emulator-5560`.
  Rebuild without the property to turn it off (the BuildConfig field is regenerated).

## Static check (`npm run checks:test -- --only release`)

`--only webview-main-frame` / `--only native-network-deny` match nothing: the checks runner
filters at the `release` aggregate. Asserts, in the real tree and against fixtures:
- Android: subclass of `RNCWebView`; the listener's first statement is
  `if (!<isMainFrame param>) return@WebMessageListener`, before `onMessage`; that listener is the
  one passed to `addWebMessageListener(webView, JAVASCRIPT_INTERFACE, …)`; `bridgeListener` is
  assigned it before `super.createRNCWebViewBridge(webView)`; the forced branch is gated by
  `com.whim.BuildConfig.WHIM_FORCE_JS_INTERFACE_BRIDGE` alone; the manager creates
  `MainFrameOnlyWebView(context)` with `RNCWebViewManagerImpl(true)`; `MainApplication` replaces
  exactly one `RNCWebViewPackage` (shared with native-network-deny).
- Gradle: the switch appears only in `defaultConfig` (exactly once, `"false"`) and
  `buildTypes.debug`; no build type does `initWith debug`.
- iOS: exactly one `+load` with `dispatch_once`; each selector swizzled exactly once through a
  `class_replaceMethod`/`method_setImplementation` + `imp_implementationWithBlock` helper on
  `RNCWebViewImpl`; script hook condition exactly `!msg.frameInfo.isMainFrame` (naming a handler fails) →
  `return;`, then the original; navigation hook condition has
  `targetFrame != nil`, `!targetFrame.isMainFrame`, `![<allowlist>() containsObject:<URL.absoluteString>]`,
  `&&` only, then `decisionHandler(WKNavigationActionPolicyCancel); return;`, else the original with
  the handler; allowlist is exactly {`about:srcdoc`, `about:blank`}; the `.m` is in the Whim
  Sources phase.
- Library seams (installed `node_modules/react-native-webview`): `RNCWebView.createRNCWebViewBridge`
  still guards with `bridgeListener == null`; `RNCWebViewImpl` implements both hooked selectors and
  not `decidePolicyForNavigationAction:preferences:decisionHandler:`.

## Compile commands for the runner (not run by chain-4)

Android (JDK 21 via `android/gradle.properties`; `assembleRelease` needs upload keys, so the
release-configuration compile is `offline`):
```sh
npm run build
(cd android && ./gradlew :app:assembleOffline)
(cd android && ./gradlew :app:assembleDebug -PWHIM_FORCE_JS_INTERFACE_BRIDGE=true)
```
`npm run android:release -- --device emulator-5560` builds the same `offline` APK and installs it.

iOS simulator (Xcode 27: `pod install` before `xcodebuild`, then restore `Podfile.lock`):
```sh
(cd ios && bundle exec pod install && xcodebuild -workspace Whim.xcworkspace -scheme Whim \
  -configuration Debug -sdk iphonesimulator -derivedDataPath build/sim build)
git checkout -- ios/Podfile.lock
```
