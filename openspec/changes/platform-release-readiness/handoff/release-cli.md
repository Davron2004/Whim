# release-cli (chain-9 → chain-10)

New `scripts/release/lib/{preflight,verify-aab,privacy-audit,association-files,release-tag}.ts`,
seven new `COMMANDS` entries in `scripts/release/cli.ts`. Every command: exit `0` success, `1`
finding(s) (one stdout line each, `<command>: <reason>` or `<command>: <reason> — fix: <fix>`
where the underlying check carries a fix), `2` usage error (stderr, prints its `usage: ...` line).

## Commands (exact usage strings)

- `check` — no args. Runs `scanNativeLiterals` + `checkIosProject` + `checkAndroidProject` +
  `checkAssets` + `checkStoreListing` unconditionally (both platforms). `check: every repo check
  passed` on success.
- `native-config --json` — prints `JSON.stringify(loadNativeReleaseConfig(cwd))` + `\n`.
- `preflight --platform ios|android --build <n> --store-latest <n> [--allow-placeholder-domain]`
  — all three of `--platform`/`--build`/`--store-latest` are required (usage error otherwise).
  `preflight: passed for <platform>, build <n>` on success.
- `verify-aab <path> --build <n>` — `<path>` is the first non-flag argument.
- `privacy-audit <App.app>`.
- `association-files [--out <dir>]` — no `--out`: prints `# apple-app-site-association` then the
  AASA JSON, then `# assetlinks.json` then the assetlinks JSON, to stdout. With `--out <dir>`:
  writes `<dir>/apple-app-site-association` and `<dir>/assetlinks.json` (creates `<dir>`).
- `tag --build <n>`.

## `preflight.ts`

```ts
export type ReleasePlatform = 'ios' | 'android';
export const ANDROID_UPLOAD_VALUE_NAMES = ['WHIM_UPLOAD_STORE_FILE', 'WHIM_UPLOAD_STORE_PASSWORD', 'WHIM_UPLOAD_KEY_ALIAS', 'WHIM_UPLOAD_KEY_PASSWORD'] as const;
export const CREDENTIAL_FILES_BY_PLATFORM: Readonly<Record<ReleasePlatform, readonly string[]>> = {
  ios: ['asc-api-key.json', 'review-contact.json'],
  android: ['play-publisher.json'],
}; // joined with os.homedir() + '.config/whim/'
export interface NamedCredentialFile { label: string; file: {path, exists, mode: number|null} }
export interface PreflightSnapshot { platform, gitStatusPorcelain, nodeMajorVersion, jdkMajorVersion /* android */, xcodebuildPresent /* ios */,
  credentialFiles: readonly {path, exists, mode: number|null}[], extraCredentialFiles: readonly NamedCredentialFile[],
  androidUploadValues: readonly {name, present}[]|undefined,
  config: NativeReleaseConfig, buildNumber: number, storeLatestBuildNumber: number|undefined,
  nativeLiteralFindings, iosProjectFindings, androidProjectFindings, assetFindings, storeListingFindings }
export function evaluatePreflight(snapshot, options: { allowPlaceholderDomain: boolean }): readonly { reason: string; fix: string }[];
export function collectPreflightSnapshot(repoRoot, platform, args: { buildNumber, storeLatestBuildNumber }): PreflightSnapshot; // impure, never called by a suite
```

Credential file mode check (both `credentialFiles` and `extraCredentialFiles`): not `exists` →
finding + fix "see docs/release/mobile.md's one-time setup"; `mode & 0o077 !== 0` (readable by
group/other) → finding naming the octal mode + fix `chmod 600 <path>`. `extraCredentialFiles`
covers the iOS `.p8` named by `asc-api-key.json`'s `key_filepath`, the Android upload keystore
resolved from `WHIM_UPLOAD_STORE_FILE`, and `~/.gradle/gradle.properties` itself when it holds
any `WHIM_UPLOAD_*` value — each a separately labeled finding. Missing Android upload values →
ONE finding `Android release build is missing: <names>` (comma-space-joined, in
`ANDROID_UPLOAD_VALUE_NAMES` order, mirrors handoff/android-build.md's Gradle error text).

## `verify-aab.ts`

```ts
export function parseFingerprintFile(text: string): string; // throws FingerprintFileError unless 32 colon-separated hex bytes; returns uppercase
export interface AabManifestFacts { packageName: string|undefined; versionCode: number|undefined; debuggable: boolean }
export function getAabManifestFacts(aabPath: string): AabManifestFacts; // shells out — see below
export function getAabSignerFingerprint(aabPath: string): string; // keytool -printcert -jarfile <aabPath>, parses "SHA256: xx:xx:..."
export function aabFindings(facts: {manifest, signerFingerprint}, expected: {packageName, versionCode, signerFingerprint}): readonly {reason: string}[];
```

**Manifest tool: `bundletool`, not `aapt2`.** Measured on this machine against a real production
`.aab`: `aapt2 dump xmltree --file base/manifest/AndroidManifest.xml <aab>` fails `could not
identify format of APK` — aapt2 cannot read a compiled App Bundle's protobuf-XML module zip, only
an APK's binary-XML container (design D12 hedged this as a fallback; it's actually the only path
that works). `getAabManifestFacts` therefore shells straight to
`bundletool dump manifest --bundle=<aabPath>` (binary name from `WHIM_BUNDLETOOL` env var, else
`bundletool` on PATH) and regex-parses its plain-XML output for `package=`, `android:versionCode=`,
`android:debuggable=`. **Verified end to end** against bundletool 1.18.3 (`brew install
bundletool`): a real `bundleRelease` AAB's `dump manifest` output matched the three regexes
exactly, and `verify-aab <aab> --build <n>` both passed a matching build number and refused a
mismatched one with the expected finding.

## `privacy-audit.ts`

```ts
export type RequiredReasonCategory = 'FileTimestamp'|'SystemBootTime'|'DiskSpace'|'ActiveKeyboards'|'UserDefaults';
export const REQUIRED_REASON_TABLE: readonly { category: RequiredReasonCategory; names: readonly string[] }[]; // design D7's table, symbols+selectors merged per row
export function categoriesFor(symbols: readonly string[], selectors: readonly string[]): readonly { category: RequiredReasonCategory; referencingName: string }[];
  // strips ONE leading "_" from symbols only (mach-o convention: nm -u -j's "stat" import reads "_stat")
export const ROOT_MANIFEST_KEY = 'root';
export function declaredCategoriesFromManifest(accessedApiTypes: readonly string[]): readonly RequiredReasonCategory[];
export function auditFindings(binaries: readonly {path, isMainBinary, manifestKey: string|undefined, hits}[], manifests: readonly {key, declaredCategories}[]): readonly {reason: string}[];
export function auditApp(appPath: string): readonly {reason: string}[]; // impure: xcrun nm -u -j + xcrun otool -v -s __TEXT __objc_methname per Mach-O, never called by a suite
```

Main binary checked only against the root manifest; a framework against its own manifest OR the
root. `xcrun nm`/`xcrun otool` ARE verified (invocation + output shape) against real macOS
binaries on this machine — `auditApp`'s enumeration logic (main binary + `Frameworks/*.framework`)
is not verified against a real `.app`, since none exists yet (chain-13 is the first real archive).

## `association-files.ts`

```ts
export const PLAY_SIGNING_FINGERPRINT_PATH = 'release/android-play-signing-cert.sha256';
export const UPLOAD_FINGERPRINT_PATH = 'release/android-upload-cert.sha256';
export function buildAasa(teamId, appId): AasaFile;
export function buildAssetLinks(appId, playSigningFingerprint, uploadFingerprint): readonly AssetLinksEntry[]; // Play signing FIRST
export function buildAssociationFiles(repoRoot, config: NativeReleaseConfig): { aasa, assetLinks }; // throws "association-files: missing fingerprint file <relPath>" if either is absent/malformed
```

## `release-tag.ts`

```ts
export type GitRunner = (args: string[]) => string; // throws on non-zero exit
export function releaseTagName(marketingVersion, buildNumber): string; // "release/<marketing>+<build>"
export function ensureReleaseTag(run: GitRunner, marketingVersion, buildNumber): string; // reuses a tag AT HEAD; throws "already points at <sha>, not HEAD (<sha>)" otherwise
export function realGitRunner(cwd: string): GitRunner; // production wiring only — a suite never calls this
```

## Credentials (paths, required mode 600; only `play-publisher.json` exists today)

`~/.config/whim/{whim-upload.jks, asc-api-key.json, play-publisher.json, review-contact.json}`,
plus the four `WHIM_UPLOAD_*` Gradle properties/env vars (handoff/android-build.md).
