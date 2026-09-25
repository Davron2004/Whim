/**
 * server/test/e2e.ts — chain-6's BROWSER-BACKED suite (spec "Blocking server suite in CI":
 * "A second, browser-backed suite SHALL exercise the pipeline end to end against the real static
 * checker, the real bundle build, and the real synthetic run harness"). Needs Chromium — never
 * part of `npm run server:test` / the fast gate (`server/test/run.mjs`'s own esbuild call). It runs
 * in the full gate as `npm run server:e2e` (`scripts/gate-full.sh`):
 *
 *   node server/test/e2e.run.mjs
 *
 * Also covers the production boot self-test and the browser-context teardown on a real TCP
 * disconnect through the composed server (`lifecycle.ts`).
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { check, eq, report, section } from './harness';
import { ScriptedModelClient } from './scripted-model';
import { E2E_ROSTER, heldRunTurns, MOUNT_HANG } from './e2e-fixtures';
import { BootError, runBootSelfTest, startServer, type ServerHandle } from '../src/lifecycle';
import { createCheckStage } from '../src/generation/stages/check';
import { createBuildStage } from '../src/generation/stages/build';
import { createRunStage } from '../src/generation/stages/run';
import type { CheckedManifest } from '../src/generation/machine';
import { SynthRunSession } from '../../synthrun/session';
import { createRunCandidate } from '../../synthrun/report';
import type { RunCandidate, RunReport } from '../../synthrun/contract';
import type { GenerationEvent } from '@whim/contract';
import { containedDetail } from './run-stage-fixtures';
import { PROTOCOL_HEADER_LINE, PROTOCOL_HEADERS } from './route-doubles';
import { runLoadtestServer, LOADTEST_HEALTHZ_SERVICE } from '../src/loadtest/server';
import { buildReport, leakProbe, runDevice, runDevices, feedSseBuffer, isRealFrame, parseGenerationEvent, verdict } from '../src/loadtest/drive';

const ROOT = process.cwd();

/** Captured at module load, before a load-test server's own `fetch` trap can install itself on
 *  `globalThis.fetch` — mirrors `src/loadtest/drive.ts`'s own `realFetch`: the test driver is a
 *  separate actor from the server it's driving and must never trip the server's own no-spend
 *  instrumentation. */
const testFetch: typeof fetch = globalThis.fetch;

function readFixture(name: string): string {
  return fs.readFileSync(path.join(ROOT, 'fixtures', name), 'utf8');
}

function capturingRunCandidate(candidate: RunCandidate): { candidate: RunCandidate; lastReport: () => RunReport | undefined } {
  let lastReport: RunReport | undefined;
  return {
    candidate: async (source, opts) => {
      const r = await candidate(source, opts);
      lastReport = r;
      return r;
    },
    lastReport: () => lastReport,
  };
}

// ── The honest corpus-shaped candidate through the REAL check, build, and run stages ──

/**
 * esbuild embeds the input FILE PATH as a `//` banner comment and derives its module-scope
 * identifier names (`<basename>_exports`/`<basename>_default`) from the same basename.
 * `createBuildStage()` always builds from raw TEXT through a synthesized temp file
 * (`synthrun/builder.ts`'s `buildCandidateSource`, filename `candidate.app.tsx` — deliberately: a
 * freshly-generated candidate has no file on disk to build FROM), so its output can never
 * literally match a FILE-PATH build's (e.g. the checked-in production artifact) comment/identifier
 * pair — `builder.ts`'s own doc comment: "the filename affects only esbuild's internal bundle
 * identifiers, never the app's runtime behavior". Normalizing away exactly that (and only that)
 * documented difference is what "byte-identical to the production build" can honestly mean for a
 * candidate built from text; any OTHER divergence (options, externals, JSX transform, minify, …)
 * still fails this comparison.
 */
function normalizeBuildIdentity(bundle: string): string {
  return bundle.replace(/\/\/ .*\.app\.tsx\n/g, '// <source>\n').replace(/\b\w+_app_(exports|default)\b/g, 'app_$1');
}

async function testHonestCandidateReachesResult(session: SynthRunSession): Promise<void> {
  section('spec: an honest corpus-shaped candidate reaches a result through the real check, build, and run stages');

  const source = readFixture('tip-splitter.app.tsx');
  const checkReport = await createCheckStage().check(source, {});
  check('setup: the honest fixture has no check-stage errors', !checkReport.diagnostics.some((d) => (d.severity ?? 'error') === 'error'));
  check('setup: a manifest was extracted', !!checkReport.manifest);
  if (!checkReport.manifest) return;

  const buildOutcome = await createBuildStage().build(source);
  check('the real build stage succeeds', buildOutcome.ok);
  if (!buildOutcome.ok) return;

  const { candidate, lastReport } = capturingRunCandidate(createRunCandidate(session));
  const runStage = createRunStage(candidate);
  const outcome = await runStage.run({ source, manifest: checkReport.manifest, build: buildOutcome.result });

  check(
    'the real run reaches contained:true',
    outcome.contained === true,
    outcome.contained === true ? undefined : containedDetail(outcome.contained, lastReport()),
  );
  if (!outcome.contained) return;
  eq('a clean fixture produces no diagnostics', outcome.diagnostics, []);
  eq('the delivered record name matches the extraction', outcome.record.name, 'Tip Splitter');

  const productionArtifact = fs.readFileSync(path.join(ROOT, 'build/generated/tip-splitter.app.js'), 'utf8');
  eq(
    'the delivered bundle is byte-identical to the production build, modulo the one documented, ' +
      'harmless difference building from TEXT (no file path) forces — the embedded esbuild source ' +
      'comment and its derived identifier names',
    normalizeBuildIdentity(outcome.record.bundle),
    normalizeBuildIdentity(productionArtifact),
  );

  // red-check (non-vacuity): normalization is narrowly scoped to that one difference — an
  // actually-different bundle (a perturbed esbuild option, same drift-tripwire technique
  // `synthrun/test/acceptance.ts` uses) must still be caught, not swallowed by the normalizer.
  const perturbed = productionArtifact.replace('React.createElement', 'React.createElementPerturbed');
  check(
    'red-check: normalization does not launder an actual content difference',
    normalizeBuildIdentity(perturbed) !== normalizeBuildIdentity(productionArtifact),
  );
}

// ── A real escape-attempting candidate stays contained (non-vacuity for the stub test above) ──

async function testHostileCandidateStaysContained(session: SynthRunSession): Promise<void> {
  section(
    'red-check (non-vacuity): a real escape-attempting candidate run through the REAL harness stays ' +
      'contained — proves the stub-based short-circuit test above exercises a real mapping, not a ' +
      'vacuously-always-false stub',
  );

  // Deliberately raw (no check-stage gating): `fixtures/adversarial/evil.app.tsx`'s own top
  // comment documents that a real static check would reject it — the pen test targets the
  // RUNTIME sandbox, the harness's own job, exactly as `synthrun`'s own suite treats its hostile
  // fixtures (never gated through the checker either).
  const hostileSource = readFixture('adversarial/evil.app.tsx');
  const buildOutcome = await createBuildStage().build(hostileSource);
  check('setup: the hostile fixture still builds (esbuild neither type-checks nor gates on forbidden globals)', buildOutcome.ok);
  if (!buildOutcome.ok) return;

  const { candidate, lastReport } = capturingRunCandidate(createRunCandidate(session));
  const runStage = createRunStage(candidate);
  const manifest: CheckedManifest = { name: 'Evil App', manifest: { capabilities: [] }, schema: {} };
  const outcome = await runStage.run({ source: hostileSource, manifest, build: buildOutcome.result });

  check(
    'the sandbox genuinely contains every escape attempt in the fixture — contained stays true',
    outcome.contained === true,
    outcome.contained === true ? undefined : containedDetail(outcome.contained, lastReport()),
  );
}

// ── The production boot self-test (design D16, spec "Production boot proves the synthetic run
//    works before serving") ──

/** Throws while rendering, so its run reports an error diagnostic. */
const THROWS_ON_MOUNT = `import { defineApp, Screen, Text } from 'vc-sdk';
function Home() {
  throw new Error('the self-test fixture failed to render');
  return <Screen><Text>unreachable</Text></Screen>;
}
export default defineApp({ name: 'Broken', initial: 'Home', screens: { Home }, capabilities: [] });
`;

async function testBootSelfTest(session: SynthRunSession): Promise<void> {
  section('spec: the boot self-test passes on a healthy session');

  const outcome = await runBootSelfTest(session).then(
    () => 'passed',
    (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err)),
  );
  eq('the curated fixture runs contained with no error diagnostic, and egress from a run context is blocked', outcome, 'passed');

  // red-check (non-vacuity): a run that reports an error diagnostic must fail boot, so the self-test
  // is more than "the browser started".
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-self-test-'));
  try {
    fs.mkdirSync(path.join(cwd, 'fixtures'));
    fs.writeFileSync(path.join(cwd, 'fixtures', 'tip-splitter.app.tsx'), THROWS_ON_MOUNT);
    const failed = await runBootSelfTest(session, cwd).then(
      () => undefined,
      (err: unknown) => err,
    );
    check(
      'red-check: a fixture that throws while rendering fails the self-test as a boot failure',
      failed instanceof BootError && failed.reason === 'self_test',
      String(failed),
    );
    check('and the failure names the fixture', failed instanceof Error && failed.message.includes('fixtures/tip-splitter.app.tsx'), String(failed));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

// ── The composed server: boot gates listening, and a real TCP disconnect closes the browser
//    context (spec "A real TCP disconnect closes the browser context") ──

const DISCONNECT_BOUND_MS = 5000;

const HARMLESS = `import { defineApp, Screen, Stack, Heading } from 'vc-sdk';
function Home() { return <Screen><Stack><Heading size="title">Harmless</Heading></Stack></Screen>; }
export default defineApp({ name: 'Harmless', initial: 'Home', screens: { Home }, capabilities: [] });
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `predicate` until it holds or `ms` elapses; returns whether it held. */
async function waitUntil(predicate: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() >= deadline) return false;
    await sleep(20);
  }
  return true;
}

const TIMED_OUT = Symbol('timed out');

/** `work`, or `TIMED_OUT` once `ms` pass on a ref'd timer. A late rejection of `work` is observed. */
async function within<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
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

function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/** `GET <url>`, parsed as JSON, over `node:http` directly — never the global `fetch` the load-test
 *  server's trap replaces for the whole process while it is up (`drive.ts`'s own module doc). */
function getJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      })
      .on('error', reject);
  });
}

async function testComposedServerBootAndDisconnect(): Promise<void> {
  section('spec: the composed server listens only after its self-test, and a real TCP disconnect closes the run\'s browser context');

  // Serving installs @hono/node-server's Request/Response globals; they are put back afterwards.
  const savedRequest = Object.getOwnPropertyDescriptor(globalThis, 'Request');
  const savedResponse = Object.getOwnPropertyDescriptor(globalThis, 'Response');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-e2e-server-'));
  const model = new ScriptedModelClient(E2E_ROSTER, heldRunTurns());
  let handle: ServerHandle | undefined;
  try {
    const checked = await createCheckStage().check(MOUNT_HANG, {});
    check('setup: the hanging candidate passes the static checks, so it reaches the run stage', !checked.diagnostics.some((d) => d.severity === 'error'), JSON.stringify(checked.diagnostics));

    const port = await freePort();
    let booted = false;
    const starting = startServer({
      env: { WHIM_DATA_DIR: dataDir, WHIM_SYNTHRUN_CONCURRENCY: '1' },
      overrides: { model: { client: model, roster: E2E_ROSTER } },
      listen: { host: '127.0.0.1', port },
    }).finally(() => {
      booted = true;
    });
    let probes = 0;
    let acceptedBeforeBoot = false;
    while (!booted) {
      probes++;
      if ((await accepts(port)) && !booted) acceptedBeforeBoot = true;
      await sleep(25);
    }
    const started = await within(starting, 60_000).then(
      (value) => value,
      (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    );
    if (started === TIMED_OUT || started instanceof Error) {
      check('the composed server booted', false, String(started));
      return;
    }
    handle = started;
    const session = handle.session;
    check('nothing accepted a connection while the browser launched and the self-test ran', !acceptedBeforeBoot);
    check('non-vacuity: the port was probed throughout boot', probes > 3, `${probes} probes`);
    check('the server accepts connections once boot resolved', await accepts(port));
    eq('it reports its bound URL', handle.url, `http://127.0.0.1:${port}`);
    if (!session) {
      check('the real pipeline has a synthetic-run session', false);
      return;
    }

    const client = rawGenerate(port, 'e2e0e2e0-e2e0-4e20-8e20-e2e0e2e0e2e0', 'a slow app');

    check('the candidate reached the run stage and opened its browser context', await waitUntil(() => session.openContextCount() === 1, 60_000), client.text().slice(-800));
    // The page loads in tens of milliseconds and the candidate never paints, so by now the run is
    // held in its mount wait.
    await sleep(500);
    check('setup: the run is still held in the run stage', session.openContextCount() === 1 && !hasTerminalEvent(client.text()));
    const destroyedAt = Date.now();
    client.socket.destroy();

    check(`within ${DISCONNECT_BOUND_MS} ms the session has no open browser context`, await waitUntil(() => session.openContextCount() === 0, DISCONNECT_BOUND_MS), `${Date.now() - destroyedAt} ms`);
    const remaining = Math.max(1, DISCONNECT_BOUND_MS - (Date.now() - destroyedAt));
    const next = await within(session.openRun(HARMLESS).then((run) => run.dispose()), remaining);
    check(`and within ${DISCONNECT_BOUND_MS} ms its only concurrency slot is free for another run`, next !== TIMED_OUT, `${Date.now() - destroyedAt} ms`);
    eq('no model call was made after the disconnect', model.requests.length, 3);
    check('the stream never produced a terminal event', !hasTerminalEvent(client.text()), client.text().slice(-800));

    const closing = await within(handle.close(), 30_000);
    check('the server drains closed', closing !== TIMED_OUT);
    handle = undefined;
    check('and no longer accepts connections', !(await accepts(port)));
  } finally {
    if (handle) await within(handle.close(), 30_000);
    if (savedRequest) Object.defineProperty(globalThis, 'Request', savedRequest);
    if (savedResponse) Object.defineProperty(globalThis, 'Response', savedResponse);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// ── A real server process under SIGTERM with a synthetic run in flight (spec "SIGTERM drains
//    in-flight work before exit", "The deadline aborts the rest") ──

const DRAIN_DEADLINE_MS = 4000;

/** `process.kill(pid, 0)` probes a process without signalling it. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** `e2e-drain-server.ts` running as its own process, with its combined output. */
interface DrainServer {
  output(): string;
  /** Every JSON line it printed: its logs and its `e2eServer` reports. */
  records(): Record<string, unknown>[];
  /** The `e2eServer` reports only. */
  reports(): Record<string, unknown>[];
  /** The last open-context count it reported. */
  lastContexts(): unknown;
  exit(): { code: number | null; signal: NodeJS.Signals | null } | undefined;
  exited: Promise<void>;
  signal(signal: NodeJS.Signals): void;
  /** Kills it if still running and removes its bundle. */
  dispose(): Promise<void>;
}

async function spawnDrainServer(dataDir: string): Promise<DrainServer> {
  const childFile = path.join(ROOT, `.server-e2e-drain.${process.pid}.tmp.mjs`);
  await build({
    entryPoints: [path.join(ROOT, 'server', 'test', 'e2e-drain-server.ts')],
    outfile: childFile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['esbuild', 'playwright', 'typescript', 'pino'],
    logLevel: 'warning',
  });

  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? os.homedir(),
    WHIM_LOG_JSON: '1',
    WHIM_DATA_DIR: dataDir,
    WHIM_SYNTHRUN_CONCURRENCY: '1',
    WHIM_DRAIN_TIMEOUT_MS: String(DRAIN_DEADLINE_MS),
  };
  for (const name of ['TMPDIR', 'PLAYWRIGHT_BROWSERS_PATH']) {
    const value = process.env[name];
    if (value) env[name] = value;
  }
  const child = spawn(process.execPath, [childFile], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    output += chunk;
  });
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', (code, signal) => {
      exit = { code, signal };
      resolve();
    });
  });
  const records = (): Record<string, unknown>[] =>
    output
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch (err) {
          return { unparsed: line, detail: String(err) };
        }
      });
  const reports = (): Record<string, unknown>[] =>
    records().flatMap((record) => (record.e2eServer && typeof record.e2eServer === 'object' ? [record.e2eServer as Record<string, unknown>] : []));
  return {
    output: () => output,
    records,
    reports,
    lastContexts: () => reports().filter((r) => 'contexts' in r).at(-1)?.contexts,
    exit: () => exit,
    exited,
    signal: (signal) => {
      child.kill(signal);
    },
    dispose: async () => {
      if (!exit) child.kill('SIGKILL');
      await within(exited, 10_000);
      fs.rmSync(childFile, { force: true });
    },
  };
}

/** A `POST /v1/generate` written straight onto a TCP socket, accumulating the raw response. */
function rawGenerate(port: number, deviceId: string, prompt: string): { socket: net.Socket; text: () => string } {
  const payload = JSON.stringify({ prompt });
  const socket = net.connect({ port, host: '127.0.0.1' });
  let received = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    received += chunk;
  });
  socket.on('error', () => undefined);
  socket.write(
    [
      'POST /v1/generate HTTP/1.1',
      'Host: 127.0.0.1',
      'Content-Type: application/json',
      `Content-Length: ${Buffer.byteLength(payload)}`,
      `x-whim-device: ${deviceId}`,
      PROTOCOL_HEADER_LINE,
      'Connection: close',
      '',
      payload,
    ].join('\r\n'),
  );
  return { socket, text: () => received };
}

function hasTerminalEvent(stream: string): boolean {
  return stream.includes('event: result') || stream.includes('event: failure');
}

/** Watches the first `ms` after the signal. Returns what ended the run early, or `undefined` if the
 *  browser stayed up, the run's context stayed open, no terminal event arrived and the server ran on. */
async function earlyEnding(server: DrainServer, browserPid: number, stream: () => string, signalledAt: number, ms: number): Promise<string | undefined> {
  while (Date.now() - signalledAt < ms) {
    const at = `${Date.now() - signalledAt} ms after SIGTERM`;
    if (!processAlive(browserPid)) return `the browser process exited ${at}`;
    if (server.exit()) return `the server exited ${at} (${JSON.stringify(server.exit())})`;
    if (hasTerminalEvent(stream())) return `the stream ended with a terminal event ${at}`;
    if (server.lastContexts() !== 1) return `the run's browser context closed ${at}`;
    await sleep(50);
  }
  return undefined;
}

function ledgerOutcomes(dataDir: string): string[] {
  const db = new DatabaseSync(path.join(dataDir, 'usage.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT outcome FROM requests').all() as { outcome: string }[]).map((row) => row.outcome);
  } finally {
    db.close();
  }
}

async function testRealPipelineSigtermDrain(): Promise<void> {
  section('spec: SIGTERM with a synthetic run in flight keeps the browser until the drain deadline aborts the run, then exits 0');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-e2e-drain-'));
  const server = await spawnDrainServer(dataDir);
  try {
    const booted = await waitUntil(() => server.reports().some((r) => typeof r.url === 'string') || server.exit() !== undefined, 90_000);
    const ready = server.reports().find((r) => typeof r.url === 'string');
    check('setup: the server process booted the real pipeline, self-test included', booted && ready !== undefined, server.output().slice(-2000));
    if (!ready) return;
    const browserPid = Number(ready.browserPid);
    const client = rawGenerate(Number(new URL(String(ready.url)).port), 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0', 'a slow app');
    try {
      check('setup: the generation reached the run stage and opened its browser context', await waitUntil(() => server.lastContexts() === 1, 60_000), server.output().slice(-2000));
      await sleep(500);
      check('setup: the run is held in its mount wait and the browser process is alive', server.lastContexts() === 1 && processAlive(browserPid) && !hasTerminalEvent(client.text()));

      const signalledAt = Date.now();
      server.signal('SIGTERM');
      check('the drain started', await waitUntil(() => server.records().some((r) => r.msg === 'drain started') || server.exit() !== undefined, 5000), server.output().slice(-2000));
      const early = await earlyEnding(server, browserPid, client.text, signalledAt, DRAIN_DEADLINE_MS - 1000);
      check('during the drain wait the browser stays connected and the run stays in flight', early === undefined, early);

      await within(server.exited, 30_000);
      eq('then the process exits 0', server.exit()?.code, 0);
      check('it exited only after the deadline', Date.now() - signalledAt >= DRAIN_DEADLINE_MS, `${Date.now() - signalledAt} ms`);
      check("the deadline closed the run's browser context before the process exited", server.reports().some((r) => r.contexts === 0), JSON.stringify(server.reports()));
      check('the drain completed', server.reports().some((r) => r.drained === true), server.output().slice(-2000));
      check('the stream was aborted without a terminal event', !hasTerminalEvent(client.text()), client.text().slice(-500));
      eq('the ledger settled the generation as aborted', ledgerOutcomes(dataDir), ['aborted']);
      check('the browser process is gone once the server has exited', await waitUntil(() => !processAlive(browserPid), 10_000));
    } finally {
      client.socket.destroy();
    }
  } finally {
    await server.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// ── The no-spend load-test server, driven for real: capacity, refusal, the leak probe, and the
//    fetch trap (design D26; specs/server-deployment "A load test measures capacity without
//    spending provider credit") ──

/** Reads an already-open `/v1/generate` SSE response one real event at a time (`undefined` once
 *  it ends), using the same frame parsing `runDevice` does. */
function sseEvents(response: Response): () => Promise<GenerationEvent | undefined> {
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  const ready: GenerationEvent[] = [];
  let buffer = '';
  return async () => {
    while (ready.length === 0) {
      if (!reader) return undefined;
      const { done, value } = await reader.read();
      if (done) return undefined;
      const fed = feedSseBuffer(buffer, decoder.decode(value, { stream: true }));
      buffer = fed.buffer;
      for (const frame of fed.frames) {
        const parsed = isRealFrame(frame) ? parseGenerationEvent(frame) : undefined;
        if (parsed) ready.push(parsed);
      }
    }
    return ready.shift();
  };
}

/** Reads an open stream's remaining events to its terminal event type (or `undefined` if the
 *  stream ends without one). */
async function terminalOf(next: () => Promise<GenerationEvent | undefined>): Promise<'result' | 'failure' | undefined> {
  for (let event = await next(); event !== undefined; event = await next()) {
    if (event.type === 'result' || event.type === 'failure') return event.type;
  }
  return undefined;
}

/** Reads an already-open `/v1/generate` SSE response to its terminal event type. */
async function drainToTerminal(response: Response): Promise<'result' | 'failure' | undefined> {
  return terminalOf(sseEvents(response));
}

/** Posts one generation for a fresh device straight to the load-test server. */
function postLoadtestGenerate(url: string, prompt: string): Promise<Response> {
  return testFetch(`${url}/v1/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-whim-device': randomUUID(), ...PROTOCOL_HEADERS },
    body: JSON.stringify({ prompt }),
  });
}

async function testLoadtestServerCapacityAndNoSpend(): Promise<void> {
  section('spec: the load-test server admits up to its cap, lines up past it, refuses past a full line, leaks no slot, and spends nothing');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-e2e-loadtest-'));
  const savedFetch = globalThis.fetch;
  let handle: Awaited<ReturnType<typeof runLoadtestServer>> | undefined;
  try {
    handle = await runLoadtestServer({
      env: {
        WHIM_DATA_DIR: dataDir,
        WHIM_MAX_CONCURRENT_GENERATIONS: '3',
        WHIM_QUEUE_MAX: '1',
        WHIM_SYNTHRUN_CONCURRENCY: '2',
        WHIM_LOADTEST_ENGINEER_TURN_MS: '300',
        WHIM_LOADTEST_REWRITE_TURN_MS: '50',
      },
      listen: { host: '127.0.0.1', port: 0 },
      start: startServer,
    });

    eq('healthz reports the load-test identity', await getJson(`${handle.url}/healthz`), { ok: true, service: LOADTEST_HEALTHZ_SERVICE });

    // Wait on a real signal that the three are holding their slots — each request's response
    // headers only arrive once the route has admitted it — instead of a fixed sleep guessing how
    // long admission takes.
    const url = handle.url;
    const three = await Promise.all(Array.from({ length: 3 }, (_, i) => postLoadtestGenerate(url, `whim e2e loadtest device ${i} ${randomUUID()}`)));
    check('all three concurrent generations were admitted before the fourth is attempted', three.every((r) => r.status === 200), JSON.stringify(three.map((r) => r.status)));

    const fourth = await postLoadtestGenerate(url, `whim e2e loadtest device: the fourth, over cap ${randomUUID()}`);
    const fourthEvents = sseEvents(fourth);
    eq('a fourth generation started while three are in flight opens its stream first in line', [fourth.status, await within(fourthEvents(), 30_000)], [200, { type: 'queued', position: 1 }]);

    const fifth = await runDevice({ baseUrl: url, prompt: 'whim e2e loadtest device: the fifth, past the full line' });
    check('a fifth, with the line of one full, is refused with server_busy', fifth.refusal?.error === 'server_busy', JSON.stringify(fifth));

    const threeResults = await within(Promise.all(three.map((response) => drainToTerminal(response))), 60_000);
    eq('all three concurrent generations end in result', threeResults, ['result', 'result', 'result']);
    eq('the fourth leaves the line and ends in result', await within(terminalOf(fourthEvents), 60_000), 'result');

    // The driver's own measure of the line: four at once against a cap of three and a line of one.
    const outcomes = await runDevices(url, 4);
    const lined = buildReport(4, 3, 1, outcomes, { ok: true, rounds: [] });
    eq('the driver sees one of four wait in line, and all four end in result', [lined.queued, lined.terminals], [1, { result: 4, failure: 0, none: 0 }]);
    check('... which its verdict passes', verdict(lined).ok, JSON.stringify(verdict(lined)));

    const leak = await leakProbe(url, 3);
    check('the two-round leak probe passes: every slot came back and the line is empty', leak.ok, JSON.stringify(leak));

    eq('the fetch trap counted zero calls for the whole test', handle.fetchCallCount(), 0);
  } finally {
    if (handle) await within(handle.close(), 60_000);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  check('fetch is restored once the load-test server has closed', globalThis.fetch === savedFetch);
}

/** A `GET /healthz/sse` written straight onto a TCP socket, so the probe is genuinely in flight
 *  across a process boundary (its three comment frames arrive a second apart). */
function rawProbe(port: number): { socket: net.Socket; text: () => string; ended: () => boolean } {
  const socket = net.connect({ port, host: '127.0.0.1' });
  let received = '';
  let ended = false;
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    received += chunk;
  });
  socket.on('close', () => {
    ended = true;
  });
  socket.on('error', () => undefined);
  socket.write(['GET /healthz/sse HTTP/1.1', 'Host: 127.0.0.1', 'Accept: text/event-stream', 'Connection: close', '', ''].join('\r\n'));
  return { socket, text: () => received, ended: () => ended };
}

/**
 * specs/server-deployment "SIGTERM drains in-flight work before exit" for the anonymous probe pool:
 * `/healthz/sse` holds a slot for seconds without a device header, so a drain that waits only on
 * generations and unary calls can close the stores out from under one. The fast gate's bundler
 * cannot import `lifecycle.ts` (playwright, esbuild), so this lives here.
 */
async function testDrainWaitsForProbes(): Promise<void> {
  section('spec: SIGTERM drains an in-flight /healthz/sse probe before the process exits');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-e2e-probe-drain-'));
  const server = await spawnDrainServer(dataDir);
  let probe: ReturnType<typeof rawProbe> | undefined;
  try {
    const booted = await waitUntil(() => server.reports().some((r) => typeof r.url === 'string') || server.exit() !== undefined, 90_000);
    const ready = server.reports().find((r) => typeof r.url === 'string');
    check('setup: the server process booted the real pipeline', booted && ready !== undefined, server.output().slice(-2000));
    if (!ready) return;

    probe = rawProbe(Number(new URL(String(ready.url)).port));
    const started = await waitUntil(() => probe!.text().includes('whim-healthz-probe'), 10_000);
    check('setup: the probe is in flight, holding its slot', started && !probe.ended(), probe.text().slice(-200));

    server.signal('SIGTERM');
    await within(server.exited, 30_000);
    eq('the process exits 0', server.exit()?.code, 0);

    const completed = server.records().filter((r) => r.msg === 'drain complete');
    eq('the drain completed exactly once', completed.length, 1);
    eq('and it reports no probe still holding a slot', completed[0]?.probes, 0);
    const started_ = server.records().find((r) => r.msg === 'drain started');
    check('the drain saw the probe when it began', started_?.probes === 1, JSON.stringify(started_));
    check('the probe connection ended', probe.ended(), probe.text().slice(-200));
  } finally {
    probe?.socket.destroy();
    await server.dispose();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // The run-stage adapter's pure-Node tests (a stub RunCandidate, no Chromium) moved to
  // run-stage.suite.ts, which server/test/acceptance.ts runs under the fast gate.

  const session = await SynthRunSession.launch({ concurrency: 2 });
  try {
    await testHonestCandidateReachesResult(session);
    await testHostileCandidateStaysContained(session);
    await testBootSelfTest(session);
  } finally {
    await session.close();
  }

  await testComposedServerBootAndDisconnect();
  await testRealPipelineSigtermDrain();
  await testDrainWaitsForProbes();
  await testLoadtestServerCapacityAndNoSpend();

  report();
}

await main();
