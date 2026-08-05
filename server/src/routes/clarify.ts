/**
 * POST /v1/clarify — the pre-stream clarify exchange (design D1, spec "Clarify endpoint").
 *
 * Unary by construction: prompt in, at most three questions out. It is NOT a generation stage, it
 * opens no stream, and it holds no per-device state — the device carries the answers forward by
 * value inside the rewrite/generate request that follows. `GenerationEvent` is untouched.
 *
 * Zero questions is a first-class success (`200` with an empty list), never an error and never a
 * degraded mode: most prompts need nothing clarified. What is NOT dressed up as zero questions is
 * a broken model call — that stays an honest `502`, mirroring `/v1/rewrite`.
 */
import { Hono } from 'hono';
import { ClarifyRequest, ClarifyResponse, type ApiError } from '@whim/contract';
import type { ModelClient, ModelRoster } from '../generation/model';
import type { UsageStore } from '../usage-store';
import { buildClarifyMessages } from '../generation/prompts';
import { parseJsonBlock } from '../generation/json-block';

type Env = { Variables: { deviceId: string } };

const NOT_CONFIGURED: ApiError = {
  error: 'clarify_not_configured',
  hint: 'The server was started without a model client for /v1/clarify — set OPENROUTER_API_KEY and the model roster, or start it with WHIM_PIPELINE=stub.',
};

const MODEL_FAILURE: ApiError = {
  error: 'model_failure',
  hint: 'The clarify model call failed. Try again in a moment.',
};

/** The prompt marker that makes the stub answer "nothing to ask" — the deterministic twin of the
 *  stub pipeline's `[[fail]]`, so the device's skip path is reachable without a model. */
const STUB_NO_QUESTIONS_MARKER = '[[noclarify]]';

/** The stub's canned questions: fixed, prompt-independent, and deliberately generic — this exists
 *  so LAN UI work can drive the clarify screen without spending tokens, not to be a clarifier. */
const STUB_QUESTIONS: ClarifyResponse = {
  questions: [
    { id: 'scope', question: 'How much should it hold?', options: ['Just today', 'A few weeks', 'Everything'] },
    { id: 'entry', question: 'How do you add things?', options: ['Type it', 'Pick from a list'] },
    { id: 'done', question: 'What happens when something is done?', options: ['It disappears', 'It stays, ticked'] },
  ],
};

/**
 * Model output → a conforming `ClarifyResponse`, or `undefined` when it is unusable. Defensive
 * normalization only, never fabrication: a question past the third is dropped, as is one with no
 * options — both are the model exceeding a bound the contract sets, not content to invent.
 */
function shapeClarify(text: string): ClarifyResponse | undefined {
  const parsed = parseJsonBlock(text);
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const raw = (parsed as Record<string, unknown>).questions;
  if (!Array.isArray(raw)) return undefined;

  const questions = raw
    .filter((q): q is Record<string, unknown> => typeof q === 'object' && q !== null)
    .map((q, index) => ({
      id: typeof q.id === 'string' && q.id.trim().length > 0 ? q.id.trim() : `q${index + 1}`,
      question: typeof q.question === 'string' ? q.question.trim() : '',
      options: Array.isArray(q.options)
        ? q.options.filter((o): o is string => typeof o === 'string' && o.trim().length > 0).map((o) => o.trim())
        : [],
    }))
    .filter((q) => q.question.length > 0 && q.options.length > 0)
    .slice(0, 3);

  const result = ClarifyResponse.safeParse({ questions });
  return result.success ? result.data : undefined;
}

export interface ClarifyRouteOptions {
  /** True when the server was started under the stub selector (`WHIM_PIPELINE=stub`): the route
   *  answers deterministically and makes no model call, exactly as the stub pipeline does. */
  stub?: boolean;
}

/**
 * `model`/`roster` are optional for the same reason `/v1/rewrite`'s are: a caller that only
 * exercises the pipeline need not supply one. An unconfigured, non-stub server answers `502`.
 */
export function makeClarifyRoute(
  model: ModelClient | undefined,
  roster: ModelRoster | undefined,
  usageStore: UsageStore,
  options: ClarifyRouteOptions = {},
): Hono<Env> {
  const app = new Hono<Env>();

  app.post('/', async (c) => {
    const deviceId = c.get('deviceId');
    const body = await c.req.json().catch(() => null);
    const parsed = ClarifyRequest.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'invalid_request', hint: parsed.error.issues[0]?.message ?? 'Invalid request body' } satisfies ApiError,
        400,
      );
    }

    if (options.stub) {
      const stubbed = parsed.data.prompt.includes(STUB_NO_QUESTIONS_MARKER) ? { questions: [] } : STUB_QUESTIONS;
      return c.json(stubbed satisfies ClarifyResponse, 200);
    }

    if (!model || !roster) return c.json(NOT_CONFIGURED, 502);

    // The small/fast model — clarify asks two short questions, it does not write code.
    const stream = model.stream({ model: roster.rewrite, messages: buildClarifyMessages({ request: parsed.data }) }, c.req.raw.signal);

    let raw = '';
    try {
      for await (const delta of stream.deltas) raw += delta;
      const usage = await stream.usage;
      await usageStore.credit(deviceId, usage);
    } catch {
      return c.json(MODEL_FAILURE, 502);
    }

    const shaped = shapeClarify(raw);
    if (!shaped) return c.json(MODEL_FAILURE, 502);
    return c.json(shaped satisfies ClarifyResponse, 200);
  });

  return app;
}
