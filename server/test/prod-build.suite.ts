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
import http2 from 'node:http2';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { createRequire, isBuiltin } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';
import { build } from 'esbuild';
import { check, eq, section } from './harness';
import { PROTOCOL_HEADER_LINE, TIMED_OUT, waitFor, within } from './route-doubles';
import { productionEntryInputs } from './build-fixtures';
import { buildRuntimeTree, declaredRuntimePackages, devBundleExternals, serverBundleTarget } from '../build.mjs';
import { TMP_BUNDLE_DIR } from '../../scripts/lib/tmp-bundle.mjs';
import { RUNTIME_ASSETS } from '../src/runtime-assets';
import { loadFewShotExamples } from '../src/generation/prompts/inputs';
import { openRouterUsageAndCostTransport } from '../src/usage/openrouter-stats';
import { NodeSqliteWaitlistStore, WAITLIST_RETENTION_DAYS } from '../src/waitlist/store';
import { CURRENT_NOTICE_ID } from '../src/waitlist/notices';
import { DEV_WAITLIST_FINGERPRINT_KEY } from '../src/config';
import { MANIFESTS, keepLimit, latestVersion } from '../../contract/src/disclosure-manifest';
import { browserLaunchOptions } from '../../synthrun/session';

const ROOT = process.cwd();
const BUNDLES = [
  'server/main.mjs',
  'server/main.mjs.map',
  'server/whim-admin.mjs',
  'server/whim-admin.mjs.map',
  'server/whim-waitlist.mjs',
  'server/whim-waitlist.mjs.map',
];
/** The ceiling on every wait for a server process: to listen, to answer, to log, to exit. Each
 *  wait ends on its condition, and this only bounds a hang. Idle, a boot or an exit takes about
 *  2 s; at background QoS beside a busy CPU (how a background agent's gate runs) boots took over
 *  20 s and exits 20 s, past the old fixed 20 s and 15 s budgets (#144). */
const PROCESS_WAIT_MS = 180_000;
/** The drain deadline in the case that proves the drain waits for a running stream: far past
 *  PROCESS_WAIT_MS, so a drain that waited for it instead of the stream fails by timing out. */
const FAR_DRAIN_DEADLINE_MS = 600_000;
const DEVICE_A = 'a11a11a1-a11a-41a1-81a1-a11a11a11a11';
const DEVICE_B = 'b22b22b2-b22b-42b2-82b2-b22b22b22b22';

function listFiles(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(path.join(dir, entry.name), rel) : [rel];
  });
}

/** The directory Node loads the bare import `name` from in a module at `fromFile`: the first
 *  `node_modules/<name>` on its lookup path, which runs on past the checkout into every parent
 *  directory. `undefined` when there is none. */
function resolvedPackageDir(fromFile: string, name: string): string | undefined {
  const lookup = createRequire(fromFile).resolve.paths(name) ?? [];
  const found = lookup.map((dir) => path.join(dir, name)).find((dir) => fs.existsSync(path.join(dir, 'package.json')));
  return found === undefined ? undefined : fs.realpathSync(found);
}

/** Where Node resolves `name` from the server workspace: the package's own directory. */
function packageDir(name: string): string {
  const found = resolvedPackageDir(path.join(ROOT, 'server', 'package.json'), name);
  if (!found) throw new Error(`setup: ${name} does not resolve from the server workspace`);
  return found;
}

/** A bundle of server code at `bundleFile` in the checkout `root` against production, which loads
 *  every runtime package from the server workspace (`/app/server`): each of `externals` must load
 *  from the directory the server workspace loads it from, and that directory must be inside the
 *  checkout, not in a parent directory's node_modules that a clean checkout does not have. */
function bundleResolutionProblems(bundleFile: string, root: string, externals: readonly string[]): string[] {
  const serverManifest = path.join(root, 'server', 'package.json');
  const inside = `${fs.realpathSync(root)}${path.sep}`;
  return externals.filter((name) => !isBuiltin(name) && name !== 'node:*').flatMap((name) => {
    const fromBundle = resolvedPackageDir(bundleFile, name);
    const fromServer = resolvedPackageDir(serverManifest, name);
    if (fromBundle === undefined) return [`${name} does not resolve from the bundle`];
    if (fromBundle !== fromServer) return [`${name} loads from ${fromBundle} in the bundle, from ${fromServer ?? 'nowhere'} in the server workspace`];
    if (!fromBundle.startsWith(inside)) return [`${name} loads from ${fromBundle}, outside the checkout`];
    return [];
  });
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

  constructor(root: string, env: Record<string, string>, nodeArgs: string[] = []) {
    this.child = spawn(process.execPath, [...nodeArgs, 'server/main.mjs'], {
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
    await within(this.exited, PROCESS_WAIT_MS);
  }
}

async function exitOf(proc: TreeProcess): Promise<Exit | typeof TIMED_OUT> {
  return within(proc.exited, PROCESS_WAIT_MS);
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
    PROTOCOL_HEADER_LINE,
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

/** The emails in a waitlist.db, sorted, read through a read-only connection of this process. */
function waitlistEmails(dataDir: string): string[] {
  const db = new DatabaseSync(path.join(dataDir, 'waitlist.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT email FROM waitlist ORDER BY email').all() as { email: string }[]).map((row) => row.email);
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
    'the tree holds the three bundles with their source maps and every runtime asset, and nothing else',
    listFiles(tree).sort((a, b) => a.localeCompare(b)),
    [...BUNDLES, ...RUNTIME_ASSETS].sort((a, b) => a.localeCompare(b)),
  );
  eq(
    'the fixtures it carries are exactly the curated few-shot examples the prompt reads',
    RUNTIME_ASSETS.filter((asset) => asset.startsWith('fixtures/')),
    loadFewShotExamples(ROOT).map((example) => `fixtures/${example.name}`),
  );

  const declared = declaredRuntimePackages();
  for (const bundle of ['server/main.mjs', 'server/whim-admin.mjs', 'server/whim-waitlist.mjs']) {
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
  // What deploy/Dockerfile's ENV sets from the build arg.
  const commit = 'fedcba9876543210fedcba9876543210fedcba98';
  const dataDir = fixture.dataDir('serves');
  const pagesOrigin = 'https://pages.example.test';
  // Two signups written by the real store before boot, one last changed past the retention period
  // the privacy policy publishes and one inside it: boot's scheduled purge must take only the first.
  const dayMs = 86_400_000;
  const seed = new NodeSqliteWaitlistStore(path.join(dataDir, 'waitlist.db'), { fingerprintKey: DEV_WAITLIST_FINGERPRINT_KEY });
  await seed.upsert({ email: 'expired@example.com', platform: 'ios', updatesOptIn: false, noticeId: CURRENT_NOTICE_ID, now: Date.now() - (WAITLIST_RETENTION_DAYS + 1) * dayMs });
  await seed.upsert({ email: 'kept@example.com', platform: 'ios', updatesOptIn: false, noticeId: CURRENT_NOTICE_ID, now: Date.now() - (WAITLIST_RETENTION_DAYS - 1) * dayMs });
  await seed.close();
  const waitlistWal = path.join(dataDir, 'waitlist.db-wal');
  const proc = new TreeProcess(fixture.tree, {
    WHIM_PIPELINE: 'stub',
    WHIM_DATA_DIR: dataDir,
    WHIM_SERVER_HOST: '127.0.0.1',
    WHIM_SERVER_PORT: String(port),
    WHIM_COMMIT: commit,
    WHIM_WEB_ORIGIN: pagesOrigin,
  });
  try {
    const listening = await proc.waitForLog('whim-server listening', PROCESS_WAIT_MS);
    check('the tree started and listened', listening, proc.text().slice(-2000));
    if (!listening) return;
    eq('it logs the bound URL', proc.logs('whim-server listening')[0]?.url, `http://127.0.0.1:${port}`);
    eq('the boot line carries the commit the image was built from', proc.logs('whim-server listening')[0]?.commit, commit);
    const stores = proc.logs('stores opened')[0];
    eq('boot logs the store backend it opened, with its data directory', [stores?.storeBackend, stores?.dataDir], ['sqlite', dataDir]);
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    eq('GET /healthz answers 200', res.status, 200);
    eq('with the service identity, the same commit and both minimum builds off', await res.json(), { ok: true, service: 'whim-server', commit, minBuild: { ios: 0, android: 0 } });
    const signup = await within(
      fetch(`http://127.0.0.1:${port}/beta/signup`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '203.0.113.5' },
        body: 'email=Tree.Person%40example.com&platform=android',
      }),
      PROCESS_WAIT_MS,
    );
    eq(
      'POST /beta/signup, with no device header, answers 303 to the pages origin\'s /beta/thanks',
      signup === TIMED_OUT ? 'timed out' : [signup.status, signup.headers.get('location')],
      [303, `${pagesOrigin}/beta/thanks`],
    );
    eq(
      'the waitlist purge ran at boot: the signup past the retention period is gone, the newer ones remain',
      waitlistEmails(dataDir),
      ['kept@example.com', 'tree.person@example.com'],
    );
    check('setup: while the server runs, waitlist.db has a write-ahead log', fs.existsSync(waitlistWal));

    proc.signal('SIGTERM');
    const exit = await exitOf(proc);
    eq('an idle server drains and exits 0 on SIGTERM', exit === TIMED_OUT ? 'timed out' : exit.code, 0);
    // SQLite removes a WAL database's log when its last connection closes, and leaves it when the
    // process exits with the connection open.
    check('  ... closing waitlist.db on the way out: its write-ahead log is gone', !fs.existsSync(waitlistWal));
  } finally {
    await proc.dispose();
  }

  // The operator command the image carries, over the waitlist.db the server just wrote.
  const exported = spawnSync(process.execPath, [path.join(fixture.tree, 'server', 'whim-waitlist.mjs'), 'export', '--platform', 'android'], {
    cwd: fixture.tree,
    encoding: 'utf8',
    timeout: PROCESS_WAIT_MS,
    env: { PATH: process.env.PATH ?? '', WHIM_DATA_DIR: dataDir },
  });
  eq('the tree\'s whim-waitlist.mjs exports the signup the server stored, with no news consent', [exported.status, exported.stdout.split('\n')[1]?.split(',').slice(0, 3)], [0, ['tree.person@example.com', 'android', 'false']]);
}

/** A loopback stand-in for a Firestore the server's credentials cannot read: every call is answered
 *  `PERMISSION_DENIED` with `message`. Point `FIRESTORE_EMULATOR_HOST` at `host`. */
async function denyingFirestore(message: string): Promise<{ host: string; calls: () => number; close: () => Promise<void> }> {
  let calls = 0;
  const server = http2.createServer();
  server.on('stream', (stream: http2.ServerHttp2Stream) => {
    calls++;
    stream.respond({ ':status': 200, 'content-type': 'application/grpc', 'grpc-status': '7', 'grpc-message': message }, { endStream: true });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    host: `127.0.0.1:${port}`,
    calls: () => calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
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
  // waitlist-hardening ruling 5: production fails closed without the waitlist fingerprint key, and a
  // refused key never reaches the output.
  const production = {
    NODE_ENV: 'production',
    OPENROUTER_API_KEY: 'unused-no-network',
    WHIM_ENGINEER_MODEL: 'test/engineer',
    WHIM_REWRITE_MODEL: 'test/rewrite',
    WHIM_WEB_ORIGIN: 'https://pages.example.test',
  };
  await expectBootRefusal(
    'production without WHIM_WAITLIST_FINGERPRINT_KEY',
    fixture.tree,
    { ...production, WHIM_DATA_DIR: fixture.dataDir('prod-no-fingerprint-key') },
    'WHIM_WAITLIST_FINGERPRINT_KEY',
  );
  const shortKey = 'short-fingerprint-secret';
  const shortKeyProc = new TreeProcess(fixture.tree, { ...production, WHIM_WAITLIST_FINGERPRINT_KEY: shortKey, WHIM_DATA_DIR: fixture.dataDir('prod-short-fingerprint-key'), WHIM_SERVER_HOST: '127.0.0.1', WHIM_SERVER_PORT: String(await freePort()) });
  try {
    const exit = await exitOf(shortKeyProc);
    check('production with a too-short fingerprint key exits non-zero, naming the variable', exit !== TIMED_OUT && exit.code !== 0 && shortKeyProc.text().includes('WHIM_WAITLIST_FINGERPRINT_KEY'), shortKeyProc.text().slice(-2000));
    check('  ... and its output never holds the key', !shortKeyProc.text().includes(shortKey));
  } finally {
    await shortKeyProc.dispose();
  }
  // specs/server-storage-backends: an unknown store backend fails boot naming the variable and both
  // allowed values.
  await expectBootRefusal(
    'WHIM_STORE_BACKEND=postgres',
    fixture.tree,
    { WHIM_PIPELINE: 'stub', WHIM_STORE_BACKEND: 'postgres', WHIM_DATA_DIR: fixture.dataDir('postgres-backend') },
    'WHIM_STORE_BACKEND must be one of sqlite, firestore',
  );
  // specs/server-storage-backends "An unreachable Firestore refuses to boot": the probe read fails
  // boot at its `stores` step, naming the backend and the database, before the server listens.
  const denied = 'whim-test credentials cannot read this database';
  const firestore = await denyingFirestore(denied);
  try {
    await expectBootRefusal(
      'WHIM_STORE_BACKEND=firestore with credentials that cannot read the database',
      fixture.tree,
      {
        WHIM_PIPELINE: 'stub',
        WHIM_STORE_BACKEND: 'firestore',
        WHIM_WAITLIST_FINGERPRINT_KEY: 'prod-build-fingerprint-key-0123456789',
        WHIM_DATA_DIR: fixture.dataDir('firestore-denied'),
        FIRESTORE_EMULATOR_HOST: firestore.host,
        GOOGLE_CLOUD_PROJECT: 'demo-whim-denied',
      },
      // As the JSON `boot failed` line carries it, quotes escaped.
      JSON.stringify(`WHIM_STORE_BACKEND=firestore: cannot read Firestore database "(default)": 7 PERMISSION_DENIED: ${denied}`).slice(1, -1),
    );
    check('  ... after its probe reached the database', firestore.calls() > 0, String(firestore.calls()));
  } finally {
    await firestore.close();
  }
  await expectBootRefusal(
    'the stub delay without the stub selector',
    fixture.tree,
    { WHIM_STUB_DELAY_MS: '1500', WHIM_DATA_DIR: fixture.dataDir('stub-delay-real') },
    'WHIM_STUB_DELAY_MS',
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

  await testBrowserThatCannotStart(fixture);
}

/** Preloaded into the server process (`node --import`): wraps the `chromium.launch` the server's
 *  bundle calls, writing each call's options as a JSON line on stdout, then launches as asked. */
const LAUNCH_RECORDER = `import { createRequire } from 'node:module';
import path from 'node:path';
const { chromium } = createRequire(path.join(process.cwd(), 'server', 'main.mjs'))('playwright');
const launch = chromium.launch;
chromium.launch = (options) => {
  process.stdout.write(JSON.stringify({ msg: 'test: browser launch attempt', options }) + '\\n');
  return launch.call(chromium, options);
};
`;

/** The position of the first JSON log line whose `msg` is `message` in `text`, or -1. */
function firstLogLine(text: string, message: string): number {
  return text.split('\n').findIndex((line) => line.startsWith('{') && line.includes(JSON.stringify(message)) && (JSON.parse(line) as { msg?: unknown }).msg === message);
}

/** The fields pino adds to every record, and the message. */
const RECORD_BASE = new Set(['level', 'severity', 'time', 'pid', 'hostname', 'scope', 'msg']);

/**
 * specs/server-deployment "A browser that cannot sandbox never serves", "Retries never weaken the
 * browser", "The boot host is recorded": Chromium cannot start from an empty browser directory, so
 * every attempt fails. Boot records its host, makes three attempts with the production options,
 * logs each failure, then stops at the launch and never listens. No browser process starts and no
 * request is made.
 */
async function testBrowserThatCannotStart(fixture: Fixture): Promise<void> {
  const recorder = path.join(fixture.scratch, 'launch-recorder.mjs');
  fs.writeFileSync(recorder, LAUNCH_RECORDER);
  const proc = new TreeProcess(
    fixture.tree,
    {
      PLAYWRIGHT_BROWSERS_PATH: fixture.dataDir('no-browsers'),
      OPENROUTER_API_KEY: 'unused-no-network',
      WHIM_ENGINEER_MODEL: 'test/engineer',
      WHIM_REWRITE_MODEL: 'test/rewrite',
      WHIM_DATA_DIR: fixture.dataDir('launch'),
      WHIM_SERVER_HOST: '127.0.0.1',
      WHIM_SERVER_PORT: String(await freePort()),
    },
    ['--import', pathToFileURL(recorder).href],
  );
  try {
    const exit = await exitOf(proc);
    check('a browser that cannot start: the process exits non-zero', exit !== TIMED_OUT && exit.code !== 0 && exit.code !== null, JSON.stringify(exit));
    check('  ... naming the browser launch', proc.logs('boot failed')[0]?.reason === 'browser_launch', proc.text().slice(-2000));
    eq('  ... and it never listened', proc.logs('whim-server listening').length, 0);

    const attempts = proc.logs('test: browser launch attempt');
    eq('  ... after exactly three launch attempts', attempts.length, 3);
    const production = JSON.parse(JSON.stringify(browserLaunchOptions())) as unknown;
    attempts.forEach((attempt, i) => eq(`  ... attempt ${i + 1} carried the production launch options, sandbox on`, attempt.options, production));

    const failures = proc.logs('browser launch failed');
    eq('  ... each failed attempt is logged with its number', failures.map((f) => f.attempt), [1, 2, 3]);
    eq(
      '  ... and its error, and nothing else',
      failures.map((f) => Object.keys(f).filter((key) => !RECORD_BASE.has(key)).sort((a, b) => a.localeCompare(b))),
      [['attempt', 'error'], ['attempt', 'error'], ['attempt', 'error']],
    );
    check('  ... the error is the launch error', failures.every((f) => typeof f.error === 'string' && f.error.includes("Executable doesn't exist")), JSON.stringify(failures));

    const hosts = proc.logs('boot host');
    eq('  ... boot logged one host record', hosts.length, 1);
    const host = hosts[0] ?? {};
    eq('  ... naming the kernel release', host.kernel, os.release());
    if (fs.existsSync('/proc/cpuinfo')) {
      const lines = fs.readFileSync('/proc/cpuinfo', 'utf8').split('\n').map((line) => line.split(':'));
      const field = (key: string): string | undefined => lines.find(([name]) => name.trim() === key)?.slice(1).join(':').trim();
      const flags = field('flags')?.split(' ');
      eq('  ... and this host\'s CPU model', host.cpuModel, field('model name') || 'unknown');
      eq('  ... and its pku/ospke flag presence', [host.pku, host.ospke], flags ? [flags.includes('pku'), flags.includes('ospke')] : ['unknown', 'unknown']);
    } else {
      eq('  ... and the CPU fields as unknown on a host without /proc/cpuinfo', [host.cpuModel, host.pku, host.ospke], ['unknown', 'unknown', 'unknown']);
    }
    const hostAt = firstLogLine(proc.text(), 'boot host');
    check('  ... before the first launch attempt', hostAt >= 0 && hostAt < firstLogLine(proc.text(), 'test: browser launch attempt'), proc.text().slice(0, 2000));
  } finally {
    await proc.dispose();
  }
}

/** `WHIM_STUB_DELAY_MS` reaches the stub pipeline the composed server runs (beta-1 fix-3): with a
 *  1.5 s wait before each event, a build's first event takes at least that long. RED while the
 *  server kept its fixed 200 ms. */
async function testStubDelayReachesThePipeline(fixture: Fixture): Promise<void> {
  section('spec: WHIM_STUB_DELAY_MS sets the stub pipeline\'s wait before each event');

  const delayMs = 1500;
  const port = await freePort();
  const proc = new TreeProcess(fixture.tree, {
    WHIM_PIPELINE: 'stub',
    WHIM_STUB_DELAY_MS: String(delayMs),
    WHIM_DATA_DIR: fixture.dataDir('stub-delay'),
    WHIM_SERVER_HOST: '127.0.0.1',
    WHIM_SERVER_PORT: String(port),
  });
  let stream: ReturnType<typeof rawRequest> | undefined;
  try {
    check('setup: the tree listened', await proc.waitForLog('whim-server listening', PROCESS_WAIT_MS), proc.text().slice(-2000));
    const payload = JSON.stringify({ prompt: 'a tip splitter' });
    const sentAt = Date.now();
    const opened = rawRequest(port, generateHead(DEVICE_A, payload), payload);
    stream = opened;
    const arrived = await waitFor(() => opened.text().includes('event: '), PROCESS_WAIT_MS);
    const elapsed = Date.now() - sentAt;
    check('the generation stream delivered its first event', arrived, opened.text().slice(-500));
    check(`no sooner than the ${delayMs} ms wait`, elapsed >= delayMs, `${elapsed} ms`);
  } finally {
    stream?.socket.destroy();
    await proc.dispose();
  }
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
  const listening = await proc.waitForLog('whim-server listening', PROCESS_WAIT_MS);
  const payload = JSON.stringify({ prompt: 'a tip splitter' });
  const stream = rawRequest(port, generateHead(DEVICE_A, payload), payload);
  const firstEvent = listening && (await waitFor(() => stream.text().includes('event: '), PROCESS_WAIT_MS));
  check(`setup (${name}): the tree listened and a generation stream delivered its first event`, firstEvent, proc.text().slice(-2000));
  return { port, dataDir, proc, stream };
}

async function testDrainCompletesStream(fixture: Fixture): Promise<void> {
  section('spec: SIGTERM mid-stream lets the stream finish, refuses new work, then exits 0');

  const { port, dataDir, proc, stream } = await startStreaming(fixture, 'drain-completes', { WHIM_DRAIN_TIMEOUT_MS: String(FAR_DRAIN_DEADLINE_MS) });
  try {
    // A request already on its connection when the signal lands: headers in, body still to come.
    const late = JSON.stringify({ prompt: 'a habit tracker' });
    const pending = rawRequest(port, generateHead(DEVICE_B, late, ['Expect: 100-continue']));
    check('setup: the second request is in progress on its connection', await waitFor(() => pending.text().startsWith('HTTP/1.1 100 Continue'), PROCESS_WAIT_MS), pending.text());

    const signalledAt = Date.now();
    proc.signal('SIGTERM');
    check('the drain started', await proc.waitForLog('drain started', PROCESS_WAIT_MS), proc.text().slice(-2000));
    check('the listener accepts no new connection', await connectRefused(port));

    pending.socket.write(late);
    check('the request arriving on its existing connection is refused 429', await waitFor(() => pending.text().includes('HTTP/1.1 429'), PROCESS_WAIT_MS), pending.text());
    check('as server_busy', pending.text().includes('"error":"server_busy"'), pending.text());
    check('while the running stream has not finished yet', !hasTerminal(stream.text()));

    const exit = await exitOf(proc);
    check('the stream delivered its terminal result before the process ended', stream.text().includes('event: result'), stream.text().slice(-500));
    eq('then the process exited 0', exit === TIMED_OUT ? 'timed out' : exit.code, 0);
    check('the drain waited for the stream rather than its deadline', Date.now() - signalledAt < FAR_DRAIN_DEADLINE_MS, `${Date.now() - signalledAt} ms`);
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

  const { dataDir, proc, stream } = await startStreaming(fixture, 'drain-second-signal', { WHIM_DRAIN_TIMEOUT_MS: String(FAR_DRAIN_DEADLINE_MS) });
  try {
    proc.signal('SIGTERM');
    check('the drain started', await proc.waitForLog('drain started', PROCESS_WAIT_MS), proc.text().slice(-2000));
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

/** Calls that stand for a list `server/build.mjs` derives from `server/package.json`. */
const DERIVED_EXTERNALS: Readonly<Record<string, () => string[]>> = { declaredRuntimePackages, devBundleExternals };

/** The packages a `derived` call above stands for, or `undefined` for any other expression. */
function derivedExternals(node: ts.Expression): string[] | undefined {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return undefined;
  return DERIVED_EXTERNALS[node.expression.text]?.();
}

/** The packages an `external` option's value names. A list entry that is neither a string nor a
 *  derived call is reported as `?<its text>`, so it can never pass for a package. */
function externalsOf(value: ts.Expression | undefined, sourceFile: ts.SourceFile): string[] {
  if (value === undefined) return [];
  const unknown = (node: ts.Node): string[] => [`?${node.getText(sourceFile)}`];
  if (!ts.isArrayLiteralExpression(value)) return derivedExternals(value) ?? unknown(value);
  return value.elements.flatMap((element) => {
    if (ts.isStringLiteralLike(element)) return [element.text];
    return (ts.isSpreadElement(element) && derivedExternals(element.expression)) || unknown(element);
  });
}

/** The value of the property `name` an object literal assigns, if any. */
function propertyValue(options: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of options.properties) {
    if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) return property.name;
  }
  return undefined;
}

/** Whether `node` is, or contains, a call of the function `name`. */
function callsFunction(node: ts.Node, name: string): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name) return true;
  return ts.forEachChild(node, (child) => callsFunction(child, name) || undefined) ?? false;
}

/** Where one bundle config puts its outfile: `helper` is `serverBundleTarget` (the server
 *  workspace's `.tmp-bundles/`), `server-dir` a file straight under `server/`, `other` anything
 *  else, `unknown` an options argument the scan cannot read. */
type OutfilePlacement = 'helper' | 'server-dir' | 'other' | 'unknown';

interface BundleConfig {
  at: string;
  externals: string[];
  /** Set when the bundle keeps the server's dev externals (`devBundleExternals`, directly or
   *  through `serverBundleTarget`): those packages resolve from the server workspace, so the
   *  outfile has to sit there too. `undefined` for a bundle with other externals. */
  placement: OutfilePlacement | undefined;
  /** Why the config does not satisfy the placement rule, if it does not. */
  placementProblem: string | undefined;
}

/** A server-externals bundle must take outfile and externals from `serverBundleTarget`. The one
 *  other placement that resolves the same way is a `server/*.mjs` CLI writing next to itself
 *  (`path.join(here, …)`, `here` being server/). Anything else, or anything unreadable, is flagged. */
function placementOf(file: string, options: ts.ObjectLiteralExpression, helperBindings: ReadonlySet<string>, constants: ReadonlyMap<string, ts.Expression>, sourceFile: ts.SourceFile): Pick<BundleConfig, 'placement' | 'placementProblem'> {
  const helperSpread = options.properties.some(
    (property) => ts.isSpreadAssignment(property) && (callsFunction(property.expression, 'serverBundleTarget') || (ts.isIdentifier(property.expression) && helperBindings.has(property.expression.text))),
  );
  const outfileValue = propertyValue(options, 'outfile');
  const outfile = outfileValue && ts.isIdentifier(outfileValue) ? (constants.get(outfileValue.text) ?? outfileValue) : outfileValue;
  const external = propertyValue(options, 'external');
  if (helperSpread) {
    const overridden = [outfileValue && 'outfile', external && 'external'].filter(Boolean);
    return { placement: 'helper', placementProblem: overridden.length > 0 ? `${overridden.join(' and ')} overrides what serverBundleTarget returns` : undefined };
  }
  if (!external || !callsFunction(external, 'devBundleExternals')) return { placement: undefined, placementProblem: undefined };
  const problem = 'keeps the server externals but does not take its outfile from serverBundleTarget (`...serverBundleTarget(name, serverDir)`)';
  const nextToServer = /^server\/[^/]+\.mjs$/.test(file) && outfile && ts.isCallExpression(outfile) && /^path\.join\(here,/.test(outfile.getText(sourceFile));
  return nextToServer ? { placement: 'server-dir', placementProblem: undefined } : { placement: outfile ? 'other' : 'unknown', placementProblem: problem };
}

/** Every esbuild `build({ bundle: true, ... })` call in `source`, with the packages its `external`
 *  option keeps out of the bundle and where its outfile goes. A `build(...)` imported from
 *  esbuild whose options are not an object literal cannot be classified and is reported as such,
 *  never skipped. */
function bundleExternals(file: string, source: string): BundleConfig[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const helperBindings = new Set<string>();
  const constants = new Map<string, ts.Expression>();
  const bind = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      constants.set(node.name.text, node.initializer);
      if (callsFunction(node.initializer, 'serverBundleTarget')) helperBindings.add(node.name.text);
    }
    ts.forEachChild(node, bind);
  };
  bind(sourceFile);
  const importsEsbuildBuild = sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'esbuild' &&
      statement.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((element) => element.name.text === 'build'),
  );
  const found: BundleConfig[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'build' && node.arguments[0]) {
      const options = node.arguments[0];
      const at = `${file}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`;
      if (!ts.isObjectLiteralExpression(options)) {
        if (importsEsbuildBuild) found.push({ at, externals: [], placement: 'unknown', placementProblem: `build() options are not an object literal (${options.getText(sourceFile)}), so the bundle cannot be classified` });
      } else if (propertyValue(options, 'bundle')?.kind === ts.SyntaxKind.TrueKeyword) {
        const placed = placementOf(file, options, helperBindings, constants, sourceFile);
        const externals = placed.placement === 'helper' && !propertyValue(options, 'external') ? DERIVED_EXTERNALS.devBundleExternals?.() : externalsOf(propertyValue(options, 'external'), sourceFile);
        found.push({ at, externals: externals ?? [], ...placed });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** Server sources that may hold a bundle config: every `.ts`/`.mjs` outside dependencies, live test bundles and build
 *  output. */
function serverSources(dir: string, rel: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'dist' || entry.name === TMP_BUNDLE_DIR ? [] : serverSources(path.join(dir, entry.name), child);
    return /\.(ts|mjs)$/.test(entry.name) && !entry.name.endsWith('.d.mts') && !entry.name.includes('.tmp.') ? [child] : [];
  });
}

/** Every esbuild bundle of server code — production, dev runner or test runner — keeps each
 *  declared runtime package external: bundled, they throw "Dynamic require of …" at import time,
 *  in whichever runner missed one. */
function testBundlesKeepRuntimePackagesExternal(): void {
  const declared = declaredRuntimePackages();
  // evals/cli.mjs bundles server/src/pipeline.ts for `--generate`.
  const files = [...serverSources(path.join(ROOT, 'server'), 'server'), 'evals/cli.mjs'];
  const configs = files.flatMap((file) => bundleExternals(file, fs.readFileSync(path.join(ROOT, file), 'utf8')));
  // The runners whose bundle is imported from the checkout: each takes outfile and externals from
  // `serverBundleTarget`, so it resolves server packages from the server workspace.
  const placedByHelper = ['server/test/run.mjs', 'server/test/e2e.run.mjs', 'server/test/e2e.ts', 'server/test/firestore.run.mjs', 'server/test/firestore-admission.run.mjs', 'evals/cli.mjs'];
  for (const runner of [...placedByHelper, 'server/dev.mjs', 'server/build.mjs']) {
    check(`the scan finds the bundle config in ${runner}`, configs.some((config) => config.at.startsWith(`${runner}:`)));
  }
  for (const runner of placedByHelper) {
    check(`${runner} writes its bundle through serverBundleTarget`, configs.filter((config) => config.at.startsWith(`${runner}:`)).every((config) => config.placement === 'helper'));
  }
  for (const config of configs) {
    eq(`${config.at} keeps every declared runtime package external`, declared.filter((name) => !config.externals.includes(name)), []);
    eq(`${config.at} writes a server-externals bundle where the server workspace's packages resolve`, config.placementProblem, undefined);
  }
  eq(
    'red-check: the scan reads a hand-kept list as written and never credits an unrecognised spread',
    bundleExternals('fixture.mjs', "build({ bundle: true, external: ['pino', ...declaredRuntimePackages().slice(1)] });\nbuild({ bundle: false });").map((config) => config.externals),
    [['pino', '?...declaredRuntimePackages().slice(1)']],
  );
  const placementOfFixture = (file: string, source: string): (string | undefined)[] => bundleExternals(file, source).map((config) => config.placementProblem);
  const serverExternals = "import { build } from 'esbuild';\n";
  eq(
    'red-check: a server-externals bundle written to a root-placed outfile is flagged',
    placementOfFixture('fixture.mjs', `${serverExternals}build({ bundle: true, outfile: tmpBundlePath('x'), external: devBundleExternals(serverDir) });`).map((problem) => problem !== undefined),
    [true],
  );
  eq(
    'red-check: ... and so is one whose outfile is hand-placed under the server directory from outside server/*.mjs',
    placementOfFixture('server/test/fixture.mjs', `${serverExternals}build({ bundle: true, outfile: path.join(here, 'x.mjs'), external: devBundleExternals(serverDir) });`).map((problem) => problem !== undefined),
    [true],
  );
  eq(
    'red-check: a build whose options the scan cannot read is flagged, not skipped',
    placementOfFixture('fixture.mjs', `${serverExternals}build(options);`).map((problem) => problem !== undefined),
    [true],
  );
  eq(
    'red-check: spreading serverBundleTarget (directly or through a binding) is accepted, overriding its outfile or externals is not',
    placementOfFixture(
      'fixture.mjs',
      `${serverExternals}const t = serverBundleTarget('a', d);\nbuild({ bundle: true, ...serverBundleTarget('a', d) });\nbuild({ bundle: true, ...t });\nbuild({ bundle: true, ...t, outfile: 'x.mjs' });\nbuild({ bundle: true, ...t, external: [] });`,
    ).map((problem) => problem !== undefined),
    [false, false, true, true],
  );
  eq(
    'a server/*.mjs CLI writing next to itself is accepted',
    placementOfFixture('server/fixture.mjs', `${serverExternals}build({ bundle: true, outfile: path.join(here, '.x.tmp.mjs'), external: devBundleExternals(here) });`),
    [undefined],
  );
}

/** `node server/build.mjs` writes the runtime tree; a bundle that inlines build.mjs (for its
 *  externals) shares that module code, and started directly it must build nothing. */
async function testInlinedBuildModuleBuildsNothing(): Promise<void> {
  section('server/build.mjs: a bundle that inlines it, started directly, builds nothing');
  fs.mkdirSync(path.join(ROOT, 'server', 'dist'), { recursive: true });
  // Inside the checkout, so the bundle resolves esbuild as build.mjs does.
  const dir = fs.mkdtempSync(path.join(ROOT, 'server', 'dist', 'inlined-build-'));
  const serverBundle = serverBundleTarget('inlined-build', path.join(ROOT, 'server'));
  const outfile = serverBundle.outfile;
  try {
    const entry = path.join(dir, 'entry.tmp.mjs');
    fs.writeFileSync(entry, `import { devBundleExternals } from ${JSON.stringify(path.join(ROOT, 'server', 'build.mjs'))};\nconsole.log(devBundleExternals().length > 0);\n`);
    await build({ entryPoints: [entry], ...serverBundle, bundle: true, platform: 'node', format: 'esm', target: 'node26', logLevel: 'silent' });
    check('setup: the bundle inlines build.mjs', fs.readFileSync(outfile, 'utf8').includes('buildRuntimeTree'));
    const run = spawnSync(process.execPath, [outfile], { cwd: ROOT, encoding: 'utf8', timeout: PROCESS_WAIT_MS });
    eq('it runs its own code and exits 0, building no tree', [run.status, run.stdout, run.stderr], [0, 'true\n', '']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outfile, { force: true });
  }
}

/** A server suite's bundle has to sit where the server workspace's packages resolve. In CI the
 *  first clean checkout failed `server:test` with "Cannot find package 'pino'": the bundle was
 *  written to the repo root, npm had installed pino only in server/node_modules, and every local
 *  run had passed because Node's lookup walked on into the enclosing primary checkout's stale
 *  node_modules. The fixture rebuilds that layout, so the red cases hold on any install. */
function testSuiteBundleResolvesLikeTheServer(): void {
  section('Server suite bundles: externals load from where the server workspace loads them');
  const self = fileURLToPath(import.meta.url);
  eq("this suite's own bundle loads every devBundleExternals package from the server workspace's directory, inside the checkout", bundleResolutionProblems(self, ROOT, devBundleExternals(path.join(ROOT, 'server'))), []);

  // outer/ stands for the primary checkout a worktree is nested in: a stale install the checkout
  // itself must never reach. outer/wt/ is the checkout, with one package npm put only under server/.
  const outer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'whim-bundle-placement-')));
  const pkg = (dir: string, name: string): void => {
    fs.mkdirSync(path.join(dir, name), { recursive: true });
    fs.writeFileSync(path.join(dir, name, 'package.json'), JSON.stringify({ name }));
  };
  try {
    const wt = path.join(outer, 'wt');
    const [shadowed, serverOnly, parentOnly] = ['whim-probe-shadowed', 'whim-probe-server-only', 'whim-probe-parent-only'];
    pkg(path.join(outer, 'node_modules'), shadowed);
    pkg(path.join(outer, 'node_modules'), parentOnly);
    pkg(path.join(wt, 'server', 'node_modules'), shadowed);
    pkg(path.join(wt, 'server', 'node_modules'), serverOnly);
    fs.mkdirSync(path.join(wt, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(wt, 'server', 'package.json'), '{}');
    const inServer = path.join(wt, 'server', '.tmp-bundles', 'probe.1.mjs');
    const inRoot = path.join(wt, '.tmp-bundles', 'probe.1.mjs');

    eq('  a bundle under server/.tmp-bundles/ loads server-only packages from server/node_modules', bundleResolutionProblems(inServer, wt, [shadowed, serverOnly]), []);
    eq('  red: a bundle under the root .tmp-bundles/ of a clean checkout cannot load a server-only package', bundleResolutionProblems(inRoot, wt, [serverOnly]), [`${serverOnly} does not resolve from the bundle`]);
    eq('  red: ... and nested in another checkout it loads that checkout\'s copy instead', bundleResolutionProblems(inRoot, wt, [shadowed]), [
      `${shadowed} loads from ${path.join(outer, 'node_modules', shadowed)} in the bundle, from ${path.join(wt, 'server', 'node_modules', shadowed)} in the server workspace`,
    ]);
    eq('  red: a package only a parent directory installs fails wherever the bundle sits', bundleResolutionProblems(inServer, wt, [parentOnly]), [`${parentOnly} loads from ${path.join(outer, 'node_modules', parentOnly)}, outside the checkout`]);
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
}

export async function runProdBuildTests(): Promise<void> {
  section('Production build');
  testSuiteBundleResolvesLikeTheServer();
  testBundlesKeepRuntimePackagesExternal();
  await testInlinedBuildModuleBuildsNothing();
  await testUsageAndCostTransport();

  const fixture = await prepareTree();
  try {
    await testStubTreeServes(fixture);
    await testBootRefusals(fixture);
    await testStubDelayReachesThePipeline(fixture);
    await testDrainCompletesStream(fixture);
    await testDrainDeadlineAborts(fixture);
    await testSecondSignalSkipsWait(fixture);
  } finally {
    fs.rmSync(fixture.scratch, { recursive: true, force: true });
  }
}
