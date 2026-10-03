/**
 * Acceptance for `scripts/release/lib/android-project.ts` (chain-4, platform-release-readiness).
 * specs/app-links/spec.md "The Android app verifies and delivers app links";
 * specs/native-release-config/spec.md "Store builds carry no cleartext exception" as beta-1 D20
 * amends it (cleartext at the base, no per-host rules); task 5.6.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, assert } from '../harness';
import {
  checkAndroidProject,
  ANDROID_MANIFEST_PATH,
  ANDROID_MAIN_NETWORK_CONFIG_PATH,
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

const MAIN_NETWORK_CONFIG = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<network-security-config>',
  '    <base-config cleartextTrafficPermitted="true"/>',
  '</network-security-config>',
  '',
].join('\n');

/** The pre-D20 store config: cleartext to no host, so a user's LAN server is unreachable. */
const MAIN_NETWORK_CONFIG_WITHOUT_CLEARTEXT = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<network-security-config>',
  '    <base-config cleartextTrafficPermitted="false"/>',
  '</network-security-config>',
  '',
].join('\n');

/** Cleartext to a fixed host list only, as the deleted dev config did: it carries a cleartext permit, but
 *  an arbitrary LAN IP stays unreachable. */
const MAIN_NETWORK_CONFIG_WITH_HOST_LIST = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<network-security-config>',
  '    <base-config cleartextTrafficPermitted="false"/>',
  '    <domain-config cleartextTrafficPermitted="true">',
  '        <domain includeSubdomains="false">10.0.2.2</domain>',
  '    </domain-config>',
  '</network-security-config>',
  '',
].join('\n');

/** Cleartext at the base, then refused again for one host by a <domain-config>. */
const MAIN_NETWORK_CONFIG_WITH_OVERRIDE = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<network-security-config>',
  '    <base-config cleartextTrafficPermitted="true"/>',
  '    <domain-config cleartextTrafficPermitted="false">',
  '        <domain includeSubdomains="false">192.168.1.20</domain>',
  '    </domain-config>',
  '</network-security-config>',
  '',
].join('\n');

function writeValidFixture(root: string): void {
  writeFile(root, ANDROID_MANIFEST_PATH, VALID_MANIFEST);
  writeFile(root, ANDROID_MAIN_NETWORK_CONFIG_PATH, MAIN_NETWORK_CONFIG);
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
      name: 'a main config that refuses cleartext at the base fails',
      file: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      content: () => MAIN_NETWORK_CONFIG_WITHOUT_CLEARTEXT,
      expectFile: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      matches: /base-config/,
    },
    {
      name: 'a main config permitting cleartext to a host list only fails (discriminating: a check for any cleartext permit would pass it)',
      file: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      content: () => MAIN_NETWORK_CONFIG_WITH_HOST_LIST,
      expectFile: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      matches: /base-config/,
    },
    {
      name: 'a build-variant network config that would replace the main one fails',
      file: 'android/app/src/debug/res/xml/network_security_config.xml',
      content: () => MAIN_NETWORK_CONFIG_WITH_HOST_LIST,
      expectFile: 'android/app/src/debug/res/xml/network_security_config.xml',
      matches: /replace/,
    },
    {
      name: 'a main config overriding the base for one host fails',
      file: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      content: () => MAIN_NETWORK_CONFIG_WITH_OVERRIDE,
      expectFile: ANDROID_MAIN_NETWORK_CONFIG_PATH,
      matches: /domain-config/,
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
