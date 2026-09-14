# Context chains: platform-release-readiness

<!--
  Section N of tasks.md = chain-(N-1).

  Dependency waves (dependency-free chains run in parallel; merges stay strictly serial):
    wave 1: chain-1
    wave 2: chain-2 ∥ chain-3 ∥ chain-4 ∥ chain-6
    wave 3: chain-0 (HUMAN-BOOTSTRAP, after chain-4) ∥ chain-7 (after 3, 4, 6) ∥ chain-8 (after 3)
    wave 4: chain-5 (after 3, 0) ∥ chain-9 (after 4, 6, 8)
    wave 5: chain-10 (after 9)
    attended: chain-12 (after 0, 2, 5, 7). It doesn't wait for store-launch-compliance.
    after store-launch-compliance has fully merged: chain-11 (after 10), then chain-13 (attended, after 11, 12)

  Parallel-safety rules every dispatched chain inherits:
  - Launcher files are off limits: src/host/launcher/** (LauncherRoot.tsx, copy.ts, HomeScreen.tsx,
    SettingsScreen.tsx, prompt-flow screens, test/acceptance.ts). chain-11 only IMPORTS
    src/host/launcher/release-config.ts and edits docs/store/review-notes.md, which is why it
    waits for store-launch-compliance.
  - A chain edits only the files its block lists. checks/test/acceptance.ts and
    checks/test/release/index.ts are edited once, by chain-1. Each later suite fills its own
    pre-created checks/test/release/<name>.suite.ts. scripts/release/cli.ts is created by chain-1
    and extended only by chain-6, then chain-9, in that order. ios/Whim.xcodeproj/project.pbxproj
    goes chain-3, then chain-5. ios/Whim/AppDelegate.swift goes chain-3, then chain-7.
    AndroidManifest.xml goes chain-4, then chain-7.
  - Suites stay pure and portable, because the gate also runs in the Linux devcontainer. They never
    shell out to xcrun, xcodebuild, keytool, aapt2, gradle, fastlane or Playwright; only `git
    ls-files` is allowed. Tool-driven code lives behind CLI commands and is tested through pure
    functions over captured facts.
  - No chain edits scripts/gate*.sh, invariants/, build/, .claude/**, .codex/**, tsconfig*,
    ESLint config, knip.json, babel/metro config, Gemfile or package-lock.json. package.json is
    chain-0 only.
  - Worktrees: symlink the primary tree's node_modules before self-gating (memory
    whim-worktree-module-resolution). The native build steps in 4.7, 5.7, 6.5 and 8.5 are
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

- tasks: 13.1–13.7
- rationale: these checks need the paired iPhone 16 Pro Max, Xcode signed into the AnyCognition team, a running Android emulator, and ears and eyes for tones and launch frames. No dispatched implementer has any of that. Results are recorded PENDING at merge and don't block the gate. They include the on-device proof of the TextDecoder fix and the WebKit containment probe on physical hardware.
- reads: docs/release/mobile.md; specs/hermes-runtime-prerequisites/spec.md; specs/mini-app-cues/spec.md (delta); specs/app-icon-and-launch/spec.md §"Launch shows the mark on the shell paper color with no flash"; specs/app-links/spec.md §"The iOS app delivers universal links to the launcher", §"The Android app verifies and delivers app links"
- writes-contract: none (results go to progress.md; failures become fix-loop findings)
- after: chain-0, chain-2, chain-5, chain-7

## chain-13: attended-accounts-and-uploads — separate-session (attended, human-run)

- tasks: 14.1–14.6
- rationale: account creation, key generation, console-only forms, the mandatory manual first Play upload, screenshots against the production server, and the first scripted uploads all need real accounts and a human at the consoles. The keystore and passwords are created here and never leave `~/.config/whim/` and the password manager.
- reads: docs/release/mobile.md; handoff/release-cli.md; specs/store-release-pipeline/spec.md; specs/store-listing/spec.md
- writes-contract: none (commits only `release/android-upload-cert.sha256`, `release/android-play-signing-cert.sha256`, `release/store/play/data-safety.csv` and screenshots)
- after: chain-11, chain-12
