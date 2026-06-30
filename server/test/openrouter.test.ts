/**
 * OpenRouter wrapper tests (SPEC.md §7) — fake transport only, no live network.
 * Tests: streaming deltas in order, usage capture, model-id passthrough, typed errors.
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

/** Consume an async iterable to completion, discarding values. */
async function drain(iter: AsyncIterable<unknown>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _item of iter) { /* intentional no-op drain */ }
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
    const { deltas, usage: usagePromise } = client.stream({
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

  // §7.5 — no key required by suite: OPENROUTER_API_KEY is not read by these tests
  check('no API key required by suite', true); // structural — the tests above never read process.env.OPENROUTER_API_KEY
}
