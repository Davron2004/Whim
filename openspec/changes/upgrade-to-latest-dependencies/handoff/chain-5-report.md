# chain-5 (rn-w3c-ios) report: complete on RN 0.88.1 + op-sqlite 19.0.5 (resumed after the op-sqlite block)

Status: 5.1–5.4 done. The first builder stopped at 5.2 (op-sqlite 16 used `RCTCxxBridge`, removed in 0.88
under `RCT_REMOVE_LEGACY_ARCH=1`); W4 was folded in (op-sqlite 19.0.5, chain-7b) and the resume finished.

## 5.1 template diff (0.85.3 -> 0.88.1 community template, diffed locally)
Applied:
- Info.plist scene manifest key `UISupportsMultipleScenes` -> `UIApplicationSupportsMultipleScenes` (the
  template's and Apple's key; UIKit never read the old one). Checker `scripts/release/lib/ios-project.ts`
  and fixture follow; new mutation case (old key alone fails), red-checked.
- SceneDelegate forwards warm links with `RCTLinkingManager.scene(_:continue:)` / `scene(_:openURLContexts:)`:
  0.88's `RCTLinkingManager.mm` returns NO from `application:openURL:` / `application:continueUserActivity:`
  without posting when `RCTIsSceneDelegateApp()`. The dead AppDelegate `application(...)` forwards are deleted
  (resume); specs/app-links MODIFIED delta names the scene forwards and the connectionOptions -> launch options
  cold start (`specs/app-links/spec.md`).
- Podfile: resource-bundle deployment-target hack dropped (svg 15.16.1 declares 15.1; all 208 targets 15.1).
- pbxproj `PODFILE_DIR = "$(SRCROOT)"`; PrivacyInfo.xcprivacy reordered by pod install (same set).
Already present: `RCTNewArchEnabled`, `UIApplicationSceneManifest`, SceneDelegate.swift, VC-based status bar.
Kept deliberately: factory owned by AppDelegate (scene reattach reuses one ReactHost); Whim's own
connectionOptions -> launchOptions conversion; `sourceURL(for:)` override; no template DEBUG dev-menu config.

## 5.3 swizzle targets (0.88.1 / webview 14.0.1 source) and status-bar ruling
- `RCTStatusBarManager -setStyle:animated:` `RCTStatusBarManager.mm:169`, `-setHidden:withAnimation:` `:186`.
- `RCTFabricModalHostViewController -preferredStatusBarStyle` `:67`, `-prefersStatusBarHidden` `:75`.
- `WKWebView -initWithFrame:configuration:`: webview 14's `RNCWKWebView` inherits it (`RNCWebViewImpl.m:519`).
- `UIViewControllerBasedStatusBarAppearance` stays `true` (today's value, #218; the template also flips to true).
  0.88 ships `RCTStatusBarAppearance.h` (its own take on WhimStatusBar); the swizzle still replaces every
  target. Retiring WhimStatusBar for upstream is a possible later change.

## 5.4 TurboModule registration (source)
WhimAppInfo/WhimAgeSignal/WhimLaunchScreen: `RCT_EXPORT_MODULE` + `RCTTurboModuleManager.mm:739-783` fallback to
`RCTGetModuleClasses()` (`RCT_REMOVE_LEGACY_MODULE_INTEROP` stays 0, `react_native_pods.rb:123`). WhimTone/
WhimHaptics: `codegenConfig.ios.modulesProvider` (package.json). Runtime proof below.

## Resume
- **pod install** (`bundle exec pod install`, CocoaPods 1.15.2): Podfile.lock moved ONLY `op-sqlite (16.2.0)`
  -> `(19.0.5)` and its checksum (`9e09cc64...`). No other pod, no pbxproj or PrivacyInfo change (DiskSpace
  E174.1 kept). 98 pods. Committed. Neither xcodebuild churned Podfile.lock afterwards.
- **Toolchain**: Xcode 27.2 (27B52), Apple clang 21.0.0 (clang-2100.4.1.1), Ruby 4.0.7, worktree-local
  `bundle install` (Gemfile.lock checksum churn restored). React-Core 0.88.1 (from
  `build/rncore-facades/React-Core`), hermes-engine 260318099.0.5, webview 14.0.1, NitroMmkv 4.3.2.
- **Release sim build** (mobile.md recipe, `-derivedDataPath build/sim`, arm64+x86_64): BUILD SUCCEEDED, 0
  `error:` lines (`c5r-xcodebuild-release.log`); includes the AppDelegate forward deletion.
- **Release launch** (own clone of 7458FD2E, deleted after): launcher renders Home (3 example tiles, compose
  bar; `c5r-release-launch.png`); no crash, no `Whim status bar:`/`WhimNetworkDeny:` line
  (`c5r-release-launch.log`). 10 more terminate+cold launches: process alive, no Whim crash report.
- **getConstants race** (RN 0.88.1 `NativeDeviceInfo.getConstants` data race): did NOT reproduce in 11 Release
  cold launches + 1 Debug launch on the simulator. Not proof of absence; device runs should keep watching.
- **Debug build** (`-configuration Debug`, `FORCE_BUNDLING=1` so the JS is bundled and no Metro/red box is
  involved; nothing listened on 8081, `RCTBundleURLProvider` fell back to `main.jsbundle`): BUILD SUCCEEDED.
  Launch log (`--info --debug`, `c5r-debug-launch.log`): no `Whim status bar:` / `Re-check WhimStatusBar` line,
  no assertionFailure, process alive, Home rendered (`c5r-debug-launch.png`, LogBox warning toast only).
- **TurboModules at runtime**: scratch (uncommitted, reverted) block in `index.js`, bundled into the Debug build,
  4 s after start logged via `console.log` (os_log `com.facebook.react.log:javascript`):
  `C5R-TM {"WhimTone":"play","WhimHaptics":"prepare|cue|notification|selection|impact","WhimAgeSignal":
  "acknowledgeSignificantUpdate|requiresSignificantUpdateAcknowledgment|check","WhimAppInfo":"getConstants",
  "WhimLaunchScreen":"hide|hide","appInfo.getConstants":"{\"version\":\"1.1.0\",\"build\":\"1\"}",
  "tone.play":"ok","haptics.selection":"ok","launchScreen.hide":"ok"}` then
  `C5R-TM ageSignal.check resolved unavailable`. All five resolve via `TurboModuleRegistry.get` and answer calls.
  The Release build was made before the scratch edit, so it never contained it.
- **Log observations (not Whim regressions)**: Debug JS warnings: "Deep imports from the 'react-native' package
  are deprecated ('react-native/Libraries/promiseRejectionTrackingOptions')" from
  `src/host/platform/install-diagnostics.ts:40`, and Reanimated "Dependencies should only be used on the web".
  UIKit logs `-[UIApplication statusBarStyle] ... is a no-op on 27.0` twice: from webview 14's
  `RNCWebViewImpl.m:185-186` init, not from Whim (log only, no assert).
- **app-links delta**: `specs/app-links/spec.md` MODIFIED "The iOS app delivers universal links to the launcher"
  (whole block, SHALL on line 1). `openspec validate upgrade-to-latest-dependencies --strict`: valid.
- **mobile.md**: iOS build step 1 now says `pod install` generates the RN core pods under the gitignored
  `ios/build/rncore-facades/` (Podfile.lock points there), so deleting `ios/build` needs a fresh `pod install`.
- Evidence: scratchpad `c5r-pod-install.log`, `c5r-xcodebuild-release.log`, `c5r-xcodebuild-debug.log`,
  `c5r-release-launch.{png,log}`, `c5r-debug-launch.{png,log}`.

## For the chain-6 iOS device runner
- Clean clone (no `ios/build`): `pod install` then Release build; PrivacyInfo.xcprivacy must stay unchanged.
- Status bar vs the main baseline: sheet opened in dark mode, phone flipped to light -> bar flips (#218); also
  hidden/shown via the shell. DEBUG launch silent (no `Whim status bar:`).
- Haptics + cue tones on a real device (simulator only proved the calls return).
- iOS network-deny leg (#74): a mini-app fetch/navigation is refused (no `WhimNetworkDeny:` line seen on sim).
- Cold and warm universal link (now through `scene(_:continue:)`; the AppDelegate forwards are gone).
- getConstants race: watch for a launch crash in `NativeDeviceInfo`.
- Review LOW still open: scene reconnect with a link while the ReactHost survives drops it (pre-existing).

## HARNESS FEEDBACK
- CAUGHT-REAL-MISTAKE: reading 0.88's RCTLinkingManager.mm found warm universal links silently dead in a scene
  app; the template diff alone does not show it. Same for the ignored scene key the checker enforced.
- ENV: primary vendor/bundle is stale after the macOS 27 upgrade; the documented symlink fails.
- DRAWBACK: the plan put W4 after W3 although design anticipated op-sqlite 16 failing on 0.88.

## HARNESS FEEDBACK (resume)
- NEUTRAL: `FORCE_BUNDLING=1` on a Debug sim build gives a Metro-free DEBUG launch with real JS (no red box).
- CAUGHT-REAL-MISTAKE: every Whim TurboModule uses `TurboModuleRegistry.get` (nullable), so a missing module is
  silent at launch; only an explicit probe proves registration.
- ENV: a `caffeinate -w <pid>` wait on the wrong pid returns at once; wait on the xcodebuild pid itself.
