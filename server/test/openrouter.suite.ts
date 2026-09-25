/**
 * OpenRouter wrapper tests — fake transport only, no live network.
 * Tests: streaming deltas in order, usage capture, model-id passthrough, typed errors
 * (including null-body → usage rejects, never hangs), generation-id capture, and abort
 * signal pass-through (server-cancellation #10).
 */
import { check, eq, caught, section } from './harness';
import { captureLogs, withMessage } from './log-capture';
import { Usage } from '@whim/contract';
import {
  OpenRouterClient,
  OpenRouterAuthError,
  OpenRouterCreditError,
  OpenRouterRateLimitError,
  OpenRouterNetworkError,
} from '../src/openrouter';
import { isCreditExhaustedError, type ReasoningSetting } from '../src/generation/model';
import type { FetchFn, ProviderSort } from '../src/openrouter';

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

const HTTP_ERROR_CTORS = {
  auth: OpenRouterAuthError,
  rate_limit: OpenRouterRateLimitError,
  credit: OpenRouterCreditError,
  network: OpenRouterNetworkError,
} as const;

/** §7.4a-c — pre-stream HTTP failures each map to their own typed error, and to no other one —
 *  one table instead of three near-identical blocks, now including 402 (previously only exercised
 *  mid-stream, never as the pre-stream HTTP status OpenRouter also uses for it). */
async function testPreStreamHttpErrors(): Promise<void> {
  const httpCases: { label: string; status: number; expected: keyof typeof HTTP_ERROR_CTORS }[] = [
    { label: '401', status: 401, expected: 'auth' },
    { label: '429', status: 429, expected: 'rate_limit' },
    { label: '402', status: 402, expected: 'credit' },
  ];
  for (const c of httpCases) {
    const client = new OpenRouterClient(makeSseFetch([], c.status));
    const { deltas, usage: usagePromise } = client.stream({ model: MODEL_ID, messages: [{ role: 'user', content: 'hi' }] });
    usagePromise.catch(() => undefined);
    const err = await caught(async () => { await drain(deltas); });
    check(`HTTP ${c.label}: mapped to its own typed error`, err instanceof HTTP_ERROR_CTORS[c.expected], String(err));
    for (const [kind, ctor] of Object.entries(HTTP_ERROR_CTORS)) {
      if (kind === c.expected) continue;
      check(`HTTP ${c.label}: not ${ctor.name}`, !(err instanceof ctor));
    }
  }

  // 401 also carries the "no chunk arrived" generation-id contract.
  const authClient = new OpenRouterClient(makeSseFetch([], 401));
  const { deltas, id: idPromise, usage } = authClient.stream({ model: MODEL_ID, messages: [{ role: 'user', content: 'hi' }] });
  usage.catch(() => undefined);
  await caught(async () => { await drain(deltas); });
  eq('generation id: undefined when the stream ends without a chunk', await idPromise, undefined);
}

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
      check('deltas: content-only frames yield text-kind deltas', delta.kind === 'text');
      collected.push(delta.text);
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
      collected.push(delta.text);
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

  // §7.3b — the ONE reasoning wire mapping (design D1): each `ReasoningSetting` maps to exactly
  // one wire shape, and `default`/unset send no `reasoning` field at all (the provider's own
  // default, unopened).
  {
    const REASONING_CASES: { label: string; setting: ReasoningSetting | undefined; wire: Record<string, unknown> | undefined }[] = [
      { label: 'off', setting: 'off', wire: { enabled: false } },
      { label: 'on', setting: 'on', wire: { enabled: true } },
      { label: 'low', setting: 'low', wire: { effort: 'low' } },
      { label: 'medium', setting: 'medium', wire: { effort: 'medium' } },
      { label: 'high', setting: 'high', wire: { effort: 'high' } },
      { label: 'default', setting: 'default', wire: undefined },
      { label: 'unset', setting: undefined, wire: undefined },
    ];
    for (const c of REASONING_CASES) {
      let capturedCall: CapturedCall | undefined;
      const client = new OpenRouterClient(makeSseFetch(SUCCESS_FRAMES, 200, (call) => { capturedCall = call; }));
      const { deltas } = client.stream({ model: MODEL_ID, messages: [{ role: 'user', content: 'hi' }], reasoning: c.setting });
      await drain(deltas);

      check(`reasoning ${c.label}: request captured`, capturedCall !== undefined);
      const body = JSON.parse((capturedCall?.init?.body as string) ?? '{}') as Record<string, unknown>;
      if (c.wire) {
        eq(`reasoning ${c.label}: wire body`, body.reasoning, c.wire);
      } else {
        check(`reasoning ${c.label}: no reasoning field on the wire`, !('reasoning' in body));
      }
    }
  }

  // §7.3c — provider routing preference (design D3): set → every request carries `provider.sort`;
  // unset → no sort. Either way every request denies data collection.
  {
    let capturedCall: CapturedCall | undefined;
    const client = new OpenRouterClient(makeSseFetch(SUCCESS_FRAMES, 200, (call) => { capturedCall = call; }), { sort: 'throughput' });
    const { deltas } = client.stream({ model: MODEL_ID, messages: [{ role: 'user', content: 'hi' }] });
    await drain(deltas);
    const body = JSON.parse((capturedCall?.init?.body as string) ?? '{}') as Record<string, unknown>;
    const sort: ProviderSort = 'throughput';
    eq('provider sort set: request carries provider.sort and denies data collection', body.provider, { data_collection: 'deny', sort });
  }
  {
    let capturedCall: CapturedCall | undefined;
    const client = new OpenRouterClient(makeSseFetch(SUCCESS_FRAMES, 200, (call) => { capturedCall = call; }));
    const { deltas } = client.stream({ model: MODEL_ID, messages: [{ role: 'user', content: 'hi' }] });
    await drain(deltas);
    const body = JSON.parse((capturedCall?.init?.body as string) ?? '{}') as Record<string, unknown>;
    eq('provider sort unset: request only denies data collection', body.provider, { data_collection: 'deny' });
  }

  await testPreStreamHttpErrors();

  // §7.4c — transport throw → network error, distinct from every HTTP-status-mapped error.
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
    check('network error: distinct from credit', !(err instanceof OpenRouterCreditError));
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
      collected.push(delta.text);
      controller.abort();
    }

    // Identity (`=== controller.signal`) would fail harmlessly on a client that links its own
    // timeout in via `AbortSignal.any` — what actually matters is that the abort reaches the
    // transport, i.e. the forwarded signal observes it.
    check('abort: the forwarded signal observes the abort', capturedCall?.init?.signal?.aborted === true);
    check(
      'abort: iteration stopped promptly (did not drain all recorded deltas)',
      collected.length > 0 && collected.length < 3,
      `collected ${collected.length} deltas`,
    );
  }

  // §7.7 — reasoning deltas: the roster models (DeepSeek v4 via OpenRouter) emit reasoning ahead
  // of their visible content, keyed either `reasoning` or `reasoning_content` depending on the
  // provider. Both are surfaced as `{ kind: 'reasoning' }` deltas, distinct from `{ kind: 'text' }`.
  {
    const REASONING_FRAMES = [
      'data: {"id":"chatcmpl-r1","choices":[{"index":0,"delta":{"role":"assistant","reasoning":"Let me think about this."}}]}\n\n',
      'data: {"id":"chatcmpl-r1","choices":[{"index":0,"delta":{"content":"Hello."}}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ];
    const client = new OpenRouterClient(makeSseFetch(REASONING_FRAMES));
    const { deltas } = client.stream({ model: MODEL_ID, messages: [{ role: 'user', content: 'hi' }] });
    const collected: Array<{ kind: string; text: string }> = [];
    for await (const delta of deltas) collected.push(delta);

    eq('reasoning (delta.reasoning): exactly 2 deltas', collected.length, 2);
    eq('reasoning (delta.reasoning): first delta is reasoning-kind', collected[0]?.kind, 'reasoning');
    eq('reasoning (delta.reasoning): reasoning text is captured', collected[0]?.text, 'Let me think about this.');
    eq('reasoning (delta.reasoning): second delta is text-kind', collected[1]?.kind, 'text');
    eq('reasoning (delta.reasoning): content text is captured', collected[1]?.text, 'Hello.');
  }

  // §7.7b — the alternate provider field name, `reasoning_content`.
  {
    const REASONING_CONTENT_FRAMES = [
      'data: {"id":"chatcmpl-r2","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Considering the options."}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const client = new OpenRouterClient(makeSseFetch(REASONING_CONTENT_FRAMES));
    const { deltas } = client.stream({ model: MODEL_ID, messages: [{ role: 'user', content: 'hi' }] });
    const collected: Array<{ kind: string; text: string }> = [];
    for await (const delta of deltas) collected.push(delta);

    eq('reasoning (delta.reasoning_content): exactly 1 delta', collected.length, 1);
    eq('reasoning (delta.reasoning_content): delta is reasoning-kind', collected[0]?.kind, 'reasoning');
    eq('reasoning (delta.reasoning_content): reasoning text is captured', collected[0]?.text, 'Considering the options.');
  }

  // §7.7c — a single frame carrying BOTH reasoning and content yields reasoning first, then text.
  {
    const MIXED_FRAME = [
      'data: {"id":"chatcmpl-r3","choices":[{"index":0,"delta":{"reasoning":"Weighing it up.","content":"Sure."}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const client = new OpenRouterClient(makeSseFetch(MIXED_FRAME));
    const { deltas } = client.stream({ model: MODEL_ID, messages: [{ role: 'user', content: 'hi' }] });
    const collected: Array<{ kind: string; text: string }> = [];
    for await (const delta of deltas) collected.push(delta);

    eq('reasoning+content in one frame: reasoning then text, in that order', collected.map((d) => d.kind), ['reasoning', 'text']);
    eq('reasoning+content in one frame: reasoning text', collected[0]?.text, 'Weighing it up.');
    eq('reasoning+content in one frame: content text', collected[1]?.text, 'Sure.');
  }

  await testMidStreamErrorFrames();
  await testModelCallLogLine();
}

/** A fetch double whose response body's read loop REJECTS once `signal` aborts — the shape a real
 *  fetch's `ReadableStream` reader takes under an aborted signal. Distinct from
 *  `makeAbortableSseFetch` above (which ends the stream CLEANLY on abort, for "iteration stops
 *  promptly" — no throw, so it never reaches the wrapper's failure/abort log path). */
function makeRejectingOnAbortSseFetch(frames: string[]): FetchFn {
  return async (_input, init) => {
    const signal = init?.signal ?? undefined;
    const encoder = new TextEncoder();
    let stopped = false;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const onAbort = (): void => {
          stopped = true;
          controller.error(new Error('aborted'));
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        for (const frame of frames) {
          if (stopped) return;
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (stopped) return;
          controller.enqueue(encoder.encode(frame));
        }
        signal?.removeEventListener('abort', onAbort);
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

/**
 * §D4 — exactly one `model call` log line per completion, whatever its outcome, with no message
 * content. Covers all three settle shapes: completed (provider/tokens/generationId present),
 * failed (a pre-stream HTTP error), and aborted (the caller's own signal fires mid-stream).
 */
async function testModelCallLogLine(): Promise<void> {
  section('OpenRouter wrapper §D4 — one "model call" log line per completion, no message content');

  const PROMPT_MARKER = 'DISTINCTIVE-OPENROUTER-LOG-PROMPT-9f2c';

  // Completed: role/model/provider/token-detail/generationId/outcome all present.
  {
    const frames = [
      'data: {"id":"gen-log-1","provider":"vendor-x","choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n',
      'data: {"id":"gen-log-1","choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7,' +
        '"completion_tokens_details":{"reasoning_tokens":3},"prompt_tokens_details":{"cached_tokens":1}}}\n\n',
      'data: [DONE]\n\n',
    ];
    const capture = captureLogs();
    let records: Record<string, unknown>[];
    try {
      const client = new OpenRouterClient(makeSseFetch(frames));
      const { deltas } = client.stream({ model: MODEL_ID, messages: [{ role: 'user', content: PROMPT_MARKER }], role: 'generate' });
      await drain(deltas);
      records = withMessage(capture, 'model call');
    } finally {
      capture.stop();
    }
    eq('completed: exactly one model call log line', records.length, 1);
    const r = records[0]!;
    eq('completed: role', r.role, 'generate');
    eq('completed: model', r.model, MODEL_ID);
    eq('completed: provider', r.provider, 'vendor-x');
    eq('completed: promptTokens', r.promptTokens, 5);
    eq('completed: completionTokens', r.completionTokens, 2);
    eq('completed: reasoningTokens', r.reasoningTokens, 3);
    eq('completed: cachedTokens', r.cachedTokens, 1);
    eq('completed: generationId', r.generationId, 'gen-log-1');
    eq('completed: outcome', r.outcome, 'completed');
    check('completed: carries a numeric durationMs', typeof r.durationMs === 'number');
    check('completed: carries a numeric ttftMs', typeof r.ttftMs === 'number');
    check('the log carries no message content anywhere', capture.raw.every((line) => !line.includes(PROMPT_MARKER)));
  }

  // Failed: a pre-stream HTTP error still logs one line, outcome failed, still role-attributed.
  {
    const capture = captureLogs();
    let records: Record<string, unknown>[];
    try {
      const client = new OpenRouterClient(makeSseFetch([], 401));
      const { deltas, usage } = client.stream({ model: MODEL_ID, messages: [{ role: 'user', content: PROMPT_MARKER }], role: 'rewrite' });
      usage.catch(() => undefined);
      await caught(async () => { await drain(deltas); });
      records = withMessage(capture, 'model call');
    } finally {
      capture.stop();
    }
    eq('failed: exactly one model call log line', records.length, 1);
    eq('failed: role', records[0]?.role, 'rewrite');
    eq('failed: outcome', records[0]?.outcome, 'failed');
    check('failed: no generationId (the stream never produced a chunk)', records[0]?.generationId === undefined);
    check('the log carries no message content anywhere', capture.raw.every((line) => !line.includes(PROMPT_MARKER)));
  }

  // Aborted: the caller's own signal fires mid-stream and the transport's read rejects.
  {
    const capture = captureLogs();
    let records: Record<string, unknown>[];
    try {
      const controller = new AbortController();
      const client = new OpenRouterClient(makeRejectingOnAbortSseFetch(SUCCESS_FRAMES));
      const { deltas, usage } = client.stream({
        model: MODEL_ID,
        messages: [{ role: 'user', content: PROMPT_MARKER }],
        role: 'plan',
        signal: controller.signal,
      });
      usage.catch(() => undefined);
      const iterator = deltas[Symbol.asyncIterator]();
      const err = await caught(async () => {
        await iterator.next(); // the first delta arrives normally
        controller.abort();
        await iterator.next(); // the next pull observes the abort and rejects
      });
      check('setup: aborting mid-stream threw', err !== undefined, String(err));
      records = withMessage(capture, 'model call');
    } finally {
      capture.stop();
    }
    eq('aborted: exactly one model call log line', records.length, 1);
    eq('aborted: role', records[0]?.role, 'plan');
    eq('aborted: outcome', records[0]?.outcome, 'aborted');
    check('the log carries no message content anywhere', capture.raw.every((line) => !line.includes(PROMPT_MARKER)));
  }
}

/**
 * §7.8 — a provider failure delivered INSIDE the stream. OpenRouter answers `200 OK`, streams some
 * content, then sends `data: {"error":{"code":402,...}}` when the operator's credit runs out
 * mid-generation. Such a frame must end the stream as a typed failure: dropped, it would look like
 * a short, complete reply, the caller would ship a truncated candidate, and `isCreditExhaustedError`
 * would never fire on a 402 that really happened.
 */
async function testMidStreamErrorFrames(): Promise<void> {
  section('OpenRouter wrapper §7.8 — a mid-stream error frame is a typed failure, not an empty frame');

  const midStreamFrames = (errorFrame: string): string[] => [
    'data: {"id":"chatcmpl-e1","choices":[{"index":0,"delta":{"role":"assistant","content":"export default "}}]}\n\n',
    'data: {"id":"chatcmpl-e1","choices":[{"index":0,"delta":{"content":"defineApp({"}}]}\n\n',
    errorFrame,
  ];

  const CREDIT_FRAME = 'data: {"error":{"code":402,"message":"Insufficient credits"}}\n\n';

  // A 402 arriving mid-stream is the same typed error the pre-stream HTTP 402 raises.
  {
    const client = new OpenRouterClient(makeSseFetch(midStreamFrames(CREDIT_FRAME)));
    const { deltas, usage: usagePromise, id: idPromise } = client.stream({ model: MODEL_ID, messages: [{ role: 'user', content: 'hi' }] });
    usagePromise.catch(() => undefined);

    const collected: string[] = [];
    const err = await caught(async () => {
      for await (const delta of deltas) collected.push(delta.text);
    });

    eq('mid-stream 402: the deltas before the error frame are still delivered', collected, ['export default ', 'defineApp({']);
    check('mid-stream 402: the iterator throws OpenRouterCreditError', err instanceof OpenRouterCreditError);
    check('mid-stream 402: the error is not swallowed as a completed stream', err !== undefined);
    check('mid-stream 402: provider-agnostic credit detection fires', isCreditExhaustedError(err));
    check('mid-stream 402: not misreported as a transport failure', !(err instanceof OpenRouterNetworkError));

    // The usage promise must settle (by rejecting) on every error path, never hang.
    const TIMEOUT = Symbol('timeout');
    let timer!: ReturnType<typeof setTimeout>;
    const timeoutP = new Promise<typeof TIMEOUT>((r) => { timer = setTimeout(() => r(TIMEOUT), 200); });
    const outcome = await Promise.race([
      usagePromise.then(() => 'resolved' as const, () => 'rejected' as const),
      timeoutP,
    ]);
    clearTimeout(timer);
    check('mid-stream 402: the usage promise rejects rather than resolving zero usage', outcome === 'rejected');
    eq('mid-stream 402: the generation id captured before the failure is kept', await idPromise, 'chatcmpl-e1');
  }

  // A non-credit mid-stream failure maps exactly as its HTTP status would.
  {
    const cases: { label: string; frame: string; is: (err: unknown) => boolean }[] = [
      { label: '429', frame: 'data: {"error":{"code":429,"message":"rate limited"}}\n\n', is: (e) => e instanceof OpenRouterRateLimitError },
      { label: '401', frame: 'data: {"error":{"code":401,"message":"bad key"}}\n\n', is: (e) => e instanceof OpenRouterAuthError },
      // A string code (some upstream providers) is read the same way as a numeric one.
      { label: '"402" as a string', frame: 'data: {"error":{"code":"402","message":"Insufficient credits"}}\n\n', is: (e) => e instanceof OpenRouterCreditError },
      // No usable code at all: a failure, but an unclassified one — never a silent success.
      { label: 'no code', frame: 'data: {"error":{"message":"upstream exploded"}}\n\n', is: (e) => e instanceof OpenRouterNetworkError },
    ];
    for (const c of cases) {
      const client = new OpenRouterClient(makeSseFetch(midStreamFrames(c.frame)));
      const { deltas, usage: usagePromise } = client.stream({ model: MODEL_ID, messages: [{ role: 'user', content: 'hi' }] });
      usagePromise.catch(() => undefined);
      const err = await caught(async () => { await drain(deltas); });
      check(`mid-stream error ${c.label}: mapped to the same typed error as the HTTP status`, c.is(err), String(err));
      check(`mid-stream error ${c.label}: credit detection fires only for a 402`, isCreditExhaustedError(err) === (err instanceof OpenRouterCreditError));
    }
  }

  // A frame that merely MENTIONS an error-shaped field in the delta text is not an error frame —
  // only a top-level `error` object ends the stream.
  {
    const frames = [
      'data: {"id":"chatcmpl-ok","choices":[{"index":0,"delta":{"content":"{\\"error\\":{\\"code\\":402}}"}}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const client = new OpenRouterClient(makeSseFetch(frames));
    const { deltas } = client.stream({ model: MODEL_ID, messages: [{ role: 'user', content: 'hi' }] });
    const collected: string[] = [];
    const err = await caught(async () => { for await (const delta of deltas) collected.push(delta.text); });
    check('error-shaped TEXT is ordinary content, not a stream failure', err === undefined);
    eq('error-shaped text reaches the caller verbatim', collected, ['{"error":{"code":402}}']);
  }
}
