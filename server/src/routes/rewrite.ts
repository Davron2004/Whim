/**
 * POST /v1/rewrite — validates RewriteRequest and returns a RewriteResponse produced by a real
 * call to the configured rewrite model (task 7.2, spec "Rewrite endpoint over the real rewrite
 * model"). Metered through the same `UsageStore` as generation. A model failure is a `502` with
 * an `ApiError` body — this route NEVER falls back to returning the input prompt disguised as a
 * rewrite (design D5: "a model failure can no longer be papered over").
 */
import { Hono } from 'hono';
import { RewriteRequest, RewriteResponse, type ApiError } from '@whim/contract';
import type { ModelClient, ModelRoster } from '../generation/model';
import type { UsageStore } from '../usage-store';
import { buildRewriteMessages } from '../generation/prompts';

type Env = { Variables: { deviceId: string } };

const NOT_CONFIGURED: ApiError = {
  error: 'rewrite_not_configured',
  hint: 'The server was started without a model client for /v1/rewrite — set OPENROUTER_API_KEY and the model roster.',
};

const MODEL_FAILURE: ApiError = {
  error: 'model_failure',
  hint: 'The rewrite model call failed. Try again in a moment.',
};

/**
 * `model`/`roster` are optional so a caller that only exercises `/v1/generate` (e.g. the
 * pre-existing server-core/metering suites) need not supply one — an unconfigured server
 * responds `502` to every rewrite request rather than silently falling back to a canned rewrite.
 */
export function makeRewriteRoute(
  model: ModelClient | undefined,
  roster: ModelRoster | undefined,
  usageStore: UsageStore,
): Hono<Env> {
  const app = new Hono<Env>();

  app.post('/', async (c) => {
    if (!model || !roster) return c.json(NOT_CONFIGURED, 502);

    const deviceId = c.get('deviceId');
    const body = await c.req.json().catch(() => null);
    const parsed = RewriteRequest.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'invalid_request', hint: parsed.error.issues[0]?.message ?? 'Invalid request body' } satisfies ApiError,
        400,
      );
    }

    const messages = buildRewriteMessages({ request: parsed.data });
    const stream = model.stream({ model: roster.rewrite, messages }, c.req.raw.signal);

    let rewrittenPrompt = '';
    try {
      for await (const delta of stream.deltas) rewrittenPrompt += delta;
      const usage = await stream.usage;
      await usageStore.credit(deviceId, usage);
    } catch {
      return c.json(MODEL_FAILURE, 502);
    }

    return c.json({ rewrittenPrompt } satisfies RewriteResponse, 200);
  });

  return app;
}
