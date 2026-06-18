/**
 * POST /v1/rewrite — validates RewriteRequest and returns a deterministic RewriteResponse.
 * In this change the rewrite is canned (same input → same output); the real rewrite stage
 * replaces the internals behind this same endpoint later.
 */
import { Hono } from 'hono';
import { RewriteRequest, RewriteResponse } from '@whim/contract';

type Env = { Variables: { deviceId: string } };

export function makeRewriteRoute(): Hono<Env> {
  const app = new Hono<Env>();

  app.post('/', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = RewriteRequest.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'invalid_request', hint: parsed.error.issues[0]?.message ?? 'Invalid request body' },
        400,
      );
    }

    const { prompt } = parsed.data;
    // Deterministic canned rewrite: clarify and expand the prompt.
    const rewrittenPrompt = `[Clarified] ${prompt.trim()} — Please be specific and concise.`;

    const response: RewriteResponse = { rewrittenPrompt };
    return c.json(response, 200);
  });

  return app;
}
