/**
 * createApp — assembles the Hono application.
 *
 * Routes:
 *   GET  /healthz          — anonymous health check
 *   GET  /healthz/sse      — anonymous stream probe (three spaced SSE comment frames, then close)
 *   POST /v1/generate      — SSE generation stream
 *   POST /v1/rewrite       — model-backed rewrite + optional plan rows
 *   POST /v1/clarify       — unary pre-stream clarify exchange (0–3 questions)
 *   POST /v1/report        — devices report objectionable or broken content
 *   GET  /v1/usage         — the calling device's accumulated token totals
 *   POST /dev/logs         — dev-only device log sink, mounted ONLY when `options.devLogSink` is
 *                            supplied (`main.ts`'s environment flag); absent ⇒ 404
 *
 * The x-whim-device gate is mounted ONCE, by path prefix over `/v1/*`, and never route by route: a
 * route added under `/v1` later is gated by construction rather than by whoever remembers. It asks
 * an injectable `DeviceVerifier` (design D15) for the calling device's id — routes, admission and
 * metering read only what it returns, never the raw header. `/healthz` and `/healthz/sse` stay
 * outside the prefix and anonymous.
 *
 * `/v1/*` middleware order (request-envelope): request id (`assignRequestId`) → device gate →
 * client envelope (`readEnvelope`) → the minimum-build gate → routes, each of which declares its
 * consent practice (`consentPractice`) before its own admission. See `./request-edge.ts`.
 */
import { Hono } from 'hono';
import type { ApiError, DevLogSinkPath } from '@whim/contract';
import type { Pipeline } from './pipeline';
import type { UsageStore } from './usage-store';
import type { ModelClient, ModelRoster } from './generation/model';
import { InFlightGenerations, makeGenerateRoute } from './routes/generate';
import { makeRewriteRoute } from './routes/rewrite';
import { makeClarifyRoute } from './routes/clarify';
import { makeReportRoute } from './routes/report';
import { makeUsageRoute } from './routes/usage';
import { makeDevLogsRoute, type DevLogSinkOptions } from './routes/dev-logs';
import { log } from './logger';
import { assignRequestId, envelopeLogFields, readEnvelope, type EdgeEnv } from './request-edge';
import { shapeOnlyVerifier, type DeviceVerifier } from './device-identity';
import { loadServerConfig, type ServerConfig } from './config';
import { createSlotController, type SlotController } from './admission/slots';
import { slotRefusal } from './admission/refusals';
import type { CreditTransport } from './admission/credit';
import { cachedPolicy } from './policy/cache';
import { StubContentPolicy, type ContentPolicy } from './policy/policy';
import { InMemoryReportStore, type ReportStore } from './reports/store';
import { ResolveTracker, type ResolveBounds, type UsageAndCostTransport } from './usage/resolve';

/** A transport that never resolves a generation id — the resolver's default when a caller supplies
 *  none. The stub pipeline records no generation id, so the resolver never calls it for a stub run
 *  (design D9: "a stream cancelled before any model call was made credits nothing"); for an
 *  unconfigured server's model calls, cost simply never resolves. */
const NO_OP_RESOLVE_TRANSPORT: UsageAndCostTransport = {
  fetchStats: async () => null,
};

type AppEnv = EdgeEnv;

export interface AppOptions {
  pipeline: Pipeline;
  usageStore: UsageStore;
  /** Keepalive interval for SSE streams, in ms. 0 / omitted = disabled. */
  keepaliveMs?: number;
  /** Model client + roster for the real `/v1/rewrite` (task 7.2). Optional so a caller that only
   *  exercises the pipeline need not supply one; when absent, `/v1/rewrite` responds `502`
   *  (`rewrite_not_configured`) rather than falling back to a canned rewrite. */
  model?: ModelClient;
  roster?: ModelRoster;
  /** The dev-only log sink (obs-v1). ABSENT unless `main.ts` sees its environment flag, and the
   *  route is mounted only when present — so a default server answers `404` there. Mounted
   *  OUTSIDE `/v1`, so the "every `/v1` route is gated by `x-whim-device`" invariant is untouched
   *  and no ungated product surface is created. */
  devLogSink?: DevLogSinkOptions;
  /** The stub selector (`WHIM_PIPELINE=stub`), forwarded from `main.ts`. It makes `/v1/clarify`
   *  deterministic and model-free, and makes `/v1/rewrite` pass a `[[fail]]`-marked prompt
   *  through raw (no model call) so the marker survives into `/v1/generate`; the pipeline's own
   *  stub is selected by passing `createStubPipeline()` above, not by this flag. */
  stub?: boolean;

  /** Verifies `x-whim-device` and resolves a device id (design D15). Defaults to
   *  `shapeOnlyVerifier` — today's UUID shape check. */
  deviceVerifier?: DeviceVerifier;
  /** The typed, frozen admission/ledger configuration (design D8). Defaults to
   *  `loadServerConfig({})` — the public-beta defaults under `NODE_ENV=development`. */
  config?: ServerConfig;
  /** Overrides the clock every admission/ledger computation reads, independent of `config.now` —
   *  lets a caller control time without reconstructing a whole `ServerConfig`. Defaults to
   *  the effective `config`'s own `now`. */
  clock?: () => number;
  /** The process-wide generation/unary slot controller (design D8) — also chain-11's drain hook:
   *  `slots.startDraining()` refuses new admissions and `slots.counts()` reports what is still
   *  in-flight. Defaults to a fresh controller sized from `config`. */
  slots?: SlotController;
  /** The content policy every prompt-accepting route checks before any model work (design D9).
   *  MUST already be wrapped in `cachedPolicy` — `createApp` never wraps a policy it is given, so
   *  an unwrapped policy passed here logs nothing (`handoff/content-policy.md`). Defaults to
   *  `cachedPolicy(new StubContentPolicy())` when omitted, so a caller that does not care about
   *  content policy (most existing suites) need not wire one. */
  policy?: ContentPolicy;
  /** The report store `/v1/report` persists into (design D10). Defaults to a fresh
   *  `InMemoryReportStore`. */
  reportStore?: ReportStore;
  /** Deps for the post-request cost resolution and aborted-run token reconciliation of
   *  `/v1/generate`, `/v1/clarify` and `/v1/rewrite` (design D7's resolver, `usage/resolve.ts`).
   *  `tracker`, when supplied, is the SAME instance a later `drain` (chain-11) calls `.drain()` on;
   *  omitted, `createApp` makes one unreachable from outside. `transport` defaults to one that
   *  never resolves a stat — `main.ts` supplies the real OpenRouter-backed one. */
  resolver?: { transport?: UsageAndCostTransport; tracker?: ResolveTracker; bounds?: Partial<ResolveBounds> };
  /** The operator-credit lookup transport `checkCredit` (design D6a) uses ahead of every generate,
   *  clarify and rewrite admission. Omitted entirely means the credit check is skipped (never
   *  refuses on budget) — `main.ts` supplies `createOpenRouterCreditTransport(...)` in production. */
  creditTransport?: CreditTransport;
  /** The in-flight generation registry a drain aborts once its wait runs out. Omitted, `createApp`
   *  makes one unreachable from outside. */
  inFlight?: InFlightGenerations;
  /** Spacing between `GET /healthz/sse`'s three probe frames. Defaults to `PROBE_FRAME_INTERVAL_MS`
   *  (production: one second, matching the proxy-flush window the probe is checking). Tests inject
   *  a small value so the spacing assertion doesn't cost real wall clock. */
  probeFrameIntervalMs?: number;
}

const PROBE_FRAME = ': whim-healthz-probe\n\n';
const PROBE_FRAME_COUNT = 3;
const PROBE_FRAME_INTERVAL_MS = 1000;
const probeEncoder = new TextEncoder();

/** `GET /healthz/sse` (specs/server-deployment "An anonymous stream probe verifies proxy
 *  flushing"): three SSE comment frames `intervalMs` apart, then close — no model call, no stored
 *  state. `onSettled` fires exactly once, however the stream ends, so the caller can release its
 *  unary slot regardless of a normal close vs. a client cancel. */
function buildProbeStream(onSettled: () => void, intervalMs: number): ReadableStream<Uint8Array> {
  let cancelled = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settleOnce = (): void => {
    if (settled) return;
    settled = true;
    onSettled();
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 0; i < PROBE_FRAME_COUNT && !cancelled; i++) {
        if (i > 0) {
          await new Promise<void>((resolve) => {
            timer = setTimeout(resolve, intervalMs);
          });
        }
        if (cancelled) break;
        controller.enqueue(probeEncoder.encode(PROBE_FRAME));
      }
      if (!cancelled) controller.close();
      settleOnce();
    },
    cancel() {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      settleOnce();
    },
  });
}

export function createApp(options: AppOptions): Hono<AppEnv> {
  const { pipeline, usageStore, keepaliveMs, model, roster } = options;

  const deviceVerifier = options.deviceVerifier ?? shapeOnlyVerifier;
  const config = options.config ?? loadServerConfig({});
  const clock = options.clock ?? config.now;
  const slots = options.slots ?? createSlotController({
    maxConcurrentGenerations: config.maxConcurrentGenerations,
    maxConcurrentUnary: config.maxConcurrentUnary,
    maxConcurrentProbes: config.maxConcurrentProbes,
  });
  const policy = options.policy ?? cachedPolicy(new StubContentPolicy());
  const reportStore = options.reportStore ?? new InMemoryReportStore();
  const resolveTracker = options.resolver?.tracker ?? new ResolveTracker();
  const resolveTransport = options.resolver?.transport ?? NO_OP_RESOLVE_TRANSPORT;
  const resolveBounds = options.resolver?.bounds;
  const { creditTransport } = options;
  const inFlight = options.inFlight ?? new InFlightGenerations();

  const app = new Hono<AppEnv>();

  // Per-request logging: one record per request carrying method, path, status and duration as
  // named fields, once the response settles — distinguishes "arrived and completed" from "never
  // arrived". A `/v1` request's record goes through its request-scoped logger, so it carries
  // `requestId`, plus the envelope once it was read (design D9) — never the device id. SSE
  // (`text/event-stream`) responses are excluded here: `await next()` returns as soon as the route
  // hands back its `Response`, before a streamed body has drained, so `/v1/generate` (and
  // `/healthz/sse`) log themselves once the stream actually settles.
  app.use('*', async (c, next) => {
    const start = performance.now();
    await next();
    const contentType = c.res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('text/event-stream')) {
      (c.get('log') ?? log).info(
        {
          scope: 'request',
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs: Math.round(performance.now() - start),
          ...envelopeLogFields(c.get('envelope')),
        },
        'request',
      );
    }
  });

  // The one handler for anything a route threw without answering (a store blip, a bug). Without it
  // Hono answers its own plain-text 500, which is the single response shape on this server that is
  // not an `ApiError` — a client parsing `{ error, hint }` gets a parse failure instead of a
  // failure it can show. The real error goes to the log (with the method and path that produced
  // it), never to the client: an internal message can carry a file path, a query, or a key.
  app.onError((err, c) => {
    (c.get('log') ?? log).error(
      {
        scope: 'request',
        method: c.req.method,
        path: c.req.path,
        errorClass: err instanceof Error ? err.constructor.name : typeof err,
        detail: err instanceof Error ? err.message : String(err),
      },
      'unhandled route error',
    );
    const body: ApiError = { error: 'internal_error', hint: 'Something went wrong on our side. Please try again.' };
    return c.json(body, 500);
  });

  // Health check — no auth
  app.get('/healthz', (c) => c.json({ ok: true, service: 'whim-server' }, 200));

  // The anonymous stream probe — outside /v1, no device header, and counted against its OWN small
  // pool (`WHIM_LIMIT_PROBE_CONCURRENCY`), never the paid clarify/rewrite one: it is unauthenticated
  // and holds its slot for seconds, so sharing the unary pool would let anonymous traffic starve every
  // paying device (specs/server-deployment "An anonymous stream probe verifies proxy flushing").
  app.get('/healthz/sse', (c) => {
    const acquired = slots.acquire('probe', 'healthz-probe');
    if (!acquired.ok) {
      const r = slotRefusal(acquired.reason);
      return c.json(r.body, r.status, r.headers);
    }
    const { handle } = acquired;
    let released = false;
    const stream = buildProbeStream(() => {
      if (released) return;
      released = true;
      handle.release();
    }, options.probeFrameIntervalMs ?? PROBE_FRAME_INTERVAL_MS);
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  });

  // The request id comes first, so every `/v1` response — the device gate's refusals included —
  // carries it.
  app.use('/v1/*', assignRequestId);

  // Device-identity middleware for all /v1/* routes — an injectable verifier, never a raw header
  // read (design D15).
  app.use('/v1/*', async (c, next) => {
    const result = await deviceVerifier.verify(c.req.raw.headers);
    if (!result.ok) {
      return c.json(result.body, result.status);
    }
    c.set('deviceId', result.deviceId);
    await next();
  });

  // The client envelope, after identity and before any route admission (design D3).
  app.use('/v1/*', readEnvelope);

  // The minimum-build gate (app-update-gate) mounts here: after the envelope, before the routes.

  // Mount routes under /v1
  app.route(
    '/v1/generate',
    makeGenerateRoute(pipeline, usageStore, {
      keepaliveMs,
      config,
      clock,
      slots,
      policy,
      creditTransport,
      resolveTracker,
      resolveTransport,
      resolveBounds,
      inFlight,
    }),
  );
  app.route(
    '/v1/rewrite',
    makeRewriteRoute(model, roster, usageStore, {
      stub: options.stub,
      config,
      clock,
      slots,
      policy,
      creditTransport,
      resolveTracker,
      resolveTransport,
      resolveBounds,
    }),
  );
  app.route(
    '/v1/clarify',
    makeClarifyRoute(model, roster, usageStore, {
      stub: options.stub,
      config,
      clock,
      slots,
      policy,
      creditTransport,
      resolveTracker,
      resolveTransport,
      resolveBounds,
    }),
  );
  app.route('/v1/report', makeReportRoute(usageStore, reportStore, { config, clock, slots }));
  app.route('/v1/usage', makeUsageRoute(usageStore));

  // The dev log sink, when enabled — deliberately not under `/v1` (see `DevLogSinkPath`).
  if (options.devLogSink) {
    const devLogsPath: DevLogSinkPath = '/dev/logs';
    app.route(devLogsPath, makeDevLogsRoute(options.devLogSink));
  }

  return app;
}
