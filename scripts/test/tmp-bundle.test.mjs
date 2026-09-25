#!/usr/bin/env node
// Suite for scripts/lib/tmp-bundle.mjs: a runner's esbuild bundle never outlives the run in the
// repo root. Framework-free, house idiom: assert + a pass counter, exit non-zero on the first failure.
//
// Each case runs a REAL child process shaped exactly like the Node runners (write the bundle,
// `import()` it, remove it in `finally`) inside a throwaway root, and inspects the root afterwards.
// The two ways the old idiom leaked are reproduced as they happen in practice: the suite calling
// `process.exit(1)`, as every suite does on a failure, and the runner being SIGKILLed mid-suite.
// The first case is the control: the pre-fix idiom must still leak in this fixture, or the others
// prove nothing.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HELPER = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'tmp-bundle.mjs')).href;

let pass = 0;
async function test(name, fn) {
  try { await fn(); pass += 1; console.log('PASS:', name); }
  catch (e) { console.error('FAIL:', name, '\n', (e && e.stack) || e); process.exit(1); }
}

const roots = [];
process.on('exit', () => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function newRoot() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whim-tmp-bundle-')));
  roots.push(root);
  // The runner, as the real ones are written. OUTFILE_MODE=legacy is the pre-fix idiom.
  fs.writeFileSync(path.join(root, 'runner.mjs'), `
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpBundlePath } from ${JSON.stringify(HELPER)};
const outfile = process.env.OUTFILE_MODE === 'legacy'
  ? path.join(process.cwd(), \`.probe-acceptance.\${process.pid}.tmp.mjs\`)
  : tmpBundlePath('probe-acceptance');
fs.writeFileSync(outfile, process.env.BUNDLE_SOURCE);
try {
  await import(pathToFileURL(outfile));
} finally {
  fs.rmSync(outfile, { force: true });
}
`);
  return root;
}

// Everything the run left behind, relative to the root, runner.mjs itself excluded.
function leftovers(root) {
  const out = [];
  for (const e of fs.readdirSync(root)) {
    if (e === 'runner.mjs') continue;
    const p = path.join(root, e);
    if (fs.statSync(p).isDirectory()) for (const k of fs.readdirSync(p)) out.push(`${e}/${k}`);
    else out.push(e);
  }
  return out;
}

function runSync(root, bundleSource, env = {}) {
  return spawnSync(process.execPath, ['runner.mjs'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...env, BUNDLE_SOURCE: bundleSource },
  });
}

const SUITE_FAILS = "console.log('1 passed, 1 failed'); process.exit(1);";
const SUITE_PASSES = "console.log('2 passed, 0 failed');";
const SUITE_HANGS = "console.log('READY'); await new Promise(() => setInterval(() => {}, 1000));";

// Runs the runner until the suite reports READY, then SIGKILLs it. Resolves with its pid.
function runAndKill(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['runner.mjs'], {
      cwd: root, env: { ...process.env, BUNDLE_SOURCE: SUITE_HANGS }, stdio: ['ignore', 'pipe', 'inherit'],
    });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('runner never reported READY')); }, 20_000);
    child.stdout.on('data', (d) => { if (String(d).includes('READY')) child.kill('SIGKILL'); });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (signal === 'SIGKILL') resolve(child.pid);
      else reject(new Error(`runner exited ${code}/${signal} instead of being killed`));
    });
  });
}

function backdate(file, ms) {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(file, t, t);
}

await test('control: the pre-fix idiom leaves its bundle in the root when the suite fails', async () => {
  const root = newRoot();
  const r = runSync(root, SUITE_FAILS, { OUTFILE_MODE: 'legacy' });
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(leftovers(root), [`.probe-acceptance.${r.pid}.tmp.mjs`]);
});

await test('a failing suite (process.exit(1)) leaves nothing behind', async () => {
  const root = newRoot();
  const r = runSync(root, SUITE_FAILS);
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(leftovers(root), []);
});

await test('a passing suite leaves nothing behind', async () => {
  const root = newRoot();
  const r = runSync(root, SUITE_PASSES);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 passed/);
  assert.deepEqual(leftovers(root), []);
});

await test('a SIGKILLed run leaves its bundle in .tmp-bundles/, never in the root', async () => {
  const root = newRoot();
  const pid = await runAndKill(root);
  assert.deepEqual(leftovers(root), [`.tmp-bundles/probe-acceptance.${pid}.mjs`]);
});

await test('the next run sweeps a dead run\'s bundle once it is older than a minute', async () => {
  const root = newRoot();
  const pid = await runAndKill(root);
  const stale = path.join(root, '.tmp-bundles', `probe-acceptance.${pid}.mjs`);

  // Fresh: kept. Its importer may be in another pid namespace and not have read it yet.
  assert.equal(runSync(root, SUITE_PASSES).status, 0);
  assert.ok(fs.existsSync(stale), 'a dead run\'s bundle younger than a minute must be kept');

  backdate(stale, 2 * 60_000);
  assert.equal(runSync(root, SUITE_PASSES).status, 0);
  assert.deepEqual(leftovers(root), []);
});

await test('a live process\'s bundle is never swept, however old', async () => {
  const root = newRoot();
  const live = path.join(root, '.tmp-bundles', `other-runner.${process.pid}.mjs`);
  fs.mkdirSync(path.dirname(live), { recursive: true });
  fs.writeFileSync(live, '');
  backdate(live, 60 * 60_000);
  assert.equal(runSync(root, SUITE_PASSES).status, 0);
  assert.ok(fs.existsSync(live), 'the bundle of a running process was swept');
});

await test('one process bundling many suites removes them all and warns about nothing', async () => {
  // src/sdk/test/run.mjs bundles one file per suite in a single process.
  const root = newRoot();
  const script = `
import fs from 'node:fs';
import { tmpBundlePath } from ${JSON.stringify(HELPER)};
for (let i = 0; i < 15; i++) fs.writeFileSync(tmpBundlePath('sdk-suite-' + i), '');
`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.deepEqual(leftovers(root), []);
});

console.log(`\ntmp-bundle tests: ${pass} passed`);
