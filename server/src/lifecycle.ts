/**
 * server/src/lifecycle.ts — how the server process starts and stops (design D16, D26;
 * specs/server-deployment "Boot fails fast when the runtime is incomplete", "Production boot proves
 * the synthetic run works before serving", "SIGTERM drains in-flight work before exit").
 *
 * `startServer` is the whole composition, in order: config, preflight, stores (with their purge
 * timers), the synthetic-run session plus the boot self-test (real pipeline only), then listen. Any
 * failure closes whatever was already opened and rejects with a `BootError` naming the step. Nothing
 * listens before the self-test has passed.
 *
 * `main.ts` calls it with the process environment and no overrides, and owns the signal handlers and
 * `process.exit`. The overrides exist for the no-spend load test (design D26), which runs this same
 * composition with a replay model and zero-cost transports; no environment variable reaches them.
 *
 * The returned handle drains (design D16): refuse new admissions and stop accepting connections, let
 * in-flight requests finish until `WHIM_DRAIN_TIMEOUT_MS`, abort the rest exactly as a client
 * disconnect would, give aborted teardowns and pending cost resolution one final 10 s window, then
 * close the browser and the stores. A second `drain()` during the wait skips straight to the abort.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { getRequestListener, type Http2Bindings, type HttpBindings } from '@hono/node-server';
import { createApp } from './app';
import { loadServerConfig, type ServerConfig } from './config';
import { runPreflight } from './preflight';
import { SELF_TEST_FIXTURE } from './runtime-assets';
import { createStubPipeline, type Pipeline } from './pipeline';
import { NodeSqliteUsageStore } from './usage-store';
import { NodeSqliteReportStore, schedulePurge, type PurgeSchedule } from './reports/store';
import { buildModelDepsFromEnv, createGenerationPipeline } from './generation';
import type { ModelClient, ModelRoster } from './generation/model';
import { loadContentPolicyDocument } from './generation/prompts/inputs';
import { createSlotController, type SlotController } from './admission/slots';
import { createOpenRouterCreditTransport, type CreditTransport } from './admission/credit';
import { cachedPolicy, ModelContentPolicy, StubContentPolicy, type ContentPolicy } from './policy';
import { ResolveTracker, type UsageAndCostTransport } from './usage/resolve';
import { openRouterUsageAndCostTransport } from './usage/openrouter-stats';
import { InFlightGenerations } from './routes/generate';
import { probeEgressBlocked, SynthRunSession } from '../../synthrun/session';
import { createRunCandidate } from '../../synthrun/report';
import { log } from './logger';

/** The step boot failed at. The message names the offending item within it. */
export type BootFailureReason =
  | 'config'
  | 'preflight'
  | 'model'
  | 'stores'
  | 'browser_launch'
  | 'self_test'
  | 'composition'
  | 'listen';

export class BootError extends Error {
  constructor(
    readonly reason: BootFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'BootError';
  }
}

/** What serving needs from an app: its fetch handler. A Hono app is one. */
export interface Servable {
  fetch(request: Request, env: HttpBindings | Http2Bindings): unknown;
}

export interface StartServerOverrides {
  /** Replaces the model client and roster everywhere they are used: the generation pipeline, the
   *  content-policy classifier, `/v1/rewrite` and `/v1/clarify`. */
  model?: { client: ModelClient; roster: ModelRoster };
  /** Replaces the generation-stats transport the usage and cost resolver polls. */
  statsTransport?: UsageAndCostTransport;
  /** Replaces the operator-credit transport admission checks. */
  creditTransport?: CreditTransport;
  /** Wraps the assembled app before it is served. */
  wrapApp?: (app: ReturnType<typeof createApp>) => Servable;
}

export interface StartServerOptions {
  /** The environment as data. `startServer` never reads `process.env` for a server setting. */
  env: NodeJS.ProcessEnv;
  overrides?: StartServerOverrides;
  /** Replaces `WHIM_SERVER_HOST` / `WHIM_SERVER_PORT`. Port 0 binds an ephemeral port. */
  listen?: { host?: string; port?: number };
}

export interface ServerHandle {
  /** `http://<host>:<port>` of the bound listener. */
  readonly url: string;
  readonly config: ServerConfig;
  /** The synthetic-run session; `undefined` under the stub pipeline. */
  readonly session: SynthRunSession | undefined;
  /** The drain (design D16). The first call starts it; a call while it waits skips to the abort.
   *  Every call returns the same promise, which resolves once the browser and stores are closed and
   *  never rejects. */
  drain(): Promise<void>;
  /** The drain without its wait: aborts in-flight work at once, then closes. */
  close(): Promise<void>;
}

/** Pending teardowns and cost resolutions get this long after the abort step (design D16). */
const FINAL_WINDOW_MS = 10_000;
/** Bounds closing the browser, so a wedged Chromium cannot hold the exit. */
const SESSION_CLOSE_MS = 10_000;
const DRAIN_POLL_MS = 25;
const PURGE_INTERVAL_MS = 3_600_000;
const DAY_MS = 86_400_000;

const bootLog = log.child({ scope: 'boot' });
const drainLog = log.child({ scope: 'drain' });

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function atStep<T>(reason: BootFailureReason, work: () => T): T {
  try {
    return work();
  } catch (err) {
    if (err instanceof BootError) throw err;
    throw new BootError(reason, messageOf(err));
  }
}

/**
 * The boot self-test (design D16): the curated `fixtures/tip-splitter.app.tsx` must run contained
 * with no error diagnostic, and an egress attempt from a run context must be blocked. Rejects with
 * `BootError('self_test', …)` naming what failed. `cwd` is where the fixture is read from.
 */
export async function runBootSelfTest(session: SynthRunSession, cwd: string = process.cwd()): Promise<void> {
  const source = atStep('self_test', () => fs.readFileSync(path.join(cwd, SELF_TEST_FIXTURE), 'utf8'));
  const report = await createRunCandidate(session)(source).catch((err: unknown) => {
    throw new BootError('self_test', `the self-test run of ${SELF_TEST_FIXTURE} failed: ${messageOf(err)}`);
  });
  const errors = report.diagnostics.filter((d) => d.severity === 'error').map((d) => d.kind);
  if (report.contained !== true || errors.length > 0) {
    throw new BootError(
      'self_test',
      `the self-test run of ${SELF_TEST_FIXTURE} was not clean: contained=${JSON.stringify(report.contained)}, error diagnostics=${JSON.stringify(errors)}`,
    );
  }
  const probe = await probeEgressBlocked(session).catch((err: unknown) => {
    throw new BootError('self_test', `the egress probe could not run: ${messageOf(err)}`);
  });
  if (!probe.blocked) {
    throw new BootError('self_test', `the egress probe was not blocked: ${JSON.stringify(probe)}`);
  }
}

/** The ledger's retention purge: at boot, then hourly on an unref'd timer. */
function scheduleLedgerPurge(usageStore: NodeSqliteUsageStore, config: ServerConfig): PurgeSchedule {
  const runOnce = (): void => {
    const cutoffDay = new Date(config.now() - config.ledgerRetentionDays * DAY_MS).toISOString().slice(0, 10);
    usageStore.purgeLedger(cutoffDay).catch((err: unknown) => {
      log.warn({ detail: messageOf(err) }, 'ledger purge failed');
    });
  };
  runOnce();
  const timer = setInterval(runOnce, PURGE_INTERVAL_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

/** Everything boot opened, closed on a boot failure or at the end of a drain. */
class Opened {
  usageStore: NodeSqliteUsageStore | undefined;
  reportStore: NodeSqliteReportStore | undefined;
  purges: PurgeSchedule[] = [];
  session: SynthRunSession | undefined;

  async close(): Promise<void> {
    for (const purge of this.purges) purge.stop();
    if (this.session) {
      const session = this.session;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<'expired'>((resolve) => {
        timer = setTimeout(() => resolve('expired'), SESSION_CLOSE_MS);
      });
      const outcome = await Promise.race([session.close().then(() => 'closed' as const, (err: unknown) => messageOf(err)), expired]);
      clearTimeout(timer);
      if (outcome !== 'closed') log.warn({ detail: outcome }, 'the synthetic-run session did not close cleanly');
    }
    this.reportStore?.close();
    this.usageStore?.close();
  }
}

/** Resolves `true` once `done()` holds, or `false` when `ms` elapse or `interrupt` aborts first. */
function waitUntil(done: () => boolean, ms: number, interrupt?: AbortSignal): Promise<boolean> {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = (): void => {
      if (done()) resolve(true);
      else if (interrupt?.aborted || Date.now() >= deadline) resolve(false);
      else setTimeout(tick, DRAIN_POLL_MS);
    };
    tick();
  });
}

interface DrainParts {
  config: ServerConfig;
  server: http.Server;
  slots: SlotController;
  inFlight: InFlightGenerations;
  resolveTracker: ResolveTracker;
  opened: Opened;
}

function createDrain(parts: DrainParts): Pick<ServerHandle, 'drain' | 'close'> {
  const { config, server, slots, inFlight, resolveTracker, opened } = parts;
  const skipWait = new AbortController();
  let running: Promise<void> | undefined;

  const run = async (): Promise<void> => {
    // 1. Refuse admission, stop accepting connections, drop the idle ones.
    slots.startDraining();
    let connectionsClosed = false;
    server.close(() => {
      connectionsClosed = true;
    });
    server.closeIdleConnections();
    drainLog.info({ ...slots.counts(), streams: inFlight.size, timeoutMs: config.drainTimeoutMs }, 'drain started');

    // 2. Let in-flight requests finish. A connection whose response has ended is idle and closed on
    //    the next tick, so the listener closes once every response has been written in full.
    await waitUntil(
      () => {
        server.closeIdleConnections();
        return connectionsClosed;
      },
      config.drainTimeoutMs,
      skipWait.signal,
    );

    // 3. Abort what remains, as a client disconnect would: streams through their controllers, and
    //    every other request through its connection (its `Request.signal`).
    if (!connectionsClosed) {
      const counts = slots.counts();
      if (inFlight.size > 0 || counts.generations > 0 || counts.unary > 0) {
        drainLog.warn({ ...counts, streams: inFlight.size }, 'drain wait over: aborting in-flight work');
      }
      inFlight.abortAll();
      server.closeAllConnections();
    }

    // 4. One final window for aborted teardowns to release their slots and settle, then for pending
    //    usage and cost resolution.
    const finalDeadline = Date.now() + FINAL_WINDOW_MS;
    const remaining = (): number => Math.max(0, finalDeadline - Date.now());
    await waitUntil(() => slots.counts().generations === 0 && slots.counts().unary === 0, remaining());
    while (resolveTracker.pendingCount > 0 && remaining() > 0) await resolveTracker.drain(remaining());

    // 5. Close everything.
    server.closeAllConnections();
    await opened.close();
    drainLog.info({ ...slots.counts(), pendingResolutions: resolveTracker.pendingCount }, 'drain complete');
  };

  const drain = (): Promise<void> => {
    if (running) {
      skipWait.abort();
      return running;
    }
    running = run().catch((err: unknown) => {
      drainLog.error({ detail: messageOf(err) }, 'drain failed');
    });
    return running;
  };

  return {
    drain,
    close: () => {
      skipWait.abort();
      return drain();
    },
  };
}

function listen(server: http.Server, host: string, port: number): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => reject(new BootError('listen', `could not listen on ${host}:${port}: ${err.message}`));
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server.address() as AddressInfo);
    });
  });
}

export async function startServer(options: StartServerOptions): Promise<ServerHandle> {
  const overrides = options.overrides ?? {};
  const config = atStep('config', () => loadServerConfig(options.env));
  const useStub = config.pipeline === 'stub';
  const dataDir = path.resolve(config.dataDir);
  atStep('preflight', () => runPreflight({ root: process.cwd(), dataDir }));

  const model = atStep('model', () => {
    if (overrides.model) return overrides.model;
    try {
      const deps = buildModelDepsFromEnv(options.env);
      return { client: deps.model, roster: deps.roster };
    } catch (err) {
      if (!useStub) throw err;
      bootLog.warn({ detail: messageOf(err), hint: '/v1/rewrite will respond 502 until configured.' }, 'starting in WHIM_PIPELINE=stub mode without a usable model client');
      return undefined;
    }
  });

  const opened = new Opened();
  try {
    const { usageStore, reportStore } = atStep('stores', () => {
      const usage = new NodeSqliteUsageStore(path.join(dataDir, 'usage.db'));
      opened.usageStore = usage;
      const reports = new NodeSqliteReportStore(path.join(dataDir, 'reports.db'));
      opened.reportStore = reports;
      opened.purges.push(schedulePurge(reports, { retentionDays: config.reportRetentionDays, now: config.now }));
      opened.purges.push(scheduleLedgerPurge(usage, config));
      return { usageStore: usage, reportStore: reports };
    });

    let pipeline: Pipeline;
    let basePolicy: ContentPolicy;
    if (useStub || !model) {
      pipeline = createStubPipeline(200);
      basePolicy = new StubContentPolicy();
    } else {
      opened.session = await SynthRunSession.launch({ concurrency: config.synthrunConcurrency }).catch((err: unknown) => {
        throw new BootError('browser_launch', messageOf(err));
      });
      await runBootSelfTest(opened.session);
      bootLog.info('boot self-test passed');
      pipeline = createGenerationPipeline({
        session: opened.session,
        // The pipeline reads only the client and roster; the key stays with the transports below.
        modelDeps: { model: model.client, roster: model.roster, apiKey: config.openRouterApiKey ?? '' },
        maxRunMs: config.generationMaxMs,
      });
      basePolicy = new ModelContentPolicy({
        modelClient: model.client,
        rewriteModelId: model.roster.rewrite,
        categories: loadContentPolicyDocument().categories,
        timeoutMs: config.policyTimeoutMs,
      });
    }

    const apiKey = config.openRouterApiKey;
    const slots = createSlotController({
      maxConcurrentGenerations: config.maxConcurrentGenerations,
      maxConcurrentUnary: config.maxConcurrentUnary,
    });
    const resolveTracker = new ResolveTracker();
    const inFlight = new InFlightGenerations();
    const app = createApp({
      pipeline,
      usageStore,
      keepaliveMs: 15_000,
      model: model?.client,
      roster: model?.roster,
      stub: useStub,
      // The dev-only device log sink: off unless explicitly enabled (design D5).
      devLogSink: config.devLogSink ? { filePath: path.resolve(config.devLogFile) } : undefined,
      config,
      slots,
      policy: cachedPolicy(basePolicy),
      reportStore,
      resolver: {
        transport: overrides.statsTransport ?? (apiKey ? openRouterUsageAndCostTransport(apiKey) : undefined),
        tracker: resolveTracker,
      },
      creditTransport: overrides.creditTransport ?? (apiKey ? createOpenRouterCreditTransport({ apiKey }) : undefined),
      inFlight,
    });
    const served = overrides.wrapApp ? overrides.wrapApp(app) : app;

    const host = options.listen?.host ?? config.serverHost;
    const server = http.createServer({}, getRequestListener((request, env) => served.fetch(request, env), { hostname: host }));
    const address = await listen(server, host, options.listen?.port ?? config.serverPort);
    const urlHost = host.includes(':') ? '[' + host + ']' : host;
    const url = `http://${urlHost}:${address.port}`;
    bootLog.info({ url, pipeline: useStub ? 'stub' : 'real' }, 'whim-server listening');

    return {
      url,
      config,
      session: opened.session,
      ...createDrain({ config, server, slots, inFlight, resolveTracker, opened }),
    };
  } catch (err) {
    await opened.close();
    if (err instanceof BootError) throw err;
    throw new BootError('composition', messageOf(err));
  }
}
