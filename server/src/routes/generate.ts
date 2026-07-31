/**
 * POST /v1/generate — validates GenerateRequest, streams SSE events from the injected pipeline.
 * Credits usage through the UsageStore BEFORE the terminal event is emitted (`interceptUsage`
 * stays the SOLE normal-path crediting authority, design D9). On abort — before any terminal
 * event was ever observed — reconciles the run's authoritative usage for every provider
 * generation id the pipeline recorded on the request's `RunTrace` (task 7.3, design D9); a run
 * that completed normally never reaches this path, so the two crediting paths can never
 * double-count.
 */
import { Hono } from 'hono';
import { GenerateRequest, GenerationEvent, type ApiError } from '@whim/contract';
import type { Pipeline } from '../pipeline';
import type { UsageStore } from '../usage-store';
import type { RunTrace } from '../generation/machine';
import { reconcileAbortedUsage, type GenerationStatsTransport, type ReconcileBounds } from '../generation/reconcile';
import { buildSseStream } from '../sse';

type Env = { Variables: { deviceId: string } };

/** `Pipeline.run` (`../pipeline.ts`) stays unchanged (design D1) — a real implementation MAY
 *  accept an optional third `trace` out-parameter (design D9) without it being part of that
 *  shared interface; a stub that ignores the extra argument stays conforming at runtime. This
 *  route always passes one, widening the call type locally rather than editing `pipeline.ts`. */
type PipelineRun = (request: GenerateRequest, signal?: AbortSignal, trace?: RunTrace) => AsyncIterable<GenerationEvent>;

export interface GenerateRouteOptions {
  keepaliveMs?: number;
  /** Post-abort usage reconciliation deps (design D9, task 7.3). */
  reconcile: { transport: GenerationStatsTransport; bounds?: Partial<ReconcileBounds> };
}

export function makeGenerateRoute(
  pipeline: Pipeline,
  usageStore: UsageStore,
  options: GenerateRouteOptions,
): Hono<Env> {
  const app = new Hono<Env>();
  const { keepaliveMs, reconcile } = options;

  app.post('/', async (c) => {
    const deviceId = c.get('deviceId');

    // Validate request body
    const body = await c.req.json().catch(() => null);
    const parsed = GenerateRequest.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'invalid_request', hint: parsed.error.issues[0]?.message ?? 'Invalid request body' } satisfies ApiError,
        400,
      );
    }

    // One AbortController per request, wired to BOTH cancellation surfaces the runtime may
    // fire: the SSE stream's own cancel() and the request's Request.signal (when present).
    // AbortController#abort() is idempotent, so both surfaces firing is harmless.
    //
    // NOTE: the deterministic suites drive only the cancel() surface. Whether
    // @hono/node-server actually fires Request.signal on a real TCP disconnect is an external
    // runtime assumption nothing here asserts — its acceptance step is the LAN check when the
    // real pipeline is mounted (task 7.6): kill the device app mid-generation, confirm the
    // server log shows the abort. See docs/v1-roadmap.md #11 carryover.
    const controller = new AbortController();
    const requestSignal = c.req.raw.signal;
    if (requestSignal) {
      if (requestSignal.aborted) {
        controller.abort();
      } else {
        requestSignal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    // The pipeline appends each model call's provider generation id here as it resolves
    // (design D9). Reconciliation, below, fires ONLY if the run is aborted before a terminal
    // event was ever streamed — a run that never made a model call reconciles nothing
    // (`trace.generationIds` stays empty, `reconcileAbortedUsage` short-circuits).
    const trace: RunTrace = { generationIds: [] };
    let reachedTerminal = false;
    controller.signal.addEventListener(
      'abort',
      () => {
        if (reachedTerminal) return;
        // `reconcileAbortedUsage` never throws/rejects (`../generation/reconcile.ts`'s own
        // contract) — fire-and-forget is intentional, the SSE response has already ended.
        reconcileAbortedUsage(deviceId, trace.generationIds, {
          transport: reconcile.transport,
          usageStore,
          bounds: reconcile.bounds,
        }).catch(() => {});
      },
      { once: true },
    );

    // Wrap the pipeline to intercept the usage event and credit before terminal
    const runWithTrace = pipeline.run as PipelineRun;
    const source = interceptUsage(
      runWithTrace(parsed.data, controller.signal, trace),
      deviceId,
      usageStore,
      () => {
        reachedTerminal = true;
      },
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
 * Wraps an event source: when a `usage` event is seen, credit the store before yielding it.
 * `onTerminal` fires the moment a `result`/`failure` terminal event is observed, so the abort
 * listener above can gate reconciliation on "never after a terminal event already streamed."
 */
async function* interceptUsage(
  source: AsyncIterable<GenerationEvent>,
  deviceId: string,
  usageStore: UsageStore,
  onTerminal: () => void,
): AsyncIterable<GenerationEvent> {
  for await (const event of source) {
    if (event.type === 'usage') {
      await usageStore.credit(deviceId, event.usage);
    }
    if (event.type === 'result' || event.type === 'failure') {
      onTerminal();
    }
    yield event;
  }
}
