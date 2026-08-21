#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// demo/android/film.mjs — films a human-paced .mp4 of a Maestro flow driving the REAL Whim
// app (same APK a user installs) on a real Android emulator via `adb shell screenrecord`.
// This is the Android sibling of demo/cli.mjs (which films a Chromium/Playwright rendering of
// a bundle in isolation) — see demo/README.md's "Android variant" section for how the two
// differ. Plain Node 22 ESM, no new dependencies, orchestrating external tools only: adb,
// maestro, the Gradle wrapper, and ffmpeg.
//
//   node demo/android/film.mjs <flow.yaml> [--out <dir>] [--rebuild] [--avd <name>] [--tighten]
//
// STATE MACHINE (one linear pipeline, no branching back-edges — a filming run is a single
// attempt, never resumed mid-way):
//
//   PREFLIGHT → DEVICE → APK → INSTALL → CLEAR → RECORD_START → MAESTRO → RECORD_STOP
//     → PULL → FINALIZE → [TIGHTEN] → done
//
// - PREFLIGHT: verify Node >= 22, resolve adb/maestro/ffmpeg/emulator (PATH first, falling
//   back to the grounded absolute paths below), verify the flow file exists. Any failure here
//   exits non-zero before anything on the device is touched.
// - DEVICE: reuse a running device if `adb devices` already shows one (state "device"); else
//   boot the requested AVD headless and poll for `sys.boot_completed`. Generous timeout — an
//   emulator cold-boot is legitimately slow.
// - APK: rebuild (npm run build → gradlew assembleRelease) only if the release APK is missing
//   or `--rebuild` was passed; an existing app-release.apk is trusted as-is otherwise. This is
//   the one place APK freshness is decided — nowhere else in this file re-derives it.
// - INSTALL/CLEAR: `adb install -r` (idempotent) then `pm clear com.whim`, so the flow always
//   starts from the unconditional first-run seed (src/host/launcher/seed.ts) as its beat 0.
// - RECORD_START..RECORD_STOP is the only window where an on-device child process exists that
//   MUST be torn down on any exit path — every function from here on runs inside a try/finally
//   that SIGINTs the recorder if it's still alive, so a thrown error (including a failed
//   `maestro test`) never leaves a zombie `screenrecord` process or an un-pulled device file.
// - MAESTRO failing does not short-circuit RECORD_STOP/PULL/FINALIZE: the partial recording is
//   still pulled and transcoded (useful for debugging a flaky flow), but the process still
//   exits non-zero and prints the flow's own error.
// - TIGHTEN (opt-in, --tighten): runs after FINALIZE, only if maestro succeeded (a failed flow's
//   partial recording is left as-is for debugging, not tightened). Calls demo/edit.mjs's
//   `tighten()` over the finalized .mp4; the raw file is always kept, a `-tight` variant is
//   written alongside it. A tighten failure is reported but does not fail the overall command —
//   the raw recording already succeeded by that point.
//
// CAP: `adb shell screenrecord` hard-stops recording at 180s. Flows filmed by this tool must
// stay comfortably under that (~2.5 min) — film.mjs does not attempt to chain recordings.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, rm } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import { resolve, join, basename, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { tighten } from '../edit.mjs';

const execFileP = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..'); // demo/android → repo root
const ANDROID_DIR = join(ROOT, 'android');
const APK_PATH = join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const DEFAULT_OUT_DIR = join(ROOT, 'demo', 'out');
const APP_ID = 'com.whim';
const DEVICE_RECORDING_PATH = '/sdcard/whim-demo.mp4';

const DEFAULT_AVD = 'Pixel_9_Pro_XL';
const SCREENRECORD_BITRATE = '8000000';
const RECORD_WARMUP_MS = 1500; // let screenrecord actually start on-device before Maestro taps
const RECORD_FINALIZE_MS = 2000; // after SIGINT, before adb pull — lets the on-device mp4 close
const BOOT_TIMEOUT_MS = 5 * 60 * 1000; // cold emulator boot is legitimately slow
const BOOT_POLL_MS = 3000;

// Tools resolved PATH-first; these are the grounded fallback locations on this machine (from
// the harness spec) in case a caller's PATH doesn't include them.
const TOOL_FALLBACKS = {
  adb: join(homedir(), 'Library/Android/sdk/platform-tools/adb'),
  emulator: join(homedir(), 'Library/Android/sdk/emulator/emulator'),
  maestro: '/opt/homebrew/bin/maestro',
  ffmpeg: '/opt/homebrew/bin/ffmpeg',
};

function log(msg) {
  console.log(`[film] ${msg}`);
}

async function fileExists(path) {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run a command to completion with inherited stdio (progress-visible for long steps like
// gradle/maestro). Rejects with a descriptive Error on non-zero exit or spawn failure.
function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', ...opts });
    child.on('error', (err) => reject(new Error(`failed to run \`${cmd} ${args.join(' ')}\`: ${err.message}`)));
    child.on('exit', (code, signal) => {
      if (signal) return reject(new Error(`\`${cmd} ${args.join(' ')}\` was killed by ${signal}`));
      if (code !== 0) return reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with code ${code}`));
      resolvePromise();
    });
  });
}

// Same as run(), but captures stdout instead of inheriting — for short status queries.
async function runCapture(cmd, args, opts = {}) {
  const { stdout } = await execFileP(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts });
  return stdout;
}

async function resolveTool(name) {
  try {
    await execFileP('/bin/sh', ['-c', `command -v ${name}`]);
    return name; // on PATH — call by bare name so any caller-side PATH override is honored
  } catch {
    const fallback = TOOL_FALLBACKS[name];
    if (fallback && (await fileExists(fallback))) return fallback;
    throw new Error(
      `required tool "${name}" was not found on PATH` + (fallback ? ` or at the fallback location ${fallback}` : ''),
    );
  }
}

function parseArgs(argv) {
  const rest = [];
  let out;
  let rebuild = false;
  let avd = DEFAULT_AVD;
  let doTighten = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      out = argv[i + 1];
      i++;
    } else if (argv[i] === '--rebuild') {
      rebuild = true;
    } else if (argv[i] === '--avd') {
      avd = argv[i + 1];
      i++;
    } else if (argv[i] === '--tighten') {
      doTighten = true;
    } else {
      rest.push(argv[i]);
    }
  }
  if (rest.length !== 1) {
    console.error('usage: node demo/android/film.mjs <flow.yaml> [--out <dir>] [--rebuild] [--avd <name>] [--tighten]');
    process.exit(1);
  }
  return { flowArg: rest[0], outDir: out ? resolve(out) : DEFAULT_OUT_DIR, rebuild, avd, doTighten };
}

// ── PREFLIGHT ───────────────────────────────────────────────────────────────────────────────
async function preflight(flowPath) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 11)) {
    throw new Error(`Node >= 22.11 required (repo engines field) — running under Node ${process.version}`);
  }
  if (!(await fileExists(flowPath))) {
    throw new Error(`flow file not found: ${flowPath}`);
  }
  const tools = {};
  for (const name of ['adb', 'emulator', 'maestro', 'ffmpeg']) {
    tools[name] = await resolveTool(name);
  }
  return tools;
}

// ── DEVICE: reuse a running emulator, or boot one ──────────────────────────────────────────
async function listOnlineDevices(adb) {
  const stdout = await runCapture(adb, ['devices']);
  return stdout
    .split('\n')
    .slice(1) // drop the "List of devices attached" header line
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/))
    .filter(([, state]) => state === 'device')
    .map(([id]) => id);
}

async function ensureDevice(adb, emulator, avdName) {
  const online = await listOnlineDevices(adb);
  if (online.length > 0) {
    log(`reusing already-running device ${online[0]}`);
    return online[0];
  }

  const avdList = (await runCapture(emulator, ['-list-avds'])).split('\n').map((s) => s.trim()).filter(Boolean);
  if (!avdList.includes(avdName)) {
    throw new Error(`AVD "${avdName}" not found (available: ${avdList.join(', ') || '(none)'})`);
  }

  log(`no device running — booting AVD "${avdName}" headless...`);
  const child = spawn(
    emulator,
    ['-avd', avdName, '-no-window', '-gpu', 'swiftshader_indirect', '-no-snapshot', '-no-audio'],
    { detached: true, stdio: 'ignore' },
  );
  child.unref(); // outlives this process on purpose — the orchestrator may want it after we exit
  child.on('error', (err) => {
    // Fires only for a spawn-level failure (e.g. binary missing) — the boot-poll loop below
    // is what actually detects "never came up" and produces the user-facing error.
    console.error(`[film] emulator process error: ${err.message}`);
  });

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const nowOnline = await listOnlineDevices(adb);
    if (nowOnline.length > 0) {
      try {
        const boot = (await runCapture(adb, ['-s', nowOnline[0], 'shell', 'getprop', 'sys.boot_completed'])).trim();
        if (boot === '1') {
          log(`device ${nowOnline[0]} finished booting`);
          return nowOnline[0];
        }
      } catch {
        // device node exists but boot isn't far enough along to answer shell commands yet
      }
    }
    await sleep(BOOT_POLL_MS);
  }
  throw new Error(`emulator "${avdName}" did not finish booting within ${BOOT_TIMEOUT_MS / 1000}s`);
}

// ── APK: rebuild only if missing or forced — this is the one place freshness is decided ────
async function ensureApk(rebuild) {
  if (!rebuild && (await fileExists(APK_PATH))) {
    log(`reusing existing release APK: ${APK_PATH}`);
    return;
  }
  log('building JS bundle (npm run build)...');
  await run('npm', ['run', 'build'], { cwd: ROOT });
  log('building release APK (gradlew assembleRelease — this can take several minutes)...');
  await run('./gradlew', ['assembleRelease'], { cwd: ANDROID_DIR });
  if (!(await fileExists(APK_PATH))) {
    throw new Error(`gradlew assembleRelease finished but did not produce ${APK_PATH}`);
  }
}

// ── screen recording: started/stopped around the maestro run ──────────────────────────────
function startScreenrecord(adb, deviceId) {
  const child = spawn(
    adb,
    ['-s', deviceId, 'shell', 'screenrecord', '--bit-rate', SCREENRECORD_BITRATE, DEVICE_RECORDING_PATH],
    { stdio: 'ignore' },
  );
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  return {
    child,
    get isRunning() {
      return !exited;
    },
  };
}

// SIGINT on the local `adb shell` client forwards a Ctrl-C to the remote pty, which is what
// makes the on-device `screenrecord` process finalize its mp4 container instead of leaving it
// truncated — killing the local process outright (SIGKILL/SIGTERM) does not do this.
async function stopScreenrecord(recorder) {
  if (recorder.isRunning) {
    recorder.child.kill('SIGINT');
  }
  await sleep(RECORD_FINALIZE_MS);
}

async function finalizeVideo(ffmpeg, rawPath, outPath) {
  try {
    await run(ffmpeg, ['-y', '-i', rawPath, '-c', 'copy', '-movflags', '+faststart', outPath], { stdio: 'inherit' });
  } catch (err) {
    log(`ffmpeg remux (stream copy) failed (${err.message}) — falling back to re-encode...`);
    await run(ffmpeg, ['-y', '-i', rawPath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outPath], { stdio: 'inherit' });
  }
}

async function main() {
  const { flowArg, outDir, rebuild, avd, doTighten } = parseArgs(process.argv.slice(2));
  const flowPath = resolve(flowArg);
  const flowName = basename(flowPath, extname(flowPath));

  let tools;
  try {
    tools = await preflight(flowPath);
  } catch (err) {
    console.error(`[film] preflight failed: ${err.message}`);
    process.exit(1);
  }
  const { adb, emulator, maestro, ffmpeg } = tools;

  await mkdir(outDir, { recursive: true });

  let deviceId;
  try {
    deviceId = await ensureDevice(adb, emulator, avd);
    await ensureApk(rebuild);
    log(`installing ${APK_PATH}...`);
    await run(adb, ['-s', deviceId, 'install', '-r', APK_PATH]);
    log(`clearing app data (pm clear ${APP_ID}) for a fresh seeded first run...`);
    await run(adb, ['-s', deviceId, 'shell', 'pm', 'clear', APP_ID]);
  } catch (err) {
    console.error(`[film] setup failed before recording started: ${err.message}`);
    process.exit(1);
  }

  // From here on, a recorder process may exist on the device — every exit path below tears it
  // down via the finally block, whether the flow succeeds, throws, or is aborted.
  log('starting screen recording...');
  const recorder = startScreenrecord(adb, deviceId);
  await sleep(RECORD_WARMUP_MS);

  let maestroError = null;
  try {
    log(`running maestro test ${flowPath}...`);
    await run(maestro, ['--device', deviceId, 'test', flowPath], { cwd: ROOT });
  } catch (err) {
    maestroError = err;
  } finally {
    log('stopping screen recording...');
    await stopScreenrecord(recorder);
  }

  const rawLocalPath = join(outDir, `.${flowName}-android.raw.mp4`);
  const outPath = join(outDir, `${flowName}-android.mp4`);
  try {
    log(`pulling ${DEVICE_RECORDING_PATH}...`);
    await run(adb, ['-s', deviceId, 'pull', DEVICE_RECORDING_PATH, rawLocalPath]);
    await run(adb, ['-s', deviceId, 'shell', 'rm', DEVICE_RECORDING_PATH]).catch(() => {}); // best-effort
    log(`finalizing ${outPath}...`);
    await finalizeVideo(ffmpeg, rawLocalPath, outPath);
    await rm(rawLocalPath, { force: true });
  } catch (err) {
    console.error(`[film] failed to pull/finalize the recording: ${err.message}`);
    process.exit(1);
  }

  if (maestroError) {
    console.error(`\n[film] maestro flow "${flowName}" failed: ${maestroError.message}`);
    console.error(`[film] the partial recording was still saved to ${outPath} for debugging.`);
    process.exit(1);
  }

  console.log(`\n[film] Demo video written: ${outPath}`);

  if (doTighten) {
    try {
      const result = await tighten(outPath);
      if (result.skipped) {
        log(`already tight (no static stretches found) — kept raw only: ${outPath}`);
      } else {
        log(
          `tightened ${result.totalDuration.toFixed(2)}s -> ${result.outDuration.toFixed(2)}s ` +
            `(${result.cuts} cuts, ${result.removedSec.toFixed(2)}s removed)`,
        );
        console.log(`[film] Tightened demo video written: ${result.outPath}`);
      }
    } catch (err) {
      console.error(`[film] --tighten skipped — ${err.message}`);
    }
  }
}

await main();
