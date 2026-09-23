/**
 * Acceptance for chain-9 (release-cli, openspec/changes/platform-release-readiness/chains.md,
 * tasks 10.1–10.6): `scripts/release/lib/{preflight,verify-aab,privacy-audit,
 * association-files,release-tag}.ts`. Every scenario here exercises only the pure half of each
 * module — snapshots, facts and fixture repos it builds itself — never shelling out to
 * keytool/aapt2/bundletool/xcrun/git (chains.md's suite-portability rule: only `git ls-files`
 * is allowed, and this suite doesn't even need that).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nodeAssert from 'node:assert';
import { test, assert } from '../harness';
import {
  evaluatePreflight,
  parseJdkMajorVersion,
  ANDROID_UPLOAD_VALUE_NAMES,
  type PreflightSnapshot,
} from '../../../scripts/release/lib/preflight';
import { parseFingerprintFile, aabFindings, type AabFacts, type AabExpected } from '../../../scripts/release/lib/verify-aab';
import {
  categoriesFor,
  auditFindings,
  declaredCategoriesFromManifest,
  ROOT_MANIFEST_KEY,
  type AuditBinaryFacts,
  type AuditManifest,
} from '../../../scripts/release/lib/privacy-audit';
import { buildAasa, buildAssetLinks, buildAssociationFiles } from '../../../scripts/release/lib/association-files';
import { ensureReleaseTag, type GitRunner } from '../../../scripts/release/lib/release-tag';
import type { NativeReleaseConfig } from '../../../scripts/release/lib/native-config';

// ── preflight.ts: evaluatePreflight fixtures ────────────────────────────────────────────────

const FIXTURE_CONFIG: NativeReleaseConfig = {
  WHIM_APP_ID: 'com.anycognition.whim',
  WHIM_APPLE_TEAM_ID: '2B7K4YLS34',
  WHIM_MARKETING_VERSION: '1.0.0',
  WHIM_BUILD_NUMBER: '1',
  WHIM_DOMAIN: 'anycognition.ca',
};

/** A fully clean snapshot — every scenario below overrides only the field(s) it's testing. */
function baseSnapshot(overrides: Partial<PreflightSnapshot> = {}): PreflightSnapshot {
  return {
    platform: 'android',
    gitStatusPorcelain: '',
    nodeMajorVersion: 22,
    jdkMajorVersion: 21,
    xcodebuildPresent: undefined,
    credentialFiles: [],
    extraCredentialFiles: [],
    androidUploadValues: ANDROID_UPLOAD_VALUE_NAMES.map((name) => ({ name, present: true })),
    config: FIXTURE_CONFIG,
    buildNumber: 369360,
    storeLatestBuildNumber: 100,
    nativeLiteralFindings: [],
    iosProjectFindings: undefined,
    androidProjectFindings: [],
    assetFindings: [],
    storeListingFindings: [],
    ...overrides,
  };
}

const PASS_OPTIONS = { allowPlaceholderDomain: false };

export async function run(): Promise<void> {
  await test('preflight: a fully clean snapshot passes with zero findings (baseline for the defect cases below)', () => {
    const findings = evaluatePreflight(baseSnapshot(), PASS_OPTIONS);
    assert(findings.length === 0, `expected the baseline snapshot to pass, got ${JSON.stringify(findings)}`);
  });

  await test('preflight: a dirty tree plus a 0644 credential file lists both, each with its fix', () => {
    const snapshot = baseSnapshot({
      gitStatusPorcelain: ' M some/file.ts\n',
      credentialFiles: [{ path: '/home/ops/.config/whim/play-publisher.json', exists: true, mode: 0o644 }],
    });
    const findings = evaluatePreflight(snapshot, PASS_OPTIONS);
    assert(findings.some((f) => f.reason.includes('uncommitted changes')), `expected a dirty-tree finding, got ${JSON.stringify(findings)}`);
    assert(
      findings.some((f) => f.reason.includes('play-publisher.json') && f.reason.includes('readable by group or others') && f.fix.includes('chmod 600')),
      `expected a credential-mode finding naming the file and a chmod fix, got ${JSON.stringify(findings)}`,
    );
    assert(findings.length === 2, `expected exactly these two findings, got ${JSON.stringify(findings)}`);
  });

  await test('preflight: a missing extra credential file (e.g. the .p8 or the upload keystore) names its label and path', () => {
    const snapshot = baseSnapshot({
      extraCredentialFiles: [{ label: 'App Store Connect API private key (asc-api-key.json\'s key_filepath)', file: { path: '/home/ops/.config/whim/AuthKey_ABC123.p8', exists: false, mode: null } }],
    });
    const findings = evaluatePreflight(snapshot, PASS_OPTIONS);
    assert(
      findings.some((f) => f.reason.includes('App Store Connect API private key') && f.reason.includes('AuthKey_ABC123.p8')),
      `expected a missing-.p8 finding naming its label and path, got ${JSON.stringify(findings)}`,
    );
  });

  for (const c of [
    { label: 'Android upload keystore (WHIM_UPLOAD_STORE_FILE)', path: '/home/ops/.config/whim/whim-upload.jks', named: ['Android upload keystore', 'whim-upload.jks'] },
    { label: '~/.gradle/gradle.properties (holds WHIM_UPLOAD_* secrets)', path: '/home/ops/.gradle/gradle.properties', named: ['gradle.properties', 'WHIM_UPLOAD_*'] },
  ]) {
    await test(`preflight: a group-readable extra credential file (${c.label}) fails with a chmod fix`, () => {
      const snapshot = baseSnapshot({
        extraCredentialFiles: [{ label: c.label, file: { path: c.path, exists: true, mode: 0o644 } }],
      });
      const findings = evaluatePreflight(snapshot, PASS_OPTIONS);
      assert(
        findings.some((f) => c.named.every((token) => f.reason.includes(token)) && f.fix.includes('chmod 600')),
        `expected a ${c.label} mode finding with a chmod fix, got ${JSON.stringify(findings)}`,
      );
    });
  }

  await test('preflight: the JDK major version is read from the stderr banner java -version actually prints', () => {
    // Taken from a real `java -version` run of the pinned Temurin/Homebrew JDK 21 on 2026-09-22;
    // the whole banner arrives on stderr, stdout is empty.
    const banner = [
      'openjdk version "21.0.12" 2026-07-21',
      'OpenJDK Runtime Environment Homebrew (build 21.0.12)',
      'OpenJDK 64-Bit Server VM Homebrew (build 21.0.12, mixed mode, sharing)',
    ].join('\n');
    nodeAssert.strictEqual(parseJdkMajorVersion(`\n${banner}`), 21);
    nodeAssert.strictEqual(parseJdkMajorVersion('openjdk version "24.0.1" 2026-04-15'), 24);
    nodeAssert.strictEqual(parseJdkMajorVersion(''), undefined, 'an empty stdout-only read must not pass as a JDK');
  });

  await test('preflight: the placeholder domain refuses, naming that no server is reachable', () => {
    const snapshot = baseSnapshot({ config: { ...FIXTURE_CONFIG, WHIM_DOMAIN: 'example.com' } });
    const findings = evaluatePreflight(snapshot, PASS_OPTIONS);
    assert(
      findings.some((f) => f.reason.includes('example.com') && f.reason.includes("couldn't reach any server")),
      `expected a placeholder-domain finding, got ${JSON.stringify(findings)}`,
    );
  });

  await test('preflight: the placeholder domain passes once --allow-placeholder-domain is set', () => {
    const snapshot = baseSnapshot({ config: { ...FIXTURE_CONFIG, WHIM_DOMAIN: 'example.com' } });
    const findings = evaluatePreflight(snapshot, { allowPlaceholderDomain: true });
    assert(findings.length === 0, `expected the override to clear the placeholder-domain finding, got ${JSON.stringify(findings)}`);
  });

  await test('preflight: a store build number at or below the store\'s latest names both numbers', () => {
    const snapshot = baseSnapshot({ buildNumber: 369360, storeLatestBuildNumber: 369400 });
    const findings = evaluatePreflight(snapshot, PASS_OPTIONS);
    assert(
      findings.some((f) => f.reason.includes('369360') && f.reason.includes('369400')),
      `expected a finding naming both build numbers, got ${JSON.stringify(findings)}`,
    );
  });

  await test('preflight: Android with no upload values lists all four WHIM_UPLOAD_* names', () => {
    const snapshot = baseSnapshot({ androidUploadValues: ANDROID_UPLOAD_VALUE_NAMES.map((name) => ({ name, present: false })) });
    const findings = evaluatePreflight(snapshot, PASS_OPTIONS);
    const hit = findings.find((f) => f.reason.startsWith('Android release build is missing'));
    assert(hit !== undefined, `expected a missing-upload-values finding, got ${JSON.stringify(findings)}`);
    for (const name of ANDROID_UPLOAD_VALUE_NAMES) {
      assert(hit!.reason.includes(name), `expected the finding to name ${name}, got ${JSON.stringify(hit)}`);
    }
  });

  await test('preflight: a repo-check finding (e.g. a stale asset) is passed through with its own fix', () => {
    const snapshot = baseSnapshot({ assetFindings: [{ path: 'release/assets/generated.json', message: 'is missing; run generate-assets' }] });
    const findings = evaluatePreflight(snapshot, PASS_OPTIONS);
    assert(
      findings.some((f) => f.reason.includes('release/assets/generated.json') && f.fix.includes('generate-assets')),
      `expected the asset finding to surface, got ${JSON.stringify(findings)}`,
    );
  });

  // ── verify-aab.ts ──────────────────────────────────────────────────────────────────────────

  await test('verify-aab: parseFingerprintFile accepts 32 colon-separated hex bytes, normalized to uppercase', () => {
    const fp = 'de:63:fd:cd:39:a3:c9:b8:e4:1e:9c:ad:98:21:c5:51:51:04:fa:17:cd:b9:f0:9f:8f:23:96:73:cd:cb:99:d1';
    assert(parseFingerprintFile(`${fp}\n`) === fp.toUpperCase(), 'expected the fingerprint normalized to uppercase');
  });

  await test('verify-aab: parseFingerprintFile rejects a malformed fingerprint', () => {
    let threw = false;
    try {
      parseFingerprintFile('not-a-fingerprint');
      // eslint-disable-next-line no-restricted-syntax -- intentional: this test asserts ONLY that a malformed fingerprint throws; the error itself is not the assertion
    } catch {
      threw = true;
    }
    assert(threw, 'expected a malformed fingerprint file to throw');
  });

  const EXPECTED_AAB: AabExpected = { packageName: 'com.anycognition.whim', versionCode: 369360, signerFingerprint: 'DE:63:FD:CD:39:A3:C9:B8:E4:1E:9C:AD:98:21:C5:51:51:04:FA:17:CD:B9:F0:9F:8F:23:96:73:CD:CB:99:D1' };
  const PASSING_AAB_FACTS: AabFacts = {
    manifest: { packageName: EXPECTED_AAB.packageName, versionCode: EXPECTED_AAB.versionCode, debuggable: false },
    signerFingerprint: EXPECTED_AAB.signerFingerprint,
  };

  await test('verify-aab: aabFindings passes a matching, non-debuggable AAB', () => {
    assert(aabFindings(PASSING_AAB_FACTS, EXPECTED_AAB).length === 0, 'expected no findings for a matching AAB');
  });

  await test('verify-aab: aabFindings flags a debuggable manifest', () => {
    const facts: AabFacts = { ...PASSING_AAB_FACTS, manifest: { ...PASSING_AAB_FACTS.manifest, debuggable: true } };
    assert(aabFindings(facts, EXPECTED_AAB).some((f) => f.reason.includes('debuggable')), 'expected a debuggable finding');
  });

  await test('verify-aab: aabFindings flags a wrong applicationId', () => {
    const facts: AabFacts = { ...PASSING_AAB_FACTS, manifest: { ...PASSING_AAB_FACTS.manifest, packageName: 'com.whim' } };
    assert(aabFindings(facts, EXPECTED_AAB).some((f) => f.reason.includes('com.whim') && f.reason.includes(EXPECTED_AAB.packageName)), 'expected a package-mismatch finding naming both');
  });

  await test('verify-aab: aabFindings flags a version code that is not the run\'s build number', () => {
    const facts: AabFacts = { ...PASSING_AAB_FACTS, manifest: { ...PASSING_AAB_FACTS.manifest, versionCode: 100 } };
    assert(aabFindings(facts, EXPECTED_AAB).some((f) => f.reason.includes('100') && f.reason.includes('369360')), 'expected a version-code finding naming both');
  });

  await test('verify-aab: aabFindings signed with the debug fingerprint shows expected and actual', () => {
    const debugFingerprint = 'AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA';
    const facts: AabFacts = { ...PASSING_AAB_FACTS, signerFingerprint: debugFingerprint };
    const findings = aabFindings(facts, EXPECTED_AAB);
    assert(
      findings.some((f) => f.reason.includes(debugFingerprint) && f.reason.includes(EXPECTED_AAB.signerFingerprint)),
      `expected a fingerprint-mismatch finding naming both, got ${JSON.stringify(findings)}`,
    );
  });

  // ── privacy-audit.ts ───────────────────────────────────────────────────────────────────────

  await test('privacy-audit: categoriesFor classifies raw mach-o import "_statfs" as DiskSpace', () => {
    const hits = categoriesFor(['_statfs'], []);
    assert(
      hits.length === 1 && hits[0].category === 'DiskSpace' && hits[0].referencingName === '_statfs',
      `expected exactly one DiskSpace hit naming "_statfs", got ${JSON.stringify(hits)}`,
    );
  });

  await test('privacy-audit: categoriesFor classifies the raw mach-o class symbol "_OBJC_CLASS_$_NSUserDefaults" as UserDefaults', () => {
    const hits = categoriesFor(['_OBJC_CLASS_$_NSUserDefaults'], []);
    assert(
      hits.some((h) => h.category === 'UserDefaults' && h.referencingName === '_OBJC_CLASS_$_NSUserDefaults'),
      `expected a UserDefaults hit naming the class symbol, got ${JSON.stringify(hits)}`,
    );
  });

  await test('privacy-audit: declaredCategoriesFromManifest reads NSPrivacyAccessedAPICategoryDiskSpace as DiskSpace', () => {
    const categories = declaredCategoriesFromManifest(['NSPrivacyAccessedAPICategoryDiskSpace', 'NSPrivacyAccessedAPICategoryBogus']);
    assert(categories.length === 1 && categories[0] === 'DiskSpace', `expected only DiskSpace recognized, got ${JSON.stringify(categories)}`);
  });

  await test('privacy-audit: auditFindings flags the main binary referencing statfs when no manifest declares DiskSpace', () => {
    const binaries: AuditBinaryFacts[] = [{ path: 'Whim', isMainBinary: true, manifestKey: undefined, hits: categoriesFor(['_statfs'], []) }];
    const manifests: AuditManifest[] = [{ key: ROOT_MANIFEST_KEY, declaredCategories: [] }];
    const findings = auditFindings(binaries, manifests);
    assert(
      findings.some((f) => f.reason.includes('DiskSpace') && f.reason.includes('_statfs')),
      `expected an undeclared-DiskSpace finding naming statfs, got ${JSON.stringify(findings)}`,
    );
  });

  await test('privacy-audit: auditFindings passes once the root manifest declares DiskSpace', () => {
    const binaries: AuditBinaryFacts[] = [{ path: 'Whim', isMainBinary: true, manifestKey: undefined, hits: categoriesFor(['_statfs'], []) }];
    const manifests: AuditManifest[] = [{ key: ROOT_MANIFEST_KEY, declaredCategories: ['DiskSpace'] }];
    assert(auditFindings(binaries, manifests).length === 0, 'expected no findings once the root manifest declares DiskSpace');
  });

  await test('privacy-audit: a framework\'s own manifest satisfies its own reference even when the root doesn\'t declare it', () => {
    const binaries: AuditBinaryFacts[] = [{ path: 'Frameworks/op_sqlite.framework/op_sqlite', isMainBinary: false, manifestKey: 'op_sqlite.framework', hits: categoriesFor(['_statfs'], []) }];
    const manifests: AuditManifest[] = [
      { key: ROOT_MANIFEST_KEY, declaredCategories: [] },
      { key: 'op_sqlite.framework', declaredCategories: ['DiskSpace'] },
    ];
    assert(auditFindings(binaries, manifests).length === 0, 'expected the framework\'s own manifest to cover its own reference');
  });

  await test('privacy-audit: a framework with neither its own manifest nor the root declaring the category fails', () => {
    const binaries: AuditBinaryFacts[] = [{ path: 'Frameworks/op_sqlite.framework/op_sqlite', isMainBinary: false, manifestKey: undefined, hits: categoriesFor(['_statfs'], []) }];
    const manifests: AuditManifest[] = [{ key: ROOT_MANIFEST_KEY, declaredCategories: [] }];
    assert(auditFindings(binaries, manifests).length === 1, 'expected exactly one undeclared-category finding');
  });

  // ── association-files.ts ──────────────────────────────────────────────────────────────────

  await test('association-files: the AASA and assetlinks shape for the real team (spec scenario)', () => {
    const aasa = buildAasa('2B7K4YLS34', 'com.anycognition.whim');
    nodeAssert.deepStrictEqual(aasa, { applinks: { details: [{ appIDs: ['2B7K4YLS34.com.anycognition.whim'], components: [{ '/': '/a/*' }] }] } });
    const assetLinks = buildAssetLinks('com.anycognition.whim', 'PLAY_FP', 'UPLOAD_FP');
    nodeAssert.deepStrictEqual(assetLinks, [
      { relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.anycognition.whim', sha256_cert_fingerprints: ['PLAY_FP', 'UPLOAD_FP'] } },
    ]);
  });

  await test('association-files: a missing Play signing fingerprint file names it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-association-files-'));
    try {
      fs.mkdirSync(path.join(dir, 'release'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'release/android-upload-cert.sha256'), '11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11\n', 'utf8');
      let threw: unknown;
      try {
        buildAssociationFiles(dir, FIXTURE_CONFIG);
      } catch (err) {
        threw = err;
      }
      assert(threw instanceof Error && threw.message.includes('android-play-signing-cert.sha256'), `expected an error naming the missing Play fingerprint file, got ${String(threw)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('association-files: builds both files once both fingerprints exist, Play signing first', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-association-files-'));
    try {
      fs.mkdirSync(path.join(dir, 'release'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'release/android-play-signing-cert.sha256'), '22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22:22\n', 'utf8');
      fs.writeFileSync(path.join(dir, 'release/android-upload-cert.sha256'), '11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11:11\n', 'utf8');
      const { assetLinks } = buildAssociationFiles(dir, FIXTURE_CONFIG);
      assert(assetLinks[0].target.sha256_cert_fingerprints[0].startsWith('22:'), 'expected the Play signing fingerprint first');
      assert(assetLinks[0].target.sha256_cert_fingerprints[1].startsWith('11:'), 'expected the upload fingerprint second');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── release-tag.ts ─────────────────────────────────────────────────────────────────────────

  function fakeGitRunner(head: string, tagCommit: string | undefined, calls: string[][]): GitRunner {
    return (args: string[]): string => {
      calls.push(args);
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return head;
      if (args[0] === 'rev-parse' && args[1] === 'release/1.0.0+369360^{commit}') {
        if (tagCommit === undefined) throw new Error('unknown revision');
        return tagCommit;
      }
      if (args[0] === 'tag') return '';
      throw new Error(`fakeGitRunner: unexpected args ${JSON.stringify(args)}`);
    };
  }

  await test('release-tag: creates the tag when it doesn\'t exist yet', () => {
    const calls: string[][] = [];
    const tag = ensureReleaseTag(fakeGitRunner('HEAD_SHA', undefined, calls), '1.0.0', 369360);
    assert(tag === 'release/1.0.0+369360', `expected the exact tag name, got ${tag}`);
    assert(calls.some((c) => c[0] === 'tag'), 'expected the runner to create the tag');
  });

  await test('release-tag: reuses the tag when it already points at HEAD', () => {
    const calls: string[][] = [];
    const tag = ensureReleaseTag(fakeGitRunner('HEAD_SHA', 'HEAD_SHA', calls), '1.0.0', 369360);
    assert(tag === 'release/1.0.0+369360', `expected the exact tag name, got ${tag}`);
    assert(!calls.some((c) => c[0] === 'tag'), 'expected the runner NOT to recreate an already-correct tag');
  });

  await test('release-tag: refuses when the tag points elsewhere', () => {
    let threw = false;
    try {
      ensureReleaseTag(fakeGitRunner('HEAD_SHA', 'OTHER_SHA', []), '1.0.0', 369360);
    } catch (err) {
      threw = err instanceof Error && err.message.includes('OTHER_SHA') && err.message.includes('HEAD_SHA');
    }
    assert(threw, 'expected a refusal naming both the tag\'s commit and HEAD');
  });
}
