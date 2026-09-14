/**
 * Acceptance for `scripts/release/lib/{native-config,build-number}.ts` (chain-1,
 * platform-release-readiness). specs/native-release-config/spec.md "One native release file
 * declares identity, version and domain" and "Version numbers come from the release file and
 * the build invocation"; specs/store-release-pipeline/spec.md "Each lane uses one time-derived
 * build number"; task 2.6.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, assert } from '../harness';
import {
  loadNativeReleaseConfig,
  NativeConfigError,
  parseNativeReleaseConfig,
  scanNativeLiterals,
} from '../../../scripts/release/lib/native-config';
import { BUILD_NUMBER_EPOCH_UTC, buildNumberAt } from '../../../scripts/release/lib/build-number';

const REPO_ROOT = process.cwd();

function assertThrowsNativeConfigError(fn: () => unknown, wantLine: number, label: string): NativeConfigError {
  try {
    fn();
  } catch (err) {
    assert(err instanceof NativeConfigError, `${label}: expected a NativeConfigError, got ${String(err)}`);
    const e = err as NativeConfigError;
    assert(e.line === wantLine, `${label}: expected the error to name line ${wantLine}, got line ${e.line} ("${e.message}")`);
    return e;
  }
  throw new Error(`${label}: expected parseNativeReleaseConfig to throw, but it returned normally`);
}

/** A temp git repo `scanNativeLiterals` can call `git ls-files` against (no fixtures/ committed). */
function makeTempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-native-config-'));
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: the acceptance suite runs inside the repo's own dev/CI toolchain, which always has a trustworthy `git` on PATH
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

function writeTracked(root: string, relPath: string, content: string): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function gitAddAll(root: string): void {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- see makeTempRepo above
  execFileSync('git', ['add', '-A'], { cwd: root });
}

export async function run(): Promise<void> {
  await test('native-config: the real release/whim-release.xcconfig parses to the design D1 defaults', () => {
    const config = loadNativeReleaseConfig(REPO_ROOT);
    assert(config.WHIM_APP_ID === 'com.anycognition.whim', `expected WHIM_APP_ID com.anycognition.whim, got ${config.WHIM_APP_ID}`);
    assert(config.WHIM_APPLE_TEAM_ID === '2B7K4YLS34', `expected WHIM_APPLE_TEAM_ID 2B7K4YLS34, got ${config.WHIM_APPLE_TEAM_ID}`);
    assert(config.WHIM_MARKETING_VERSION === '1.0.0', `expected WHIM_MARKETING_VERSION 1.0.0, got ${config.WHIM_MARKETING_VERSION}`);
    assert(config.WHIM_BUILD_NUMBER === '1', `expected WHIM_BUILD_NUMBER 1, got ${config.WHIM_BUILD_NUMBER}`);
    assert(config.WHIM_DOMAIN === 'example.com', `expected WHIM_DOMAIN example.com, got ${config.WHIM_DOMAIN}`);
  });

  const VALID_LINES = [
    'WHIM_APP_ID = com.anycognition.whim',
    'WHIM_APPLE_TEAM_ID = 2B7K4YLS34',
    'WHIM_MARKETING_VERSION = 1.0.0',
    'WHIM_BUILD_NUMBER = 1',
    'WHIM_DOMAIN = example.com',
  ];

  await test('native-config: an #include line is rejected, naming its line', () => {
    const text = [...VALID_LINES.slice(0, 2), '#include "other.xcconfig"', ...VALID_LINES.slice(2)].join('\n');
    assertThrowsNativeConfigError(() => parseNativeReleaseConfig(text), 3, '#include');
  });

  await test('native-config: a $(...) value is rejected, naming its line', () => {
    const text = [
      'WHIM_APP_ID = com.anycognition.whim',
      'WHIM_APPLE_TEAM_ID = 2B7K4YLS34',
      'WHIM_MARKETING_VERSION = 1.0.0',
      'WHIM_BUILD_NUMBER = 1',
      'WHIM_DOMAIN = $(SOME_MACRO)',
    ].join('\n');
    assertThrowsNativeConfigError(() => parseNativeReleaseConfig(text), 5, '$(...) value');
  });

  await test('native-config: a duplicate key is rejected, naming the line of the second occurrence', () => {
    const text = [...VALID_LINES, 'WHIM_APP_ID = com.other.app'].join('\n');
    assertThrowsNativeConfigError(() => parseNativeReleaseConfig(text), 6, 'duplicate key');
  });

  await test('native-config: a missing key is rejected, naming it', () => {
    const text = VALID_LINES.slice(0, 4).join('\n'); // drops WHIM_DOMAIN
    try {
      parseNativeReleaseConfig(text);
      throw new Error('expected parseNativeReleaseConfig to throw for a missing key');
    } catch (err) {
      assert(err instanceof NativeConfigError, `expected a NativeConfigError, got ${String(err)}`);
      assert(/WHIM_DOMAIN/.test((err as Error).message), `expected the message to name WHIM_DOMAIN, got: ${(err as Error).message}`);
    }
  });

  await test('native-config: a malformed team id is rejected, naming its line', () => {
    const text = [
      'WHIM_APP_ID = com.anycognition.whim',
      'WHIM_APPLE_TEAM_ID = notateamid',
      'WHIM_MARKETING_VERSION = 1.0.0',
      'WHIM_BUILD_NUMBER = 1',
      'WHIM_DOMAIN = example.com',
    ].join('\n');
    assertThrowsNativeConfigError(() => parseNativeReleaseConfig(text), 2, 'malformed team id');
  });

  await test('native-config: blank lines and "//" comments around valid lines are accepted', () => {
    const text = ['// header comment', '', ...VALID_LINES, '', '// trailing comment'].join('\n');
    const config = parseNativeReleaseConfig(text);
    assert(config.WHIM_DOMAIN === 'example.com', 'a well-formed file surrounded by comments and blanks must still parse');
  });

  await test('build-number: buildNumberAt(2026-09-14T12:00:30Z) is 369360 (spec scenario)', () => {
    const n = buildNumberAt(new Date('2026-09-14T12:00:30Z'));
    assert(n === 369360, `expected 369360, got ${n}`);
  });

  await test('build-number: the epoch itself is build number 0', () => {
    const n = buildNumberAt(new Date(BUILD_NUMBER_EPOCH_UTC));
    assert(n === 0, `expected 0, got ${n}`);
  });

  await test('build-number: a date before the epoch throws', () => {
    let threw = false;
    try {
      buildNumberAt(new Date(BUILD_NUMBER_EPOCH_UTC - 1000));
      // eslint-disable-next-line no-restricted-syntax -- intentional: the assertion IS "did it throw"; the thrown value is deliberately discarded and the `threw` flag below reports the outcome
    } catch {
      threw = true;
    }
    assert(threw, 'a pre-epoch date must throw, not return a negative number');
  });

  await test('native-config: scanNativeLiterals finds nothing in the real repo', () => {
    const config = loadNativeReleaseConfig(REPO_ROOT);
    const findings = scanNativeLiterals(REPO_ROOT, config);
    assert(findings.length === 0, `expected no literal findings in the repo, got ${JSON.stringify(findings)}`);
  });

  await test('native-config: scanNativeLiterals catches an app-id literal planted ONLY in android/app/build.gradle (discriminating: a pbxproj-only scan would miss it)', () => {
    const dir = makeTempRepo();
    try {
      writeTracked(dir, 'ios/Whim.xcodeproj/project.pbxproj', 'PRODUCT_BUNDLE_IDENTIFIER = "$(WHIM_APP_ID)";\n');
      writeTracked(dir, 'android/app/build.gradle', 'applicationId "com.anycognition.whim"\n');
      gitAddAll(dir);
      const config = parseNativeReleaseConfig(VALID_LINES.join('\n'));
      const findings = scanNativeLiterals(dir, config);
      const hit = findings.find((f) => f.key === 'WHIM_APP_ID' && f.file === 'android/app/build.gradle');
      assert(!!hit, `expected a WHIM_APP_ID finding in android/app/build.gradle, got ${JSON.stringify(findings)}`);
      assert(hit?.line === 1, `expected the finding at line 1, got line ${String(hit?.line)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('native-config: scanNativeLiterals catches a marketing-version literal planted in Info.plist', () => {
    const dir = makeTempRepo();
    try {
      writeTracked(dir, 'ios/Whim/Info.plist', '<key>CFBundleShortVersionString</key>\n<string>1.0.0</string>\n');
      gitAddAll(dir);
      const config = parseNativeReleaseConfig(VALID_LINES.join('\n'));
      const findings = scanNativeLiterals(dir, config);
      const hit = findings.find((f) => f.key === 'WHIM_MARKETING_VERSION' && f.file === 'ios/Whim/Info.plist');
      assert(!!hit, `expected a WHIM_MARKETING_VERSION finding in ios/Whim/Info.plist, got ${JSON.stringify(findings)}`);
      assert(hit?.line === 2, `expected the finding at line 2, got line ${String(hit?.line)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await test('native-config: scanNativeLiterals does NOT flag a marketing-version literal outside the three named files', () => {
    const dir = makeTempRepo();
    try {
      writeTracked(dir, 'ios/Whim/SomeOtherFile.swift', '// version 1.0.0\n');
      gitAddAll(dir);
      const config = parseNativeReleaseConfig(VALID_LINES.join('\n'));
      const findings = scanNativeLiterals(dir, config);
      assert(findings.length === 0, `a marketing-version literal outside project.pbxproj/Info.plist/build.gradle must not be flagged, got ${JSON.stringify(findings)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
