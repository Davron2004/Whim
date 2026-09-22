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
import { createConnection, createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const runMjs = path.join(repoRoot, 'scripts', 'netdeny', 'run.mjs');
const CANARY_TIMEOUT_MS = 10_000;
const READY_LINE = 'netdeny canary: listening ';

// `variants.ts` has no side effects (unlike `canary.ts`, whose module top level starts the
// server as soon as it's imported), so bundle just it to a temp module and read the arrays off
// it directly — never a hand-copy that can drift from the source it's supposed to mirror.
async function loadVariants() {
  const entry = path.join(repoRoot, 'scripts', 'netdeny', 'variants.ts');
  const outfile = path.join(repoRoot, `.netdeny-variants.${process.pid}.tmp.mjs`);
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    tsconfigRaw: '{}',
    logLevel: 'warning',
  });
  try {
    return await import(pathToFileURL(outfile).href);
  } finally {
    fs.rmSync(outfile, { force: true });
  }
}

const { NAVIGATION_VARIANTS, LEAK_REQUIRED_VARIANTS: LEAK_REQUIRED } = await loadVariants();

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

async function allocatePortPair() {
  const servers = [createServer(), createServer()];
  try {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => {
              server.off('error', reject);
              resolve();
            });
          }),
      ),
    );
    return servers.map((server) => {
      const address = server.address();
      assert.ok(address && typeof address === 'object', 'OS did not assign a TCP port');
      return address.port;
    });
  } finally {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise((resolve) => {
            if (server.listening) server.close(resolve);
            else resolve();
          }),
      ),
    );
  }
}

function diagnostics(result) {
  return [
    `exit=${String(result.code)} signal=${result.signal || 'none'}`,
    `stdout:\n${result.stdout || '<empty>'}`,
    `stderr:\n${result.stderr || '<empty>'}`,
  ].join('\n');
}

/** Spawns `run.mjs canary <args>`, exposes its concrete listener-ready signal, and guarantees
 *  a stalled child cannot outlive the test. */
function spawnCanary(args) {
  const child = spawn(process.execPath, [runMjs, 'canary', ...args], { cwd: repoRoot });
  let stdout = '';
  let stderr = '';
  let closed = false;
  let timedOut = false;
  let spawnError;
  let signalReady;
  const ready = new Promise((resolve) => {
    signalReady = resolve;
  });

  child.stdout.on('data', (d) => {
    stdout += d.toString();
    if (stdout.includes(READY_LINE)) signalReady();
  });
  child.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.includes(READY_LINE)) signalReady();
  });

  child.once('error', (error) => {
    spawnError = error;
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, CANARY_TIMEOUT_MS);
  const exited = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      closed = true;
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });

  return {
    async waitForReady() {
      const outcome = await Promise.race([ready.then(() => undefined), exited]);
      if (outcome) {
        let reason = 'exited before listener readiness';
        if (timedOut) reason = `timed out after ${CANARY_TIMEOUT_MS} ms before listener readiness`;
        else if (spawnError) reason = `failed to spawn: ${spawnError.message}`;
        throw new Error(`canary ${reason}\n${diagnostics(outcome)}`);
      }
    },
    async waitForExit() {
      const result = await exited;
      if (timedOut) {
        throw new Error(`canary timed out after ${CANARY_TIMEOUT_MS} ms\n${diagnostics(result)}`);
      }
      if (spawnError) {
        throw new Error(`canary failed to spawn: ${spawnError.message}\n${diagnostics(result)}`);
      }
      return result;
    },
    /** End the run the way an operator would after the traffic is done — SIGINT, which
     *  `canary.ts` handles the same way as its `--seconds` timer (prints the summary, exits) —
     *  instead of racing a fixed wall-clock window that a loaded machine can close mid-fetch. */
    async finishAndWaitForExit() {
      if (!closed) child.kill('SIGINT');
      return this.waitForExit();
    },
    async stop() {
      if (!closed) child.kill('SIGKILL');
      await exited;
    },
  };
}

await test('zero with no traffic exits 1, naming every un-fetched bundle', async () => {
  const [httpPort, tlsPort] = await allocatePortPair();
  const canary = spawnCanary([
    '--expect',
    'zero',
    '--seconds',
    '2',
    '--http-port',
    String(httpPort),
    '--tls-port',
    String(tlsPort),
  ]);
  try {
    await canary.waitForReady();
    const result = await canary.waitForExit();
    assert.equal(result.code, 1, `expected exit 1\n${diagnostics(result)}`);
    assert.match(result.stdout, /NETDENY FAIL expect=zero/, diagnostics(result));
    assert.ok(
      result.stdout.includes(`missing=${NAVIGATION_VARIANTS.join(',')}`),
      `missing= should name every variant\n${diagnostics(result)}`,
    );
  } finally {
    await canary.stop();
  }
});

await test('zero after fetching all six bundles with no hits exits 0', async () => {
  const [httpPort, tlsPort] = await allocatePortPair();
  const base = `http://127.0.0.1:${httpPort}`;
  const tlsBase = `https://127.0.0.1:${tlsPort}`;
  const canary = spawnCanary(['--expect', 'zero', '--http-port', String(httpPort), '--tls-port', String(tlsPort)]);

  try {
    await canary.waitForReady();
    for (const variant of NAVIGATION_VARIANTS) {
      const url = `${base}/wnd/bundle/${variant}?http=${encodeURIComponent(base)}&tls=${encodeURIComponent(tlsBase)}&run=testB`;
      const res = await fetch(url);
      await res.text();
    }

    const result = await canary.finishAndWaitForExit();
    assert.equal(result.code, 0, `expected exit 0\n${diagnostics(result)}`);
    assert.ok(
      result.stdout.includes(`bundles=${NAVIGATION_VARIANTS.length}`),
      `should count every bundle fetch\n${diagnostics(result)}`,
    );
    assert.match(result.stdout, /NETDENY PASS expect=zero/, diagnostics(result));
    assert.ok(
      !result.stdout.includes('missing='),
      `a passing zero run should name nothing missing\n${diagnostics(result)}`,
    );
  } finally {
    await canary.stop();
  }
});

await test('leak passes on every required hit and a TLS connection, unaffected by zero bundle fetches', async () => {
  const [httpPort, tlsPort] = await allocatePortPair();
  const canary = spawnCanary(['--expect', 'leak', '--http-port', String(httpPort), '--tls-port', String(tlsPort)]);

  try {
    await canary.waitForReady();
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

    const result = await canary.finishAndWaitForExit();
    assert.equal(result.code, 0, `expected exit 0\n${diagnostics(result)}`);
    assert.ok(result.stdout.includes('bundles=0'), `should report zero bundle fetches\n${diagnostics(result)}`);
    assert.match(result.stdout, /NETDENY PASS expect=leak/, diagnostics(result));
  } finally {
    await canary.stop();
  }
});

console.log(`\n${pass} netdeny canary case(s) passed`);
