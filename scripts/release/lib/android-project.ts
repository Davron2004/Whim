/**
 * Checks the Android project's identity-independent shape: the app-link intent filter,
 * `singleTask` + portrait on `MainActivity`, and the cleartext split between the main and debug
 * network security configs (specs/app-links/spec.md "The Android app verifies and delivers app
 * links"; specs/native-release-config/spec.md "Store builds carry no cleartext exception", "The
 * iOS app declares its export, device and permission surface" Android portrait sentence; design
 * D4, D5). Pure text reading, no shelling out, so it runs in the Linux devcontainer gate
 * (chains.md's suite-portability rule).
 */

import fs from 'node:fs';
import path from 'node:path';

export const ANDROID_MANIFEST_PATH = 'android/app/src/main/AndroidManifest.xml';
export const ANDROID_MAIN_NETWORK_CONFIG_PATH = 'android/app/src/main/res/xml/network_security_config.xml';
export const ANDROID_DEBUG_NETWORK_CONFIG_PATH = 'android/app/src/debug/res/xml/network_security_config.xml';

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

function checkMainNetworkConfig(repoRoot: string): AndroidProjectFinding[] {
  const text = readXml(repoRoot, ANDROID_MAIN_NETWORK_CONFIG_PATH);
  if (text === undefined) {
    return [{ file: ANDROID_MAIN_NETWORK_CONFIG_PATH, message: 'file not found' }];
  }
  // Any element, not just <base-config>: a cleartext <domain-config> is the store-build leak.
  if (/cleartextTrafficPermitted\s*=\s*"true"/.test(text)) {
    return [{
      file: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      message: 'the store build\'s network security config must permit cleartext to no host (found cleartextTrafficPermitted="true")',
    }];
  }
  return [];
}

function checkDebugNetworkConfig(repoRoot: string): AndroidProjectFinding[] {
  const text = readXml(repoRoot, ANDROID_DEBUG_NETWORK_CONFIG_PATH);
  if (text === undefined) {
    return [{ file: ANDROID_DEBUG_NETWORK_CONFIG_PATH, message: 'file not found' }];
  }
  const holdsDevHosts = [...text.matchAll(/<domain-config\s+cleartextTrafficPermitted="true"\s*>([\s\S]*?)<\/domain-config>/g)]
    .some((m) => /<domain\b[^>]*>\s*[^<\s]+\s*<\/domain>/.test(m[1]));
  if (!holdsDevHosts) {
    return [{
      file: ANDROID_DEBUG_NETWORK_CONFIG_PATH,
      message: 'the dev hosts must sit in a <domain-config cleartextTrafficPermitted="true"> with at least one <domain>',
    }];
  }
  return [];
}

/** Every finding across the manifest and both network security configs. Empty means the project passes. */
export function checkAndroidProject(repoRoot: string): AndroidProjectFinding[] {
  return [
    ...checkManifest(repoRoot),
    ...checkMainNetworkConfig(repoRoot),
    ...checkDebugNetworkConfig(repoRoot),
  ];
}
