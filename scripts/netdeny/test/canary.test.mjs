#!/usr/bin/env node
// Node-level acceptance for scripts/netdeny/canary.ts's bundle-fetch requirement
// (platform-release-readiness/release-fixes-b finding 5: a `--expect zero` canary that never saw
// a real bundle request proves nothing — a wrong build, a disabled flag, or a blocked fetch would
// otherwise print PASS with no traffic to deny at all).
//
// Framework-free, house idiom (mirrors scripts/test/sonar-pr-issues.test.mjs): assert + a pass
// counter, exit non-zero on the first failure. Spawns the real `run.mjs canary` subprocess for
// every case (never imports `canary.ts` directly — its module top level starts the server as
// soon as it's imported) and drives it with real HTTP and TCP traffic, asserting on the process's
// stdout summary line and exit code.
//
// Not wired into `scripts/gate.sh` — `package.json` is Class-1 protected and the canary is
// documented (`handoff/netdeny-probe.md`'s "Verified directly" section) as a manually-run
// reproduction harness, same as before this fix. Run by hand from the repo root:
//
//   node scripts/netdeny/test/canary.test.mjs
//
// and re-run whenever `canary.ts` changes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mirrors `scripts/netdeny/variants.ts`'s `NAVIGATION_VARIANTS`, in order, by hand — a plain Node
// script can't import the `.ts` module without a loader.
const NAVIGATION_VARIANTS = ['loc-href', 'loc-assign', 'meta-refresh', 'anchor-click', 'loc-href-https', 'dns-name'];
const LEAK_REQUIRED = ['loc-href', 'loc-assign', 'meta-refresh', 'anchor-click', 'host-top-frame'];

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const runMjs = path.join(repoRoot, 'scripts', 'netdeny', 'run.mjs');

let pass = 0;
async function test(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log('PASS:', name);
  } catch (e) {
    console.error('FAIL:', name, '\n', (e && e.stack) || e);
    process.exit(1);
  }
}

/** Spawns `run.mjs canary <args>`, resolving with its exit code and stdout once the process exits
 *  on its own (the canary's own `--seconds` timer). */
function spawnCanary(args) {
  const child = spawn(process.execPath, [runMjs, 'canary', ...args], { cwd: repoRoot });
  let stdout = '';
  child.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
  return { exited, stdoutRef: () => stdout };
}

await test('zero with no traffic exits 1, naming every un-fetched bundle', async () => {
  const { exited, stdoutRef } = spawnCanary(['--expect', 'zero', '--seconds', '2', '--http-port', '18765', '--tls-port', '18766']);
  const code = await exited;
  const stdout = stdoutRef();
  assert.equal(code, 1, `expected exit 1, got ${code} (stdout: ${stdout})`);
  assert.match(stdout, /NETDENY FAIL expect=zero/);
  assert.ok(stdout.includes(`missing=${NAVIGATION_VARIANTS.join(',')}`), `missing= should name every variant (stdout: ${stdout})`);
});

await test('zero after fetching all six bundles with no hits exits 0', async () => {
  const httpPort = 18767;
  const tlsPort = 18768;
  const base = `http://127.0.0.1:${httpPort}`;
  const tlsBase = `https://127.0.0.1:${tlsPort}`;
  const { exited, stdoutRef } = spawnCanary(['--expect', 'zero', '--seconds', '3', '--http-port', String(httpPort), '--tls-port', String(tlsPort)]);

  // Give the HTTP/TLS listeners time to bind before the first request.
  await new Promise((r) => setTimeout(r, 400));
  for (const variant of NAVIGATION_VARIANTS) {
    const url = `${base}/wnd/bundle/${variant}?http=${encodeURIComponent(base)}&tls=${encodeURIComponent(tlsBase)}&run=testB`;
    const res = await fetch(url);
    await res.text();
  }

  const code = await exited;
  const stdout = stdoutRef();
  assert.equal(code, 0, `expected exit 0, got ${code} (stdout: ${stdout})`);
  assert.ok(stdout.includes(`bundles=${NAVIGATION_VARIANTS.length}`), `should count every bundle fetch (stdout: ${stdout})`);
  assert.match(stdout, /NETDENY PASS expect=zero/);
  assert.ok(!stdout.includes('missing='), `a passing zero run should name nothing missing (stdout: ${stdout})`);
});

await test('leak passes on every required hit and a TLS connection, unaffected by zero bundle fetches', async () => {
  const httpPort = 18769;
  const tlsPort = 18770;
  const { exited, stdoutRef } = spawnCanary(['--expect', 'leak', '--seconds', '3', '--http-port', String(httpPort), '--tls-port', String(tlsPort)]);

  await new Promise((r) => setTimeout(r, 400));
  // No bundle is ever fetched in this case — the point is that `--expect leak` doesn't require one.
  for (const variant of LEAK_REQUIRED) {
    const res = await fetch(`http://127.0.0.1:${httpPort}/wnd/hit/${variant}?run=testC`);
    await res.text();
  }
  await new Promise((resolve, reject) => {
    const socket = createConnection(tlsPort, '127.0.0.1', () => socket.end());
    socket.once('close', resolve);
    socket.once('error', reject);
  });

  const code = await exited;
  const stdout = stdoutRef();
  assert.equal(code, 0, `expected exit 0, got ${code} (stdout: ${stdout})`);
  assert.ok(stdout.includes('bundles=0'), `should report zero bundle fetches (stdout: ${stdout})`);
  assert.match(stdout, /NETDENY PASS expect=leak/);
});

console.log(`\n${pass} netdeny canary case(s) passed`);
