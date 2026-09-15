# Context chains: platform-release-readiness

<!--
  Section N of tasks.md = chain-(N-1).

  Dependency waves (dependency-free chains run in parallel; merges stay strictly serial):
    wave 1: chain-1
    wave 2: chain-2 ∥ chain-3 ∥ chain-4 ∥ chain-6
    wave 3: chain-0 (HUMAN-BOOTSTRAP, after chain-4) ∥ chain-7 (after 3, 4, 6) ∥ chain-8 (after 3)
    wave 4: chain-5 (after 3, 0) ∥ chain-9 (after 4, 6, 8)
    wave 5: chain-10 (after 9)
    network deny (design D17), reproduce first:
      chain-14 (no deps, dispatch now) → chain-15 (attended reproduction, after 14; must finish
      before 16 and 17 dispatch) → chain-16 (after 1, 15) → chain-17 (after 3, 5, 15, 16)
    attended: chain-12 (after 0, 2, 5, 7, 14, 16, 17). It doesn't wait for store-launch-compliance.
    after store-launch-compliance has fully merged: chain-11 (after 10), then chain-13 (attended, after 11, 12)
      and chain-18 (network deny records, after 11, 12, 16, 17)

  Parallel-safety rules every dispatched chain inherits:
  - Launcher files are off limits: src/host/launcher/** (LauncherRoot.tsx, copy.ts, HomeScreen.tsx,
    SettingsScreen.tsx, prompt-flow screens, test/acceptance.ts). chain-11 only IMPORTS
    src/host/launcher/release-config.ts and edits docs/store/review-notes.md, which is why it
    waits for store-launch-compliance.
  - A chain edits only the files its block lists. checks/test/acceptance.ts is edited once, by
    chain-1. checks/test/release/index.ts is created by chain-1 and gets one more import and call
    from chain-16. Each later suite fills its own pre-created checks/test/release/<name>.suite.ts,
    except native-network-deny.suite.ts, which chain-16 creates and chain-17 extends.
    scripts/release/cli.ts is created by chain-1 and extended only by chain-6, then chain-9, in
    that order. ios/Whim.xcodeproj/project.pbxproj goes chain-3, then chain-5, then chain-17.
    ios/Whim/AppDelegate.swift goes chain-3, then chain-7; the network deny doesn't touch it.
    AndroidManifest.xml goes chain-4, then chain-7. MainApplication.kt is chain-16 only. App.tsx
    is chain-14 only (attended chains flip its flags locally and never commit them).
    docs/decisions.md goes chain-11, then chain-18.
  - The network deny needs no prop on src/host/launcher/MiniAppView.tsx or DevProbeScreen.tsx, so
    no network deny chain edits a launcher file. chain-14 only IMPORTS
    src/host/launcher/deliver.ts, which no store-launch-compliance task edits.
  - Suites stay pure and portable, because the gate also runs in the Linux devcontainer. They never
    shell out to xcrun, xcodebuild, keytool, aapt2, gradle, fastlane or Playwright; only `git
    ls-files` is allowed. Tool-driven code lives behind CLI commands and is tested through pure
    functions over captured facts.
  - No chain edits scripts/gate*.sh, invariants/, build/, .claude/**, .codex/**, tsconfig*,
    ESLint config, knip.json, babel/metro config, Gemfile or package-lock.json. package.json is
    chain-0 only.
  - Worktrees: symlink the primary tree's node_modules before self-gating (memory
    whim-worktree-module-resolution). The native build steps in 4.7, 5.7, 6.5, 8.5, 17.5 and 18.5 are
    evidence, not the gate. Report "not run" when the toolchain or network isn't available;
    never claim a build ran. Run `bundle` with `BUNDLE_PATH=vendor/bundle`.
  - Every chain not marked HUMAN-BOOTSTRAP or attended is dispatchable.
-->

## chain-0: bootstrap-package-json — HUMAN-BOOTSTRAP

- tasks: 1.1–1.3
- rationale: `package.json` is in gate.sh's `CONFIG_SET` tripwire and is protected, so both edits are human-applied, together as one commit. The `ios` codegen key registers `WhimToneModule` (design D9). The `android:release` repoint needs chain-4's `offline` build type (design D4).
- reads: design.md D4, D9; handoff: handoff/android-build.md (confirms the `offline` build type name)
- writes-contract: none
- after: chain-4
- exact edits (human applies):
  - `package.json` → `codegenConfig` gains `"ios": {"modulesProvider": {"WhimTone": "WhimToneModule"}}`. `name`, `type`, `jsSrcsDir` and `android` stay unchanged.
  - `package.json` → `scripts["android:release"]` becomes `react-native run-android --mode offline --active-arch-only`.
  - Then `./scripts/gate.sh` on the staging branch, and commit `package.json` alone.

## chain-1: release-tooling-foundation

- tasks: 2.1–2.6
- rationale: every later chain needs the shared pieces: the native release file, its TypeScript parser and literal scan, the build-number function, the esbuild runner and command table, and the pre-registered suite files that let later chains run in parallel without touching `checks/test/acceptance.ts`.
- files: `release/whim-release.xcconfig`, `scripts/release/{run.mjs,cli.ts}`, `scripts/release/lib/{native-config.ts,build-number.ts}`, `checks/test/acceptance.ts` (one import and one call), `checks/test/release/index.ts`, `checks/test/release/{native-config,hermes-entry,ios-project,android-project,assets,store-listing,release-cli,domain-lockstep}.suite.ts` (stubs, except `native-config`, which it fills)
- reads: specs/native-release-config/spec.md §"One native release file declares identity, version and domain", §"Version numbers come from the release file and the build invocation"; specs/store-release-pipeline/spec.md §"Each lane uses one time-derived build number"; design.md D1, D3, D12 (the `scripts/release/` and Tests paragraphs); research.md "Integration points"; handoff: none
- writes-contract: handoff/release-tooling.md (`NativeReleaseConfig` verbatim; signatures of `parseNativeReleaseConfig`, `loadNativeReleaseConfig`, `scanNativeLiterals`, `NativeConfigError`, `buildNumberAt`, `assertBuildNumberAbove`; how `run.mjs` is invoked and the command-table entry shape; the suite `run()` convention and the `checks/test/harness.ts` imports; the suite file → owning chain map)

## chain-2: hermes-runtime-prerequisites

- tasks: 3.1–3.4
- rationale: one runtime concern. Move the polyfills, install them from the entry with the real platform, give the storage engine its own import edge, and lock the entry order and fill-only-missing behavior in a suite.
- files: `src/host/version-store/polyfills.ts` → `src/host/platform/hermes-polyfills.ts` (git mv), `src/host/platform/install-entry-polyfills.ts`, `index.js`, `src/host/version-store/{compaction.ts,device-acceptance.ts,engine.ts}` (import path only), `src/host/storage-engine/marshal.ts` (one import), `checks/test/release/hermes-entry.suite.ts`
- reads: specs/hermes-runtime-prerequisites/spec.md (all three requirements); design.md D8; research.md "Entry", "Polyfills"; docs/decisions.md #36 D2 and #39 (the recipe being moved); handoff: handoff/release-tooling.md (suite convention only)
- writes-contract: none
- after: chain-1

## chain-3: ios-project-identity-and-links

- tasks: 4.1–4.7
- rationale: every iOS project-level declaration a store build needs: build settings from the native release file, the entitlement, the plist surface, the privacy manifest, and link forwarding in `AppDelegate`. It's one file set with one vocabulary, plus the validator that locks it.
- files: `ios/Whim.xcodeproj/project.pbxproj`, `ios/Whim/{Whim.entitlements,Info.plist,PrivacyInfo.xcprivacy,AppDelegate.swift}`, `scripts/release/lib/ios-project.ts`, `checks/test/release/ios-project.suite.ts`
- reads: specs/native-release-config/spec.md §"One native release file declares identity, version and domain", §"Both apps ship under one identity", §"Store builds carry no cleartext exception" (iOS sentence), §"The iOS app declares its export, device and permission surface", §"The iOS privacy manifest covers linked native code and collected data"; specs/app-links/spec.md §"The iOS app delivers universal links to the launcher"; design.md D1, D2, D5, D6, D7 (manifest content only); openspec/changes/store-launch-compliance/design.md D17 ("The iOS project must provide"); research.md "iOS identity", "Info.plist", "Privacy manifest", "AppDelegate"; handoff: handoff/release-tooling.md
- writes-contract: handoff/ios-project.md (the exact `xcodeproj` gem command that adds a source file to the `Whim` target; the plist reader and pbxproj build-settings extraction signatures; `checkIosProject` signature; workspace, scheme and configuration names; entitlements and manifest paths; the collected data type identifiers verbatim)
- after: chain-1

## chain-4: android-build-types-signing-links

- tasks: 5.1–5.7
- rationale: the whole Android build surface in one context: the native release file in Gradle, the upload-signed `release` and the `offline` dev build type, network configs split by source set, the app-link filter, the new `appId` in the Maestro flows, and the validator.
- files: `android/app/build.gradle`, `android/app/src/main/AndroidManifest.xml`, `android/app/src/main/res/xml/network_security_config.xml`, `android/app/src/debug/res/xml/network_security_config.xml` (new), `demo/android/flows/tea/*.yaml` (six files), `scripts/release/lib/android-project.ts`, `checks/test/release/android-project.suite.ts`
- reads: specs/native-release-config/spec.md §"One native release file declares identity, version and domain", §"Both apps ship under one identity", §"Version numbers come from the release file and the build invocation", §"The Android store build is upload-signed and not debuggable", §"An offline build type serves the Android dev loop", §"Store builds carry no cleartext exception", §"The iOS app declares its export, device and permission surface" (Android portrait sentence); specs/app-links/spec.md §"The Android app verifies and delivers app links"; design.md D1, D2, D4, D5, D6; openspec/changes/store-launch-compliance/design.md D17 ("The Android project must provide"); research.md "Android build", "Android manifest"; handoff: handoff/release-tooling.md
- writes-contract: handoff/android-build.md (the `WHIM_UPLOAD_*` names and lookup order; build type names; task names `bundleRelease`, `assembleOffline`, `installOffline`; AAB and APK output paths; the `whimBuildNumber` and `reactNativeArchitectures` properties; the missing-key error text; the merged-manifest path; `checkAndroidProject` signature)
- after: chain-1

## chain-5: ios-whimtone

- tasks: 6.1–6.5
- rationale: one native module. The Objective-C++ TurboModule, its tone renderer and system-sound playback, its project membership, and the two JS comments that stop calling sound Kotlin-only.
- files: `ios/Whim/WhimToneModule.mm` (new), `ios/Whim.xcodeproj/project.pbxproj` (Sources membership only), `src/host/cue-backend.ts` and `src/native/NativeWhimTone.ts` (comments only)
- reads: specs/mini-app-cues/spec.md (delta) §"Sound cues play on iOS from the Android tone table"; openspec/specs/mini-app-cues/spec.md §"Cue delivery is fire-and-forget and at-most-once", §"Cue rows bind to an injected backend, not to RN imports"; design.md D9; research.md "Cues" and D (AOSP descriptors); handoff: handoff/ios-project.md
- writes-contract: none
- after: chain-3 (project.pbxproj), chain-0 (the `ios` codegen key, so 6.5's compile check means something)

## chain-6: brand-asset-generator

- tasks: 7.1–7.5
- rationale: one pipeline. It covers the brand inputs, the PNG codec, the Playwright renderer and output table, the committed outputs for both platforms and the Play listing, and the stale-asset suite. Nothing here wires assets into screens.
- files: `release/assets/{brand.json,icon-foreground.svg,generated.json}`, `scripts/release/lib/{png.ts,assets.ts}`, `scripts/release/cli.ts` (adds `generate-assets`), `ios/Whim/Images.xcassets/{AppIcon.appiconset,LaunchMark.imageset,LaunchBackground.colorset}/**`, `android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/*`, `android/app/src/main/res/mipmap-anydpi-v26/*`, `android/app/src/main/res/drawable-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/launch_mark.png`, `android/app/src/main/res/values/brand_colors.xml`, `release/store/play/en-US/images/{icon.png,featureGraphic.png}`, `checks/test/release/assets.suite.ts`
- reads: specs/app-icon-and-launch/spec.md §"One command derives every icon and launch asset from one source", §"The checks detect stale, missing or mis-sized assets", §"Store-facing icons meet each store's format rules", §"The Android icon is adaptive with a legacy fallback", §"Launch shows the mark on the shell paper color with no flash" (the brand color check only); design.md D10 (Inputs, The command, the output table); research.md D (brand art, shell colors); handoff: handoff/release-tooling.md
- writes-contract: handoff/brand-assets.md (resource names `LaunchMark`, `LaunchBackground`, `@color/launch_background`, `@color/ic_launcher_background`, `@drawable/launch_mark`, `@mipmap/ic_launcher{,_round,_foreground,_monochrome}`; the `generated.json` schema verbatim; `checkAssets` and `readPngInfo` signatures; the generate command line)
- after: chain-1

## chain-7: launch-screen-wiring

- tasks: 8.1–8.5
- rationale: wiring the generated launch assets into both apps' launch paths so nothing flashes between launch and first frame. The storyboard, the root view color, and the two Android themes, layer list, manifest theme and `setTheme` all serve that one behavior.
- files: `ios/Whim/LaunchScreen.storyboard`, `ios/Whim/AppDelegate.swift` (root view background only), `android/app/src/main/res/values/styles.xml`, `android/app/src/main/res/values-v31/styles.xml` (new), `android/app/src/main/res/drawable/launch_screen.xml` (new), `android/app/src/main/AndroidManifest.xml` (activity theme only), `android/app/src/main/java/com/whim/MainActivity.kt`
- reads: specs/app-icon-and-launch/spec.md §"Launch shows the mark on the shell paper color with no flash"; design.md D10 ("Launch wiring, no new dependency"); handoff: handoff/brand-assets.md, handoff/ios-project.md, handoff/android-build.md
- writes-contract: none
- after: chain-3, chain-4, chain-6

## chain-8: store-listing-content

- tasks: 9.1–9.5
- rationale: the listing text, privacy and rating answers, and the validator that keeps them within limits and consistent with the privacy manifest and the consent disclosure. It's one content set with one vocabulary (store fields, data types).
- files: `release/store/app-store/en-US/*.txt`, `release/store/app-store/{copyright,primary_category,secondary_category}.txt`, `release/store/app-store/{app-privacy.json,age-rating.json}`, `release/store/play/en-US/{title,short_description,full_description}.txt`, `release/store/play/en-US/changelogs/default.txt`, `release/store/play/data-safety.json`, `release/store/answers.md`, `scripts/release/lib/store-listing.ts`, `checks/test/release/store-listing.suite.ts`
- reads: specs/store-listing/spec.md (all requirements); design.md D11; openspec/changes/store-launch-compliance/design.md D5 (disclosure copy) and D18 item 5 (form drafts); openspec/changes/store-launch-compliance/specs/content-reporting/spec.md (what a report sends); handoff: handoff/release-tooling.md, handoff/ios-project.md (plist reader, collected data identifiers)
- writes-contract: handoff/store-content.md (all paths; `LISTING_LIMITS` and `PROMO_TERMS` verbatim; `checkStoreListing` signature; the privacy mapping table; the schemas of `app-privacy.json`, `data-safety.json` and `age-rating.json`)
- after: chain-3

## chain-9: release-cli

- tasks: 10.1–10.6
- rationale: every mechanical guard the lanes run before and after a build (preflight, AAB check, privacy audit, association files, tags) as pure logic plus thin tool adapters, behind one CLI and one suite. The lanes chain then only orchestrates.
- files: `scripts/release/lib/{preflight.ts,verify-aab.ts,privacy-audit.ts,association-files.ts,release-tag.ts}`, `scripts/release/cli.ts` (adds the commands), `checks/test/release/release-cli.suite.ts`
- reads: specs/store-release-pipeline/spec.md §"The preflight names every reason it refuses", §"Only a verified store AAB is uploaded", §"The iOS lane audits required-reason APIs before upload", §"Credentials never enter the repository", §"A successful upload is tagged"; specs/app-links/spec.md §"The release tooling prints the exact association files"; design.md D7 (audit table and rules), D12 (Credentials, Tags, `verify-aab`), D14, D15; openspec/changes/store-launch-compliance/design.md D17 ("Ops must serve"); handoff: handoff/release-tooling.md, handoff/ios-project.md, handoff/android-build.md, handoff/brand-assets.md, handoff/store-content.md
- writes-contract: handoff/release-cli.md (every command's arguments, output line format and exit codes verbatim; credential paths and required modes; fingerprint file format; which AAB manifest tool worked and its invocation)
- after: chain-4, chain-6, chain-8

## chain-10: fastlane-lanes-and-runbook

- tasks: 11.1–11.6
- rationale: the orchestration layer and its documentation. The Fastfile calls the CLI and store actions, and the runbook plus the CLAUDE.md and README lines tell a human how to run it. It shares the lane vocabulary and nothing else.
- files: `fastlane/Fastfile` (new), `docs/release/mobile.md` (new), `CLAUDE.md` ("Android build & run" bullets only), `README.md` (the `android:release` line)
- reads: specs/store-release-pipeline/spec.md §"Releasing is one attended lane per platform", §"Each lane uses one time-derived build number"; specs/store-listing/spec.md §"No URL, domain or contact detail is committed in listing files"; design.md D4 (dev recipe), D5 (http override note), D11 (upload inputs), D12, D13, D14; handoff: handoff/release-cli.md, handoff/ios-project.md, handoff/android-build.md, handoff/store-content.md, handoff/brand-assets.md
- writes-contract: none (chains 12–13 read `docs/release/mobile.md` as a document)
- after: chain-9

## chain-11: post-compliance-reconciliation

- tasks: 12.1–12.4
- rationale: the only tasks that need `store-launch-compliance`'s landed files: the domain lockstep suite, which imports `release-config.ts`; turning its review notes into the uploadable notes file and pointing its form drafts at this change's answer files; plus the decision entry and `.gitignore` lines, which also wait so the contested decision number is read last.
- files: `checks/test/release/domain-lockstep.suite.ts`, `release/store/app-store/review_information/notes.txt` (new), `scripts/release/lib/store-listing.ts` (notes limit), `fastlane/Fastfile` (notes hookup, if needed), `docs/store/review-notes.md` (§5 and the §6 checklist line), `docs/decisions.md` (one appended entry), `.gitignore`
- reads: specs/native-release-config/spec.md §"The native release domain matches the launcher's release domain"; specs/store-listing/spec.md §"Listing text lives as files within each store's limits"; design.md D1 (lockstep paragraph), D16; openspec/changes/store-launch-compliance/design.md D5, D18; the landed `docs/store/review-notes.md` and `src/host/launcher/release-config.ts` (import only); handoff: handoff/release-tooling.md, handoff/store-content.md, handoff/release-cli.md
- writes-contract: none
- after: chain-10; external: every chain of `store-launch-compliance` merged on `integration/store-launch` (its chain-1 lands `release-config.ts`, its chain-7 lands `docs/store/review-notes.md` and its decision entry)

## chain-12: attended-device-acceptance — separate-session (attended, human-run)

- tasks: 13.1–13.9
- rationale: these checks need the paired iPhone 16 Pro Max, Xcode signed into the AnyCognition team, a running Android emulator, a canary on the Mac with `sudo tcpdump`, and ears and eyes for tones and launch frames. No dispatched implementer has any of that. Results are recorded PENDING at merge and don't block the gate. They include the on-device proof of the TextDecoder fix, the WebKit containment probe on physical hardware, and the network deny's post-fix pass, negative control and fail-closed check on both platforms.
- reads: docs/release/mobile.md; specs/hermes-runtime-prerequisites/spec.md; specs/mini-app-cues/spec.md (delta); specs/app-icon-and-launch/spec.md §"Launch shows the mark on the shell paper color with no flash"; specs/app-links/spec.md §"The iOS app delivers universal links to the launcher", §"The Android app verifies and delivers app links"; specs/sandbox-isolation/spec.md (delta, all three requirements); design.md D17 "Reproduce first, then prove"; progress.md "Network deny reproduction"; handoff: handoff/netdeny-probe.md, handoff/android-network-deny.md, handoff/ios-network-deny.md
- writes-contract: none (results go to progress.md; failures become fix-loop findings)
- after: chain-0, chain-2, chain-5, chain-7, chain-14, chain-16, chain-17, chain-host-startup-watchdog

## chain-13: attended-accounts-and-uploads — separate-session (attended, human-run)

- tasks: 14.1–14.6
- rationale: account creation, key generation, console-only forms, the mandatory manual first Play upload, screenshots against the production server, and the first scripted uploads all need real accounts and a human at the consoles. The keystore and passwords are created here and never leave `~/.config/whim/` and the password manager.
- reads: docs/release/mobile.md; handoff/release-cli.md; specs/store-release-pipeline/spec.md; specs/store-listing/spec.md
- writes-contract: none (commits only `release/android-upload-cert.sha256`, `release/android-play-signing-cert.sha256`, `release/store/play/data-safety.csv` and screenshots)
- after: chain-11, chain-12

## chain-14: network-deny-probe-and-canary

- tasks: 15.1–15.5
- rationale: the reproduction tooling for design D17, built before the fix so it can fail against today's build. It holds the canary mini-app sources, the canary server that compiles them with the production bundle contract and counts hits, the flag-gated on-device probe screen, and its `App.tsx` flag. It shares one vocabulary (variants, run id, hits) and touches no native file.
- files: `scripts/netdeny/{variants.ts,canary.ts,run.mjs}` (new), `src/host/NetworkDenyProbeScreen.tsx` (new), `App.tsx`
- reads: specs/sandbox-isolation/spec.md (delta) §"The WebView that hosts mini-apps refuses network loads natively", §"The native refusal is locked by the checks and proven on device" (the device scenario); design.md D17 ("Reproduce first, then prove", "What the runtime page loads"); research.md E ("Mounts", "The runtime page needs no network", "Probe constraints"); docs/security/2026-09-14-webrtc-alias.md §"Reproduction", §"Open item"; `synthrun/builder.ts` (`buildCandidateSource`, import only); `synthrun/test/isolation.ts:310-352` (attack shape); `src/host/launcher/deliver.ts` (import only); `src/host/launcher/MiniAppView.tsx:129-141` (props to mirror, read only); `checks/test/run.mjs` (runner idiom); handoff: none
- writes-contract: handoff/netdeny-probe.md (the `NetdenyVariant` members and `NAVIGATION_VARIANTS` verbatim; the canary command line, flags, defaults, routes, output line format and exit codes; the `--expect leak` pass rule; the `RUN_NETDENY_PROBE` flag and `NETDENY_CANARY_HOST_OVERRIDE` constant; default hosts and ports per platform; the probe-only string literal an operator greps for in a bundle; what each on-screen row shows)

## chain-15: network-deny-reproduction — separate-session (attended)

- tasks: 16.1–16.5
- rationale: the failing baseline, on real engines, before any fix lands. It needs the Android emulator, the iOS simulator with Xcode, a canary on the Mac and `sudo tcpdump`, so a foreground attended session runs it (a human, or an attended agent session with those tools). Its stop rule gates chains 16 and 17.
- reads: handoff/netdeny-probe.md; design.md D17 "Reproduce first, then prove"; CLAUDE.md "Android build & run"; tasks.md 4.7 (the iOS simulator Release build); docs/security/2026-09-14-webrtc-alias.md §"On-device confirmation" item 4
- writes-contract: none (results go to progress.md "Network deny reproduction", which chains 16, 17 and 18 read)
- after: chain-14

## chain-16: android-webview-network-deny

- tasks: 17.1–17.5
- rationale: the Android half of the leg in one context: the view manager subclass that sets `blockNetworkLoads` at creation, the package that serves only it, the in-place replacement of the autolinked package, and the suite that locks all three.
- files: `android/app/src/main/java/com/whim/webview/{NetworkDeniedWebViewManager.kt,NetworkDeniedWebViewPackage.kt}` (new), `android/app/src/main/java/com/whim/MainApplication.kt`, `checks/test/release/native-network-deny.suite.ts` (new), `checks/test/release/index.ts` (one import and one call)
- reads: specs/sandbox-isolation/spec.md (delta, all three requirements; Android sentences and scenarios); design.md D17 (opening paragraphs, "Android", the suite paragraph of "Reproduce first, then prove"); research.md E ("No supported prop", "Android extension point", "Android ordering", "Android duplicate managers", "Chromium semantics"); progress.md "Network deny reproduction" (Android); `node_modules/react-native-webview/android/src/newarch/com/reactnativecommunity/webview/RNCWebViewManager.java` and `.../main/java/com/reactnativecommunity/webview/RNCWebViewPackage.java` (read only); handoff: handoff/release-tooling.md (suite convention, `checks/test/harness.ts` imports, the `index.ts` shape), handoff/netdeny-probe.md (for 17.5)
- writes-contract: handoff/android-network-deny.md (the Kotlin class names and package; the `MainApplication` replacement and its `check` message; the suite file's exported `run()`, its fixture helper signatures and where chain-17 adds iOS cases; the exact one-line local edit that removes the deny for chain-12's negative control, and how to confirm the rebuilt APK carries it)
- after: chain-1, chain-15

## chain-17: ios-webview-network-deny

- tasks: 18.1–18.5
- rationale: the iOS half of the leg in one context: the rule file, the `+load` initializer swap with its fail-closed branch, the target membership, and the iOS cases of the shared suite.
- files: `ios/Whim/WebViewNetworkDeny.json` (new), `ios/Whim/WhimWebViewNetworkDeny.m` (new), `ios/Whim.xcodeproj/project.pbxproj` (Sources and Resources membership only), `checks/test/release/native-network-deny.suite.ts` (iOS cases)
- reads: specs/sandbox-isolation/spec.md (delta, all three requirements; iOS sentences and scenarios); design.md D17 (opening paragraphs, "iOS", the suite paragraph of "Reproduce first, then prove"); research.md E ("No supported prop", "iOS extension point", "WebKit semantics", "iOS project"); progress.md "Network deny reproduction" (iOS); `node_modules/react-native-webview/apple/RNCWebViewImpl.m:423-519` (read only); handoff: handoff/ios-project.md (the `xcodeproj` gem command, the pbxproj reader), handoff/android-network-deny.md (suite structure), handoff/netdeny-probe.md (for 18.5)
- writes-contract: handoff/ios-network-deny.md (the rule list identifier and file name; the `WhimNetworkDeny:` log lines verbatim; the exact local edit that removes the deny for chain-12's negative control; the exact local edit that points the loader at a missing file for the fail-closed check; the `xcodeproj` commands used)
- after: chain-3 (project.pbxproj, handoff/ios-project.md), chain-5 (project.pbxproj), chain-15, chain-16 (native-network-deny.suite.ts, handoff/android-network-deny.md)

## chain-18: network-deny-records

- tasks: 19.1–19.4
- rationale: the written record of the leg, once its proof exists: the decision entry, the audit's open item and on-device results, the containment bullet agents read first, and the spike note. It waits for chain-11 because both append to `docs/decisions.md` and chain-11 comes after every compliance merge, so the contested number is read last. It waits for chain-12 so the security doc carries measured results.
- files: `docs/decisions.md` (one appended entry), `docs/security/2026-09-14-webrtc-alias.md`, `CLAUDE.md` (the "Containment is three legs" bullet only), `docs/spike2-findings.md` (one dated note)
- reads: design.md D17; specs/sandbox-isolation/spec.md (delta); progress.md "Network deny reproduction" and "Network deny acceptance"; the landed `docs/decisions.md` tail; docs/decisions.md #35, #37, #64; handoff: handoff/netdeny-probe.md, handoff/android-network-deny.md, handoff/ios-network-deny.md
- writes-contract: none
- after: chain-11, chain-12, chain-16, chain-17

## chain-host-startup-watchdog: fail a delivery attempt that never receives page frames

- tasks: 20.1–20.4
- rationale: satisfy D17's existing app-error requirement when native rule loading disables page JavaScript. Dispatch only after the primary simulator reproduces the indefinite boot state.
- files: `src/host/launcher/boot-state.ts`, `src/host/launcher/useMiniAppHost.ts`, `src/host/launcher/test/boot-state.suite.ts`, `src/host/launcher/test/bundle-error-watchdog.suite.ts`
- reads: host-startup-fix.md; specs/sandbox-isolation/spec.md; design.md D17; relevant standing realm-reset/trust decisions and spike2 findings; handoff/ios-network-deny.md; progress.md missing-resource reproduction evidence
- writes-contract: handoff/host-startup-watchdog.md (deadline start/cancel behavior, tested helper interface, stale-callback fence, normal LauncherRoot missing-resource acceptance procedure)
- after: chain-17
