/**
 * Acceptance for `scripts/release/lib/android-project.ts` (chain-4, platform-release-readiness).
 * specs/app-links/spec.md "The Android app verifies and delivers app links";
 * specs/native-release-config/spec.md "Store builds carry no cleartext exception"; task 5.6.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, assert } from '../harness';
import {
  checkAndroidProject,
  ANDROID_MANIFEST_PATH,
  ANDROID_MAIN_NETWORK_CONFIG_PATH,
  ANDROID_DEBUG_NETWORK_CONFIG_PATH,
} from '../../../scripts/release/lib/android-project';

const REPO_ROOT = process.cwd();

function writeFile(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whim-android-project-'));
}

/** `linkActivity` moves the app-link filter off the launcher activity onto a sibling activity. */
function manifest(opts: { autoVerify: boolean; host: string; linkActivity?: string }): string {
  const linkFilter = [
    `        <intent-filter${opts.autoVerify ? ' android:autoVerify="true"' : ''}>`,
    '            <action android:name="android.intent.action.VIEW" />',
    '            <category android:name="android.intent.category.DEFAULT" />',
    '            <category android:name="android.intent.category.BROWSABLE" />',
    '            <data',
    '              android:scheme="https"',
    `              android:host="${opts.host}"`,
    '              android:pathPrefix="/a/" />',
    '        </intent-filter>',
  ];
  return [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <application android:name=".MainApplication">',
    '      <activity',
    '        android:name=".MainActivity"',
    '        android:launchMode="singleTask"',
    '        android:screenOrientation="portrait"',
    '        android:exported="true">',
    '        <intent-filter>',
    '            <action android:name="android.intent.action.MAIN" />',
    '            <category android:name="android.intent.category.LAUNCHER" />',
    '        </intent-filter>',
    ...(opts.linkActivity === undefined ? linkFilter : []),
    '      </activity>',
    ...(opts.linkActivity === undefined
      ? []
      : [`      <activity android:name="${opts.linkActivity}" android:exported="true">`, ...linkFilter, '      </activity>']),
    '    </application>',
    '</manifest>',
    '',
  ].join('\n');
}

const VALID_MANIFEST = manifest({ autoVerify: true, host: '${whimWebHost}' });

const STRICT_MAIN_NETWORK_CONFIG = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<network-security-config>',
  '    <base-config cleartextTrafficPermitted="false"/>',
  '</network-security-config>',
  '',
].join('\n');

const MAIN_NETWORK_CONFIG_WITH_CLEARTEXT_DOMAIN = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<network-security-config>',
  '    <base-config cleartextTrafficPermitted="false"/>',
  '    <domain-config cleartextTrafficPermitted="true">',
  '        <domain includeSubdomains="false">evil.example.com</domain>',
  '    </domain-config>',
  '</network-security-config>',
  '',
].join('\n');

const DEBUG_NETWORK_CONFIG = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<network-security-config>',
  '    <base-config cleartextTrafficPermitted="false">',
  '        <trust-anchors>',
  '            <certificates src="system" />',
  '        </trust-anchors>',
  '    </base-config>',
  '    <domain-config cleartextTrafficPermitted="true">',
  '        <domain includeSubdomains="false">10.0.2.2</domain>',
  '    </domain-config>',
  '</network-security-config>',
  '',
].join('\n');

function writeValidFixture(root: string): void {
  writeFile(root, ANDROID_MANIFEST_PATH, VALID_MANIFEST);
  writeFile(root, ANDROID_MAIN_NETWORK_CONFIG_PATH, STRICT_MAIN_NETWORK_CONFIG);
  writeFile(root, ANDROID_DEBUG_NETWORK_CONFIG_PATH, DEBUG_NETWORK_CONFIG);
}

export async function run(): Promise<void> {
  await test('android-project: the real Android project passes checkAndroidProject', () => {
    const findings = checkAndroidProject(REPO_ROOT);
    assert(findings.length === 0, `expected no findings in the real project, got ${JSON.stringify(findings)}`);
  });

  await test('android-project: a well-formed temp fixture passes', () => {
    const dir = makeTempDir();
    try {
      writeValidFixture(dir);
      const findings = checkAndroidProject(dir);
      assert(findings.length === 0, `expected no findings on a valid fixture, got ${JSON.stringify(findings)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  const mutationCases: readonly {
    name: string;
    file: string;
    content: () => string;
    expectFile: string;
    matches: RegExp;
  }[] = [
    {
      name: 'a VIEW intent-filter without autoVerify fails',
      file: ANDROID_MANIFEST_PATH,
      content: () => manifest({ autoVerify: false, host: '${whimWebHost}' }),
      expectFile: ANDROID_MANIFEST_PATH,
      matches: /autoVerify/,
    },
    {
      name: 'an app-link filter on an activity other than the launcher fails',
      file: ANDROID_MANIFEST_PATH,
      content: () => manifest({ autoVerify: true, host: '${whimWebHost}', linkActivity: '.LinkActivity' }),
      expectFile: ANDROID_MANIFEST_PATH,
      matches: /VIEW intent-filter/,
    },
    {
      name: 'a literal host instead of the ${whimWebHost} placeholder fails',
      file: ANDROID_MANIFEST_PATH,
      content: () => manifest({ autoVerify: true, host: 'whim.example.com' }),
      expectFile: ANDROID_MANIFEST_PATH,
      matches: /host/,
    },
    {
      name: 'a main config with a cleartext domain-config fails (discriminating: a check of base-config alone would miss it)',
      file: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      content: () => MAIN_NETWORK_CONFIG_WITH_CLEARTEXT_DOMAIN,
      expectFile: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      matches: /./,
    },
  ];

  for (const c of mutationCases) {
    await test(`android-project: ${c.name}`, () => {
      const dir = makeTempDir();
      try {
        writeValidFixture(dir);
        writeFile(dir, c.file, c.content());
        const findings = checkAndroidProject(dir);
        const hit = findings.find((f) => f.file === c.expectFile && c.matches.test(f.message));
        assert(!!hit, `expected a finding on ${c.expectFile} matching ${c.matches}, got ${JSON.stringify(findings)}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}
