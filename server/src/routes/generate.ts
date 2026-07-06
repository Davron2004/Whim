/**
 * POST /v1/generate — validates GenerateRequest, streams SSE events from the injected pipeline.
 * Credits usage through the UsageStore BEFORE the terminal event is emitted.
 */
import { Hono } from 'hono';
import { GenerateRequest, GenerationEvent } from '@whim/contract';
import type { Pipeline } from '../pipeline';
import type { UsageStore } from '../usage-store';
import { buildSseStream } from '../sse';

type Env = { Variables: { deviceId: string } };

export function makeGenerateRoute(
  pipeline: Pipeline,
  usageStore: UsageStore,
  keepaliveMs?: number,
): Hono<Env> {
  const app = new Hono<Env>();

  app.post('/', async (c) => {
    const deviceId = c.get('deviceId');

    // Validate request body
    const body = await c.req.json().catch(() => null);
    const parsed = GenerateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', hint: parsed.error.issues[0]?.message ?? 'Invalid request body' }, 400);
    }

    // Wrap the pipeline to intercept the usage event and credit before terminal
    const source = interceptUsage(pipeline.run(parsed.data), deviceId, usageStore);
    const stream = buildSseStream(source, keepaliveMs);

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    });
  });

  return app;
}

/**
 * Wraps an event source: when a `usage` event is seen, credit the store before yielding it,
 * then yield the terminal event after.
 */
async function* interceptUsage(
  source: AsyncIterable<GenerationEvent>,
  deviceId: string,
  usageStore: UsageStore,
): AsyncIterable<GenerationEvent> {
  for await (const event of source) {
    if (event.type === 'usage') {
      await usageStore.credit(deviceId, event.usage);
    }
    yield event;
  }
}
