/**
 * `npm run android:release` (native-release-config "An offline build type serves the Android dev
 * loop", design D7): builds the `offline` variant and installs it on exactly one named device.
 * The resolver is pure (serial from `--device` or `ANDROID_SERIAL`, then the `adb devices`
 * listing); `runAndroidRelease` wires it to real `adb` and `react-native`. `checkDevScripts`
 * is the release check that keeps `package.json` from bypassing the wrapper.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadNativeReleaseConfig } from './native-config';

declare module 'node:child_process' {
  // The live build inherits the terminal and carries ANDROID_SERIAL in its environment.
  export function spawnSync(
    file: string,
    args: string[],
    options: { cwd?: string; encoding: 'utf8'; stdio: 'inherit'; env: Record<string, string | undefined> },
  ): { readonly status: number | null; readonly error?: Error };
}

export type DeviceResolution =
  | { readonly ok: true; readonly serial: string; readonly command: readonly string[] }
  | { readonly ok: false; readonly exitCode: 2; readonly message: string };

/** Serials `adb devices` lists in the `device` state (not `offline`, `unauthorized`, ...). */
export function attachedSerials(adbDevicesOutput: string): string[] {
  const serials: string[] = [];
  for (const line of adbDevicesOutput.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length >= 2 && cols[1] === 'device') serials.push(cols[0]);
  }
  return serials;
}

/** `undefined` = no `--device` flag; `''` = the flag without a value. */
function flagSerial(args: readonly string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--device') return args[i + 1] ?? '';
    if (args[i].startsWith('--device=')) return args[i].slice('--device='.length);
  }
  return undefined;
}

/** `release` = the offline build (`npm run android:release`); `dev` = the debug build against a Metro you started (`npm run android`). */
export type AndroidMode = 'release' | 'dev';

const MODE_LABEL: Record<AndroidMode, string> = { release: 'android:release', dev: 'android' };

export function resolveAndroidRelease(
  args: readonly string[],
  env: { readonly ANDROID_SERIAL?: string },
  adbDevicesOutput: string,
  appId: string,
  mode: AndroidMode = 'release',
): DeviceResolution {
  const label = MODE_LABEL[mode];
  const flag = flagSerial(args);
  if (flag === '') {
    return {
      ok: false,
      exitCode: 2,
      message: `${label}: \`--device\` needs a serial (npm run ${label} -- --device emulator-5560).`,
    };
  }
  const serial = flag ?? env.ANDROID_SERIAL;
  if (!serial) {
    return {
      ok: false,
      exitCode: 2,
      message: `${label}: no device named. Pick one with \`--device <serial>\` (npm run ${label} -- --device emulator-5560) or the ANDROID_SERIAL environment variable.${mode === 'dev' ? ' Start Metro yourself first (npm start): this script never opens a packager window.' : ''}`,
    };
  }
  const attached = attachedSerials(adbDevicesOutput);
  if (!attached.includes(serial)) {
    return {
      ok: false,
      exitCode: 2,
      message: `${label}: "${serial}" is not attached as a device (adb lists: ${attached.join(', ') || 'none'}). Nothing was built.`,
    };
  }
  return {
    ok: true,
    serial,
    command:
      mode === 'release'
        ? ['react-native', 'run-android', '--mode', 'offline', '--active-arch-only', '--device', serial, '--appId', appId, '--no-packager']
        : ['react-native', 'run-android', '--active-arch-only', '--device', serial, '--appId', appId, '--no-packager'],
  };
}

export interface AndroidReleaseDeps {
  adbDevices(): string;
  /** The applicationId the install carries (`WHIM_APP_ID`); the Gradle namespace is `com.whim`, so RN CLI must be told it to launch. */
  appId(): string;
  /** Runs `command` with `env` and returns its exit code. */
  run(command: readonly string[], env: Record<string, string | undefined>): number;
  stderr(text: string): void;
}

export function runAndroidRelease(
  args: readonly string[],
  env: Record<string, string | undefined>,
  deps: AndroidReleaseDeps,
  mode: AndroidMode = 'release',
): number {
  let listing: string;
  try {
    listing = deps.adbDevices();
  } catch (err) {
    deps.stderr(`${MODE_LABEL[mode]}: could not run \`adb devices\`: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
  const resolved = resolveAndroidRelease(args, env, listing, deps.appId(), mode);
  if (!resolved.ok) {
    deps.stderr(`${resolved.message}\n`);
    return resolved.exitCode;
  }
  return deps.run(resolved.command, { ...env, ANDROID_SERIAL: resolved.serial });
}

/** The real `adb` and `react-native`, run from `repoRoot`. */
export function realAndroidReleaseDeps(repoRoot: string): AndroidReleaseDeps {
  return {
    adbDevices() {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- intentional: a developer-run script; `adb` from the developer's Android SDK PATH is the tool being asked about
      const result = spawnSync('adb', ['devices'], { encoding: 'utf8' });
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error(result.stderr.trim() || `adb devices exited ${String(result.status)}`);
      return result.stdout;
    },
    appId: () => loadNativeReleaseConfig(repoRoot).WHIM_APP_ID,
    run(command, env) {
      const [bin, ...rest] = command;
      const result = spawnSync(path.join(repoRoot, 'node_modules', '.bin', bin), rest, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'inherit',
        env,
      });
      return result.error ? 1 : (result.status ?? 1);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
  };
}

const WRAPPERS = { release: 'scripts/android-release.mjs', dev: 'scripts/android-dev.mjs' } as const;
const WRAPPER_SCRIPT = { release: 'android:release', dev: 'android' } as const;
const RN_RUNNERS = /\brun-(android|ios)\b/;

/**
 * Findings for `package.json`: each wrapper script runs its wrapper; no script runs `run-android` or
 * `run-ios` itself (a bare one installs on every attached device and opens a Metro terminal window);
 * and each wrapper's spawned command carries `--no-packager`.
 */
export function checkDevScripts(repoRoot: string): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const scripts = pkg.scripts ?? {};
  const findings: string[] = [];
  for (const mode of ['release', 'dev'] as const) {
    const name = WRAPPER_SCRIPT[mode];
    if (!(scripts[name] ?? '').includes(WRAPPERS[mode])) {
      findings.push(
        `package.json: script "${name}" must run ${WRAPPERS[mode]} (a bare run-android installs on every attached device)`,
      );
    }
    const resolved = resolveAndroidRelease(['--device', 'x'], {}, 'List of devices attached\nx\tdevice\n', 'a.b.c', mode);
    if (!resolved.ok || !resolved.command.includes('--no-packager') || !resolved.command.includes('--appId')) {
      findings.push(`${WRAPPERS[mode]}: the spawned run-android command lacks --no-packager (it opens a Metro terminal window) or --appId (RN CLI would launch the Gradle namespace, not the applicationId)`);
    }
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (RN_RUNNERS.test(command)) {
      findings.push(
        `package.json: script "${name}" runs react-native run-android/run-ios directly (use the device-naming wrapper; every run needs --no-packager)`,
      );
    }
  }
  return findings;
}
