# Research digest: what native, entry-point, cue and tooling terrain would making both Whim apps buildable, signable and uploadable by script touch?

<!-- Compiled from three researcher digests run 2026-09-14 against `integration/store-launch` (7855881):
"native projects" (A), "entry polyfills and sound cues" (B), "repo-wide release terrain" (C).
Section D holds planner spot-checks: the local machine, web sources, and one-command greps. -->

## Relevant files
- `ios/Whim.xcodeproj/project.pbxproj` — the only iOS build-settings source; one target `Whim`, no test target (A)
- `ios/Whim/{Info.plist,PrivacyInfo.xcprivacy,AppDelegate.swift,LaunchScreen.storyboard}`, `Images.xcassets/AppIcon.appiconset/Contents.json` (A)
- `ios/Podfile`, `ios/Podfile.lock`, root `Gemfile` + `Gemfile.lock`, `.bundle/config`, `ios/.xcode.env` (A)
- `android/app/build.gradle:80-126`, `android/build.gradle`, `android/gradle.properties`, `android/app/src/main/AndroidManifest.xml`, `res/xml/network_security_config.xml`, `res/values/styles.xml`, `res/mipmap-*` (A)
- `android/app/src/main/java/com/whim/{MainActivity.kt,MainApplication.kt}`, `.../tone/{WhimToneModule.kt,WhimTonePackage.kt}` (A, B)
- `index.js`, `App.tsx` — RN entry and probe flags (B)
- `src/host/version-store/polyfills.ts`; importers `compaction.ts:14`, `device-acceptance.ts:19`, `engine.ts:22` (B)
- `src/host/storage-engine/marshal.ts:24-25` — module-scope `new TextEncoder()` / `new TextDecoder()` (B)
- `src/host/cue-backend.ts`, `src/native/NativeWhimTone.ts`, `openspec/specs/mini-app-cues/spec.md` (B)
- `checks/test/acceptance.ts`, `checks/test/run.mjs`, `knip.json`, `tsconfig.json`, `.eslintrc.js`, `.eslintignore`, `scripts/gate.sh` (C)
- `demo/android/flows/tea/*.yaml` — six Maestro flows with `appId: com.whim` (C)

## Current behavior
- **iOS identity (A).** Target Debug and Release both set `PRODUCT_BUNDLE_IDENTIFIER = com.whim`, `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION = 1`, `TARGETED_DEVICE_FAMILY = "1,2"`, deployment target 15.1 (`pbxproj:256-313`). No `DEVELOPMENT_TEAM`, `CODE_SIGN_STYLE`, `CODE_SIGN_ENTITLEMENTS` or entitlements file. Target base configs are the Pods xcconfigs (`:258,288`); project-level configs have no base xcconfig. Build phases: Check Pods Manifest.lock, Sources, Frameworks, Resources, Bundle React Native code and images, Embed Pods Frameworks, Copy Pods Resources (`:107-115`).
- **Info.plist (A).** Version keys reference `$(MARKETING_VERSION)` / `$(CURRENT_PROJECT_VERSION)`. Display name Whim. iPhone portrait only; iPad all four orientations. ATS: `NSAllowsArbitraryLoads=false`, `NSAllowsLocalNetworking=true`. `NSLocationWhenInUseUsageDescription` is an empty string (`:36-37`). No `ITSAppUsesNonExemptEncryption`.
- **Privacy manifest (A).** FileTimestamp C617.1, UserDefaults CA92.1, SystemBootTime 35F9.1; no collected data types; tracking false.
- **AppDelegate (A).** RN 0.85 bridgeless template (`RCTReactNativeFactory`, `startReactNative(withModuleName: "Whim", launchOptions)`); no URL-open or user-activity methods.
- **iOS art (A, C).** AppIcon Contents.json declares the legacy multi-slot set with zero image files. LaunchScreen is the stock white "Whim / Powered by React Native".
- **Pods and Ruby (A).** Non-template pods: MMKVCore 2.4.0, NitroMmkv 4.3.1, NitroModules 0.35.9, op-sqlite 16.2.0, plus safe-area-context and webview. Gemfile pins cocoapods ≥1.13, activesupport ≥6.1.7.5, xcodeproj <1.26 (lock: 1.15.2 / 7.2.3.2 / 1.25.1); `.bundle/config` sets `BUNDLE_PATH: vendor/bundle`.
- **Android build (A).** `namespace` and `applicationId` `com.whim`; `versionCode 1`, `versionName "1.0"` as literals. Release reuses `signingConfigs.debug` with `debuggable true`, minify off. The inline comment calls this the v0.1 emulator-acceptance build, kept debug-signed for the offline bundle and logcat, and says to drop both for a production build (`build.gradle:100-109`; `DEVLOG.md:50-55,108-109`; `docs/decisions.md:945`). minSdk 24, compile/target 36, NDK 27.1, Kotlin 2.1.20. `gradle.properties` pins `org.gradle.java.home` to a machine-specific SDKMAN path and `reactNativeArchitectures=arm64-v8a`.
- **Android manifest (A).** `allowBackup=false`, `usesCleartextTraffic="${usesCleartextTraffic}"` (placeholder from `@react-native/gradle-plugin`), `networkSecurityConfig` set. `MainActivity`: `singleTask`, `adjustResize`, MAIN/LAUNCHER only. Theme `AppTheme` extends `Theme.AppCompat.DayNight.NoActionBar`. No `src/debug/` or `src/release/` source sets. The network config allows cleartext to 10.0.2.2, 10.0.3.2, localhost, 127.0.0.1, 10.0.0.253 in every build type. Mipmaps are the stock Android robot at five densities, legacy PNG only.
- **Native module registration (A).** `MainApplication.kt:17-20` appends `WhimTonePackage()` to `PackageList` by hand, since it isn't in `node_modules`.
- **npm scripts (A).** `"android:release": "react-native run-android --mode release --active-arch-only"`; no iOS script. That script is the documented emulator recipe in CLAUDE.md:60, README.md:149, demo/README.md:22, docs/demo/storyboard.md:62,81, docs/decisions.md:966 and src/host/launcher/test/acceptance.spec.md:4 (D).
- **Entry (B).** `index.js` imports `AppRegistry`, `App`, `app.json` and nothing else. `App.tsx` imports `LauncherRoot` first; `RUN_VSTORE_PROBE` / `RUN_STORAGE_PROBE` / `RUN_BRIDGE_PROBE` are hand-flipped `const false` (`App.tsx:18,21,25`).
- **Polyfills (B).** `polyfills.ts` imports `buffer` and (guarded) `text-encoding-polyfill`; installs `Buffer`, `process.env` / `process.platform` and `TextDecoder` only when missing; `process.platform` is the literal `'android'` (`:36`). It auto-installs on import behind one module-level `installed` flag, imports no React Native, and loads under Node. marshal.ts is the only module-scope, unguarded TextDecoder construction; it has no import edge to polyfills.ts. `metro.config.js` doesn't override `inlineRequires`. Governing recipe: decisions #36 D2 (`decisions.md:249-264`) and #39 (`:372-376`).
- **Cues (B).** Haptics use RN `Vibration.vibrate` with ms patterns (tap 18, double [0,22,90,22], heavy [0,70,50,120]). Sound calls `WhimTone?.play(name)` (`cue-backend.ts:51`), resolved with `TurboModuleRegistry.get<Spec>('WhimTone')`, so a missing module is silent. Spec: `play(token: string): void`. Kotlin uses `android.media.ToneGenerator` on `STREAM_NOTIFICATION` at volume 90, a fresh generator per call released after duration + 60 ms, errors swallowed: `tick` → `TONE_PROP_BEEP` 80 ms, `chime` → `TONE_PROP_ACK` 180 ms, `alarm` → `TONE_CDMA_ALERT_CALL_GUARD` 750 ms, unknown → beep 80 ms. `codegenConfig`: `{"name":"WhimAppSpecs","type":"modules","jsSrcsDir":"src/native","android":{"javaPackageName":"com.whim.tone"}}`, no `ios` key.

## Constraints and invariants
- mini-app-cues: closed token sets resolved host-side; fire-and-forget, at-most-once; rows bind to an injected backend; a missing backend is a structured error, never a throw (B).
- #36 D2 / #39: polyfills must be in place before isomorphic-git runs; "imported first", not "imported somewhere" (B).
- `package.json` sits in gate.sh's `CONFIG_SET` tripwire, so any edit is HUMAN-BOOTSTRAP (C).
- No decision or live spec covers native packaging, signing, entitlements, icons or deep links (A, C). Compliance chains.md:5 declares native projects out of its scope (C).

## Integration points
- Gate reach without a gate edit: a new module imported from `checks/test/acceptance.ts`, run by `npm run checks:test` (`gate.sh:63`). Its import list is written by hand; `main()` calls one function per section (C, D).
- `knip.json` entries include `checks/test/**`; project globs don't include `scripts/`. `tsconfig.json` includes `**/*.ts` with no `scripts/` exclude, so `.ts` there is typechecked; ESLint's `*.mjs` override gives any `.mjs` a Node env (C).
- `sdk:test` auto-discovers only `src/sdk/test/*.acceptance.ts(x)`. `scripts/test/*.test.sh` are invoked one by one from gate.sh, not globbed (C).
- Link delivery attaches at `AppDelegate.swift` and a second intent filter on `MainActivity` (A; compliance design D17).

## Risks and unknowns
- None of op-sqlite, react-native-mmkv, nitro-modules, safe-area-context or react-native-webview ships a `PrivacyInfo.xcprivacy`. RN's `privacy_manifest_utils.rb` aggregates only pods that do (React-Core, boost, glog, RCT-Folly, React-cxxreact wire theirs) (C). MMKVCore comes from CocoaPods trunk; its manifest was not checked (D).
- Decisions tail is #64; `public-generation-server` design.md:314 also targets #64, and compliance task 7.3 appends "next". The next free number is contested (C).
- Not verified: ToneGenerator silent-mode behavior; iOS Hermes's native TextEncoder support; what each probe screen prints (B).

## D. Planner spot-checks
- Apple team: the local profile with TeamName "AnyCognition Inc." has TeamIdentifier `2B7K4YLS34`. Xcode 26.6; Homebrew fastlane 2.237.0 (2.240.0 available) on Ruby 4.0.6; bundler 4.0.16.
- `~/.config/whim/` holds `play-publisher.json` and `oauth-token`. No keystore or `.p8` yet.
- Paired devices (`xcrun devicectl list devices`): "iPhone", iPhone 16 Pro Max, CoreDevice id `D9977C08-2DDA-5AEB-8684-F977D1DAB1F2`; also an iPhone 15 Plus.
- op-sqlite's bundled `cpp/sqlite3.c` references `statfs`-family calls (DiskSpace required-reason APIs) and `stat`/`fstat` (FileTimestamp); `cpp/utils.cpp` uses `stat`. No hits in mmkv, nitro, safe-area or webview sources in `node_modules`.
- Brand art: `docs/mascot/` holds the undecided "Amber Wisp" mascot. `no_brows.png` is 1155×959 on a dark background with a trailing tail; `big_ref.png` is a 2816×1536 concept sheet. No square or transparent master, no SVG anywhere. Shell colors: `SHELL_COLORS.paper #fbfaf8`, `accent #3f3d8f` (`src/sdk/design-tokens.ts:43-54`).
- `DevProbeScreen` (the `CONTAINED ✓` verdict) opens only when `__DEV__` is true (`LauncherRoot.tsx:1277`).
- AOSP `ToneGenerator.cpp` descriptors: PROP_BEEP 400+1200 Hz for 40 ms; PROP_ACK 1200 Hz 100 ms on / 100 ms off, repeat 1; CDMA_ALERT_CALL_GUARD 1319 Hz 125 ms on / 125 ms off, repeat 2.
- ATS doesn't apply to numeric IP hosts on iOS 10+; `NSAllowsLocalNetworking` covers only unqualified and `.local` names (Apple DTS, developer.apple.com/forums/thread/66417).
- Play: the API can't publish until one build has been uploaded by hand in Play Console (fastlane supply docs). Data safety answers import and export as CSV in the console (Play Console Help 10787469).
- RN app-level iOS TurboModules register through `codegenConfig.ios.modulesProvider` with an Objective-C++ class conforming to the generated spec protocol; `pod install` reruns codegen (reactnative.dev, Turbo Native Modules).
