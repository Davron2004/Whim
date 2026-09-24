/**
 * Production build acceptance (public-generation-server chain-11, task 12.5): specs/server-deployment
 * "A production build produces a self-contained runtime tree", "Boot fails fast when the runtime is
 * incomplete", "Production configuration refuses dev-only modes" (the stub case), "Production boot
 * proves the synthetic run works before serving" (the browser that cannot start), and "SIGTERM
 * drains in-flight work before exit".
 *
 * The tree is built into a temporary directory outside the checkout, given a `node_modules` holding
 * only the declared runtime packages, and started as a real process with `node server/main.mjs`
 * from its root — the production start command. Every case runs the stub pipeline or fails before a
 * browser starts, so this suite launches no browser and makes no request off the loopback.
 *
 * Also covers the OpenRouter usage-and-cost transport composition wires (`usage/openrouter-stats.ts`).
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { createRequire, isBuiltin } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { check, eq, section } from './harness';
import { TIMED_OUT, waitFor, within } from './route-doubles';
import { productionEntryInputs } from './build-fixtures';
import { buildRuntimeTree } from '../build.mjs';
import { RUNTIME_ASSETS } from '../src/runtime-assets';
import { loadFewShotExamples } from '../src/generation/prompts/inputs';
import { openRouterUsageAndCostTransport } from '../src/usage/openrouter-stats';
import { MANIFESTS, keepLimit, latestVersion } from '../../contract/src/disclosure-manifest';

const ROOT = process.cwd();
const BUNDLES = ['server/main.mjs', 'server/main.mjs.map', 'server/whim-admin.mjs', 'server/whim-admin.mjs.map'];
const BOOT_MS = 20_000;
const EXIT_MS = 15_000;
const DEVICE_A = 'a11a11a1-a11a-41a1-81a1-a11a11a11a11';
const DEVICE_B = 'b22b22b2-b22b-42b2-82b2-b22b22b22b22';

function declaredRuntimePackages(): string[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
  return Object.keys(manifest.dependencies).filter((name) => !name.startsWith('@whim/'));
}

function listFiles(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), rel) : [rel];
  });
}

/** Where Node resolves `name` from the server workspace: the package's own directory. */
function packageDir(name: string): string {
  const lookup = createRequire(path.join(ROOT, 'server', 'package.json')).resolve.paths(name) ?? [];
  const found = lookup.map((dir) => path.join(dir, name)).find((dir) => fs.existsSync(path.join(dir, 'package.json')));
  if (!found) throw new Error(`setup: ${name} does not resolve from the server workspace`);
  return fs.realpathSync(found);
}

/** Bare module specifiers a bundle still loads at run time: its import and export declarations, and
 *  `import()`, `require()` and esbuild's `__require()` calls on a string. String contents never
 *  count, so candidate source text inside the bundle is not mistaken for an import. */
function bareSpecifiers(bundle: string): string[] {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      found.add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
      const callee = node.expression;
      const loads = callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && (callee.text === 'require' || callee.text === '__require'));
      if (loads) found.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('bundle.mjs', bundle, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS));
  return [...found].filter((spec) => !spec.startsWith('.') && !spec.startsWith('/')).sort((a, b) => a.localeCompare(b));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** One `node server/main.mjs` process started from a tree root, with its combined output. */
class TreeProcess {
  private output = '';
  readonly exited: Promise<Exit>;
  private readonly child: ChildProcessByStdio<null, Readable, Readable>;
  private exit: Exit | undefined;

  constructor(root: string, env: Record<string, string>) {
    this.child = spawn(process.execPath, ['server/main.mjs'], {
      cwd: root,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? os.homedir(), WHIM_LOG_JSON: '1', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      this.output += chunk;
    });
    this.child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      this.output += chunk;
    });
    this.exited = new Promise((resolve) => {
      this.child.once('exit', (code, signal) => {
        this.exit = { code, signal };
        resolve(this.exit);
      });
    });
  }

  text(): string {
    return this.output;
  }

  /** The JSON log records whose `msg` is `message`. */
  logs(message: string): Record<string, unknown>[] {
    return this.output
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch (err) {
          return { unparsed: line, detail: String(err) };
        }
      })
      .filter((record) => record.msg === message);
  }

  waitForLog(message: string, ms: number): Promise<boolean> {
    return waitFor(() => this.logs(message).length > 0 || this.exit !== undefined, ms).then(() => this.logs(message).length > 0);
  }

  signal(signal: NodeJS.Signals): void {
    this.child.kill(signal);
  }

  /** Stops the process if a failed case left it running. */
  async dispose(): Promise<void> {
    if (this.exit) return;
    this.child.kill('SIGKILL');
    await within(this.exited, EXIT_MS);
  }
}

async function exitOf(proc: TreeProcess): Promise<Exit | typeof TIMED_OUT> {
  return within(proc.exited, EXIT_MS);
}

/** An HTTP/1.1 request written straight onto a TCP socket, accumulating the raw response. */
function rawRequest(port: number, head: string[], body?: string): { socket: net.Socket; text: () => string } {
  const socket = net.connect({ port, host: '127.0.0.1' });
  let received = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    received += chunk;
  });
  socket.on('error', (err) => {
    received += `\n[client socket error: ${err.message}]`;
  });
  socket.write([...head, '', body ?? ''].join('\r\n'));
  return { socket, text: () => received };
}

function generateHead(deviceId: string, payload: string, extra: string[] = []): string[] {
  return [
    'POST /v1/generate HTTP/1.1',
    'Host: 127.0.0.1',
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(payload)}`,
    `x-whim-device: ${deviceId}`,
    ...extra,
  ];
}

function connectRefused(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });
}

function ledgerOutcomes(dataDir: string): string[] {
  const db = new DatabaseSync(path.join(dataDir, 'usage.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT outcome FROM requests ORDER BY started_at').all() as { outcome: string }[]).map((row) => row.outcome);
  } finally {
    db.close();
  }
}

function hasTerminal(stream: string): boolean {
  return stream.includes('event: result') || stream.includes('event: failure');
}

interface Fixture {
  scratch: string;
  tree: string;
  /** A fresh copy of the started tree (with its `node_modules`) to break. */
  copy(name: string): string;
  dataDir(name: string): string;
}

async function prepareTree(): Promise<Fixture> {
  section('spec: the production build writes exactly the runtime tree');

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-prod-build-'));
  const tree = path.join(scratch, 'app');
  await buildRuntimeTree({ outDir: tree });

  eq(
    'the tree holds the two bundles with their source maps and every runtime asset, and nothing else',
    listFiles(tree).sort((a, b) => a.localeCompare(b)),
    [...BUNDLES, ...RUNTIME_ASSETS].sort((a, b) => a.localeCompare(b)),
  );
  eq(
    'the fixtures it carries are exactly the curated few-shot examples the prompt reads',
    RUNTIME_ASSETS.filter((asset) => asset.startsWith('fixtures/')),
    loadFewShotExamples(ROOT).map((example) => `fixtures/${example.name}`),
  );

  const declared = declaredRuntimePackages();
  for (const bundle of ['server/main.mjs', 'server/whim-admin.mjs']) {
    const outsiders = bareSpecifiers(fs.readFileSync(path.join(tree, bundle), 'utf8')).filter(
      (spec) => !isBuiltin(spec) && !declared.some((name) => spec === name || spec.startsWith(`${name}/`)),
    );
    eq(`${bundle} imports nothing at run time but Node built-ins and the declared runtime packages`, outsiders, []);
  }
  eq(
    'red-check: that scan sees an off-list import, a dynamic import and a require, but not source text in a string',
    bareSpecifiers('import { z } from "zod";\nimport fs from "node:fs";\nawait import("left-pad");\n__require("chalk");\nconst src = "import x from \'vc-sdk\'";'),
    ['chalk', 'left-pad', 'node:fs', 'zod'],
  );

  const inputs = await productionEntryInputs();
  check('@whim/contract is bundled into the entry', inputs.includes('contract/src/index.ts'), JSON.stringify(inputs.filter((i) => i.startsWith('contract'))));
  eq('no test module reaches the entry bundle', inputs.filter((input) => input.startsWith('server/test/')), []);

  const modules = path.join(tree, 'node_modules');
  for (const name of declared) {
    fs.mkdirSync(path.dirname(path.join(modules, name)), { recursive: true });
    fs.symlinkSync(packageDir(name), path.join(modules, name), 'dir');
  }

  let copies = 0;
  return {
    scratch,
    tree,
    copy(name: string) {
      const dest = path.join(scratch, `${name}-${++copies}`);
      fs.cpSync(tree, dest, { recursive: true, verbatimSymlinks: true });
      return dest;
    },
    dataDir(name: string) {
      return fs.mkdtempSync(path.join(scratch, `${name}-data-`));
    },
  };
}

async function testStubTreeServes(fixture: Fixture): Promise<void> {
  section('spec: the built tree starts without the checkout');

  const port = await freePort();
  const proc = new TreeProcess(fixture.tree, {
    WHIM_PIPELINE: 'stub',
    WHIM_DATA_DIR: fixture.dataDir('serves'),
    WHIM_SERVER_HOST: '127.0.0.1',
    WHIM_SERVER_PORT: String(port),
  });
  try {
    check('the tree started and listened', await proc.waitForLog('whim-server listening', BOOT_MS), proc.text().slice(-2000));
    eq('it logs the bound URL', proc.logs('whim-server listening')[0]?.url, `http://127.0.0.1:${port}`);
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    eq('GET /healthz answers 200', res.status, 200);
    eq('with the service identity and both minimum builds off', await res.json(), { ok: true, service: 'whim-server', minBuild: { ios: 0, android: 0 } });

    proc.signal('SIGTERM');
    const exit = await exitOf(proc);
    eq('an idle server drains and exits 0 on SIGTERM', exit === TIMED_OUT ? 'timed out' : exit.code, 0);
  } finally {
    await proc.dispose();
  }
}

async function expectBootRefusal(what: string, root: string, env: Record<string, string>, named: string): Promise<void> {
  const proc = new TreeProcess(root, { WHIM_SERVER_HOST: '127.0.0.1', WHIM_SERVER_PORT: String(await freePort()), ...env });
  try {
    const exit = await exitOf(proc);
    check(`${what}: the process exits non-zero`, exit !== TIMED_OUT && exit.code !== 0 && exit.code !== null, JSON.stringify(exit));
    check(`${what}: its output names ${named}`, proc.text().includes(named), proc.text().slice(-2000));
    eq(`${what}: it never listened`, proc.logs('whim-server listening').length, 0);
  } finally {
    await proc.dispose();
  }
}

async function testBootRefusals(fixture: Fixture): Promise<void> {
  section('spec: boot fails fast, by name, before listening');

  await expectBootRefusal(
    'a malformed plan reasoning setting in stub mode',
    fixture.tree,
    { WHIM_PIPELINE: 'stub', WHIM_PLAN_REASONING: 'fast', WHIM_DATA_DIR: fixture.dataDir('bad-reasoning') },
    'WHIM_PLAN_REASONING',
  );
  await expectBootRefusal(
    'a malformed repair reasoning setting in stub mode',
    fixture.tree,
    { WHIM_PIPELINE: 'stub', WHIM_REPAIR_REASONING: 'fast', WHIM_DATA_DIR: fixture.dataDir('bad-repair-reasoning') },
    'WHIM_REPAIR_REASONING',
  );

  const missingAsset = fixture.copy('missing-asset');
  fs.rmSync(path.join(missingAsset, 'docs', 'sdk-reference.md'));
  await expectBootRefusal('a removed runtime asset', missingAsset, { WHIM_PIPELINE: 'stub', WHIM_DATA_DIR: fixture.dataDir('asset') }, 'docs/sdk-reference.md');

  // The owner-only mode is not enforced for root, whose unwritable directory is one that cannot exist.
  const blocked = fixture.dataDir('readonly');
  let unwritable = blocked;
  if (process.getuid?.() === 0) {
    fs.writeFileSync(path.join(blocked, 'file'), '');
    unwritable = path.join(blocked, 'file', 'data');
  } else {
    fs.chmodSync(blocked, 0o500);
  }
  await expectBootRefusal('an unwritable data directory', fixture.tree, { WHIM_PIPELINE: 'stub', WHIM_DATA_DIR: unwritable }, unwritable);
  fs.chmodSync(blocked, 0o700);

  await expectBootRefusal(
    'NODE_ENV=production with the stub selector',
    fixture.tree,
    { NODE_ENV: 'production', WHIM_PIPELINE: 'stub', WHIM_DATA_DIR: fixture.dataDir('prod-stub') },
    'WHIM_PIPELINE',
  );

  // specs/device-records "Too long a report retention refuses to start": the process exits naming
  // the variable and the maximum the current disclosure manifest publishes for reports.
  {
    const maximum = keepLimit(MANIFESTS[latestVersion()], 'reports')?.days ?? 0;
    const proc = new TreeProcess(fixture.tree, {
      WHIM_PIPELINE: 'stub',
      WHIM_REPORT_RETENTION_DAYS: '400',
      WHIM_DATA_DIR: fixture.dataDir('long-retention'),
      WHIM_SERVER_HOST: '127.0.0.1',
      WHIM_SERVER_PORT: String(await freePort()),
    });
    try {
      const exit = await exitOf(proc);
      const failure = proc.logs('boot failed')[0];
      const detail = typeof failure?.detail === 'string' ? failure.detail : '';
      check('WHIM_REPORT_RETENTION_DAYS=400: the process exits non-zero', exit !== TIMED_OUT && exit.code !== 0 && exit.code !== null, JSON.stringify(exit));
      check(
        `  ... at the config step, naming the variable and the ${maximum}-day reports maximum`,
        failure?.reason === 'config' && detail.includes('WHIM_REPORT_RETENTION_DAYS') && new RegExp(String.raw`\b${maximum}\b`).test(detail),
        proc.text().slice(-2000),
      );
      eq('  ... and it never listened', proc.logs('whim-server listening').length, 0);
    } finally {
      await proc.dispose();
    }
  }

  // Chromium cannot start from an empty browser directory: the real pipeline must stop at the launch
  // and never listen. No browser process starts and no request is made.
  const noBrowsers = fixture.dataDir('no-browsers');
  await expectBootRefusal(
    'a browser that cannot start',
    fixture.tree,
    {
      PLAYWRIGHT_BROWSERS_PATH: noBrowsers,
      OPENROUTER_API_KEY: 'unused-no-network',
      WHIM_ENGINEER_MODEL: 'test/engineer',
      WHIM_REWRITE_MODEL: 'test/rewrite',
      WHIM_DATA_DIR: fixture.dataDir('launch'),
    },
    'browser_launch',
  );
}

/** Starts the stub tree and opens one generation stream that has delivered its first event. */
async function startStreaming(fixture: Fixture, name: string, env: Record<string, string>) {
  const port = await freePort();
  const dataDir = fixture.dataDir(name);
  const proc = new TreeProcess(fixture.tree, {
    WHIM_PIPELINE: 'stub',
    WHIM_DATA_DIR: dataDir,
    WHIM_SERVER_HOST: '127.0.0.1',
    WHIM_SERVER_PORT: String(port),
    ...env,
  });
  const listening = await proc.waitForLog('whim-server listening', BOOT_MS);
  const payload = JSON.stringify({ prompt: 'a tip splitter' });
  const stream = rawRequest(port, generateHead(DEVICE_A, payload), payload);
  const firstEvent = listening && (await waitFor(() => stream.text().includes('event: '), 5000));
  check(`setup (${name}): the tree listened and a generation stream delivered its first event`, firstEvent, proc.text().slice(-2000));
  return { port, dataDir, proc, stream };
}

async function testDrainCompletesStream(fixture: Fixture): Promise<void> {
  section('spec: SIGTERM mid-stream lets the stream finish, refuses new work, then exits 0');

  const { port, dataDir, proc, stream } = await startStreaming(fixture, 'drain-completes', { WHIM_DRAIN_TIMEOUT_MS: '30000' });
  try {
    // A request already on its connection when the signal lands: headers in, body still to come.
    const late = JSON.stringify({ prompt: 'a habit tracker' });
    const pending = rawRequest(port, generateHead(DEVICE_B, late, ['Expect: 100-continue']));
    check('setup: the second request is in progress on its connection', await waitFor(() => pending.text().startsWith('HTTP/1.1 100 Continue'), 5000), pending.text());

    const signalledAt = Date.now();
    proc.signal('SIGTERM');
    check('the drain started', await proc.waitForLog('drain started', 5000), proc.text().slice(-2000));
    check('the listener accepts no new connection', await connectRefused(port));

    pending.socket.write(late);
    check('the request arriving on its existing connection is refused 429', await waitFor(() => pending.text().includes('HTTP/1.1 429'), 5000), pending.text());
    check('as server_busy', pending.text().includes('"error":"server_busy"'), pending.text());
    check('while the running stream has not finished yet', !hasTerminal(stream.text()));

    const exit = await exitOf(proc);
    check('the stream delivered its terminal result before the process ended', stream.text().includes('event: result'), stream.text().slice(-500));
    eq('then the process exited 0', exit === TIMED_OUT ? 'timed out' : exit.code, 0);
    check('the drain waited for the stream rather than its 30 s deadline', Date.now() - signalledAt < 15_000, `${Date.now() - signalledAt} ms`);
    eq('the ledger settled the stream as delivered, and the refused request took no unit', ledgerOutcomes(dataDir), ['delivered']);
  } finally {
    stream.socket.destroy();
    await proc.dispose();
  }
}

async function testDrainDeadlineAborts(fixture: Fixture): Promise<void> {
  section('spec: a stream still running at the drain deadline is aborted, and the process exits 0');

  const { dataDir, proc, stream } = await startStreaming(fixture, 'drain-deadline', { WHIM_DRAIN_TIMEOUT_MS: '300' });
  try {
    proc.signal('SIGTERM');
    const exit = await exitOf(proc);
    eq('the process exited 0', exit === TIMED_OUT ? 'timed out' : exit.code, 0);
    check('the stream was cut without a terminal event', !hasTerminal(stream.text()), stream.text().slice(-500));
    eq('the ledger settled the stream as aborted', ledgerOutcomes(dataDir), ['aborted']);
  } finally {
    stream.socket.destroy();
    await proc.dispose();
  }
}

async function testSecondSignalSkipsWait(fixture: Fixture): Promise<void> {
  section('spec: a second signal during the drain skips the wait');

  const { dataDir, proc, stream } = await startStreaming(fixture, 'drain-second-signal', { WHIM_DRAIN_TIMEOUT_MS: '60000' });
  try {
    proc.signal('SIGTERM');
    check('the drain started', await proc.waitForLog('drain started', 5000), proc.text().slice(-2000));
    proc.signal('SIGTERM');
    const exit = await exitOf(proc);
    eq('the process exited 0', exit === TIMED_OUT ? 'timed out' : exit.code, 0);
    check('the stream was aborted rather than waited for', !hasTerminal(stream.text()), stream.text().slice(-500));
    eq('the ledger settled the stream as aborted', ledgerOutcomes(dataDir), ['aborted']);
  } finally {
    stream.socket.destroy();
    await proc.dispose();
  }
}

async function testUsageAndCostTransport(): Promise<void> {
  section('composition: the OpenRouter usage-and-cost transport parses generation stats');

  const calls: { url: string; auth: string | null; signal: AbortSignal | null | undefined }[] = [];
  const respond = (status: number, body: unknown) => async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), auth: new Headers(init?.headers).get('authorization'), signal: init?.signal });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  const signal = new AbortController().signal;

  const resolved = await openRouterUsageAndCostTransport('sk-test', respond(200, { data: { tokens_prompt: 12, tokens_completion: 30, total_cost: 0.0042 } })).fetchStats('gen/1', signal);
  eq('tokens and total_cost are read from the record', resolved, { usage: { promptTokens: 12, completionTokens: 30, totalTokens: 42 }, totalCostUsd: 0.0042 });
  eq('it asks for the encoded generation id', calls[0]?.url, 'https://openrouter.ai/api/v1/generation?id=gen%2F1');
  eq('with the operator key as a bearer token', calls[0]?.auth, 'Bearer sk-test');
  check("and the resolver's per-attempt signal", calls[0]?.signal === signal);

  eq(
    'native token counts stand in when the normalized ones are absent',
    await openRouterUsageAndCostTransport('k', respond(200, { data: { native_tokens_prompt: 5, native_tokens_completion: 7, total_cost: 0 } })).fetchStats('g', signal),
    { usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 }, totalCostUsd: 0 },
  );
  eq('a record without total_cost is not resolved yet', await openRouterUsageAndCostTransport('k', respond(200, { data: { tokens_prompt: 1, tokens_completion: 1 } })).fetchStats('g', signal), null);
  eq('a non-numeric total_cost is not resolved', await openRouterUsageAndCostTransport('k', respond(200, { data: { tokens_prompt: 1, tokens_completion: 1, total_cost: '0.1' } })).fetchStats('g', signal), null);
  eq('a missing data object is not resolved', await openRouterUsageAndCostTransport('k', respond(200, {})).fetchStats('g', signal), null);
  eq('a non-2xx answer is not resolved', await openRouterUsageAndCostTransport('k', respond(404, { error: 'not found' })).fetchStats('g', signal), null);

  let rejected = false;
  await openRouterUsageAndCostTransport('k', async () => {
    throw new Error('network down');
  })
    .fetchStats('g', signal)
    .catch(() => {
      rejected = true;
    });
  check('a transport failure rejects, for the resolver to retry', rejected);
}

export async function runProdBuildTests(): Promise<void> {
  section('Production build');
  await testUsageAndCostTransport();

  const fixture = await prepareTree();
  try {
    await testStubTreeServes(fixture);
    await testBootRefusals(fixture);
    await testDrainCompletesStream(fixture);
    await testDrainDeadlineAborts(fixture);
    await testSecondSignalSkipsWait(fixture);
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
  }
}
