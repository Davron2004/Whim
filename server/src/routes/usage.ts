/**
 * GET /v1/usage — returns the calling device's accumulated Usage totals.
 * Scoped strictly to the x-whim-device header (validated upstream by middleware).
 * Unknown device ID → zeroed Usage, HTTP 200 (never an error).
 */
import { Hono } from 'hono';
import type { UsageStore } from '../usage-store';

type Env = { Variables: { deviceId: string } };

export function makeUsageRoute(usageStore: UsageStore): Hono<Env> {
  const app = new Hono<Env>();

  app.get('/', async (c) => {
    const deviceId = c.get('deviceId');
    const usage = await usageStore.read(deviceId);
    return c.json(usage, 200);
  });

  return app;
}
