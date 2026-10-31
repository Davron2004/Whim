/**
 * Acceptance for `scripts/release/lib/android-dev-script.ts` (beta-2-spec-fixes chain-7,
 * native-release-config "An offline build type serves the Android dev loop"): the device resolver,
 * the live wrapper driven through a fake `adb` and a fake `react-native`, and the package.json check.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, assert } from '../harness';
import {
  attachedSerials,
  checkDevScripts,
  realAndroidReleaseDeps,
  resolveAndroidRelease,
  runAndroidRelease,
} from '../../../scripts/release/lib/android-dev-script';
import { loadNativeReleaseConfig, NATIVE_RELEASE_CONFIG_PATH } from '../../../scripts/release/lib/native-config';

const REPO_ROOT = process.cwd();
const APP_ID = 'com.example.app';
const ADB_TWO = 'List of devices attached\nemulator-5560\tdevice\nemulator-5562\tdevice\nR58M123\toffline\n\n';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whim-android-dev-'));
}

function packageWith(root: string, scripts: Record<string, string>): void {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts }), 'utf8');
}

export async function run(): Promise<void> {
  await test('android-dev-script: only the `device` state counts as attached', () => {
    assert(
      JSON.stringify(attachedSerials(ADB_TWO)) === JSON.stringify(['emulator-5560', 'emulator-5562']),
      `got ${JSON.stringify(attachedSerials(ADB_TWO))}`,
    );
  });

  await test('android-dev-script: no --device and no ANDROID_SERIAL refuses with exit 2 naming both', () => {
    const r = resolveAndroidRelease([], {}, ADB_TWO, APP_ID);
    assert(!r.ok && r.exitCode === 2, 'expected a refusal with exit 2');
    assert(!r.ok && r.message.includes('--device') && r.message.includes('ANDROID_SERIAL'), 'message must name both ways');
  });

  await test('android-dev-script: --device wins over ANDROID_SERIAL and builds the offline command for it', () => {
    const r = resolveAndroidRelease(['--device', 'emulator-5560'], { ANDROID_SERIAL: 'emulator-5562' }, ADB_TWO, APP_ID);
    assert(r.ok && r.serial === 'emulator-5560', `got ${JSON.stringify(r)}`);
    assert(
      r.ok &&
        r.command.join(' ') ===
          'react-native run-android --mode offline --active-arch-only --device emulator-5560 --appId com.example.app --no-packager',
      `got ${r.ok ? r.command.join(' ') : ''}`,
    );
  });

  await test('android-dev-script: dev mode builds the debug command with --no-packager and its refusal says to start Metro', () => {
    const r = resolveAndroidRelease(['--device', 'emulator-5560'], {}, ADB_TWO, APP_ID, 'dev');
    assert(
      r.ok && r.command.join(' ') === 'react-native run-android --active-arch-only --device emulator-5560 --appId com.example.app --no-packager',
      `got ${JSON.stringify(r)}`,
    );
    const none = resolveAndroidRelease([], {}, ADB_TWO, APP_ID, 'dev');
    assert(!none.ok && none.message.includes('npm start') && none.message.startsWith('android:'), `got ${JSON.stringify(none)}`);
  });

  await test('android-dev-script: --device with no or an empty value refuses instead of falling back to ANDROID_SERIAL', () => {
    for (const args of [['--device'], ['--device', ''], ['--device=']]) {
      const r = resolveAndroidRelease(args, { ANDROID_SERIAL: 'emulator-5562' }, ADB_TWO, APP_ID);
      assert(
        !r.ok && r.exitCode === 2 && r.message.includes('--device') && r.message.includes('needs a serial'),
        `${JSON.stringify(args)}: got ${JSON.stringify(r)}`,
      );
    }
  });

  await test('android-dev-script: ANDROID_SERIAL alone selects the device', () => {
    const r = resolveAndroidRelease([], { ANDROID_SERIAL: 'emulator-5562' }, ADB_TWO, APP_ID);
    assert(r.ok && r.serial === 'emulator-5562', `got ${JSON.stringify(r)}`);
  });

  await test('android-dev-script: a serial adb does not list as a device is refused', () => {
    for (const serial of ['emulator-9999', 'R58M123']) {
      const r = resolveAndroidRelease(['--device', serial], {}, ADB_TWO, APP_ID);
      assert(!r.ok && r.exitCode === 2 && r.message.includes(serial), `${serial}: got ${JSON.stringify(r)}`);
    }
  });

  await test('android-dev-script: a refusal runs nothing, and the build runs once with ANDROID_SERIAL exported', () => {
    const runs: { command: readonly string[]; serial: string | undefined }[] = [];
    const deps = {
      adbDevices: () => ADB_TWO,
      appId: () => APP_ID,
      run: (command: readonly string[], env: Record<string, string | undefined>) => {
        runs.push({ command, serial: env.ANDROID_SERIAL });
        return 0;
      },
      stderr: () => undefined,
    };
    assert(runAndroidRelease([], {}, deps) === 2 && runs.length === 0, 'no device must not build');
    assert(runAndroidRelease(['--device', 'emulator-5560'], { ANDROID_SERIAL: 'other' }, deps) === 0, 'build exit');
    assert(runs.length === 1 && runs[0].serial === 'emulator-5560', `got ${JSON.stringify(runs)}`);
  });

  await test('android-dev-script: an unrunnable adb refuses with exit 2 and builds nothing', () => {
    let built = false;
    const code = runAndroidRelease(['--device', 'emulator-5560'], {}, {
      appId: () => APP_ID,
      adbDevices: () => {
        throw new Error('spawn adb ENOENT');
      },
      run: () => {
        built = true;
        return 0;
      },
      stderr: () => undefined,
    });
    assert(code === 2 && !built, `code ${String(code)} built ${String(built)}`);
  });

  await test('android-dev-script: the live deps read a fake adb and hand the build its serial', () => {
    const root = tempDir();
    const bin = path.join(root, 'node_modules', '.bin');
    fs.mkdirSync(bin, { recursive: true });
    const fakeAdb = path.join(root, 'fakebin');
    fs.mkdirSync(fakeAdb);
    fs.writeFileSync(path.join(fakeAdb, 'adb'), `#!/bin/sh\nprintf '${ADB_TWO.replace(/\n/g, '\\n')}'\n`, { mode: 0o755 });
    fs.mkdirSync(path.join(root, 'release'));
    fs.copyFileSync(path.join(REPO_ROOT, NATIVE_RELEASE_CONFIG_PATH), path.join(root, NATIVE_RELEASE_CONFIG_PATH));
    const realAppId = loadNativeReleaseConfig(REPO_ROOT).WHIM_APP_ID;
    const out = path.join(root, 'out.txt');
    fs.writeFileSync(
      path.join(bin, 'react-native'),
      `#!/bin/sh\necho "$ANDROID_SERIAL $*" > "${out}"\n`,
      { mode: 0o755 },
    );
    const originalPath = process.env.PATH;
    process.env.PATH = `${fakeAdb}:${originalPath ?? ''}`;
    let code: number;
    try {
      code = runAndroidRelease(['--device', 'emulator-5560'], process.env, realAndroidReleaseDeps(root));
    } finally {
      process.env.PATH = originalPath;
    }
    assert(code === 0, `exit ${String(code)}`);
    assert(
      fs.readFileSync(out, 'utf8').trim() ===
        `emulator-5560 run-android --mode offline --active-arch-only --device emulator-5560 --appId ${realAppId} --no-packager`,
      `got ${fs.readFileSync(out, 'utf8')}`,
    );
    fs.rmSync(root, { recursive: true, force: true });
  });

  await test('android-dev-script: the real package.json passes checkDevScripts', () => {
    const findings = checkDevScripts(REPO_ROOT);
    assert(findings.length === 0, `got ${JSON.stringify(findings)}`);
  });

  await test('android-dev-script: android:release as a bare run-android is a finding', () => {
    const root = tempDir();
    packageWith(root, {
      'android:release': 'react-native run-android --mode offline --active-arch-only',
      android: 'node scripts/android-dev.mjs',
    });
    const findings = checkDevScripts(root);
    assert(findings.length === 2, `expected the missing wrapper and the bypass, got ${JSON.stringify(findings)}`);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await test('android-dev-script: another script running the offline build around the wrapper is a finding', () => {
    const root = tempDir();
    packageWith(root, {
      'android:release': 'node scripts/android-release.mjs',
      android: 'node scripts/android-dev.mjs',
      'android:offline': 'react-native run-android --mode offline',
    });
    const findings = checkDevScripts(root);
    assert(findings.length === 1 && findings[0].includes('android:offline'), `got ${JSON.stringify(findings)}`);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await test('android-dev-script: a bare react-native run-android or run-ios script is a finding', () => {
    for (const bare of ['react-native run-android', 'react-native run-ios --simulator "iPhone 17"']) {
      const root = tempDir();
      packageWith(root, {
        'android:release': 'node scripts/android-release.mjs',
        android: 'node scripts/android-dev.mjs',
        ios: bare,
      });
      const findings = checkDevScripts(root);
      assert(findings.length === 1 && findings[0].includes('"ios"'), `${bare}: got ${JSON.stringify(findings)}`);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('android-dev-script: android as a bare run-android is a finding (wrapper missing and bypass)', () => {
    const root = tempDir();
    packageWith(root, { 'android:release': 'node scripts/android-release.mjs', android: 'react-native run-android' });
    const findings = checkDevScripts(root);
    assert(findings.length === 2, `got ${JSON.stringify(findings)}`);
    fs.rmSync(root, { recursive: true, force: true });
  });
}
