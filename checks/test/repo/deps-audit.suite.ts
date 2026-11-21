/**
 * `npm run deps:audit` (spec `dependency-currency`, "A networked audit reports undeclared lag").
 * Each scenario runs the real script against a temp repo, with `--registry` pointed at a stub
 * registry on loopback: the dist-tags it answers are the scenario, and nothing leaves the machine.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test, assert } from '../harness';

const ROOT = process.cwd();
const SCRIPT = path.join(ROOT, 'scripts', 'deps-audit.mjs');
const RUN_TIMEOUT_MS = 30_000;

interface AuditRun {
  code: number | null;
  stdout: string;
  stderr: string;
  requested: string[];
}

/** A root + `server` workspace repo: root declares `zod` and `typescript`, the server `hono`
 *  and the scoped `@hono/node-server`; `typescript` is pinned to ^6. */
function writeRepo(dir: string, resolved: Record<string, string>): void {
  fs.mkdirSync(path.join(dir, 'server'));
  const rootManifest = { name: 'root', workspaces: ['server'], dependencies: { zod: '^4.3.0' }, devDependencies: { typescript: '^6.0.0' } };
  const serverManifest = { name: '@x/server', dependencies: { hono: '^4.13.0', '@hono/node-server': '^2.1.0', root: '*' } };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(rootManifest));
  fs.writeFileSync(path.join(dir, 'server', 'package.json'), JSON.stringify(serverManifest));
  const packages: Record<string, { version: string }> = {};
  for (const [name, version] of Object.entries(resolved)) packages[`node_modules/${name}`] = { version };
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  const register = [{ package: 'typescript', range: '^6.0.0', reason: 'typescript 7 ships no compiler API', lift: 'A stable 7.x with a compiler API' }];
  fs.writeFileSync(path.join(dir, 'dependency-pins.json'), JSON.stringify(register));
}

/** Runs the audit against a temp repo resolving `resolved`, with a stub registry answering `tags`
 *  (a package it does not list gets a 404). */
async function audit(resolved: Record<string, string>, tags: Record<string, Record<string, string>>): Promise<AuditRun> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-deps-audit-'));
  const requested: string[] = [];
  const server = http.createServer((req, res) => {
    const match = /^\/-\/package\/([^/]+)\/dist-tags$/.exec(req.url ?? '');
    const name = match ? decodeURIComponent(match[1]) : '';
    requested.push(name);
    const body = tags[name];
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? { error: 'not found' }));
  });
  try {
    writeRepo(dir, resolved);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const child = spawn(process.execPath, [SCRIPT, '--root', dir, '--registry', `http://127.0.0.1:${port}/`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.stderr.on('data', (chunk) => (stderr += String(chunk)));
    let timer: NodeJS.Timeout | undefined;
    const code = await Promise.race([
      new Promise<number | null>((resolve) => child.on('close', resolve)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`deps-audit did not finish within ${RUN_TIMEOUT_MS} ms; stdout so far: ${stdout}`));
        }, RUN_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
    return { code, stdout, stderr, requested };
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const CURRENT = { zod: '4.3.2', typescript: '6.0.3', hono: '4.13.19', '@hono/node-server': '2.1.11' };
const TAGS = {
  zod: { latest: '4.3.2', canary: '4.5.0-canary.1' },
  typescript: { latest: '7.0.2', next: '7.1.0-dev.1' },
  hono: { latest: '4.13.19', next: '5.0.0-rc.1' },
  '@hono/node-server': { latest: '2.1.11' },
};

export async function run(): Promise<void> {
  await test('deps:audit: a dependency below its latest with no pin entry exits 1, listing the package with both versions', async () => {
    const r = await audit({ ...CURRENT, zod: '4.3.1' }, TAGS);
    assert(r.code === 1, `expected exit 1, got ${String(r.code)}; stdout: ${r.stdout} stderr: ${r.stderr}`);
    const line = r.stdout.split('\n').find((l) => l.includes('zod'));
    assert(line !== undefined && line.includes('4.3.1') && line.includes('4.3.2'), `expected a line naming zod 4.3.1 and 4.3.2, got: ${r.stdout}`);
    assert(!r.stdout.split('\n').some((l) => l.includes('hono') && l.includes('->')), `a current package is not lag: ${r.stdout}`);
  });

  await test('deps:audit: a repo where every dependency is on latest or pinned exits 0, with prerelease tags ignored', async () => {
    const r = await audit(CURRENT, TAGS);
    assert(r.code === 0, `expected exit 0, got ${String(r.code)}; stdout: ${r.stdout} stderr: ${r.stderr}`);
    for (const name of Object.keys(CURRENT)) assert(r.requested.includes(name), `the registry was never asked for ${name}: asked ${JSON.stringify(r.requested)}`);
    assert(!r.requested.includes('root'), `a workspace package is not a registry dependency: asked ${JSON.stringify(r.requested)}`);
  });

  await test('deps:audit: a pin is listed with its range, the current latest and its lift condition', async () => {
    const r = await audit(CURRENT, TAGS);
    const at = r.stdout.split('\n').findIndex((l) => l.includes('typescript') && l.includes('^6.0.0'));
    assert(at >= 0 && r.stdout.split('\n')[at].includes('7.0.2'), `expected typescript listed with ^6.0.0 and 7.0.2, got: ${r.stdout}`);
    assert(r.stdout.includes('A stable 7.x with a compiler API'), `expected the pin's lift condition in the output, got: ${r.stdout}`);
  });

  await test('deps:audit: a registry that cannot answer for a package exits 2, naming it', async () => {
    const withoutHono = Object.fromEntries(Object.entries(TAGS).filter(([name]) => name !== 'hono'));
    const r = await audit(CURRENT, withoutHono);
    assert(r.code === 2, `expected exit 2, got ${String(r.code)}; stdout: ${r.stdout} stderr: ${r.stderr}`);
    assert(r.stderr.includes('hono') && r.stderr.includes('404'), `expected the failure to name hono and the 404, got: ${r.stderr}`);
  });

  await test('deps:audit: neither gate script runs the audit (the gates have no registry egress)', () => {
    for (const gate of ['gate.sh', 'gate-full.sh']) {
      const text = fs.readFileSync(path.join(ROOT, 'scripts', gate), 'utf8');
      assert(text.includes('checks:test') || text.includes('gate.sh'), `scripts/${gate} does not look like a gate script: the scan read the wrong file`);
      assert(!/deps:audit|deps-audit/.test(text), `scripts/${gate} invokes the networked dependency audit`);
    }
  });
}
