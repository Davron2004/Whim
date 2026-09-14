## Context

Both native projects are still their templates. iOS has the placeholder id `com.whim`, no team, no entitlements, a multi-slot icon set with no images, and the stock launch screen (research.md "Current behavior", iOS items). Android's release build type is the v0.1 emulator shortcut: debug-signed, debuggable, and allowing cleartext to five dev hosts in every build type. Its own comment says to drop that for production (research.md "Android build"). Nothing is scripted. The runtime has three latent problems of its own. `marshal.ts` builds a `TextDecoder` at module load with no polyfill edge, `polyfills.ts` hard-codes `process.platform = 'android'`, and `WhimTone` exists only in Kotlin (research.md "Polyfills", "Cues").

Four outside inputs shape the design:

- **Launch decisions** (launch-context, platform-context): id `com.anycognition.whim`, AnyCognition team, automatic signing, an upload keystore in `~/.config/whim/`, Play App Signing, HTTPS only, attended uploads, and fastlane allowed if it's the cleanest path with no new Ruby dependencies.
- **store-launch-compliance**, which applies before this change. D17 fixes the native link contract. D6 puts `WHIM_DOMAIN` in `src/host/launcher/release-config.ts`. D5 fixes what the consent screen says is sent. D18 creates `docs/store/review-notes.md` with draft form answers. Its chains own the launcher files for the next several hours, so no chain here may touch them.
- **The harness.** `package.json` is in the gate's `CONFIG_SET`, so its edits are HUMAN-BOOTSTRAP. Repo-wide checks reach the fast gate through `checks/test/acceptance.ts` with no gate edit (research.md "Integration points"). knip ignores `scripts/`, and tsc typechecks `.ts` there.
- **The machine.** Team id `2B7K4YLS34`, Homebrew fastlane 2.237.0, a Play service account already in `~/.config/whim/`, and a paired iPhone 16 Pro Max (research.md D).

## Goals / Non-Goals

**Goals:**
- An operator with credentials builds, signs and uploads either app with one command, and a misconfiguration stops the run before a ten-minute build with a message that says what to fix.
- No identity, version or domain literal is repeated across native files, and the native domain can't drift from the launcher's.
- Store builds are hardened (not debuggable, no cleartext, export flag, privacy manifest), while the Android emulator loop keeps working exactly as documented.
- The TextDecoder crash class and the wrong iOS platform are gone structurally, and iOS cues sound like Android's.
- Icons and launch screens come from one source, and nothing flashes between launch and the first frame.
- Listing text and privacy answers are files that the checks keep consistent with each other and with the consent disclosure.

**Non-Goals:**
- Launcher screens and copy, server and deploy work, and hosting the web pages and association files. This change specifies their exact content, nothing more.
- Submitting for App Store review or promoting a Play release to production. The runbook covers those as console steps.
- Final brand artwork. The pipeline is built around a source the user provides, and a placeholder ships meanwhile.
- The iOS launcher UI fixes and iOS haptics (see "Follow-ups").

## Decisions

### D1. One native release file in xcconfig syntax
`release/whim-release.xcconfig` holds five keys:

```
WHIM_APP_ID = com.anycognition.whim
WHIM_APPLE_TEAM_ID = 2B7K4YLS34
WHIM_MARKETING_VERSION = 1.0.0
WHIM_BUILD_NUMBER = 1
WHIM_DOMAIN = example.com
```

The grammar is strict: `KEY = VALUE`, `//` comments, blank lines, no `#include`, no `$(...)`. Anything else is an error that names the line.

- **Xcode.** The project-level Debug and Release configurations take the file as `baseConfigurationReference`, through a file reference in a `Release` group. The target levels keep their Pods xcconfigs, which CocoaPods owns (research.md "iOS identity"). Target settings become `PRODUCT_BUNDLE_IDENTIFIER = $(WHIM_APP_ID)`, `DEVELOPMENT_TEAM = $(WHIM_APPLE_TEAM_ID)`, `CODE_SIGN_STYLE = Automatic`, `MARKETING_VERSION = $(WHIM_MARKETING_VERSION)`, `CURRENT_PROJECT_VERSION = $(WHIM_BUILD_NUMBER)`, `CODE_SIGN_ENTITLEMENTS = Whim/Whim.entitlements`, `TARGETED_DEVICE_FAMILY = 1`. `Whim.entitlements` holds `applinks:whim.$(WHIM_DOMAIN)`, and Xcode expands build settings in entitlements.
- **Gradle.** `android/app/build.gradle` parses the file with about ten lines of Groovy that apply the same grammar and require all five keys. It then sets `applicationId`, `versionName`, `versionCode` (the `whimBuildNumber` property when given) and `manifestPlaceholders.whimWebHost = "whim.${WHIM_DOMAIN}"`. That last one is a single-key assignment, never a map replacement, because the RN Gradle plugin puts `usesCleartextTraffic` in the same map (research.md "Android manifest").
- **TypeScript.** `scripts/release/lib/native-config.ts` parses the file for the checks and the lanes.

I picked xcconfig because Xcode reads it natively and it's trivial to parse elsewhere. The alternatives lost. A JSON file would need a generation step before Xcode could see it. A Gradle properties file can't be read by Xcode. Keeping literals in both projects is exactly the drift the compliance change fears (its "Native link host drifts" risk). Parsing the file twice (Groovy, TypeScript) is acceptable because the grammar is too small to diverge, and the TypeScript parser, which runs in the gate, rejects anything the Groovy one might read differently.

The launcher's `WHIM_DOMAIN` stays a JS constant (compliance D6 rejected Babel injection). A lockstep suite compares the two. So a domain change is two one-line edits the gate holds together, down from three edits held together by a checklist.

### D2. One identity everywhere, including dev builds
Every configuration and build type uses `com.anycognition.whim`, with no `applicationIdSuffix`. One id keeps D17's filter and the AASA valid on developer installs, and Xcode's automatic signing registers one App ID with the Associated Domains capability. The Kotlin namespace stays `com.whim`, as decided. The six Maestro flows in `demo/android/flows/tea/` switch their `appId`. Existing `com.whim` installs become a separate app, and the runbook says to uninstall them.

### D3. Build numbers are minutes since 2026-01-01T00:00Z
`buildNumberAt(date) = floor((date − 2026-01-01T00:00Z) / 60 s)` gives 369,360 at noon on 2026-09-14. At that rate it stays under Play's 2,100,000,000 ceiling for millennia, it's a valid iOS `CFBundleVersion`, and it needs no state or credentials to compute. A lane computes it once at start unless the operator passes `build:<n>`, so a release of both platforms can carry one number. The preflight still compares it with the store's highest (`latest_testflight_build_number`, and the maximum of `google_play_track_version_codes` over internal, alpha, beta and production) and refuses anything not greater.

Git commit count lost because `/git-cleanup` rewrites history, so the count can go down. Commit time lost because a retry of a build the store half-accepted would need a new commit. "Store latest plus one" per platform lost because building would need credentials and the platforms would drift apart.

### D4. Android: `release` is the store build, `offline` is the old release build
- **`release`.** Its `signingConfig` is the upload key when the four `WHIM_UPLOAD_*` values exist, from `~/.gradle/gradle.properties` or the environment. A `doFirst` on `preReleaseBuild` throws a `GradleException` naming each missing value and `docs/release/mobile.md`, so debug and offline builds on an unconfigured machine are unaffected. It sets `debuggable false`, keeps minify off, and ships as an AAB.
- **`offline`.** `initWith release`, then `signingConfig signingConfigs.debug`, `debuggable true`, `matchingFallbacks = ['release']`, plus `sourceSets.offline.res.srcDirs += 'src/debug/res'` for the dev network config. That's the current release build type's exact configuration (research.md "Android build") plus the dev hosts it had implicitly. The RN plugin's default `debuggableVariants = ["debug"]` means `offline` embeds the Hermes bundle.
- **`npm run android:release`** is repointed to `--mode offline` in the HUMAN-BOOTSTRAP `package.json` edit, so CLAUDE.md, README.md, demo docs and acceptance.spec.md stay correct without edits (research.md "npm scripts").

The decided store build forbids cleartext and debug signing. The emulator loop needs both, since the NAT route to Metro is dead and the LAN dev server speaks http. Making `release` behave differently under a hidden flag was the other option, and it's a footgun: a manual console upload could ship the dev flavor. A named build type makes the difference visible in the artifact name.

### D5. Cleartext: strict main config, dev hosts in `src/debug`; iOS keeps local networking
- **Android.** `res/xml/network_security_config.xml` becomes `<base-config cleartextTrafficPermitted="false"/>`. The five dev hosts move to `src/debug/res/xml/network_security_config.xml`, which overrides it by resource name in `debug` and `offline`.
- **iOS.** One Info.plist for every configuration: `NSAllowsArbitraryLoads = false` and `NSAllowsLocalNetworking = true`. ATS never applies to numeric IP hosts on iOS 10+, and local networking covers only unqualified and `.local` names (research.md D). A per-configuration plist would need preprocessing or a script phase, and would restrict nothing that matters. Local networking stays because the simulator reaches Metro on `localhost`.

The consequence goes in the runbook: an Android store build can't use an http Advanced override (compliance D7), while iOS can reach a LAN IP. Testers who need a LAN server use the `offline` APK.

### D6. iOS ships iPhone-only and portrait; Android locks portrait
`TARGETED_DEVICE_FAMILY = 1`, the `~ipad` orientations removed, `ITSAppUsesNonExemptEncryption = false`, and the empty `NSLocationWhenInUseUsageDescription` deleted. `MainActivity` gets `android:screenOrientation="portrait"`. Nobody has laid out or tested the launcher on iPad. Declaring iPad support would require iPad screenshots and invite review on iPad. Android 16 ignores the orientation lock on large screens for target-36 apps, which is acceptable.

### D7. The privacy manifest covers what's linked, and an audit checks the archive
The app-level `PrivacyInfo.xcprivacy` keeps FileTimestamp `C617.1`, UserDefaults `CA92.1` and SystemBootTime `35F9.1`, and adds DiskSpace `E174.1`. op-sqlite's bundled SQLite references `statfs`-family calls, op-sqlite ships no manifest, and RN's aggregator only reads pods that do (research.md "Risks", D). It declares `NSPrivacyCollectedDataTypeOtherUserContent` and `NSPrivacyCollectedDataTypeDeviceID`, each not linked, not tracking, with purpose `NSPrivacyCollectedDataTypePurposeAppFunctionality`.

`pod install` may rewrite the file through `privacy_manifest_utils.rb`, so the checks parse the plist rather than compare bytes.

The `privacy-audit` command reads every Mach-O in the archived `.app`. It uses `xcrun nm -u` for imported symbols and `otool -v -s __TEXT __objc_methname` for selectors, maps them through a table taken from Apple's required-reason API list, and fails when the main binary uses a category the root manifest doesn't declare, or a framework uses one that neither its own manifest nor the root declares. The table:

| Category | Symbols and selectors |
|---|---|
| FileTimestamp | `stat`, `fstat`, `fstatat`, `lstat`, `getattrlist`, `fgetattrlist`, `getattrlistat`, `getattrlistbulk`, `NSFileCreationDate`, `NSFileModificationDate`, `NSURLCreationDateKey`, `NSURLContentModificationDateKey`, `creationDate`, `modificationDate`, `fileModificationDate` |
| SystemBootTime | `mach_absolute_time`, `systemUptime` |
| DiskSpace | `statfs`, `statvfs`, `fstatfs`, `fstatvfs`, `NSFileSystemFreeSize`, `NSFileSystemSize`, `NSURLVolumeAvailableCapacityKey`, `NSURLVolumeAvailableCapacityForImportantUsageKey`, `NSURLVolumeAvailableCapacityForOpportunisticUsageKey`, `NSURLVolumeTotalCapacityKey` |
| ActiveKeyboards | `activeInputModes` |
| UserDefaults | `NSUserDefaults` |

The audit is a guard, not Apple's scanner. It's there to turn an ITMS-91053 rejection email after a ten-minute upload into a local stop.

### D8. Hermes prerequisites move to `src/host/platform/` and run from the entry
- **`src/host/platform/hermes-polyfills.ts`** is `polyfills.ts` moved with `git mv`. When a codec is missing from the target, it requires `text-encoding-polyfill` and takes the constructor from the package's exports (the native one where it exists), instead of relying on the package writing to the real global. It exports `installHermesPolyfills(target: HermesGlobal = globalThis, platform?: 'ios' | 'android'): void`, which checks each of `TextEncoder`, `TextDecoder`, `Buffer`, `process`, `process.env` and `process.platform` on every call. The module-level `installed` flag goes, because it would make a platform-less first call lock out the entry's call. The platform is written only when passed and missing. Loading the module still calls `installHermesPolyfills(globalThis)` for its side effect, and it imports no React Native.
- **`src/host/platform/install-entry-polyfills.ts`** is React Native-only. It imports `Platform`, maps `Platform.OS` to `ios` or `android` (anything else passes no platform), and calls the installer.
- **`index.js`'s first statement** is `import './src/host/platform/install-entry-polyfills';`. Metro's inline-requires transform defers only imports with bindings, so a bare side-effect import runs in place, before `react-native` or `App` load.
- **The version-store importers** (`compaction.ts`, `device-acceptance.ts`, `engine.ts`) switch to the new path. **`marshal.ts`** gains `import '../platform/hermes-polyfills';` above its module-scope codecs, so the storage engine carries its own guarantee as the version store always has.
- **The suite** parses `index.js` with the TypeScript parser (`ScriptKind.JS`). It asserts the first statement is that bare import and red-checks against the plausible weaker variant: the import present but second. It also runs the installer against fresh plain objects: all globals installed with a codec round trip, existing globals kept by identity, no platform without one, the platform set on a later call, never overwritten.

This moves the #36 D2 / #39 recipe's home, which the post-compliance chain records in the decision log. I rejected detecting the platform inside the pure module with `.ios.ts`/`.android.ts` files. knip can't see Metro's platform extensions and would flag them, and `knip.json` is protected.

### D9. iOS `WhimTone` synthesizes the AOSP tones and plays them as system sounds
`ios/Whim/WhimToneModule.mm` is an Objective-C++ class `WhimToneModule`. It conforms to `NativeWhimToneSpec` from the codegen header `WhimAppSpecs/WhimAppSpecs.h`, returns `@"WhimTone"` from `+moduleName` and `NativeWhimToneSpecJSI` from `getTurboModule:`. It's registered by `"ios": {"modulesProvider": {"WhimTone": "WhimToneModule"}}` in `codegenConfig`, the HUMAN-BOOTSTRAP edit. The file joins the `Whim` target through the `xcodeproj` gem already in `Gemfile.lock` (`bundle exec ruby`), never by hand-editing or regenerating the project.

Tone table (research.md D, cut to Kotlin's windows, 44.1 kHz, 16-bit mono):

| token | Android | iOS render |
|---|---|---|
| `tick` (and unknown) | `TONE_PROP_BEEP`, 80 ms window | 400 Hz + 1200 Hz, 40 ms |
| `chime` | `TONE_PROP_ACK`, 180 ms window | 1200 Hz, 100 ms (the second burst starts at 200 ms, past the window) |
| `alarm` | `TONE_CDMA_ALERT_CALL_GUARD`, 750 ms window | 1319 Hz, 125 ms bursts at 0, 250 and 500 ms |

Each sample is `(0.9 / waveCount) × 10^(−5/20) × Σ sin(2πft)`, which is ToneGenerator's per-wave gain with Java volume 90 mapped to −5 dB. A 3 ms linear ramp opens and closes each burst. ToneGenerator has no ramp; this one prevents speaker clicks, and the deviation is deliberate. On first use the module writes each token to `Caches/whim-tone-v1/<token>.wav` on its method queue, creates one `SystemSoundID` per token, and calls `AudioServicesPlaySystemSound`. Every error is swallowed. Comments in `cue-backend.ts` and `NativeWhimTone.ts` stop saying Kotlin-only.

System sounds are the closest match to Android's `STREAM_NOTIFICATION`. They follow the ringer volume, the Silent switch mutes them, and they mix with other audio without an audio session. `AVAudioEngine` lost: it needs an app-wide session category, interruption and route handling, and an engine lifecycle, all for three beeps. Bundled audio files lost too: they add binary resources to the project and a second copy of the table to keep in step.

### D10. Icons and launch screens from one mark, rendered by Playwright
**Inputs.** `release/assets/icon-foreground.svg` (or `.png`): 1024×1024, transparent, the mark inside the central 626 px circle, which is the adaptive icon's 66 dp safe zone on its 108 dp layer. `release/assets/brand.json`: `{ "iconBackground": "#3f3d8f", "launchBackground": "#fbfaf8" }`. Until real artwork exists, the chain authors a placeholder SVG: a stroked lowercase `w` in `#fbfaf8` built from plain path data, so rendering doesn't depend on installed fonts.

**The command.** `node scripts/release/run.mjs generate-assets` renders through Playwright's Chromium (already a root devDependency) and writes:

| Output | Size | Alpha |
|---|---|---|
| `ios/Whim/Images.xcassets/AppIcon.appiconset/AppIcon-1024.png` + single-size `Contents.json` | 1024 | no |
| `ios/Whim/Images.xcassets/LaunchMark.imageset/LaunchMark{,@2x,@3x}.png` + `Contents.json` (the mark in a 160 pt icon-background circle) | 160/320/480 | yes |
| `ios/Whim/Images.xcassets/LaunchBackground.colorset/Contents.json` | – | – |
| `android/.../res/mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png`, `ic_launcher_round.png` | 48/72/96/144/192 | yes |
| `android/.../res/mipmap-*/ic_launcher_foreground.png`, `ic_launcher_monochrome.png` | 108/162/216/324/432 | yes |
| `android/.../res/mipmap-anydpi-v26/ic_launcher.xml`, `ic_launcher_round.xml` | – | – |
| `android/.../res/values/brand_colors.xml` (`ic_launcher_background`, `launch_background`) | – | – |
| `android/.../res/drawable-{m,h,xh,xxh,xxxh}dpi/launch_mark.png` (160 dp circle) | 160/240/320/480/640 | yes |
| `release/store/play/en-US/images/icon.png` | 512 | yes |
| `release/store/play/en-US/images/featureGraphic.png` | 1024×500 | no |

Opaque outputs are re-encoded from Chromium's RGBA as 8-bit RGB (PNG color type 2) by `scripts/release/lib/png.ts`, a zlib-only encoder and decoder, since Apple rejects icons with alpha and Play rejects feature graphics with it. The command writes `release/assets/generated.json` (`version`, source path and SHA-256, `brand.json` SHA-256, and each output's path, SHA-256, width, height and alpha). The assets suite re-hashes everything, reads PNG headers for size and color type, and compares `launchBackground` with `SHELL_COLORS.paper` imported from `src/sdk/design-tokens.ts`.

**Launch wiring, no new dependency.** iOS: `LaunchScreen.storyboard` becomes a `LaunchBackground` view with a centered 160×160 `LaunchMark` image view, and `AppDelegate` sets the root view controller's view background to `UIColor(named: "LaunchBackground")` after `startReactNative`, so the gap before React's first frame is paper, not system white. Android: a `Theme.Whim.Launch` style on `MainActivity`, whose `android:windowBackground` is `@drawable/launch_screen` (a layer list of `@color/launch_background` and a centered `@drawable/launch_mark`). A `values-v31` override sets `android:windowSplashScreenBackground` and leaves the icon to the adaptive launcher icon, which the system draws in the same circle. `AppTheme` gets `android:windowBackground = @color/launch_background`, and `MainActivity.onCreate` calls `setTheme(R.style.AppTheme)` before `super.onCreate`. `androidx.core:core-splashscreen` lost because it's a new artifact for what two theme attributes already do.

### D11. Store content in fastlane's layouts, with URLs and contacts supplied at upload
`release/store/app-store/` follows `deliver`: `en-US/{name,subtitle,description,keywords,promotional_text,release_notes}.txt`, `{copyright,primary_category,secondary_category}.txt`, `age-rating.json`, `app-privacy.json`, and later `review_information/notes.txt` and `screenshots/`. `release/store/play/` follows `supply`: `en-US/{title,short_description,full_description}.txt`, `en-US/changelogs/default.txt`, `en-US/images/`, `data-safety.json`. `release/store/answers.md` records every console-only answer (IARC content rating, target audience 13+, the AI-generated content declaration, the Device and Network Abuse exemption), each with its source: a D5 line, a launch-context rule, or a server spec.

`scripts/release/lib/store-listing.ts` validates:
- **Limits** from the store-listing spec, with keywords counted in bytes.
- **No URL files and no domain or `whim.` literals.**
- **No exclamation marks and none of** `amazing, awesome, best-in-class, breakthrough, cutting-edge, effortless, game-changing, incredible, magical, powerful, revolutionary, seamless, stunning, ultimate, unleash, world-class`.
- **Screenshot sizes and ratios.**
- **An age rating** whose override is 13+. Whim's own content descriptors are all none, so 13+ comes from `ageRatingOverrideV2 = THIRTEEN_PLUS`. Attribute names follow the App Store Connect `AgeRatingDeclaration` resource, and the attended metadata upload confirms them.
- **Privacy consistency** through one mapping: `OTHER_USER_CONTENT` ↔ `NSPrivacyCollectedDataTypeOtherUserContent` ↔ `other_user_generated_content`, and `DEVICE_ID` ↔ `NSPrivacyCollectedDataTypeDeviceID` ↔ `device_or_other_ids`.

`app-privacy.json` uses the array format fastlane's `upload_app_privacy_details_to_app_store` reads, each entry `{category, purposes: ["APP_FUNCTIONALITY"], data_protections: ["DATA_NOT_LINKED_TO_YOU"]}`. `data-safety.json` is this repo's own schema, `{ encryptedInTransit, deletionRequestMechanism, types: [{ id, collected, shared, sharedWith?, optional, ephemeral, purposes }] }`. User content is shared with "AI model providers through OpenRouter", optional, not ephemeral, for `app_functionality`. The device ID isn't shared and is optional, for `app_functionality` and `fraud_prevention_security_compliance` (daily limits). The Play console CSV is made from the console's own exported template in the attended chain, because only that template carries the real question ids.

Copy rules come from the platform context and D5. Say what Whim does: describe an app, answer a question or two, approve a plan, get an app on this phone. Say what leaves the phone and to whom, that apps stay on the phone that made them, that there are no accounts, that making or changing apps needs internet, and that the examples work offline. Never name specific models. Categories are Productivity and Utilities.

The URLs come from `WHIM_DOMAIN` at upload (`privacy_url` and `support_url` hashes for `deliver`). The reviewer contact is read from `~/.config/whim/review-contact.json` into `app_review_information`. Neither is committed.

### D12. fastlane from Homebrew for store calls, TypeScript for everything checkable
**`fastlane/Fastfile`** opens with `min_fastlane_version("2.237.0")` and has these lanes:
- `ios testflight [build:n] [external:true groups:"…"] [placeholder_domain:true]`
- `ios metadata`
- `ios privacy` (App Privacy upload; needs an Apple ID session, attended)
- `android closed [build:n] [status:draft|completed] [upload:false] [placeholder_domain:true]`
- `android metadata`

Every lane `sh`-calls `node scripts/release/run.mjs` for `preflight`, `verify-aab`, `privacy-audit` and `tag`, and uses fastlane only for `build_app`, `latest_testflight_build_number`, `upload_to_testflight`, `gradle`, `google_play_track_version_codes`, `upload_to_play_store`, `deliver` and `supply`. iOS signing passes `-allowProvisioningUpdates` plus the App Store Connect key flags (`-authenticationKeyPath/-authenticationKeyID/-authenticationKeyIssuerID`) in `xcargs` and `export_xcargs`. Both build lanes run `npm run build` first, because the runtime artifacts are generated and untracked. The iOS lane also runs `bundle exec pod install`. Archives and IPAs go to `ios/build/release/`, and AABs stay at Gradle's default `android/app/build/outputs/bundle/release/`. Both paths are already ignored, and neither is under the protected root `build/` directory.

**`scripts/release/`** follows the repo's runner idiom. `run.mjs` esbuild-bundles `cli.ts` to a temp file with `external: ['typescript', 'playwright']` and `tsconfigRaw: '{}'`, runs it, and removes the file. The commands are `check`, `native-config --json` (so the Fastfile never parses the xcconfig a third time), `build-number`, `preflight`, `verify-aab`, `privacy-audit`, `association-files`, `generate-assets` and `tag`. Pure logic lives in `lib/`. `preflight` gathers a snapshot (`git status --porcelain`, `node -v`, the JDK from `org.gradle.java.home` or `JAVA_HOME`, `xcodebuild -version`, file modes, Gradle properties) and hands it to a pure `evaluatePreflight(snapshot, options)`, which returns every failure with its fix. `verify-aab` uses `keytool -printcert -jarfile` for the signer and `aapt2 dump xmltree --file base/manifest/AndroidManifest.xml` from the newest installed build-tools for the manifest. If `aapt2` can't read the bundle's proto manifest, the chain falls back to `bundletool dump manifest` and records which one works in the handoff.

**Tests** live in `checks/test/release/*.suite.ts`, reached through one aggregator imported from `checks/test/acceptance.ts`. The same `lib/` functions serve the gate (every commit) and the preflight (every release).

**Credentials:** `~/.config/whim/whim-upload.jks`, `asc-api-key.json` (`{ key_id, issuer_id, key_filepath }`, pointing at `AuthKey_<id>.p8`), `play-publisher.json`, `review-contact.json`, and the `WHIM_UPLOAD_*` values in `~/.gradle/gradle.properties` or the environment. All files must be mode 0600. The two public fingerprints are committed: `release/android-upload-cert.sha256` and `release/android-play-signing-cert.sha256`.

**Tags.** `tag` creates `release/<marketing>+<build>` on HEAD. If the tag already points at HEAD, it succeeds without change. If it points anywhere else, it fails.

Node clients for App Store Connect and Play lost. They'd re-implement Play edit sessions, App Store Connect screenshot reservations and processing waits, which `deliver`, `supply` and `pilot` already handle. Adding fastlane to the root Gemfile lost because the launch context rules out new Ruby dependencies, and `min_fastlane_version` gives the floor a pin would. Plain `xcodebuild -exportArchive` with `destination: upload` would cover the iOS binary alone, but not metadata or Play, and one tool for all store calls is simpler to run and document.

### D13. Store AABs carry three ABIs; dev builds stay arm64
The Android lane passes `-PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64`. `gradle.properties` keeps `arm64-v8a` for local speed (research.md "Android build"). Play serves per-ABI splits, so users don't download the extra code, and the store build reaches 32-bit phones and x86_64 Chromebooks. If a 32-bit native build fails in the attended run, the fallback is the arm64-only property on the lane, recorded in the runbook.

### D14. The placeholder domain blocks uploads unless overridden
The preflight refuses `WHIM_DOMAIN = example.com` unless the lane gets `placeholder_domain:true`. The override exists for two jobs only: the Play Console's mandatory manual first upload, and internal TestFlight smoke builds of native changes. Such builds reach no server (compliance D6).

### D15. Association files are printed, not committed
`association-files` prints the AASA and assetlinks JSON exactly as D17 fixes them, or writes them with `--out`. It uses the team id, the app id and the two fingerprint files, Play signing first. Ops copies the output, so the server repo never re-types a fingerprint.

### D16. Chains stay off launcher files; one chain waits for compliance
No chain touches `LauncherRoot.tsx`, `copy.ts`, `HomeScreen.tsx`, `SettingsScreen.tsx`, prompt-flow screens or `src/host/launcher/test/acceptance.ts`. Three tasks need things only `store-launch-compliance` provides, so they sit in a final chain that runs after that whole change:
- the domain lockstep suite, which imports `release-config.ts`
- turning `docs/store/review-notes.md` §1–4 into `release/store/app-store/review_information/notes.txt` (at most 4000 characters) and replacing its §5 draft answers with pointers to the release files
- the decision log entry and the `.gitignore` additions (`*.jks`, `*.p8`, `play-publisher*.json`)

## Risks / Trade-offs

- [Homebrew fastlane drifts or breaks on Ruby 4.0] → `min_fastlane_version` sets the floor. The attended chain's first lane run is the compatibility check, and the runbook names `brew upgrade fastlane`.
- [`react-native run-android --mode offline` mis-resolves the APK path] → The attended chain runs it on the emulator. The fallback recipe is `./gradlew :app:installOffline` plus `adb shell am start`, recorded in the runbook.
- [32-bit or x86_64 native builds fail] → D13's arm64-only fallback.
- [The privacy audit's table misses a symbol Apple flags, or flags one Apple doesn't] → It's a guard. An ITMS-91053 email still names the API, and the table gains the entry.
- [`pod install` rewrites `PrivacyInfo.xcprivacy` or `Podfile.lock`, with absolute-path checksums] → The checks parse plist semantics. The attended chain commits pod output only when the pod set changes and reverts path-only churn.
- [Universal links and app links can't be verified until the domain exists and AASA/assetlinks are hosted] → Those device steps are recorded PENDING, with the exact verification commands.
- [The App Store name "Whim" is taken] → Open question with a fallback name. The home-screen name stays `Whim`.
- [System sounds on iOS have different latency and loudness than ToneGenerator] → Compared by ear on the iPhone in the attended chain. Gain can be tuned in the table without touching the contract.
- [Store builds on Android can't reach an http override] → Runbook note. Testers use the `offline` APK. Warning in Settings is a launcher follow-up.
- [The placeholder mark ships to testers] → It's a clean, deliberate mark, not the template robot. Replacing it is one file plus one command.
- [A non-debuggable release blocks `run-as` and WebView inspection] → The `offline` build keeps both for development.
- [Decision number contention with the two in-flight changes] → The post-compliance chain reads the tail at merge time.

## Migration Plan

1. This change's chains 1–10 run on `integration/store-launch` alongside `store-launch-compliance`'s chains. They share no files with them.
2. The human applies chain-0 (`package.json`) once chain-4 has merged.
3. The attended device chain runs as soon as chains 0, 2, 5 and 7 have merged. The TextDecoder fix doesn't wait for compliance.
4. Chain-11 runs after `store-launch-compliance` finishes. Then the attended upload chain runs.
5. Developers uninstall `com.whim` from emulators and devices. The orchestrator updates the memory notes that say `android:release` is debug-signed.
6. Rollback is reverting the merges. Store records and the upload key survive a revert, and a later re-release needs a build number above whatever was uploaded, which D3 guarantees.

## Open Questions

- **Icon artwork.** There's no usable source in the repo: the Android mipmaps are the stock robot, the iOS icon set is empty, there's no SVG anywhere, and `docs/mascot/` holds the undecided Amber Wisp concept (`no_brows.png` 1155×959 on a dark background; `big_ref.png` a 2816×1536 sheet), with no square transparent master. Default: the placeholder `w` mark on `#3f3d8f`, replaced by a 1024×1024 transparent PNG the user provides.
- **App Store name.** Default: `Whim`, falling back to `Whim: Small Apps You Describe` if taken.
- **The real domain.** Default: `example.com`, blocked at upload by D14.
- **External TestFlight group name.** Default: `Public beta`, created in App Store Connect during the attended chain.
- **Play closed track.** Default: the built-in closed testing track (`alpha`), with testers managed in the console.
- **Data safety deletion mechanism.** Default: none declared. There are no accounts, and reports expire under the server's retention period.
- **The age rating's user-generated-content answer.** Default: no, since nothing is shared between users. 13+ comes from the override.
- **Screenshots.** Default: captured in the attended chain from the iPhone 17 Pro Max simulator (1320×2868) and the emulator at 1080×2160, against the production server.

## Follow-ups (not in this change)

The iOS launcher UI batch collides with the launcher chains, so it waits:
- the ⚙ settings glyph renders as a color emoji (`HomeScreen.tsx:145`)
- `BackHandler` does nothing on iOS across eight launcher screens, so iOS needs a visible back affordance design
- probe screens hard-code `paddingTop: 48` instead of safe-area insets
- tile accessibility labels announce initials twice
- DevProbeScreen fixtures have been dead since `build/build.mjs:301` set `bundles: {}`

Also later:
- iOS haptics through `UIImpactFeedbackGenerator`, since RN's `Vibration` ignores durations on iOS
- a Settings warning when an Android store build has an http override
- a clipboard button for app links (compliance open question)
