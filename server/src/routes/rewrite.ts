/**
 * POST /v1/rewrite — validates RewriteRequest and returns a RewriteResponse produced by a real
 * call to the configured rewrite model (task 7.2, spec "Rewrite endpoint over the real rewrite
 * model"). Metered through the same `UsageStore` as generation. A model failure is a `502` with
 * an `ApiError` body — this route NEVER falls back to returning the input prompt disguised as a
 * rewrite (design D5: "a model failure can no longer be papered over").
 *
 * It is also the plan screen's endpoint (design D10): the request may carry the clarify exchange's
 * answers, and the response may carry the labelled `plan` rows the device renders as its approval
 * gate. Both are optional on the wire and optional here — one endpoint, one approval gate.
 */
import { Hono } from 'hono';
import { RewriteRequest, RewriteResponse, type ApiError, type PlanRow } from '@whim/contract';
import type { ModelClient, ModelRoster } from '../generation/model';
import type { UsageStore } from '../usage-store';
import { buildRewriteMessages } from '../generation/prompts';
import { parseJsonBlock } from '../generation/json-block';

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
 * The model is asked for `{ rewrittenPrompt, plan: [{label, text}] }` (design D10). A model that
 * answers with plain prose instead is NOT a failure: its whole reply becomes `rewrittenPrompt` with
 * no plan, and the device renders that single row. Rows are kept only when both fields are
 * non-empty strings; an empty row list is dropped entirely, since "no rows" and "zero rows" mean
 * the same thing to the device and the contract prefers the absent form.
 */
function shapeRewrite(text: string): RewriteResponse {
  const parsed = parseJsonBlock(text);
  if (typeof parsed !== 'object' || parsed === null) return { rewrittenPrompt: text.trim() };
  const v = parsed as Record<string, unknown>;
  const rewrittenPrompt = typeof v.rewrittenPrompt === 'string' ? v.rewrittenPrompt.trim() : '';
  if (rewrittenPrompt.length === 0) return { rewrittenPrompt: text.trim() };

  const rows: PlanRow[] = Array.isArray(v.plan)
    ? v.plan
        .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
        .map((row) => ({ label: String(row.label ?? '').trim(), text: String(row.text ?? '').trim() }))
        .filter((row) => row.label.length > 0 && row.text.length > 0)
    : [];

  return rows.length > 0 ? { rewrittenPrompt, plan: rows } : { rewrittenPrompt };
}

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

    let raw = '';
    try {
      for await (const delta of stream.deltas) raw += delta;
      const usage = await stream.usage;
      await usageStore.credit(deviceId, usage);
    // eslint-disable-next-line no-restricted-syntax -- intentional: stream/parse failure surfaces to the client as a 502, not silence
    } catch {
      return c.json(MODEL_FAILURE, 502);
    }

    return c.json(shapeRewrite(raw) satisfies RewriteResponse, 200);
  });

  return app;
}
