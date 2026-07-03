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

    // One AbortController per request, wired to BOTH cancellation surfaces the runtime may
    // fire: the SSE stream's own cancel() and the request's Request.signal (when present).
    // AbortController#abort() is idempotent, so both surfaces firing is harmless.
    //
    // NOTE: the deterministic suites drive only the cancel() surface. Whether
    // @hono/node-server actually fires Request.signal on a real TCP disconnect is an external
    // runtime assumption nothing here asserts — its acceptance step is the LAN check when the
    // real pipeline is mounted (#11): kill the device app mid-generation, confirm the server
    // log shows the abort. See docs/v1-roadmap.md #11 carryover.
    const controller = new AbortController();
    const requestSignal = c.req.raw.signal;
    if (requestSignal) {
      if (requestSignal.aborted) {
        controller.abort();
      } else {
        requestSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    // Wrap the pipeline to intercept the usage event and credit before terminal
    const source = interceptUsage(
      pipeline.run(parsed.data, controller.signal),
      deviceId,
      usageStore,
    );
    const stream = buildSseStream(source, keepaliveMs, () => controller.abort());

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
