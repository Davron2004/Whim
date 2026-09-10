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
 *
 * A re-prompt additionally carries `app`, the display-name context of the app being changed. This
 * route neither builds nor edits it: `RewriteRequest` validates it (and strips anything else the
 * device put there), and the parsed request reaches `buildRewriteMessages` whole — the prompt
 * builder is the one place that decides how an edit is stated to the model.
 */
import { Hono } from 'hono';
import { RewriteRequest, RewriteResponse, type ApiError, type PlanRow } from '@whim/contract';
import type { ModelClient, ModelMessage, ModelRoster } from '../generation/model';
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
        .map((row) => ({
          label: (typeof row.label === 'string' ? row.label : '').trim(),
          text: (typeof row.text === 'string' ? row.text : '').trim(),
        }))
        .filter((row) => row.label.length > 0 && row.text.length > 0)
    : [];

  return rows.length > 0 ? { rewrittenPrompt, plan: rows } : { rewrittenPrompt };
}

/**
 * Runs the rewrite turn, re-asking once when the reply shapes to no plan. The plan step cannot
 * render without rows, so any reply with no usable `plan` — an empty stream, JSON truncated before
 * `rewrittenPrompt`/`plan` ever appear, or plain prose with no structured rows — costs one extra
 * model call BY DESIGN: that is cheaper than showing the device an empty or malformed plan screen.
 * A second such reply is still returned rather than tried a third time: retrying forever on a
 * model that keeps answering the same way just delays the response for no better outcome.
 * Extracted from the route handler so the retry loop doesn't push the handler's own branching over
 * the cognitive-complexity budget.
 */
async function rewriteWithRetry(
  model: ModelClient,
  roster: ModelRoster,
  messages: ModelMessage[],
  signal: AbortSignal | undefined,
  usageStore: UsageStore,
  deviceId: string,
): Promise<{ ok: true; response: RewriteResponse } | { ok: false }> {
  let shaped: RewriteResponse | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = model.stream({ model: roster.rewrite, messages }, signal);
    let raw = '';
    try {
      for await (const delta of stream.deltas) if (delta.kind === 'text') raw += delta.text;
      const usage = await stream.usage;
      await usageStore.credit(deviceId, usage);
    // eslint-disable-next-line no-restricted-syntax -- intentional: stream/parse failure surfaces to the client as a 502, not silence
    } catch {
      return { ok: false };
    }
    shaped = shapeRewrite(raw);
    if (shaped.rewrittenPrompt.length > 0 && shaped.plan) break;
  }
  return { ok: true, response: shaped as RewriteResponse };
}

export interface RewriteRouteOptions {
  /** True when the server was started under the stub selector (`WHIM_PIPELINE=stub`): a prompt
   *  carrying the stub pipeline's `[[fail]]` marker is passed through raw, with no model call —
   *  mirroring `/v1/clarify`'s stub short-circuit — so the marker survives into `/v1/generate`. */
  stub?: boolean;
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
  options: RewriteRouteOptions = {},
): Hono<Env> {
  const app = new Hono<Env>();

  app.post('/', async (c) => {
    const deviceId = c.get('deviceId');
    const body = await c.req.json().catch(() => null);
    const parsed = RewriteRequest.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'invalid_request', hint: parsed.error.issues[0]?.message ?? 'Invalid request body' } satisfies ApiError,
        400,
      );
    }

    if (options.stub && parsed.data.prompt.includes('[[fail]]')) {
      return c.json({ rewrittenPrompt: parsed.data.prompt } satisfies RewriteResponse, 200);
    }

    if (!model || !roster) return c.json(NOT_CONFIGURED, 502);

    const messages = buildRewriteMessages({ request: parsed.data });
    const outcome = await rewriteWithRetry(model, roster, messages, c.req.raw.signal, usageStore, deviceId);
    if (!outcome.ok) return c.json(MODEL_FAILURE, 502);

    return c.json(outcome.response, 200);
  });

  return app;
}
