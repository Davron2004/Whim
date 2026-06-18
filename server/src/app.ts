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
import type { Pipeline } from './pipeline';
import type { UsageStore } from './usage-store';
import { makeGenerateRoute } from './routes/generate';
import { makeRewriteRoute } from './routes/rewrite';
import { makeUsageRoute } from './routes/usage';

/** UUID v4 pattern (also accepts other UUID versions — any 8-4-4-4-12 hex). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AppEnv = { Variables: { deviceId: string } };

export interface AppOptions {
  pipeline: Pipeline;
  usageStore: UsageStore;
  /** Keepalive interval for SSE streams, in ms. 0 / omitted = disabled. */
  keepaliveMs?: number;
}

export function createApp(options: AppOptions): Hono<AppEnv> {
  const { pipeline, usageStore, keepaliveMs } = options;
  const app = new Hono<AppEnv>();

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
        },
        400,
      );
    }

    if (!UUID_RE.test(deviceHeader)) {
      return c.json(
        {
          error: 'invalid_device_id',
          hint: 'The x-whim-device header must be a valid UUID (e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).',
        },
        400,
      );
    }

    c.set('deviceId', deviceHeader);
    await next();
  });

  // Mount routes under /v1
  app.route('/v1/generate', makeGenerateRoute(pipeline, usageStore, keepaliveMs));
  app.route('/v1/rewrite', makeRewriteRoute());
  app.route('/v1/usage', makeUsageRoute(usageStore));

  return app;
}
