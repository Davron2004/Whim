/**
 * createApp — assembles the Hono application.
 *
 * Routes:
 *   GET  /healthz          — anonymous health check
 *   POST /v1/generate      — SSE generation stream (requires x-whim-device UUID)
 *   POST /v1/rewrite       — canned deterministic rewrite (requires x-whim-device UUID)
 *
 * Middleware on /v1/* enforces the x-whim-device UUID header; missing/malformed → 400 JSON.
 */
import { Hono } from 'hono';
import type { DeviceIdError } from '@whim/contract';
import type { Pipeline } from './pipeline';
import type { UsageStore } from './usage-store';
import type { ModelClient, ModelRoster } from './generation/model';
import type { GenerationStatsTransport, ReconcileBounds } from './generation/reconcile';
import { makeGenerateRoute } from './routes/generate';
import { makeRewriteRoute } from './routes/rewrite';
import { makeUsageRoute } from './routes/usage';
import { logRequest } from './dev-log';

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
}

export function createApp(options: AppOptions): Hono<AppEnv> {
  const { pipeline, usageStore, keepaliveMs, model, roster } = options;
  const reconcile = options.reconcile ?? { transport: NO_OP_STATS_TRANSPORT };
  const app = new Hono<AppEnv>();

  // Dev request logging (task 4.1, design D5): one line per request (method, path, status,
  // duration) once the response settles — distinguishes "arrived and completed" from "never
  // arrived". SSE (`text/event-stream`) responses are excluded here: `await next()` returns as
  // soon as the route hands back its `Response`, before a streamed body has drained, so
  // `/v1/generate` logs itself once the stream actually settles (see `routes/generate.ts`).
  app.use('*', async (c, next) => {
    const start = performance.now();
    await next();
    const contentType = c.res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('text/event-stream')) {
      logRequest(c.req.method, c.req.path, c.res.status, start);
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
  app.route('/v1/usage', makeUsageRoute(usageStore));

  return app;
}
