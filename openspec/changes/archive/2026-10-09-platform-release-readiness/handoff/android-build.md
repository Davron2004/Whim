# android-build (chain-4 → chain-0, chain-7, chain-9, chain-11)

## Build types (`android/app/build.gradle`)

| type | signing | debuggable | JS | cleartext | CMake build type | react-android variant |
|---|---|---|---|---|---|---|
| `debug` | debug key | yes | Metro | dev hosts (`src/debug/res`) | Debug | debug |
| `offline` | debug key | yes | Hermes bundle baked in | dev hosts (`sourceSets.offline.res.srcDirs += 'src/debug/res'`) | RelWithDebInfo (pinned) | release (`matchingFallbacks`) |
| `release` | upload key only, never the debug key | no | Hermes bundle baked in | none | RelWithDebInfo | release |

All three use `applicationId` = `WHIM_APP_ID`; Kotlin `namespace` stays `com.whim`.
`npm run android:release` must build `offline` (chain-0 repoints it to
`react-native run-android --mode offline --active-arch-only`). Until chain-0 lands, that script
still runs `--mode release`, which now fails on a machine without the upload key.

**Invariants for anyone editing `offline`** (both verified by building, see below):
- Keep `externalNativeBuild { cmake { arguments "-DCMAKE_BUILD_TYPE=RelWithDebInfo" } }`. AGP
  8.12 picks the CMake type from the variant name (`*release` → RelWithDebInfo, `*debug` →
  Debug) and falls back to `debuggable` for other names. Without the pin, `offline` compiles C++ as
  Debug (no `NDEBUG` → `REACT_NATIVE_DEBUG`) against the release react-android prefab, and
  `libreact_codegen_safeareacontext.so` fails to link (`undefined symbol:
  facebook::react::ShadowNode::getDebugName() const`, `Sealable::Sealable()`, ...).
- Keep `manifestPlaceholders.usesCleartextTraffic = "false"`. The RN plugin only fills that
  placeholder on `debug`/`release`/`debugOptimized` (in `finalizeDsl`, after `initWith release`
  copied release's map), so without it `processOfflineMainManifest` fails.

## Native release file in Gradle

`release/whim-release.xcconfig` is parsed at configuration time (same grammar as
`native-config.ts`; a bad line, unknown/duplicate key or `$(` throws a `GradleException`
`"<file>:<line>: ..."`, missing keys `"<file>: missing required key(s): ..."`). It sets `applicationId` (`WHIM_APP_ID`), `versionName`
(`WHIM_MARKETING_VERSION`), `versionCode` (`-PwhimBuildNumber=<n>`, else `WHIM_BUILD_NUMBER`), and
`manifestPlaceholders.whimWebHost = "whim.${WHIM_DOMAIN}"`.

## `WHIM_UPLOAD_*` signing values

Names: `WHIM_UPLOAD_STORE_FILE`, `WHIM_UPLOAD_STORE_PASSWORD`, `WHIM_UPLOAD_KEY_ALIAS`,
`WHIM_UPLOAD_KEY_PASSWORD`. Lookup per value: Gradle property of that exact name (`-P...` or
`~/.gradle/gradle.properties`), else environment variable of that exact name. Blank counts as
missing. A `doFirst` on `:app:preReleaseBuild` throws when any is missing, listing only the
missing ones, comma-space-joined, in the order above:

```
Android release build is missing: WHIM_UPLOAD_STORE_FILE, WHIM_UPLOAD_STORE_PASSWORD, WHIM_UPLOAD_KEY_ALIAS, WHIM_UPLOAD_KEY_PASSWORD. See docs/release/mobile.md.
```

`release` variant tasks (`bundleRelease`, `assembleRelease`, `installRelease`) all hang off
`preReleaseBuild`. The RN plugin's `createBundleReleaseJsAndAssets` does not, so the JS bundle
builds before the error appears (measured on `bundleRelease`). `debug`/`offline` never read these.

## Gradle properties

- `whimBuildNumber`: overrides `versionCode`.
- `reactNativeArchitectures`: read by the RN plugin, default `arm64-v8a` from
  `android/gradle.properties`; a store lane passes
  `-PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86_64` (design D13).

## Tasks and outputs (paths under `android/app/build/`)

- `:app:bundleRelease` → `outputs/bundle/release/app-release.aab`
- `:app:assembleOffline` / `:app:installOffline` → `outputs/apk/offline/app-offline.apk`
- `:app:assembleDebug` / `:app:installDebug` → `outputs/apk/debug/app-debug.apk`
- Merged manifest for variant `<v>` (`<V>` capitalized), placeholders resolved and
  `android:debuggable="true"` present only for `debug`/`offline`:
  `intermediates/merged_manifest/<v>/process<V>MainManifest/AndroidManifest.xml`. Same content under
  `intermediates/packaged_manifests/<v>/process<V>ManifestForPackage/`; the AAB's is
  `intermediates/bundle_manifest/release/processApplicationManifestReleaseForBundle/AndroidManifest.xml`.

## Manifest surface (chain-7 edits `AndroidManifest.xml` next; keep all of this)

`MainActivity`: `android:launchMode="singleTask"`, `android:screenOrientation="portrait"`, and,
beside MAIN/LAUNCHER, `<intent-filter android:autoVerify="true">` with action `VIEW`, categories
`DEFAULT` and `BROWSABLE`, and `<data android:scheme="https" android:host="${whimWebHost}"
android:pathPrefix="/a/" />`. Never a literal host (`scanNativeLiterals` and
`checkAndroidProject` both fail it).

Network configs: `src/main/res/xml/network_security_config.xml` is exactly
`<base-config cleartextTrafficPermitted="false"/>`. `src/debug/res/xml/network_security_config.xml`
holds the five dev hosts (10.0.2.2, 10.0.3.2, localhost, 127.0.0.1, 10.0.0.253) in a
`<domain-config cleartextTrafficPermitted="true">`. Same resource name, so it replaces the main
file wholesale in `debug` and `offline`.

## `scripts/release/lib/android-project.ts`

```ts
export const ANDROID_MANIFEST_PATH = 'android/app/src/main/AndroidManifest.xml';
export const ANDROID_MAIN_NETWORK_CONFIG_PATH = 'android/app/src/main/res/xml/network_security_config.xml';
export const ANDROID_DEBUG_NETWORK_CONFIG_PATH = 'android/app/src/debug/res/xml/network_security_config.xml';
export interface AndroidProjectFinding { readonly file: string; readonly message: string; }
export function checkAndroidProject(repoRoot: string): AndroidProjectFinding[]; // [] means pass
```

Pure file reads, with XML comments stripped first. It rethrows any read error other than ENOENT
(reported as a `file not found` finding). Checks: the MainActivity attributes and the VIEW filter
*inside MainActivity* (above); no `cleartextTrafficPermitted="true"` on any element of the main
config; the debug config has a cleartext `domain-config` holding at least one `<domain>`.

## Build evidence constraint

From a git worktree whose `node_modules` is a symlink, the `createBundle<V>JsAndAssets` tasks
fail (Metro can't see the symlinked `node_modules`). Native-only tasks work. Full `offline`,
`release` builds need the primary tree, or a scratch `--init-script` that sets
`react.bundleConfig` to a Metro config whose `watchFolders` include the real `node_modules`.
