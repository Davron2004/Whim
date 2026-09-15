/**
 * The release preflight (design D12 "scripts/release" paragraph; specs/store-release-pipeline/
 * spec.md "The preflight names every reason it refuses"). `collectPreflightSnapshot` is the
 * only impure half — it shells to git/java/xcodebuild and reads the filesystem, including the
 * repo checks (`scanNativeLiterals`, `checkIosProject`, `checkAndroidProject`, `checkAssets`,
 * `checkStoreListing`) task 10.1 names. `evaluatePreflight` is pure: given a snapshot and
 * options it returns every failing condition with its fix, never stopping at the first —
 * the only half `checks/test/release/release-cli.suite.ts` calls.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadNativeReleaseConfig, scanNativeLiterals, type NativeReleaseConfig, type NativeLiteralFinding } from './native-config';
import { checkIosProject, type IosProjectFinding } from './ios-project';
import { checkAndroidProject, type AndroidProjectFinding } from './android-project';
import { checkAssets, GENERATE_ASSETS_COMMAND, type AssetFinding } from './assets';
import { checkStoreListing, type StoreListingFinding } from './store-listing';

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function statSync(path: string): { readonly mode: number };
}
declare module 'node:os' {
  export function homedir(): string;
}
declare global {
  interface WhimProcess {
    readonly version: string;
  }
}

export type ReleasePlatform = 'ios' | 'android';

export const ANDROID_UPLOAD_VALUE_NAMES = [
  'WHIM_UPLOAD_STORE_FILE',
  'WHIM_UPLOAD_STORE_PASSWORD',
  'WHIM_UPLOAD_KEY_ALIAS',
  'WHIM_UPLOAD_KEY_PASSWORD',
] as const;
export type AndroidUploadValueName = (typeof ANDROID_UPLOAD_VALUE_NAMES)[number];

/** The credential files the preflight checks for each platform, under `~/.config/whim/` — plus
 *  the derived-path files `NamedCredentialFile`/`extraCredentialFiles` cover (the iOS `.p8`, the
 *  Android upload keystore, and `~/.gradle/gradle.properties` itself). */
export const CREDENTIAL_FILES_BY_PLATFORM: Readonly<Record<ReleasePlatform, readonly string[]>> = {
  ios: ['asc-api-key.json', 'review-contact.json'],
  android: ['play-publisher.json'],
};

const PLACEHOLDER_DOMAIN = 'example.com';

export interface CredentialFileStatus {
  readonly path: string;
  readonly exists: boolean;
  /** `fs.Stats.mode & 0o777`; `null` when the file doesn't exist. */
  readonly mode: number | null;
}

/** A credential file the preflight checks beyond `CREDENTIAL_FILES_BY_PLATFORM` — one whose
 *  path is itself derived from another credential (the iOS `.p8` named by `asc-api-key.json`)
 *  or from Gradle properties (the Android keystore, and `~/.gradle/gradle.properties` itself
 *  when it holds any `WHIM_UPLOAD_*` value). `label` names it in the finding. */
export interface NamedCredentialFile {
  readonly label: string;
  readonly file: CredentialFileStatus;
}

export interface AndroidUploadValueStatus {
  readonly name: AndroidUploadValueName;
  readonly present: boolean;
}

export interface PreflightSnapshot {
  readonly platform: ReleasePlatform;
  readonly gitStatusPorcelain: string;
  readonly nodeMajorVersion: number;
  readonly jdkMajorVersion: number | undefined;
  readonly xcodebuildPresent: boolean | undefined;
  readonly credentialFiles: readonly CredentialFileStatus[];
  /** Beyond `credentialFiles` — see `NamedCredentialFile`. Always present (possibly empty). */
  readonly extraCredentialFiles: readonly NamedCredentialFile[];
  readonly androidUploadValues: readonly AndroidUploadValueStatus[] | undefined;
  readonly config: NativeReleaseConfig;
  readonly buildNumber: number;
  readonly storeLatestBuildNumber: number | undefined;
  readonly nativeLiteralFindings: readonly NativeLiteralFinding[];
  readonly iosProjectFindings: readonly IosProjectFinding[] | undefined;
  readonly androidProjectFindings: readonly AndroidProjectFinding[] | undefined;
  readonly assetFindings: readonly AssetFinding[];
  readonly storeListingFindings: readonly StoreListingFinding[];
}

export interface PreflightOptions {
  readonly allowPlaceholderDomain: boolean;
}

export interface PreflightFinding {
  readonly reason: string;
  readonly fix: string;
}

function fileFindings(findings: PreflightFinding[], entries: readonly { readonly file: string; readonly message: string }[] | undefined, category: string, fix: string): void {
  if (!entries) return;
  for (const entry of entries) {
    findings.push({ reason: `${category} — ${entry.file}: ${entry.message}`, fix });
  }
}

function toolchainFindings(snapshot: PreflightSnapshot): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  if (snapshot.nodeMajorVersion !== 22) {
    findings.push({ reason: `Node is major version ${snapshot.nodeMajorVersion}, not 22`, fix: 'run under Node 22 (nvm use 22; check PATH ordering against Homebrew\'s node)' });
  }
  if (snapshot.platform === 'android' && snapshot.jdkMajorVersion !== 21) {
    const found = snapshot.jdkMajorVersion === undefined ? 'not found' : `major version ${snapshot.jdkMajorVersion}`;
    findings.push({ reason: `the JDK is ${found}, not 21`, fix: 'pin org.gradle.java.home in android/gradle.properties to a JDK 21 install' });
  }
  if (snapshot.platform === 'ios' && snapshot.xcodebuildPresent === false) {
    findings.push({ reason: 'xcodebuild is not present', fix: 'install Xcode and its command line tools' });
  }
  return findings;
}

function fileStatusFindings(findings: PreflightFinding[], label: string, file: CredentialFileStatus): void {
  if (!file.exists) {
    findings.push({ reason: `missing ${label} at ${file.path}`, fix: "see docs/release/mobile.md's one-time setup" });
  } else if (file.mode !== null && (file.mode & 0o077) !== 0) { // eslint-disable-line no-bitwise -- checking the group/other permission bits of a file mode
    findings.push({ reason: `${label} at ${file.path} is readable by group or others (mode ${file.mode.toString(8)})`, fix: `chmod 600 ${file.path}` });
  }
}

function credentialFindings(snapshot: PreflightSnapshot): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const file of snapshot.credentialFiles) {
    fileStatusFindings(findings, 'credential file', file);
  }
  for (const { label, file } of snapshot.extraCredentialFiles) {
    fileStatusFindings(findings, label, file);
  }
  if (snapshot.androidUploadValues) {
    const missing = snapshot.androidUploadValues.filter((v) => !v.present).map((v) => v.name);
    if (missing.length > 0) {
      findings.push({
        reason: `Android release build is missing: ${missing.join(', ')}`,
        fix: 'set the four WHIM_UPLOAD_* Gradle properties, see docs/release/mobile.md',
      });
    }
  }
  return findings;
}

function repoCheckFindings(snapshot: PreflightSnapshot): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  fileFindings(findings, snapshot.iosProjectFindings, 'iOS project', 'fix the iOS project file named above');
  fileFindings(findings, snapshot.androidProjectFindings, 'Android project', 'fix the Android project file named above');
  for (const asset of snapshot.assetFindings) {
    findings.push({ reason: `assets — ${asset.path}: ${asset.message}`, fix: `run "${GENERATE_ASSETS_COMMAND}"` });
  }
  fileFindings(findings, snapshot.storeListingFindings, 'store listing', 'fix release/store/** per docs/release/mobile.md');
  for (const literal of snapshot.nativeLiteralFindings) {
    findings.push({
      reason: `native literal — ${literal.file}:${literal.line}: literal ${literal.key} value ${JSON.stringify(literal.literal)}`,
      fix: `use the $(${literal.key}) macro from release/whim-release.xcconfig instead of a literal`,
    });
  }
  return findings;
}

/**
 * Every condition specs/store-release-pipeline/spec.md "The preflight names every reason it
 * refuses" lists, evaluated against `snapshot` — never stopping at the first failure.
 */
export function evaluatePreflight(snapshot: PreflightSnapshot, options: PreflightOptions): readonly PreflightFinding[] {
  const findings: PreflightFinding[] = [];

  if (snapshot.gitStatusPorcelain.trim().length > 0) {
    findings.push({ reason: 'the working tree has uncommitted changes', fix: 'commit or stash your changes' });
  }

  findings.push(...toolchainFindings(snapshot));
  findings.push(...credentialFindings(snapshot));

  if (snapshot.config.WHIM_DOMAIN === PLACEHOLDER_DOMAIN && !options.allowPlaceholderDomain) {
    findings.push({
      reason: `WHIM_DOMAIN is the placeholder "${PLACEHOLDER_DOMAIN}" — the build couldn't reach any server`,
      fix: 'set the real domain in release/whim-release.xcconfig, or pass --allow-placeholder-domain for a Play Console manual upload or a domain-less TestFlight smoke build',
    });
  }

  findings.push(...repoCheckFindings(snapshot));

  if (snapshot.storeLatestBuildNumber !== undefined && snapshot.buildNumber <= snapshot.storeLatestBuildNumber) {
    findings.push({
      reason: `the run's build number ${snapshot.buildNumber} is not above the store's latest build number ${snapshot.storeLatestBuildNumber}`,
      fix: 'wait a minute and recompute the build number, or pass a higher --build',
    });
  }

  return findings;
}

// ── collectPreflightSnapshot: the impure half (never called by the suite) ──────────────────

function parseSimpleProperties(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    values.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return values;
}

function readPropertiesFile(absPath: string): Map<string, string> {
  try {
    return parseSimpleProperties(fs.readFileSync(absPath, 'utf8'));
    // eslint-disable-next-line no-restricted-syntax -- intentional: a missing properties file just means none of its values are set, handled the same as any other missing property below
  } catch {
    return new Map();
  }
}

function gitStatusPorcelain(repoRoot: string): string {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: the release preflight runs inside the repo's own dev/release toolchain, which always has a trustworthy `git` on PATH
  return execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
}

function nodeMajorVersion(): number {
  return Number(process.version.replace(/^v/, '').split('.')[0]);
}

function javaHomeFromGradleProperties(repoRoot: string): string | undefined {
  return readPropertiesFile(path.join(repoRoot, 'android/gradle.properties')).get('org.gradle.java.home');
}

function jdkMajorVersion(repoRoot: string): number | undefined {
  const javaHome = javaHomeFromGradleProperties(repoRoot) ?? process.env.JAVA_HOME;
  const javaBin = javaHome ? path.join(javaHome, 'bin', 'java') : 'java';
  try {
    const output = execFileSync(javaBin, ['-version'], { encoding: 'utf8' });
    const match = /version "(\d+)/.exec(output);
    return match ? Number(match[1]) : undefined;
    // eslint-disable-next-line no-restricted-syntax -- intentional: "no JDK found at this path" is reported as jdkMajorVersion===undefined, which evaluatePreflight already turns into a finding
  } catch {
    return undefined;
  }
}

function xcodebuildPresent(): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: same toolchain assumption as git above
    execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' });
    return true;
    // eslint-disable-next-line no-restricted-syntax -- intentional: "xcodebuild isn't installed" is exactly what this probe reports as false
  } catch {
    return false;
  }
}

function fileStatusAt(absPath: string): CredentialFileStatus {
  if (!fs.existsSync(absPath)) return { path: absPath, exists: false, mode: null };
  return { path: absPath, exists: true, mode: fs.statSync(absPath).mode & 0o777 }; // eslint-disable-line no-bitwise -- reading only the permission bits of a file mode
}

function credentialFileStatus(name: string): CredentialFileStatus {
  return fileStatusAt(path.join(os.homedir(), '.config', 'whim', name));
}

const GRADLE_PROPERTIES_PATH = path.join(os.homedir(), '.gradle', 'gradle.properties');

function androidUploadValueStatus(gradleProperties: Map<string, string>): readonly AndroidUploadValueStatus[] {
  return ANDROID_UPLOAD_VALUE_NAMES.map((name) => ({
    name,
    present: (gradleProperties.get(name) ?? process.env[name] ?? '').length > 0,
  }));
}

/** The `.p8` `asc-api-key.json`'s `key_filepath` names, when that file exists and parses —
 *  `undefined` when it doesn't (the base `credentialFiles` check already names that). */
function iosApiKeyFile(): NamedCredentialFile | undefined {
  const ascApiKeyPath = path.join(os.homedir(), '.config', 'whim', 'asc-api-key.json');
  if (!fs.existsSync(ascApiKeyPath)) return undefined;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(ascApiKeyPath, 'utf8'));
    const keyFilepath = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).key_filepath : undefined;
    if (typeof keyFilepath !== 'string' || keyFilepath.length === 0) return undefined;
    return { label: 'App Store Connect API private key (asc-api-key.json\'s key_filepath)', file: fileStatusAt(keyFilepath) };
    // eslint-disable-next-line no-restricted-syntax -- intentional: an unparseable asc-api-key.json is reported by the base credentialFiles mode check, not duplicated here
  } catch {
    return undefined;
  }
}

/** The resolved Android upload keystore (`WHIM_UPLOAD_STORE_FILE`) and, when it holds any
 *  `WHIM_UPLOAD_*` value, `~/.gradle/gradle.properties` itself — both named findings beyond the
 *  four-value presence check `credentialFindings` already does. */
function androidExtraCredentialFiles(gradleProperties: Map<string, string>): readonly NamedCredentialFile[] {
  const files: NamedCredentialFile[] = [];
  const keystorePath = gradleProperties.get('WHIM_UPLOAD_STORE_FILE') ?? process.env.WHIM_UPLOAD_STORE_FILE;
  if (keystorePath) {
    files.push({ label: 'Android upload keystore (WHIM_UPLOAD_STORE_FILE)', file: fileStatusAt(keystorePath) });
  }
  const holdsUploadSecret = ANDROID_UPLOAD_VALUE_NAMES.some((name) => gradleProperties.has(name));
  if (holdsUploadSecret) {
    files.push({ label: '~/.gradle/gradle.properties (holds WHIM_UPLOAD_* secrets)', file: fileStatusAt(GRADLE_PROPERTIES_PATH) });
  }
  return files;
}

export interface CollectPreflightSnapshotArgs {
  readonly buildNumber: number;
  readonly storeLatestBuildNumber: number | undefined;
}

/** Gathers every fact `evaluatePreflight` needs, including the five repo checks task 10.1 names. */
export function collectPreflightSnapshot(repoRoot: string, platform: ReleasePlatform, args: CollectPreflightSnapshotArgs): PreflightSnapshot {
  const config = loadNativeReleaseConfig(repoRoot);
  const gradleProperties = platform === 'android' ? readPropertiesFile(GRADLE_PROPERTIES_PATH) : new Map<string, string>();
  const extraCredentialFiles: readonly NamedCredentialFile[] = platform === 'ios' ? [iosApiKeyFile()].filter((f): f is NamedCredentialFile => f !== undefined) : androidExtraCredentialFiles(gradleProperties);
  return {
    platform,
    gitStatusPorcelain: gitStatusPorcelain(repoRoot),
    nodeMajorVersion: nodeMajorVersion(),
    jdkMajorVersion: platform === 'android' ? jdkMajorVersion(repoRoot) : undefined,
    xcodebuildPresent: platform === 'ios' ? xcodebuildPresent() : undefined,
    credentialFiles: CREDENTIAL_FILES_BY_PLATFORM[platform].map(credentialFileStatus),
    extraCredentialFiles,
    androidUploadValues: platform === 'android' ? androidUploadValueStatus(gradleProperties) : undefined,
    config,
    buildNumber: args.buildNumber,
    storeLatestBuildNumber: args.storeLatestBuildNumber,
    nativeLiteralFindings: scanNativeLiterals(repoRoot, config),
    iosProjectFindings: platform === 'ios' ? checkIosProject(repoRoot, config) : undefined,
    androidProjectFindings: platform === 'android' ? checkAndroidProject(repoRoot) : undefined,
    assetFindings: checkAssets(repoRoot),
    storeListingFindings: checkStoreListing(repoRoot, config),
  };
}
