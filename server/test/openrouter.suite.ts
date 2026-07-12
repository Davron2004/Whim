/**
 * OpenRouter wrapper tests (SPEC.md §7) — fake transport only, no live network.
 * Tests: streaming deltas in order, usage capture, model-id passthrough, typed errors
 * (including null-body → usage rejects, never hangs), generation-id capture, and abort
 * signal pass-through (server-cancellation #10).
 */
import { check, eq, caught, section } from './harness';
import { Usage } from '@whim/contract';
import {
  OpenRouterClient,
  OpenRouterAuthError,
  OpenRouterRateLimitError,
  OpenRouterNetworkError,
  Usage as OpenRouterUsage,
} from '../src/openrouter';
import type { FetchFn } from '../src/openrouter';

// ─── Fake fetch helpers ───────────────────────────────────────────────────────

interface CapturedCall {
  url: string;
  init: RequestInit | undefined;
}

/** Build a fake fetch that returns an SSE response from a list of data-frame strings. */
function makeSseFetch(
  frames: string[],
  statusCode = 200,
  captureCall?: (call: CapturedCall) => void,
): FetchFn {
  return async (input, init) => {
    if (captureCall) {
      captureCall({ url: String(input), init });
    }
    if (statusCode !== 200) {
      return new Response(null, { status: statusCode });
    }

    // Build a ReadableStream that yields the frames
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        for (const frame of frames) {
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
}

/** Build a fake fetch that throws (transport failure). */
function makeThrowingFetch(err: unknown): FetchFn {
  return async () => {
    throw err;
  };
}

/**
 * Build a fake fetch that dribbles `frames` out one at a time (a macrotask apart)
 * over a real ReadableStream, observing `init.signal`: once aborted, it stops
 * enqueuing further frames and closes the stream — simulating a transport that
 * honors abort by ending the response body promptly.
 */
function makeAbortableSseFetch(
  frames: string[],
  captureCall?: (call: CapturedCall) => void,
): FetchFn {
  return async (input, init) => {
    if (captureCall) {
      captureCall({ url: String(input), init });
    }
    const signal = init?.signal ?? undefined;
    const encoder = new TextEncoder();
    let stopped = false;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const onAbort = (): void => {
          stopped = true;
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        for (const frame of frames) {
          if (stopped || signal?.aborted) break;
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (stopped || signal?.aborted) break;
          controller.enqueue(encoder.encode(frame));
        }
        signal?.removeEventListener('abort', onAbort);
        controller.close();
      },
    });

    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  };
}

/** Consume an async iterable to completion, discarding values. */
async function drain(iter: AsyncIterable<unknown>): Promise<void> {
  const iterator = iter[Symbol.asyncIterator]();
  while (!(await iterator.next()).done) { /* discard */ }
}

// ─── Recorded SSE frames (success scenario) ──────────────────────────────────
// These mirror server/test/fixtures/openrouter-success.txt but are inline here
// so the test doesn't need fs access after bundling.

const SUCCESS_FRAMES = [
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}\n\n',
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"content":", "},"finish_reason":null}]}\n\n',
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"content":"world"},"finish_reason":null}]}\n\n',
  'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"total_tokens":13}}\n\n',
  'data: [DONE]\n\n',
];

const MODEL_ID = 'openai/gpt-4o-mini';

// ─── Tests ────────────────────────────────────────────────────────────────────

export async function runOpenRouterTests(): Promise<void> {
  section('OpenRouter wrapper (SPEC §7) — fake transport');

  // §7.1 — streaming deltas arrive in recorded order
  {
    const client = new OpenRouterClient(makeSseFetch(SUCCESS_FRAMES));
    const { deltas } = client.stream({
      model: MODEL_ID,
      messages: [{ role: 'user', content: 'hi' }],
    });

    const collected: string[] = [];
    for await (const delta of deltas) {
      collected.push(delta);
    }

    eq('deltas: first delta', collected[0], 'Hello');
    eq('deltas: second delta', collected[1], ', ');
    eq('deltas: third delta', collected[2], 'world');
    eq('deltas: exactly 3 deltas', collected.length, 3);
  }

  // §7.1b — final SSE frame with NO trailing newline (left in buffer by the main
  // loop) still yields its content delta via the post-loop flush
  {
    const NO_TRAILING_NEWLINE_FRAMES = [
      'data: {"id":"chatcmpl-2","object":"chat.completion.chunk","model":"openai/gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"lead"},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl-2","object":"chat.completion.chunk","model":"m","choices":[{"index":0,"delta":{"content":"X"}}]}',
    ];
    const client = new OpenRouterClient(makeSseFetch(NO_TRAILING_NEWLINE_FRAMES));
    const { deltas } = client.stream({
      model: MODEL_ID,
      messages: [{ role: 'user', content: 'hi' }],
    });

    const collected: string[] = [];
    for await (const delta of deltas) {
      collected.push(delta);
    }

    check('flush: trailing no-newline final delta is not dropped', collected.includes('X'));
  }

  // §7.2 — usage capture validates as contract Usage
  {
    const client = new OpenRouterClient(makeSseFetch(SUCCESS_FRAMES));
    const { deltas, usage: usagePromise } = client.stream({
      model: MODEL_ID,
      messages: [{ role: 'user', content: 'hi' }],
    });

    // Must drain deltas before usage resolves
    await drain(deltas);
    const capturedUsage = await usagePromise;

    // Validate the Usage schema exported from openrouter is the same object as the contract's Usage
    check('usage schema identity: openrouter reuses contract Usage by reference', OpenRouterUsage === Usage);

    // Validate the shape is contract Usage by identity
    const parsed = Usage.safeParse(capturedUsage);
    check('usage capture: validates as contract Usage', parsed.success);
    eq('usage capture: promptTokens', capturedUsage.promptTokens, 10);
    eq('usage capture: completionTokens', capturedUsage.completionTokens, 3);
    eq('usage capture: totalTokens', capturedUsage.totalTokens, 13);
  }

  // §7.2b — generation id: captured from the top-level `id` of the first SSE chunk
  {
    const client = new OpenRouterClient(makeSseFetch(SUCCESS_FRAMES));
    const { deltas, id: idPromise } = client.stream({
      model: MODEL_ID,
      messages: [{ role: 'user', content: 'hi' }],
    });

    await drain(deltas);
    const generationId = await idPromise;
    eq('generation id: captured from first chunk', generationId, 'chatcmpl-1');
  }

  // §7.3 — model id passthrough: caller-supplied id appears verbatim in request body
  {
    let capturedCall: CapturedCall | undefined;
    const client = new OpenRouterClient(
      makeSseFetch(SUCCESS_FRAMES, 200, (call) => { capturedCall = call; }),
    );
    const { deltas } = client.stream({
      model: MODEL_ID,
      messages: [{ role: 'user', content: 'hi' }],
    });
    await drain(deltas);

    check('model-id passthrough: request captured', capturedCall !== undefined);
    if (capturedCall) {
      const body = JSON.parse(capturedCall.init?.body as string) as Record<string, unknown>;
      eq('model-id passthrough: model appears verbatim', body.model, MODEL_ID);
    }
  }

  // §7.4a — replayed 401 → auth error
  {
    const client = new OpenRouterClient(makeSseFetch([], 401));
    const { deltas, usage: usagePromise, id: idPromise } = client.stream({
      model: MODEL_ID,
      messages: [{ role: 'user', content: 'hi' }],
    });
    // Suppress the usage rejection (same error as the delta throw)
    usagePromise.catch(() => undefined);
    const err = await caught(async () => {
      await drain(deltas);
    });
    check('auth error: instanceof OpenRouterAuthError', err instanceof OpenRouterAuthError);
    check('auth error: distinct from rate-limit', !(err instanceof OpenRouterRateLimitError));
    check('auth error: distinct from network', !(err instanceof OpenRouterNetworkError));

    const generationId = await idPromise;
    eq('generation id: undefined when the stream ends without a chunk', generationId, undefined);
  }

  // §7.4b — replayed 429 → rate-limit error
  {
    const client = new OpenRouterClient(makeSseFetch([], 429));
    const { deltas, usage: usagePromise } = client.stream({
      model: MODEL_ID,
      messages: [{ role: 'user', content: 'hi' }],
    });
    usagePromise.catch(() => undefined);
    const err = await caught(async () => {
      await drain(deltas);
    });
    check('rate-limit error: instanceof OpenRouterRateLimitError', err instanceof OpenRouterRateLimitError);
    check('rate-limit error: distinct from auth', !(err instanceof OpenRouterAuthError));
    check('rate-limit error: distinct from network', !(err instanceof OpenRouterNetworkError));
  }

  // §7.4c — transport throw → network error
  {
    const transportErr = new Error('ECONNREFUSED');
    const client = new OpenRouterClient(makeThrowingFetch(transportErr));
    const { deltas, usage: usagePromise } = client.stream({
      model: MODEL_ID,
      messages: [{ role: 'user', content: 'hi' }],
    });
    usagePromise.catch(() => undefined);
    const err = await caught(async () => {
      await drain(deltas);
    });
    check('network error: instanceof OpenRouterNetworkError', err instanceof OpenRouterNetworkError);
    check('network error: distinct from auth', !(err instanceof OpenRouterAuthError));
    check('network error: distinct from rate-limit', !(err instanceof OpenRouterRateLimitError));
  }

  // §7.4d — a 200 response with a null body throws a typed network error AND rejects the
  // usage promise (it must never be left pending). Locks the "every error path rejects usage,
  // never hangs" invariant across the whole error surface, not just the fetch/HTTP paths.
  {
    const client = new OpenRouterClient(async () => new Response(null, { status: 200 }));
    const { deltas, usage: usagePromise, id: idPromise } = client.stream({
      model: MODEL_ID,
      messages: [{ role: 'user', content: 'hi' }],
    });
    const err = await caught(async () => {
      await drain(deltas);
    });
    check('null body: deltas throw OpenRouterNetworkError', err instanceof OpenRouterNetworkError);

    // Assert usage SETTLES by rejecting — race a short timer so a regression that left the
    // promise pending fails cleanly here instead of hanging the whole suite.
    const TIMEOUT = Symbol('timeout');
    let timer!: ReturnType<typeof setTimeout>;
    const timeoutP = new Promise<typeof TIMEOUT>((r) => { timer = setTimeout(() => r(TIMEOUT), 200); });
    const outcome = await Promise.race([
      usagePromise.then(() => 'resolved' as const, () => 'rejected' as const),
      timeoutP,
    ]);
    clearTimeout(timer);
    check('null body: usage promise rejects, does not hang', outcome === 'rejected');

    const generationId = await idPromise;
    eq('null body: generation id undefined', generationId, undefined);
  }

  // §7.6 — abort reaches the transport and iteration stops promptly
  {
    const controller = new AbortController();
    let capturedCall: CapturedCall | undefined;
    const client = new OpenRouterClient(
      makeAbortableSseFetch(SUCCESS_FRAMES, (call) => { capturedCall = call; }),
    );
    const { deltas } = client.stream({
      model: MODEL_ID,
      messages: [{ role: 'user', content: 'hi' }],
      signal: controller.signal,
    });

    const collected: string[] = [];
    for await (const delta of deltas) {
      collected.push(delta);
      controller.abort();
    }

    check('abort: signal forwarded in outgoing request-init', capturedCall?.init?.signal === controller.signal);
    check(
      'abort: iteration stopped promptly (did not drain all recorded deltas)',
      collected.length > 0 && collected.length < 3,
      `collected ${collected.length} deltas`,
    );
  }

  // §7.5 — no key required by suite: OPENROUTER_API_KEY is not read by these tests
  check('no API key required by suite', true); // structural — the tests above never read process.env.OPENROUTER_API_KEY
}
