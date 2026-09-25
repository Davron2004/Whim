/**
 * Acceptance for release source maps (developer-observability tasks 7.2–7.3; specs/device-diagnostics
 * "Release builds keep a source map for every shipped bundle"). Everything runs the real entry
 * points — `scripts/symbolicate.mjs` and `scripts/release/run.mjs upload-source-map`, the command the
 * store lanes call — as child processes, with `gcloud` on PATH replaced by a stub that treats a
 * scratch directory as GCS (`gs://<bucket>/<key>` ↔ `<dir>/<bucket>/<key>`), so a wrong bucket or
 * key finds nothing.
 *
 * The map fixture is the composed Hermes map of the offline-59505b5 Android release build, trimmed
 * to the two mappings around each stack column below plus its sources' `x_facebook_sources` and
 * ignore-list entries. The stack's columns are bytecode offsets taken from that map's mappings for
 * `redact.ts` and `report-send.ts` (one, 650510, falls between two mappings). EXPECTED is
 * metro-symbolicate's output for this stack on the full, untrimmed map; the lines and function names
 * match those files at 59505b5.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import nodeAssert from 'node:assert';
import { test } from '../harness';
import { loadNativeReleaseConfig } from '../../../scripts/release/lib/native-config';
import { symbolicateStack, realCommandRunner } from '../../../scripts/release/lib/source-map';
import { trimFrameLocations } from '../../../src/host/logging/crash-capture';

const REPO_ROOT = process.cwd();
const MAPS_DIR = path.join(REPO_ROOT, 'checks/test/release/fixtures/sourcemaps');
const FIXTURE_MAP = path.join(MAPS_DIR, 'android/1.0.0+1.map');
const BUCKET = 'anycognition-whim-sourcemaps';

const STACK = [
  "TypeError: Cannot read property 'toLowerCase' of undefined",
  '    at isSensitiveField (address at index.android.bundle:1:650510)',
  '    at redactObject (address at index.android.bundle:1:650735)',
  '    at redactValue (address at index.android.bundle:1:650616)',
  '    at map (native)',
  '    at sendFailureOutcome (address at index.android.bundle:1:668904)',
  '',
].join('\n');

const BUILD_ROOT = '/Users/davrondjabborov/Work/other/Whim';
const EXPECTED = [
  "TypeError: Cannot read property 'toLowerCase' of undefined",
  `    at isSensitiveField (address at ${BUILD_ROOT}/src/host/logging/redact.ts:65:isSensitiveField)`,
  `    at redactObject (address at ${BUILD_ROOT}/src/host/logging/redact.ts:88:redactObject)`,
  `    at redactValue (address at ${BUILD_ROOT}/src/host/logging/redact.ts:80:redactValue)`,
  '    at map (native)',
  `    at sendFailureOutcome (address at ${BUILD_ROOT}/src/host/launcher/report-send.ts:51:sendFailureOutcome)`,
  '',
].join('\n');

const FAKE_GCLOUD = `#!/bin/bash
printf '%s\\n' "$*" >> "$FAKE_GCLOUD_LOG"
if [ -n "\${FAKE_GCLOUD_FAIL:-}" ]; then echo "$FAKE_GCLOUD_FAIL" >&2; exit 1; fi
[ "$1 $3 $4" = "--project storage cp" ] || { echo "unexpected gcloud call: $*" >&2; exit 2; }
src="$5" dst="$6"
case "$src" in gs://*) src="$FAKE_GCS_DIR/\${src#gs://}" ;; esac
case "$dst" in gs://*) dst="$FAKE_GCS_DIR/\${dst#gs://}"; mkdir -p "$(dirname "$dst")" ;; esac
cp "$src" "$dst" 2>/dev/null || { echo "ERROR: (gcloud.storage.cp) The following URLs matched no objects or files: $5" >&2; exit 1; }
`;

interface Sandbox {
  readonly root: string;
  readonly gcs: string;
  readonly home: string;
  readonly log: string;
  readonly env: Record<string, string>;
}

const sandboxes: Sandbox[] = [];

function makeSandbox(extraEnv: Record<string, string> = {}): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-sourcemaps-suite-'));
  const bin = path.join(root, 'bin');
  const gcs = path.join(root, 'gcs');
  const home = path.join(root, 'home');
  const log = path.join(root, 'gcloud.log');
  for (const dir of [bin, gcs, home]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(bin, 'gcloud'), FAKE_GCLOUD, { mode: 0o755 });
  fs.writeFileSync(log, '');
  const env = { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`, HOME: home, FAKE_GCS_DIR: gcs, FAKE_GCLOUD_LOG: log, ...extraEnv };
  const sandbox = { root, gcs, home, log, env };
  sandboxes.push(sandbox);
  return sandbox;
}

function gcloudCalls(sandbox: Sandbox): string[] {
  return fs.readFileSync(sandbox.log, 'utf8').split('\n').filter((line) => line !== '');
}

function runScript(sandbox: Sandbox, script: string, args: string[], input = '') {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, script), ...args], {
    cwd: REPO_ROOT,
    env: sandbox.env,
    input,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function symbolicate(sandbox: Sandbox, args: string[]) {
  return runScript(sandbox, 'scripts/symbolicate.mjs', args, STACK);
}

function uploadSourceMap(sandbox: Sandbox, args: string[]) {
  return runScript(sandbox, 'scripts/release/run.mjs', ['upload-source-map', ...args]);
}

export async function run(): Promise<void> {
  try {
    await runCases();
  } finally {
    for (const { root } of sandboxes.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  }
}

async function runCases(): Promise<void> {
  const version = loadNativeReleaseConfig(REPO_ROOT).WHIM_MARKETING_VERSION;

  await test('source maps: a Hermes stack from a release build symbolicates to its src/ files, lines and functions', () => {
    const result = symbolicate(makeSandbox(), ['android', '1.0.0', '1', '--maps-dir', MAPS_DIR]);
    nodeAssert.strictEqual(result.status, 0, result.stderr);
    nodeAssert.strictEqual(result.stdout, EXPECTED);
  });

  await test('source maps: an iOS-shaped stack, trimmed to file name + line:column (D7), symbolicates to the same lines as the untrimmed one', () => {
    const iosStack = [
      "TypeError: Cannot read property 'toLowerCase' of undefined",
      '    at isSensitiveField (address at /private/var/containers/Bundle/Application/1234ABCD-1234-ABCD-1234-ABCD12345678/Whim.app/main.jsbundle:1:650510)',
      '    at redactObject (address at /private/var/containers/Bundle/Application/1234ABCD-1234-ABCD-1234-ABCD12345678/Whim.app/main.jsbundle:1:650735)',
      '    at redactValue (address at /private/var/containers/Bundle/Application/1234ABCD-1234-ABCD-1234-ABCD12345678/Whim.app/main.jsbundle:1:650616)',
      '    at map (native)',
      '    at sendFailureOutcome (address at /private/var/containers/Bundle/Application/1234ABCD-1234-ABCD-1234-ABCD12345678/Whim.app/main.jsbundle:1:668904)',
      '',
    ].join('\n');
    const trimmed = trimFrameLocations(iosStack);
    nodeAssert.ok(!trimmed.includes('/Bundle/Application/'), 'the install path is gone from the trimmed stack');
    nodeAssert.ok(trimmed.includes('main.jsbundle:1:650510'), 'the file name and position survive');
    const fromUntrimmed = symbolicateStack(realCommandRunner, REPO_ROOT, FIXTURE_MAP, iosStack);
    const fromTrimmed = symbolicateStack(realCommandRunner, REPO_ROOT, FIXTURE_MAP, trimmed);
    nodeAssert.strictEqual(fromTrimmed, fromUntrimmed, 'trimming the install path must not change what the frame resolves to');
    nodeAssert.strictEqual(fromTrimmed, EXPECTED, 'and it still resolves to the same source lines as the real Android stack above');
  });

  await test('source maps: without --maps-dir, symbolicate reads <platform>/<version>+<build>.map from the source-map bucket', () => {
    const sandbox = makeSandbox();
    fs.mkdirSync(path.join(sandbox.gcs, BUCKET, 'android'), { recursive: true });
    fs.copyFileSync(FIXTURE_MAP, path.join(sandbox.gcs, BUCKET, 'android/1.0.0+1.map'));
    const result = symbolicate(sandbox, ['android', '1.0.0', '1']);
    nodeAssert.strictEqual(result.status, 0, result.stderr);
    nodeAssert.strictEqual(result.stdout, EXPECTED);
    const calls = gcloudCalls(sandbox);
    nodeAssert.strictEqual(calls.length, 1, calls.join('\n'));
    nodeAssert.ok(calls[0].startsWith(`--project anycognition-whim storage cp gs://${BUCKET}/android/1.0.0+1.map `), calls[0]);
  });

  await test('source maps: a missing map exits non-zero naming the key and never symbolicates with another build\'s map', () => {
    const cases: Array<{ args: string[]; key: string }> = [
      { args: ['android', '1.0.0', '2', '--maps-dir', MAPS_DIR], key: 'android/1.0.0+2.map' },
      { args: ['ios', '1.0.0', '1', '--maps-dir', MAPS_DIR], key: 'ios/1.0.0+1.map' },
    ];
    const bucketSandbox = makeSandbox();
    fs.mkdirSync(path.join(bucketSandbox.gcs, BUCKET, 'android'), { recursive: true });
    fs.copyFileSync(FIXTURE_MAP, path.join(bucketSandbox.gcs, BUCKET, 'android/1.0.0+1.map'));
    for (const { args, key } of [...cases, { args: ['android', '1.0.0', '3'], key: 'android/1.0.0+3.map' }]) {
      const result = symbolicate(args.includes('--maps-dir') ? makeSandbox() : bucketSandbox, args);
      nodeAssert.notStrictEqual(result.status, 0, `${key}: expected a non-zero exit`);
      nodeAssert.ok(result.stderr.includes(key), `${key}: stderr must name the key, got ${result.stderr}`);
      nodeAssert.ok(!result.stdout.includes('redact.ts'), `${key}: symbolicated with another map: ${result.stdout}`);
    }
  });

  await test('source maps: upload-source-map puts the map at gs://anycognition-whim-sourcemaps/<platform>/<version>+<build>.map', () => {
    const sandbox = makeSandbox();
    const result = uploadSourceMap(sandbox, ['--platform', 'android', '--build', '42', FIXTURE_MAP]);
    nodeAssert.strictEqual(result.status, 0, result.stderr);
    const stored = path.join(sandbox.gcs, BUCKET, 'android', `${version}+42.map`);
    nodeAssert.ok(fs.existsSync(stored), `nothing at ${stored}; gcloud calls: ${gcloudCalls(sandbox).join(' | ')}`);
    nodeAssert.strictEqual(fs.readFileSync(stored, 'utf8'), fs.readFileSync(FIXTURE_MAP, 'utf8'));
  });

  await test('source maps: the operator\'s deploy.env WHIM_GCP_PROJECT moves the upload to that project\'s bucket', () => {
    const sandbox = makeSandbox();
    fs.mkdirSync(path.join(sandbox.home, '.config/whim'), { recursive: true });
    fs.writeFileSync(path.join(sandbox.home, '.config/whim/deploy.env'), 'WHIM_GCP_PROJECT=other-project\n');
    const result = uploadSourceMap(sandbox, ['--platform', 'ios', '--build', '7', FIXTURE_MAP]);
    nodeAssert.strictEqual(result.status, 0, result.stderr);
    nodeAssert.ok(fs.existsSync(path.join(sandbox.gcs, 'other-project-sourcemaps', 'ios', `${version}+7.map`)), gcloudCalls(sandbox).join(' | '));
  });

  await test('source maps: a failed upload exits non-zero naming the key and gcloud\'s reason, so the lane stops', () => {
    const reason = 'ERROR: (gcloud.storage.cp) HTTPError 403: caller does not have storage.objects.create access';
    const result = uploadSourceMap(makeSandbox({ FAKE_GCLOUD_FAIL: reason }), ['--platform', 'android', '--build', '42', FIXTURE_MAP]);
    nodeAssert.strictEqual(result.status, 1);
    nodeAssert.ok(result.stderr.includes(`android/${version}+42.map`) && result.stderr.includes(reason), result.stderr);
  });

  await test('source maps: a build that emitted no map, or something that is not a map, is refused before any upload', () => {
    const sandbox = makeSandbox();
    const notAMap = path.join(sandbox.home, 'index.android.bundle.map');
    fs.writeFileSync(notAMap, '{"version":3,"mappings":""}\n');
    for (const mapPath of [path.join(sandbox.home, 'missing.map'), notAMap]) {
      const result = uploadSourceMap(sandbox, ['--platform', 'android', '--build', '42', mapPath]);
      nodeAssert.strictEqual(result.status, 1, `${mapPath}: ${result.stdout}`);
      nodeAssert.ok(result.stderr.includes(mapPath), result.stderr);
    }
    nodeAssert.deepStrictEqual(gcloudCalls(sandbox), []);
  });
}
