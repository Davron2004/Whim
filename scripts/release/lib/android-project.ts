/**
 * Checks the Android project's identity-independent shape: the app-link intent filter,
 * `singleTask` + portrait on `MainActivity`, and the one network security config every build type
 * uses (specs/app-links/spec.md "The Android app verifies and delivers app links";
 * specs/native-release-config/spec.md "Store builds carry no cleartext exception" as beta-1 D20
 * amends it, "The iOS app declares its export, device and permission surface" Android portrait
 * sentence; design D4, D5). Pure text reading, no shelling out, so it runs in the Linux
 * devcontainer gate (chains.md's suite-portability rule).
 */

import fs from 'node:fs';
import path from 'node:path';

export const ANDROID_MANIFEST_PATH = 'android/app/src/main/AndroidManifest.xml';
export const ANDROID_MAIN_NETWORK_CONFIG_PATH = 'android/app/src/main/res/xml/network_security_config.xml';
const ANDROID_SOURCE_SETS_DIR = 'android/app/src';

export interface AndroidProjectFinding {
  readonly file: string;
  readonly message: string;
}

/** The file's text with XML comments removed, or `undefined` when it doesn't exist. */
function readXml(repoRoot: string, relPath: string): string | undefined {
  let text: string;
  try {
    text = fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
  } catch (err) {
    if ((err as { code?: unknown }).code === 'ENOENT') return undefined;
    throw err;
  }
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

/** `.MainActivity`'s opening-tag attributes and element body, or `undefined`. */
function findMainActivity(manifest: string): { attrs: string; body: string } | undefined {
  for (const m of manifest.matchAll(/<activity\b([^>]*)>([\s\S]*?)<\/activity>/g)) {
    if (/android:name="\.MainActivity"/.test(m[1])) {
      return { attrs: m[1], body: m[2] };
    }
  }
  return undefined;
}

/** The first `<intent-filter>` in `activityBody` whose action is VIEW, or `undefined`. */
function findViewIntentFilter(activityBody: string): { attrs: string; body: string } | undefined {
  for (const m of activityBody.matchAll(/<intent-filter([^>]*)>([\s\S]*?)<\/intent-filter>/g)) {
    if (m[2].includes('android.intent.action.VIEW')) {
      return { attrs: m[1], body: m[2] };
    }
  }
  return undefined;
}

function checkManifest(repoRoot: string): AndroidProjectFinding[] {
  const text = readXml(repoRoot, ANDROID_MANIFEST_PATH);
  if (text === undefined) {
    return [{ file: ANDROID_MANIFEST_PATH, message: 'file not found' }];
  }
  const activity = findMainActivity(text);
  if (activity === undefined) {
    return [{ file: ANDROID_MANIFEST_PATH, message: 'no <activity android:name=".MainActivity"> found' }];
  }

  const problems: string[] = [];
  if (!/android:launchMode="singleTask"/.test(activity.attrs)) {
    problems.push('MainActivity must keep android:launchMode="singleTask"');
  }
  if (!/android:screenOrientation="portrait"/.test(activity.attrs)) {
    problems.push('MainActivity must declare android:screenOrientation="portrait"');
  }

  const filter = findViewIntentFilter(activity.body);
  if (filter === undefined) {
    problems.push('MainActivity has no VIEW intent-filter for app links');
  } else {
    const required: readonly [RegExp, string][] = [
      [/<category\s+android:name="android\.intent\.category\.DEFAULT"\s*\/>/, 'the DEFAULT category'],
      [/<category\s+android:name="android\.intent\.category\.BROWSABLE"\s*\/>/, 'the BROWSABLE category'],
      [/android:scheme="https"/, 'android:scheme="https"'],
      [/android:pathPrefix="\/a\/"/, 'android:pathPrefix="/a/"'],
    ];
    if (!/android:autoVerify="true"/.test(filter.attrs)) {
      problems.push('the VIEW intent-filter must declare android:autoVerify="true"');
    }
    for (const [pattern, what] of required) {
      if (!pattern.test(filter.body)) problems.push(`the VIEW intent-filter is missing ${what}`);
    }
    if (!/android:host="\$\{whimWebHost\}"/.test(filter.body)) {
      problems.push('the VIEW intent-filter must declare android:host="${whimWebHost}", not a literal host');
    }
  }
  return problems.map((message) => ({ file: ANDROID_MANIFEST_PATH, message }));
}

/** The config every build type uses (beta-1 design D20): cleartext permitted at the base, so a user's own
 *  server on a LAN IP is reachable (a <domain> can't name an arbitrary address), and no
 *  <domain-config> overriding it. The launcher's address rule is the guard against plain http to
 *  a public host; the sandbox's CSP keeps mini-app bundles off the network either way. */
function checkMainNetworkConfig(repoRoot: string): AndroidProjectFinding[] {
  const text = readXml(repoRoot, ANDROID_MAIN_NETWORK_CONFIG_PATH);
  if (text === undefined) {
    return [{ file: ANDROID_MAIN_NETWORK_CONFIG_PATH, message: 'file not found' }];
  }
  const problems: string[] = [];
  const base = /<base-config\b([^>]*)>/.exec(text);
  if (base === null || !/cleartextTrafficPermitted\s*=\s*"true"/.test(base[1])) {
    problems.push('the network security config\'s <base-config> must set cleartextTrafficPermitted="true", so a user\'s own LAN server is reachable');
  }
  if (/<domain-config\b/.test(text)) {
    problems.push('the network security config must carry no <domain-config>: per-host rules would override the base for those hosts');
  }
  return problems.map((message) => ({ file: ANDROID_MAIN_NETWORK_CONFIG_PATH, message }));
}

/** A network security config under any other source set (`debug`, `offline`, ...) replaces main's
 *  whole file in that build type, so every build type must use main's (beta-1 design D20). */
function checkVariantNetworkConfigs(repoRoot: string): AndroidProjectFinding[] {
  const sourceSets = path.join(repoRoot, ANDROID_SOURCE_SETS_DIR);
  if (!fs.existsSync(sourceSets)) return [];
  return fs
    .readdirSync(sourceSets, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'main')
    .map((entry) => `${ANDROID_SOURCE_SETS_DIR}/${entry.name}/res/xml/network_security_config.xml`)
    .filter((file) => fs.existsSync(path.join(repoRoot, file)))
    .map((file) => ({ file, message: `a build-variant network security config would replace ${ANDROID_MAIN_NETWORK_CONFIG_PATH} in that build type; delete it` }));
}

/** Every finding across the manifest and the network security configs. Empty means the project passes. */
export function checkAndroidProject(repoRoot: string): AndroidProjectFinding[] {
  return [
    ...checkManifest(repoRoot),
    ...checkMainNetworkConfig(repoRoot),
    ...checkVariantNetworkConfigs(repoRoot),
  ];
}
