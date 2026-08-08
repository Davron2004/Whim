/**
 * createApp — assembles the Hono application.
 *
 * Routes:
 *   GET  /healthz          — anonymous health check
 *   POST /v1/generate      — SSE generation stream
 *   POST /v1/rewrite       — model-backed rewrite + optional plan rows
 *   POST /v1/clarify       — unary pre-stream clarify exchange (0–3 questions)
 *   GET  /v1/usage         — the calling device's accumulated token totals
 *   POST /dev/logs         — dev-only device log sink, mounted ONLY when `options.devLogSink` is
 *                            supplied (`main.ts`'s environment flag); absent ⇒ 404
 *
 * The x-whim-device UUID gate is mounted ONCE, by path prefix over `/v1/*`, and never route by
 * route: a route added under `/v1` later is gated by construction rather than by whoever
 * remembers. Missing/malformed → 400 JSON before any handler runs. `/healthz` is outside the
 * prefix and stays anonymous.
 */
import { Hono } from 'hono';
import type { DeviceIdError, DevLogSinkPath } from '@whim/contract';
import type { Pipeline } from './pipeline';
import type { UsageStore } from './usage-store';
import type { ModelClient, ModelRoster } from './generation/model';
import type { GenerationStatsTransport, ReconcileBounds } from './generation/reconcile';
import { makeGenerateRoute } from './routes/generate';
import { makeRewriteRoute } from './routes/rewrite';
import { makeClarifyRoute } from './routes/clarify';
import { makeUsageRoute } from './routes/usage';
import { makeDevLogsRoute, type DevLogSinkOptions } from './routes/dev-logs';
import { log } from './logger';

/** A transport that never resolves a generation id — safe as the default: the stub pipeline
 *  never records a generation id on `RunTrace`, so `reconcileAbortedUsage` short-circuits before
 *  this is ever called (design D9: "a stream cancelled before any model call was made credits
 *  nothing"). */
const NO_OP_STATS_TRANSPORT: GenerationStatsTransport = {
  fetchStats: async () => null,
};

/** UUID v4 pattern (also accepts other UUID versions — any 8-4-4-4-12 hex). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AppEnv = { Variables: { deviceId: string } };

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
  /** Post-abort usage reconciliation transport for `/v1/generate` (design D9, task 7.3).
   *  Defaults to a no-op transport — safe with the stub pipeline (see `NO_OP_STATS_TRANSPORT`). */
  reconcile?: { transport: GenerationStatsTransport; bounds?: Partial<ReconcileBounds> };
  /** The dev-only log sink (obs-v1). ABSENT unless `main.ts` sees its environment flag, and the
   *  route is mounted only when present — so a default server answers `404` there. Mounted
   *  OUTSIDE `/v1`, so the "every `/v1` route is gated by `x-whim-device`" invariant is untouched
   *  and no ungated product surface is created. */
  devLogSink?: DevLogSinkOptions;
  /** The stub selector (`WHIM_PIPELINE=stub`), forwarded from `main.ts`. Today it only makes
   *  `/v1/clarify` deterministic and model-free; the pipeline's own stub is selected by passing
   *  `createStubPipeline()` above, not by this flag. */
  stub?: boolean;
}

export function createApp(options: AppOptions): Hono<AppEnv> {
  const { pipeline, usageStore, keepaliveMs, model, roster } = options;
  const reconcile = options.reconcile ?? { transport: NO_OP_STATS_TRANSPORT };
  const app = new Hono<AppEnv>();

  // Per-request logging: one record per request carrying method, path, status and duration as
  // named fields, once the response settles — distinguishes "arrived and completed" from "never
  // arrived". SSE (`text/event-stream`) responses are excluded here: `await next()` returns as
  // soon as the route hands back its `Response`, before a streamed body has drained, so
  // `/v1/generate` logs itself once the stream actually settles (see `routes/generate.ts`).
  const requestLog = log.child({ scope: 'request' });
  app.use('*', async (c, next) => {
    const start = performance.now();
    await next();
    const contentType = c.res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('text/event-stream')) {
      requestLog.info(
        {
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          durationMs: Math.round(performance.now() - start),
        },
        'request',
      );
    }
  });

  // Health check — no auth
  app.get('/healthz', (c) => c.text('ok', 200));

  // Device-identity middleware for all /v1/* routes
  app.use('/v1/*', async (c, next) => {
    const deviceHeader = c.req.header('x-whim-device');

    if (!deviceHeader) {
      return c.json(
        {
          error: 'missing_device_id',
          hint: 'Include a UUID in the x-whim-device request header.',
        } satisfies DeviceIdError,
        400,
      );
    }

    if (!UUID_RE.test(deviceHeader)) {
      return c.json(
        {
          error: 'invalid_device_id',
          hint: 'The x-whim-device header must be a valid UUID (e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).',
        } satisfies DeviceIdError,
        400,
      );
    }

    c.set('deviceId', deviceHeader);
    await next();
  });

  // Mount routes under /v1
  app.route('/v1/generate', makeGenerateRoute(pipeline, usageStore, { keepaliveMs, reconcile }));
  app.route('/v1/rewrite', makeRewriteRoute(model, roster, usageStore));
  app.route('/v1/clarify', makeClarifyRoute(model, roster, usageStore, { stub: options.stub }));
  app.route('/v1/usage', makeUsageRoute(usageStore));

  // The dev log sink, when enabled — deliberately not under `/v1` (see `DevLogSinkPath`).
  if (options.devLogSink) {
    const devLogsPath: DevLogSinkPath = '/dev/logs';
    app.route(devLogsPath, makeDevLogsRoute(options.devLogSink));
  }

  return app;
}
