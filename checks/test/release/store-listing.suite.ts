/**
 * Acceptance for `scripts/release/lib/store-listing.ts` (chain-8, platform-release-readiness).
 * specs/store-listing/spec.md (all requirements); design.md D11; task 9.5. The privacy
 * declaration cases cover legal-surface-v2 spec store-privacy-declarations (task 8.1).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, assert } from '../harness';
import {
  checkDiagnosticsDisclosure,
  checkStoreListing,
  diagnosticsTransportFile,
  type DiagnosticsDisclosureModules,
} from '../../../scripts/release/lib/store-listing';
import { MANIFESTS, latestVersion, type DisclosureManifest } from '../../../contract/src/disclosure-manifest';
import { loadNativeReleaseConfig, type NativeReleaseConfig } from '../../../scripts/release/lib/native-config';

const REPO_ROOT = process.cwd();

const FIXTURE_CONFIG: NativeReleaseConfig = {
  WHIM_APP_ID: 'com.anycognition.whim',
  WHIM_APPLE_TEAM_ID: '2B7K4YLS34',
  WHIM_MARKETING_VERSION: '1.0.0',
  WHIM_BUILD_NUMBER: '1',
  WHIM_DOMAIN: 'example.com',
};

const AGE_RATING_JSON = JSON.stringify({ ageRatingOverrideV2: 'THIRTEEN_PLUS', contentDescriptors: {}, unrestrictedWebAccess: false, gambling: false });

const APP_PRIVACY_PATH = 'release/store/app-store/app-privacy.json';
const DATA_SAFETY_PATH = 'release/store/play/data-safety.json';
const PRIVACY_MANIFEST_PATH = 'ios/Whim/PrivacyInfo.xcprivacy';
const ANSWERS_PATH = 'release/store/answers.md';

/** The committed privacy declarations, written from draft-copy §4 rather than from the checker's
 *  own mapping code, so a misunderstanding in the checker can't be copied into its fixture. */
function committed(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

/** `text` with the one match of `pattern` replaced; throws when there isn't exactly one match,
 *  because a fixture that silently didn't change would prove nothing. */
function replaceOnce(text: string, pattern: RegExp, replacement: string): string {
  const matches = text.match(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`)) ?? [];
  if (matches.length !== 1) throw new Error(`fixture setup bug: ${String(pattern)} matched ${matches.length} times, expected 1`);
  return text.replace(pattern, replacement);
}

type AppPrivacyEntry = { category: string; purposes: string[]; data_protections: string[] };

/** The committed `app-privacy.json` with `edit` applied to its entries. */
function editedAppPrivacy(edit: (entries: AppPrivacyEntry[]) => AppPrivacyEntry[]): string {
  return JSON.stringify(edit(JSON.parse(committed(APP_PRIVACY_PATH)) as AppPrivacyEntry[]));
}

function withProtections(category: string, protections: (had: string[]) => string[]): (entries: AppPrivacyEntry[]) => AppPrivacyEntry[] {
  return (entries) => {
    if (!entries.some((e) => e.category === category)) throw new Error(`fixture setup bug: app-privacy.json has no ${category}`);
    return entries.map((e) => (e.category === category ? { ...e, data_protections: protections(e.data_protections) } : e));
  };
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
    [APP_PRIVACY_PATH]: committed(APP_PRIVACY_PATH),
    'release/store/app-store/age-rating.json': AGE_RATING_JSON,
    'release/store/play/en-US/title.txt': 'Whim: Small Apps You Describe',
    'release/store/play/en-US/short_description.txt': 'Describe an app out loud. Whim keeps it on your phone.',
    'release/store/play/en-US/full_description.txt': 'Whim turns a spoken description into a small app that stays on your phone.',
    'release/store/play/en-US/changelogs/default.txt': 'First release.',
    [DATA_SAFETY_PATH]: committed(DATA_SAFETY_PATH),
    [ANSWERS_PATH]: committed(ANSWERS_PATH),
    'release/store/app-store/review_information/notes.txt': 'How to try Whim: describe an app, review the plan, build it.',
    [PRIVACY_MANIFEST_PATH]: committed(PRIVACY_MANIFEST_PATH),
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

// ── Diagnostics disclosure (developer-observability task 5.2) ──

const TRANSPORT_PATH = 'src/host/logging/diagnostics-transport.ts';
const PRIVACY_PAGE_PATHS = ['deploy/site/privacy.html', 'deploy/site/fr/privacy.html'];
const DISCLOSURE_MANIFEST_PATH = 'contract/src/disclosure-manifest.ts';

/** A device module that posts to the diagnostics route, plus the committed privacy pages the check then reads. */
function withTransport(text: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    [TRANSPORT_PATH]: 'export function send(base: string, body: string) { return fetch(`${base}/v1/diagnostics`, { method: "POST", body }); }\n',
    ...Object.fromEntries(PRIVACY_PAGE_PATHS.map((p) => [p, committed(p)])),
    ...text,
  };
}

/** The committed privacy manifest without the `NSPrivacyCollectedDataTypes` entry for `type`. */
function manifestWithout(xml: string, type: string): string {
  const anchor = xml.indexOf(`<string>${type}</string>`);
  if (anchor === -1) throw new Error(`fixture setup bug: the privacy manifest has no ${type}`);
  return xml.slice(0, xml.lastIndexOf('<dict>', anchor)) + xml.slice(xml.indexOf('</dict>', anchor) + '</dict>'.length);
}

/** Every committed store declaration with its crash and diagnostics entries removed, all four files together. */
function declarationsWithoutDiagnostics(): Record<string, string> {
  const appPrivacy = editedAppPrivacy((entries) => entries.filter((e) => e.category !== 'CRASH_DATA' && e.category !== 'OTHER_DIAGNOSTIC_DATA'));
  const dataSafety = JSON.parse(committed(DATA_SAFETY_PATH)) as { types: { id: string }[] };
  const answersLines = committed(ANSWERS_PATH).split('\n');
  const answers = answersLines.filter((line) => !(line.startsWith('|') && /error details/i.test(line)));
  if (answersLines.length - answers.length !== 4) throw new Error('fixture setup bug: answers.md should have four error-details rows');
  return {
    [APP_PRIVACY_PATH]: appPrivacy,
    [DATA_SAFETY_PATH]: JSON.stringify({ ...dataSafety, types: dataSafety.types.filter((t) => t.id !== 'crash_logs' && t.id !== 'diagnostics') }),
    [PRIVACY_MANIFEST_PATH]: manifestWithout(manifestWithout(committed(PRIVACY_MANIFEST_PATH), 'NSPrivacyCollectedDataTypeCrashData'), 'NSPrivacyCollectedDataTypeOtherDiagnosticData'),
    [ANSWERS_PATH]: answers.join('\n'),
  };
}

/** The current manifest with its error-details category gone, as a manifest that stopped mapping diagnostics would be. */
function manifestWithoutErrorDetails(): DisclosureManifest {
  const current = MANIFESTS[latestVersion()];
  return { ...current, categories: current.categories.filter((c) => c.id !== 'error-details') };
}

const SOME_CONSENT_TEXT = { en: 'Error details when something goes wrong.', fr: 'Détails d’erreur quand quelque chose ne va pas.' };

function diagnosticsMessages(dir: string, modules?: DiagnosticsDisclosureModules): string[] {
  return checkDiagnosticsDisclosure(dir, modules).map((f) => `${f.file}: ${f.message}`);
}

export async function run(): Promise<void> {
  await test('store-listing: the real repo passes with zero findings', () => {
    const findings = checkStoreListing(REPO_ROOT, loadNativeReleaseConfig(REPO_ROOT));
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

  await test('store-privacy: declarations that mark every type Linked pass', () => {
    const appPrivacy = JSON.parse(committed(APP_PRIVACY_PATH)) as AppPrivacyEntry[];
    const manifest = committed(PRIVACY_MANIFEST_PATH);
    const manifestTypes = manifest.match(/<key>NSPrivacyCollectedDataType<\/key>/g) ?? [];
    const manifestLinked = manifest.match(/<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>/g) ?? [];
    assert(appPrivacy.length > 0 && appPrivacy.every((e) => e.data_protections.includes('DATA_LINKED_TO_YOU')), 'fixture precondition: every app-privacy.json entry is DATA_LINKED_TO_YOU');
    assert(manifestTypes.length > 0 && manifestLinked.length === manifestTypes.length, 'fixture precondition: every privacy-manifest type is Linked');
    withFixtureRepo({}, (dir) => {
      const messages = messagesFor(dir);
      assert(messages.length === 0, `expected all-Linked declarations to pass, got ${JSON.stringify(messages)}`);
    });
  });

  await test('store-privacy: the privacy manifest marking the device ID not Linked fails, naming the file and the type', () => {
    const manifest = replaceOnce(
      committed(PRIVACY_MANIFEST_PATH),
      /(<string>NSPrivacyCollectedDataTypeDeviceID<\/string>\s*<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*)<true\/>/,
      '$1<false/>',
    );
    withFixtureRepo({ text: { [PRIVACY_MANIFEST_PATH]: manifest } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.startsWith(`${PRIVACY_MANIFEST_PATH}: `) && m.includes('NSPrivacyCollectedDataTypeDeviceID') && m.includes('linked=false')),
        `expected a not-Linked finding naming ${PRIVACY_MANIFEST_PATH} and NSPrivacyCollectedDataTypeDeviceID, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-privacy: app-privacy.json declaring DEVICE_ID not linked fails, naming the file and the type', () => {
    const appPrivacy = editedAppPrivacy(withProtections('DEVICE_ID', () => ['DATA_NOT_LINKED_TO_YOU']));
    withFixtureRepo({ text: { [APP_PRIVACY_PATH]: appPrivacy } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.startsWith(`${APP_PRIVACY_PATH}: `) && m.includes('DEVICE_ID') && m.includes('linked=false')),
        `expected a not-linked finding naming ${APP_PRIVACY_PATH} and DEVICE_ID, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-privacy: app-privacy.json marking a type DATA_USED_TO_TRACK_YOU fails, naming the file and the type', () => {
    const appPrivacy = editedAppPrivacy(withProtections('DEVICE_ID', (had) => [...had, 'DATA_USED_TO_TRACK_YOU']));
    withFixtureRepo({ text: { [APP_PRIVACY_PATH]: appPrivacy } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.startsWith(`${APP_PRIVACY_PATH}: `) && m.includes('DEVICE_ID') && m.includes('tracking')),
        `expected a tracking finding naming ${APP_PRIVACY_PATH} and DEVICE_ID, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-privacy: the privacy manifest marking a type used for tracking fails, naming the file and the type', () => {
    const manifest = replaceOnce(
      committed(PRIVACY_MANIFEST_PATH),
      /(<string>NSPrivacyCollectedDataTypeProductInteraction<\/string>\s*<key>NSPrivacyCollectedDataTypeLinked<\/key>\s*<true\/>\s*<key>NSPrivacyCollectedDataTypeTracking<\/key>\s*)<false\/>/,
      '$1<true/>',
    );
    withFixtureRepo({ text: { [PRIVACY_MANIFEST_PATH]: manifest } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.startsWith(`${PRIVACY_MANIFEST_PATH}: `) && m.includes('NSPrivacyCollectedDataTypeProductInteraction') && m.includes('tracking')),
        `expected a tracking finding naming ${PRIVACY_MANIFEST_PATH} and the product-interaction type, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-privacy: answers.md answering "Used to track you" Yes fails, naming the file and the type', () => {
    const answers = replaceOnce(committed(ANSWERS_PATH), /(\| Crash Data \| Yes \| )No( \|)/, '$1Yes$2');
    withFixtureRepo({ text: { [ANSWERS_PATH]: answers } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.startsWith(`${ANSWERS_PATH}: `) && m.includes('Crash Data') && m.includes('tracking')),
        `expected a tracking finding naming ${ANSWERS_PATH} and Crash Data, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-privacy: data-safety.json omitting error details fails, naming the file and the error-details category', () => {
    const dataSafety = JSON.parse(committed(DATA_SAFETY_PATH)) as { types: { id: string }[] };
    const kept = dataSafety.types.filter((t) => t.id !== 'crash_logs' && t.id !== 'diagnostics');
    assert(kept.length === dataSafety.types.length - 2, 'fixture precondition: data-safety.json declares crash_logs and diagnostics');
    withFixtureRepo({ text: { [DATA_SAFETY_PATH]: JSON.stringify({ ...dataSafety, types: kept }) } }, (dir) => {
      const messages = messagesFor(dir).filter((m) => m.startsWith(`${DATA_SAFETY_PATH}: `) && m.includes('error-details'));
      assert(
        messages.some((m) => m.includes('crash_logs')) && messages.some((m) => m.includes('diagnostics')),
        `expected missing-type findings naming ${DATA_SAFETY_PATH}, crash_logs, diagnostics and error-details, got ${JSON.stringify(messagesFor(dir))}`,
      );
    });
  });

  await test('store-privacy: answers.md calling error details Required fails, naming the file and the type (error details are optional)', () => {
    const answers = replaceOnce(committed(ANSWERS_PATH), /(\| Crash logs \(error details\) \| Yes \| No \| No \| )Optional( \|)/, '$1Required$2');
    withFixtureRepo({ text: { [ANSWERS_PATH]: answers } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.startsWith(`${ANSWERS_PATH}: `) && m.includes('Crash logs') && m.includes('optional=false')),
        `expected a required-or-optional finding naming ${ANSWERS_PATH} and Crash logs, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-privacy: app-privacy.json declaring a type the mapping does not give fails, naming the file and the type', () => {
    const appPrivacy = editedAppPrivacy((entries) => [...entries, { category: 'EMAIL_ADDRESS', purposes: ['APP_FUNCTIONALITY'], data_protections: ['DATA_LINKED_TO_YOU'] }]);
    withFixtureRepo({ text: { [APP_PRIVACY_PATH]: appPrivacy } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.startsWith(`${APP_PRIVACY_PATH}: `) && m.includes('EMAIL_ADDRESS')),
        `expected an unexpected-type finding naming ${APP_PRIVACY_PATH} and EMAIL_ADDRESS, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-privacy: a privacy manifest that drops the device ID fails, naming the file, the type and the phone-id category', () => {
    const full = committed(PRIVACY_MANIFEST_PATH);
    const anchor = full.indexOf('<string>NSPrivacyCollectedDataTypeDeviceID</string>');
    assert(anchor !== -1, 'fixture precondition: the privacy manifest declares the device ID');
    const manifest = full.slice(0, full.lastIndexOf('<dict>', anchor)) + full.slice(full.indexOf('</dict>', anchor) + '</dict>'.length);
    withFixtureRepo({ text: { [PRIVACY_MANIFEST_PATH]: manifest } }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.startsWith(`${PRIVACY_MANIFEST_PATH}: `) && m.includes('NSPrivacyCollectedDataTypeDeviceID') && m.includes('phone-id')),
        `expected a missing-type finding naming ${PRIVACY_MANIFEST_PATH}, the device ID type and phone-id, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-diagnostics: the transport is found by its route or its seam name, and a mention in a test is not a build that sends diagnostics', () => {
    withFixtureRepo({ text: { 'src/host/logging/test/transport.suite.ts': 'post("/v1/diagnostics")\n' } }, (dir) => {
      assert(diagnosticsTransportFile(dir) === undefined, `a test file must not count as the transport, got ${String(diagnosticsTransportFile(dir))}`);
    });
    withFixtureRepo({ text: withTransport() }, (dir) => {
      assert(diagnosticsTransportFile(dir) === TRANSPORT_PATH, `expected the route to mark ${TRANSPORT_PATH}, got ${String(diagnosticsTransportFile(dir))}`);
    });
    withFixtureRepo({ text: { 'src/host/logging/index.ts': 'export const seam = createSeam({ sinks: [devSink, diagnosticsTransport] });\n' } }, (dir) => {
      assert(diagnosticsTransportFile(dir) === 'src/host/logging/index.ts', `expected the seam name to mark the file, got ${String(diagnosticsTransportFile(dir))}`);
    });
  });

  await test('store-diagnostics: with the transport in the build, the committed declarations pass: the Play form, privacy manifest and App Store answers declare the same diagnostics types', () => {
    withFixtureRepo({ text: withTransport() }, (dir) => {
      const messages = messagesFor(dir);
      assert(messages.length === 0, `expected the committed declarations to cover diagnostics, got ${JSON.stringify(messages)}`);
    });
  });

  await test('store-diagnostics: with the transport in the build, a privacy manifest without the diagnostics entry fails, naming the manifest and the transport', () => {
    const manifest = manifestWithout(committed(PRIVACY_MANIFEST_PATH), 'NSPrivacyCollectedDataTypeOtherDiagnosticData');
    withFixtureRepo({ text: withTransport({ [PRIVACY_MANIFEST_PATH]: manifest }) }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.startsWith(`${PRIVACY_MANIFEST_PATH}: `) && m.includes('NSPrivacyCollectedDataTypeOtherDiagnosticData') && m.includes(TRANSPORT_PATH)),
        `expected a finding naming ${PRIVACY_MANIFEST_PATH}, the diagnostics type and ${TRANSPORT_PATH}, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-diagnostics: a manifest that stops mapping error details, with every declaration dropping them too, still fails once the transport ships, naming each file', () => {
    const modules = { manifest: manifestWithoutErrorDetails(), consentText: SOME_CONSENT_TEXT };
    withFixtureRepo({ text: withTransport(declarationsWithoutDiagnostics()) }, (dir) => {
      const messages = diagnosticsMessages(dir, modules);
      for (const [file, type] of [
        [DISCLOSURE_MANIFEST_PATH, 'error-details'],
        [APP_PRIVACY_PATH, 'OTHER_DIAGNOSTIC_DATA'],
        [DATA_SAFETY_PATH, 'crash_logs'],
        [PRIVACY_MANIFEST_PATH, 'NSPrivacyCollectedDataTypeCrashData'],
        [ANSWERS_PATH, 'Crash Data'],
        [ANSWERS_PATH, 'Diagnostics'],
      ]) {
        assert(messages.some((m) => m.startsWith(`${file}: `) && m.includes(type)), `expected a finding naming ${file} and ${type}, got ${JSON.stringify(messages)}`);
      }
    });
    withFixtureRepo({ text: declarationsWithoutDiagnostics() }, (dir) => {
      const messages = diagnosticsMessages(dir, modules);
      assert(messages.length === 0, `without the transport the build sends no diagnostics, so nothing must be required; got ${JSON.stringify(messages)}`);
    });
  });

  await test('store-diagnostics: with the transport in the build, a consent screen naming no error details in one language fails, naming the copy file and the language', () => {
    withFixtureRepo({ text: withTransport() }, (dir) => {
      const messages = diagnosticsMessages(dir, { manifest: MANIFESTS[latestVersion()], consentText: { ...SOME_CONSENT_TEXT, fr: '' } });
      assert(
        messages.length === 1 && messages[0].startsWith('src/host/launcher/copy.ts: ') && messages[0].includes('fr consent screen'),
        `expected one finding naming src/host/launcher/copy.ts and fr, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-diagnostics: with the transport in the build, a privacy page that keeps no error-details period fails, naming the page', () => {
    const page = replaceOnce(committed('deploy/site/fr/privacy.html'), /data-keep="error-details connection-logs"/, 'data-keep="connection-logs"');
    withFixtureRepo({ text: withTransport({ 'deploy/site/fr/privacy.html': page }) }, (dir) => {
      const messages = messagesFor(dir);
      assert(
        messages.some((m) => m.startsWith('deploy/site/fr/privacy.html: ') && m.includes('data-keep="error-details"')),
        `expected a finding naming deploy/site/fr/privacy.html and its data-keep row, got ${JSON.stringify(messages)}`,
      );
    });
  });

  await test('store-listing: neither committed description says "analytics" or "anonymous", and the review notes name OpenRouter only in the reviewer paragraph', () => {
    for (const file of ['release/store/app-store/en-US/description.txt', 'release/store/play/en-US/full_description.txt']) {
      const text = committed(file);
      assert(!/analytics|anonymous/i.test(text), `${file} must not say "analytics" or "anonymous"`);
    }
    const notes = committed('release/store/app-store/review_information/notes.txt');
    const reviewerParagraph = notes.indexOf('WHAT LEAVES THE PHONE, AND WHEN');
    assert(reviewerParagraph !== -1, 'notes.txt has no "WHAT LEAVES THE PHONE, AND WHEN" paragraph');
    assert(notes.slice(reviewerParagraph).includes('OpenRouter'), 'the reviewer paragraph must name OpenRouter');
    assert(!notes.slice(0, reviewerParagraph).includes('OpenRouter'), 'notes.txt must name OpenRouter only in the reviewer paragraph');
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
