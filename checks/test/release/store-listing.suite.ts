/**
 * Acceptance for `scripts/release/lib/store-listing.ts` (chain-8, platform-release-readiness).
 * specs/store-listing/spec.md (all requirements); design.md D11; task 9.5.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, assert } from '../harness';
import { checkStoreListing } from '../../../scripts/release/lib/store-listing';
import type { NativeReleaseConfig } from '../../../scripts/release/lib/native-config';

const REPO_ROOT = process.cwd();

const FIXTURE_CONFIG: NativeReleaseConfig = {
  WHIM_APP_ID: 'com.anycognition.whim',
  WHIM_APPLE_TEAM_ID: '2B7K4YLS34',
  WHIM_MARKETING_VERSION: '1.0.0',
  WHIM_BUILD_NUMBER: '1',
  WHIM_DOMAIN: 'example.com',
};

const APP_PRIVACY_JSON = JSON.stringify([
  { category: 'OTHER_USER_CONTENT', purposes: ['APP_FUNCTIONALITY'], data_protections: ['DATA_NOT_LINKED_TO_YOU'] },
  { category: 'DEVICE_ID', purposes: ['APP_FUNCTIONALITY'], data_protections: ['DATA_NOT_LINKED_TO_YOU'] },
]);

const AGE_RATING_JSON = JSON.stringify({ ageRatingOverrideV2: 'THIRTEEN_PLUS', contentDescriptors: {}, unrestrictedWebAccess: false, gambling: false });

const DATA_SAFETY_JSON = JSON.stringify({
  encryptedInTransit: true,
  deletionRequestMechanism: 'no account exists',
  types: [
    { id: 'other_user_generated_content', collected: true, shared: true, sharedWith: 'AI model providers through OpenRouter', optional: true, ephemeral: false, purposes: ['app_functionality'] },
    { id: 'device_or_other_ids', collected: true, shared: false, optional: true, ephemeral: false, purposes: ['app_functionality'] },
  ],
});

function privacyManifestXml(opts: { includeDeviceId?: boolean } = {}): string {
  const includeDeviceId = opts.includeDeviceId ?? true;
  const deviceIdEntry = includeDeviceId
    ? `
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeDeviceID</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<false/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
		</dict>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSPrivacyCollectedDataTypes</key>
	<array>
		<dict>
			<key>NSPrivacyCollectedDataType</key>
			<string>NSPrivacyCollectedDataTypeOtherUserContent</string>
			<key>NSPrivacyCollectedDataTypeLinked</key>
			<false/>
			<key>NSPrivacyCollectedDataTypeTracking</key>
			<false/>
		</dict>${deviceIdEntry}
	</array>
	<key>NSPrivacyTracking</key>
	<false/>
</dict>
</plist>
`;
}

/** A minimal PNG whose IHDR chunk declares `width`x`height` — the rest of the file is padding, since the checker reads only the header. */
function pngFixture(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  buf.write('\x89PNG\r\n\x1a\n', 0, 'binary');
  buf.writeUInt32BE(13, 8);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

/** Every file `checkStoreListing` requires or reads, with baseline content that passes every rule. */
function baselineFiles(): Record<string, string> {
  return {
    'release/store/app-store/en-US/name.txt': 'Whim: Small Apps You Describe',
    'release/store/app-store/en-US/subtitle.txt': 'No coding. Just talk.',
    'release/store/app-store/en-US/promotional_text.txt': 'Describe an app in your own words.',
    'release/store/app-store/en-US/description.txt': 'Whim turns a spoken description into a small app that stays on your phone.',
    'release/store/app-store/en-US/keywords.txt': 'ai app builder,no code,custom tool',
    'release/store/app-store/copyright.txt': '2026 AnyCognition Inc.',
    'release/store/app-store/primary_category.txt': 'PRODUCTIVITY',
    'release/store/app-store/secondary_category.txt': 'UTILITIES',
    'release/store/app-store/app-privacy.json': APP_PRIVACY_JSON,
    'release/store/app-store/age-rating.json': AGE_RATING_JSON,
    'release/store/play/en-US/title.txt': 'Whim: Small Apps You Describe',
    'release/store/play/en-US/short_description.txt': 'Describe an app out loud. Whim keeps it on your phone.',
    'release/store/play/en-US/full_description.txt': 'Whim turns a spoken description into a small app that stays on your phone.',
    'release/store/play/en-US/changelogs/default.txt': 'First release.',
    'release/store/play/data-safety.json': DATA_SAFETY_JSON,
    'release/store/answers.md': '# Draft answers\n\nSee the release for details.',
    'release/store/app-store/review_information/notes.txt': 'How to try Whim: describe an app, review the plan, build it.',
    'ios/Whim/PrivacyInfo.xcprivacy': privacyManifestXml(),
  };
}

interface FixtureOverrides {
  readonly text?: Record<string, string | undefined>; // undefined deletes the baseline file
  readonly binary?: Record<string, Buffer>;
}

/** Writes the baseline listing tree (plus overrides) under a fresh temp dir and runs `fn`, cleaning up after. */
function withFixtureRepo(overrides: FixtureOverrides, fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-store-listing-'));
  try {
    const files = { ...baselineFiles(), ...(overrides.text ?? {}) };
    for (const [relPath, content] of Object.entries(files)) {
      const abs = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (content === undefined) {
        fs.rmSync(abs, { force: true });
      } else {
        fs.writeFileSync(abs, content, 'utf8');
      }
    }
    for (const [relPath, buf] of Object.entries(overrides.binary ?? {})) {
      const abs = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buf);
    }
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function messagesFor(dir: string): string[] {
  return checkStoreListing(dir, FIXTURE_CONFIG).map((f) => `${f.file}: ${f.message}`);
}

export async function run(): Promise<void> {
  await test('store-listing: the real repo passes with zero findings', () => {
    const findings = checkStoreListing(REPO_ROOT, FIXTURE_CONFIG);
    assert(findings.length === 0, `expected no findings against the real repo, got ${JSON.stringify(findings)}`);
  });

  await test('store-listing: a well-formed fixture passes with zero findings (baseline for the defect cases below)', () => {
    withFixtureRepo({}, (dir) => {
      const findings = checkStoreListing(dir, FIXTURE_CONFIG);
      assert(findings.length === 0, `expected the baseline fixture to pass, got ${JSON.stringify(findings)}`);
    });
  });

  await test('store-listing: a 31-character subtitle fails, naming the file, the 30-character limit and the length 31', () => {
    withFixtureRepo({ text: { 'release/store/app-store/en-US/subtitle.txt': 'a'.repeat(31) } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('subtitle.txt') && m.includes('30-character') && m.includes('31')),
        `expected a subtitle length finding, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-listing: a committed support_url.txt fails, naming the file', () => {
    withFixtureRepo({ text: { 'release/store/app-store/en-US/support_url.txt': 'https://example.com/support' } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('support_url.txt')),
        `expected a URL-file finding, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-listing: the word "revolutionary" fails, naming the file and the word', () => {
    withFixtureRepo({ text: { 'release/store/play/en-US/full_description.txt': 'This is a revolutionary way to build apps.' } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('full_description.txt') && m.includes('revolutionary')),
        `expected a promotional-term finding, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-listing: an exclamation mark fails', () => {
    withFixtureRepo({ text: { 'release/store/app-store/en-US/promotional_text.txt': 'Describe an app!' } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('promotional_text.txt') && m.toLowerCase().includes('exclamation')),
        `expected an exclamation-mark finding, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-listing: a manifest that drops the device ID fails, naming app-privacy.json, PrivacyInfo.xcprivacy and the device ID type', () => {
    withFixtureRepo({ text: { 'ios/Whim/PrivacyInfo.xcprivacy': privacyManifestXml({ includeDeviceId: false }) } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('app-privacy.json') && m.includes('PrivacyInfo.xcprivacy') && m.includes('device ID')),
        `expected a device-ID disagreement finding, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-listing: a 1080x2400 Play screenshot fails, naming the file and its 2.22 aspect ratio', () => {
    withFixtureRepo({ binary: { 'release/store/play/en-US/images/phoneScreenshots/1.png': pngFixture(1080, 2400) } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('phoneScreenshots/1.png') && m.includes('2.22')),
        `expected an aspect-ratio finding, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-listing: a 4001-character review notes.txt fails, naming the file, the 4000-character limit and the length 4001', () => {
    withFixtureRepo({ text: { 'release/store/app-store/review_information/notes.txt': 'a'.repeat(4001) } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.includes('notes.txt') && m.includes('4000-character') && m.includes('4001')),
        `expected a notes.txt length finding, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test(
    'store-listing: keywords of 100 characters but 101 UTF-8 bytes fail (discriminating: a character-count check would pass this)',
    () => {
      const boundary = `${'a'.repeat(99)}é`; // 100 UTF-16 code units, 101 UTF-8 bytes (the trailing é is 2 bytes)
      assert(boundary.length === 100, `fixture setup bug: expected 100 characters, got ${boundary.length}`);
      withFixtureRepo({ text: { 'release/store/app-store/en-US/keywords.txt': boundary } }, (dir) => {
        const messages = messagesFor(dir);
        assert(
          messages.some((m) => m.includes('keywords.txt') && m.includes('100-byte') && m.includes('101')),
          `expected a byte-length finding, got ${JSON.stringify(messages)}`,
        );
      });
    },
  );
}
