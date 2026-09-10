/**
 * generation-client Node suite (prompt-flow-ux chain-1, tasks 1.1/2.1; build-liveness B1/B2) —
 * `device-id.ts` and `generation-client.ts` against canned `fetchImpl`/`Response` objects, no real
 * HTTP server. Mirrors `server/test/sse-reader.ts`'s SSE-framing idiom, inverted (this reads
 * frames the server writes, per `server/src/sse.ts`).
 *
 * Scenarios (spec `prompt-flow/spec.md` "Every server request carries a persisted anonymous
 * device identity" / "Generation progress is shown without exposing internals" / "Failure is
 * shown honestly, never as a crash"):
 *
 *   - device id: generated once on first read, persisted, and reused by a second `getDeviceId`
 *     call over the SAME KVBackend (simulating a second prompt flow on the same device).
 *   - rewritePrompt: a 200 JSON response parses to `RewriteResponse`, sending the prompt body
 *     and the `x-whim-device` header; a non-2xx HTTP response raises `kind:'http'`; a 400
 *     `DeviceIdError`-shaped body raises `kind:'device_id'` carrying its `hint`.
 *   - generateApp: stage/token/thinking/diagnostic/usage/result/failure SSE frames all parse into
 *     their validated `GenerationEvent` shapes, in order, with a PARITY test feeding one instance
 *     of every union arm through the real guard so a future contract addition cannot silently
 *     break the device the way `thinking`'s own guard arm was initially missed; a frame whose
 *     `data:` JSON does not match `GenerationEvent` raises `kind:'stream_parse'`; a stream aborted
 *     mid-flight (`AbortError` from the reader) ends iteration with no terminal event and does not
 *     throw; a keepalive comment block (`: keepalive\n\n`) fires `ClientOptions.onKeepalive`, never
 *     an event.
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { getDeviceId } from '../device-id';
import { GenerationClientError, clarifyPrompt, generateApp, rewritePrompt } from '../generation-client';
import { buildRewriteAppContext } from '../generation-request';
import type { ClientOptions } from '../generation-client';
import type { InstalledApp } from '../app-index';
import type { GenerationEvent } from '@whim/contract';
import { CONNECT_TIMEOUT_HINT } from '../transport-shared';
import { log } from '../../logging';
import { CHANNELS } from '../../logging/channels';

function sseFrame(event: GenerationEvent, id: number): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\nid: ${id}\n\n`;
}

/** Build a `Response` whose body streams the given raw SSE text in one or more chunks. */
function sseResponse(chunks: string[], opts: { status?: number } = {}): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(enc.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: opts.status ?? 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect(source: AsyncIterable<GenerationEvent>): Promise<GenerationEvent[]> {
  const out: GenerationEvent[] = [];
  for await (const event of source) {
    out.push(event);
  }
  return out;
}

/** Errors a stream controller with the same `AbortError` shape a real aborted `fetch` produces. */
function errorStreamOnAbort(controller: ReadableStreamDefaultController<Uint8Array>): void {
  controller.error(new DOMException('The operation was aborted.', 'AbortError'));
}

/** A `Response` that emits `startEvent` then, once `signal` aborts, errors its stream the same
 *  way a real aborted fetch would — the stream never reaches a terminal frame. */
function abortableSseResponse(startEvent: GenerationEvent, signal: AbortSignal | undefined): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(enc.encode(sseFrame(startEvent, 1)));
      signal?.addEventListener('abort', () => errorStreamOnAbort(streamController));
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const BASE: ClientOptions = { baseUrl: 'https://example.invalid', deviceId: 'device-1' };

/** One installed entry to re-prompt: a storage app whose display names ("Completions", "Date",
 *  "Note") are deliberately different from the burned ids underneath them ("c1", "f1", "f2"), so
 *  a body carrying either can be told apart. */
const HABITS: InstalledApp = {
  id: 'habits',
  name: 'Habit Tracker',
  createdAt: 0,
  lineageId: 'main',
  record: {
    appId: 'habits',
    name: 'Habit Tracker',
    manifest: { capabilities: ['storage'] },
    schemaArtifact: {
      schemaVersion: 1,
      collections: {
        Completions: {
          id: 'c1',
          tombstones: [],
          fields: { Date: { id: 'f1', type: 'date' }, Note: { id: 'f2', type: 'text' } },
        },
      },
    },
  },
};

/** The connect window used by the timeout scenarios below — milliseconds, not the production
 *  15s, so the suite proves the behaviour without sleeping through it. */
const WINDOW_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Await `promise` but resolve to `'hung'` rather than hanging the whole suite if it never
 *  settles (a bare `await` on a regression here would be an exit-13 hang, not a failed check). */
async function settledOrHung<T>(promise: Promise<T>, ms: number): Promise<T | 'hung' | Error> {
  const hung = new Promise<'hung'>((resolve) => {
    setTimeout(() => resolve('hung'), ms);
  });
  try {
    return await Promise.race([promise, hung]);
  } catch (err) {
    return err as Error;
  }
}

/** A `fetch` double whose SSE response body stays open indefinitely: the test drives it through
 *  `hold.controller`, and the body errors on abort exactly as a real `fetch`'s does — so a connect
 *  timer that was never disarmed would visibly kill the stream. */
function openEndedSseFetch(hold: { controller?: ReadableStreamDefaultController<Uint8Array> }): typeof fetch {
  const start = (c: ReadableStreamDefaultController<Uint8Array>, signal: AbortSignal | null | undefined): void => {
    hold.controller = c;
    signal?.addEventListener('abort', () => errorStreamOnAbort(c));
  };
  return (async (_url: string, init?: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({ start: (c) => start(c, init?.signal) });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
}

/** A `fetch` double that never resolves on its own — it settles only when the request's signal
 *  aborts, exactly as a real `fetch` does, so a fired connect timeout is observable. */
function hangingFetch(record: { signal?: AbortSignal } = {}): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    record.signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
  }) as typeof fetch;
}

export async function runGenerationClientTests(h: Harness): Promise<void> {
  // device id: generated once, persisted, reused
  await h.test('device-id generates once and persists across reads on the same KVBackend', () => {
    const kv = new MapKVBackend();
    const first = getDeviceId(kv);
    h.ok(/^[0-9a-f-]{36}$/i.test(first), 'looks UUID-shaped');
    const second = getDeviceId(kv);
    h.eq(second, first, 'a second read over the same store returns the SAME id');
    // A fresh KVBackend instance wrapping the SAME underlying map (a second "prompt flow" on
    // the same device, new process) still sees the persisted id.
    const kvAgain = new MapKVBackend(kv.raw());
    h.eq(getDeviceId(kvAgain), first, 'persists across a fresh KVBackend instance over the same store');
  });

  await h.test('device-id generates a fresh id per independent KVBackend', () => {
    const a = getDeviceId(new MapKVBackend());
    const b = getDeviceId(new MapKVBackend());
    h.ok(a !== b, 'two independent devices get different ids');
  });

  // rewritePrompt: success
  await h.test('rewritePrompt: success parses RewriteResponse and sends the device header', async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ rewrittenPrompt: '[Clarified] hi' }), { status: 200 });
    }) as typeof fetch;

    const result = await rewritePrompt({ ...BASE, fetchImpl }, 'hi');
    h.eq(result, { rewrittenPrompt: '[Clarified] hi' }, 'parses the 200 JSON body');
    h.eq(capturedUrl, 'https://example.invalid/v1/rewrite', 'posts to /v1/rewrite');
    h.eq(
      (capturedInit?.headers as Record<string, string> | undefined)?.['x-whim-device'],
      'device-1',
      'attaches the x-whim-device header',
    );
    h.eq(JSON.parse(String(capturedInit?.body)), { prompt: 'hi' }, 'sends the prompt as the request body');
  });

  // rewritePrompt: the app a re-prompt is changing (spec "A rewrite for an edit carries the app
  // it is changing"). Driven through `buildRewriteAppContext` from a stored entry, the way the
  // shell drives it, so this covers the whole device seam: entry → context → request body.
  await h.test('rewritePrompt: a re-prompt carries the app being changed; a new app carries none', async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ rewrittenPrompt: 'r' }), { status: 200 });
    }) as typeof fetch;

    await rewritePrompt({ ...BASE, fetchImpl }, 'add a streak count', [], buildRewriteAppContext(HABITS));
    h.eq(
      bodies[0],
      {
        prompt: 'add a streak count',
        app: { name: 'Habit Tracker', collections: [{ name: 'Completions', fields: ['Date', 'Note'] }] },
      },
      'the body carries the app name and its collections by display name',
    );
    h.ok(
      !JSON.stringify(bodies[0]).includes('c1') && !JSON.stringify(bodies[0]).includes('f1'),
      'and carries no burned collection/field ids',
    );

    await rewritePrompt({ ...BASE, fetchImpl }, 'a brew timer', [], buildRewriteAppContext(undefined));
    h.eq(bodies[1], { prompt: 'a brew timer' }, 'composing a new app sends no app key at all');
  });

  // clarifyPrompt: the SAME app context, so the clarifier never re-asks what the app already is
  // (`ClarifyRequest.app` mirrors `RewriteRequest.app` exactly — `AppContext`).
  await h.test('clarifyPrompt: an edit carries the app being changed; a new app carries none', async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ questions: [] }), { status: 200 });
    }) as typeof fetch;

    await clarifyPrompt({ ...BASE, fetchImpl }, 'add a fruit tea section', buildRewriteAppContext(HABITS));
    h.eq(
      bodies[0],
      {
        prompt: 'add a fruit tea section',
        app: { name: 'Habit Tracker', collections: [{ name: 'Completions', fields: ['Date', 'Note'] }] },
      },
      'the clarify body carries the same app context a rewrite would',
    );

    await clarifyPrompt({ ...BASE, fetchImpl }, 'a brew timer', buildRewriteAppContext(undefined));
    h.eq(bodies[1], { prompt: 'a brew timer' }, 'composing a new app sends no app key at all');

    await clarifyPrompt({ ...BASE, fetchImpl }, 'a dice roller');
    h.eq(bodies[2], { prompt: 'a dice roller' }, 'and an omitted app argument sends the same shape');
  });

  // rewritePrompt: generic HTTP error
  await h.test('rewritePrompt: a non-2xx response raises GenerationClientError{kind:"http"}', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'invalid_request', hint: 'bad body' }), { status: 400 })) as typeof fetch;
    try {
      await rewritePrompt({ ...BASE, fetchImpl }, 'hi');
      h.ok(false, 'expected a throw');
    } catch (err) {
      h.ok(err instanceof GenerationClientError, 'throws GenerationClientError');
      h.eq((err as GenerationClientError).kind, 'http', 'kind is "http"');
      h.eq((err as GenerationClientError).status, 400, 'status is carried through');
      h.eq((err as GenerationClientError).hint, 'bad body', 'carries the response hint');
    }
  });

  // rewritePrompt: device-id error
  await h.test('rewritePrompt: a DeviceIdError-shaped 400 body raises GenerationClientError{kind:"device_id"}', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ error: 'missing_device_id', hint: 'Include a UUID in the x-whim-device request header.' }),
        { status: 400 },
      )) as typeof fetch;
    try {
      await rewritePrompt({ ...BASE, fetchImpl }, 'hi');
      h.ok(false, 'expected a throw');
    } catch (err) {
      h.ok(err instanceof GenerationClientError, 'throws GenerationClientError');
      h.eq((err as GenerationClientError).kind, 'device_id', 'kind is "device_id"');
      h.eq(
        (err as GenerationClientError).hint,
        'Include a UUID in the x-whim-device request header.',
        'carries the server hint',
      );
    }
  });

  // generateApp: parses stage/token/thinking/diagnostic/usage/result frames, in order
  await h.test('generateApp: parses stage/token/thinking/diagnostic/usage/result frames off the Response', async () => {
    const events: GenerationEvent[] = [
      { type: 'stage', stage: 'generate', status: 'start' },
      { type: 'thinking', chars: 1_200 },
      { type: 'token', text: 'const x = 1;' },
      { type: 'diagnostic', diagnostic: { kind: 'type-error', symbol: 'x', hint: 'declare a type' } },
      { type: 'usage', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      {
        type: 'result',
        app: { name: 'Tip Splitter', source: 'src', bundle: 'window.__WHIM_APP_MODULE__ = {};', manifest: {}, schema: {} },
      },
    ];
    const text = events.map((e, i) => sseFrame(e, i + 1)).join('');
    const fetchImpl = (async () => sseResponse([text])) as typeof fetch;
    const got = await collect(generateApp({ ...BASE, fetchImpl }, { prompt: 'make a tip splitter' }));
    h.eq(got, events, 'yields every frame, validated, in order');
  });

  // Parity test (build-liveness review finding): every arm of the CONTRACT'S union must have a
  // matching arm in this client's hand-rolled `isGenerationEvent` guard, or the device throws
  // `stream_parse` on a perfectly valid frame the moment the server starts sending it — exactly
  // what happened here for `thinking` before this change. One canned frame per union arm, fed
  // through the real SSE path, is what makes "the guard accepts everything the contract allows"
  // a fact about the code rather than an assumption a future contract addition can silently break.
  await h.test('generateApp: accepts one valid instance of EVERY GenerationEvent union arm', async () => {
    const oneOfEach: GenerationEvent[] = [
      { type: 'stage', stage: 'plan', status: 'start' },
      { type: 'token', text: 'x' },
      { type: 'thinking', chars: 1 },
      { type: 'diagnostic', diagnostic: { kind: 'type-error', hint: 'declare a type' } },
      { type: 'usage', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
      {
        type: 'result',
        app: { name: 'Tip Splitter', source: 'src', bundle: 'window.__WHIM_APP_MODULE__ = {};', manifest: {}, schema: {} },
      },
      { type: 'failure', reason: 'nope', attempts: 1, diagnostics: [] },
    ];
    for (const event of oneOfEach) {
      const fetchImpl = (async () => sseResponse([sseFrame(event, 1)])) as typeof fetch;
      const got = await collect(generateApp({ ...BASE, fetchImpl }, { prompt: 'p' }));
      h.eq(got, [event], `the "${event.type}" arm parses without throwing`);
    }
  });

  await h.test('generateApp: parses a failure terminal frame', async () => {
    const event: GenerationEvent = {
      type: 'failure',
      reason: 'could not satisfy the checks',
      attempts: 3,
      diagnostics: [{ kind: 'type-error', hint: 'declare a type' }],
    };
    const fetchImpl = (async () => sseResponse([sseFrame(event, 1)])) as typeof fetch;
    const got = await collect(generateApp({ ...BASE, fetchImpl }, { prompt: 'p' }));
    h.eq(got, [event], 'yields the failure event');
  });

  await h.test('generateApp: a frame split across chunks and a keepalive comment still parse', async () => {
    const event: GenerationEvent = { type: 'token', text: 'hello' };
    const frame = sseFrame(event, 1);
    const mid = Math.floor(frame.length / 2);
    const fetchImpl = (async () => sseResponse([frame.slice(0, mid), frame.slice(mid), ': keepalive\n\n'])) as typeof fetch;
    const got = await collect(generateApp({ ...BASE, fetchImpl }, { prompt: 'p' }));
    h.eq(got, [event], 'reassembles the split frame and skips the keepalive comment');
  });

  // build-liveness B2: the keepalive comment is transport noise (never a GenerationEvent), but it
  // still has to reach the caller SOMEHOW — through `ClientOptions.onKeepalive`.
  await h.test('generateApp: a keepalive comment block fires onKeepalive exactly once, never as an event', async () => {
    const event: GenerationEvent = { type: 'token', text: 'hi' };
    const fetchImpl = (async () =>
      sseResponse([sseFrame(event, 1), ': keepalive\n\n', ': keepalive\n\n'])) as typeof fetch;
    let keepalives = 0;
    const got = await collect(generateApp({ ...BASE, fetchImpl, onKeepalive: () => keepalives++ }, { prompt: 'p' }));
    h.eq(got, [event], 'still yields only the real event');
    h.eq(keepalives, 2, 'and the caller hears about both keepalive frames');
  });

  await h.test('generateApp: with no onKeepalive supplied, a keepalive comment is silently skipped as before', async () => {
    const event: GenerationEvent = { type: 'token', text: 'hi' };
    const fetchImpl = (async () => sseResponse([sseFrame(event, 1), ': keepalive\n\n'])) as typeof fetch;
    const got = await collect(generateApp({ ...BASE, fetchImpl }, { prompt: 'p' }));
    h.eq(got, [event], 'an absent callback is a no-op, not a throw');
  });

  // generateApp: malformed frame — unrecognized discriminant
  await h.test('generateApp: a malformed frame raises GenerationClientError{kind:"stream_parse"}', async () => {
    const badFrame = 'event: stage\ndata: {"type":"not-a-real-type"}\nid: 1\n\n';
    const fetchImpl = (async () => sseResponse([badFrame])) as typeof fetch;
    try {
      await collect(generateApp({ ...BASE, fetchImpl }, { prompt: 'p' }));
      h.ok(false, 'expected a throw');
    } catch (err) {
      h.ok(err instanceof GenerationClientError, 'throws GenerationClientError');
      h.eq((err as GenerationClientError).kind, 'stream_parse', 'kind is "stream_parse"');
    }
  });

  // generateApp: malformed frame — recognized discriminant, but a required field is missing
  // (exercises the per-variant field guards, not just the top-level `type` switch).
  await h.test(
    'generateApp: a frame with a known type but a missing required field raises GenerationClientError{kind:"stream_parse"}',
    async () => {
      const badFrame = 'event: token\ndata: {"type":"token"}\nid: 1\n\n'; // missing `text`
      const fetchImpl = (async () => sseResponse([badFrame])) as typeof fetch;
      try {
        await collect(generateApp({ ...BASE, fetchImpl }, { prompt: 'p' }));
        h.ok(false, 'expected a throw');
      } catch (err) {
        h.ok(err instanceof GenerationClientError, 'throws GenerationClientError');
        h.eq((err as GenerationClientError).kind, 'stream_parse', 'kind is "stream_parse"');
      }
    },
  );

  // generateApp: result frame with an empty bundle raises GenerationClientError{kind:"stream_parse"}
  await h.test(
    'generateApp: a result frame with an empty bundle raises GenerationClientError{kind:"stream_parse"}',
    async () => {
      const badFrame =
        'event: result\ndata: {"type":"result","app":{"name":"Tip Splitter","source":"src","bundle":"","manifest":{},"schema":{}}}\nid: 1\n\n';
      const fetchImpl = (async () => sseResponse([badFrame])) as typeof fetch;
      try {
        await collect(generateApp({ ...BASE, fetchImpl }, { prompt: 'p' }));
        h.ok(false, 'expected a throw');
      } catch (err) {
        h.ok(err instanceof GenerationClientError, 'throws GenerationClientError');
        h.eq((err as GenerationClientError).kind, 'stream_parse', 'kind is "stream_parse"');
      }
    },
  );

  // generateApp: result frame with a bundle missing the loader's runtime binding contract
  // raises GenerationClientError{kind:"stream_parse"}
  await h.test(
    'generateApp: a result frame with a bundle missing __WHIM_APP_MODULE__ raises GenerationClientError{kind:"stream_parse"}',
    async () => {
      const badFrame =
        'event: result\ndata: {"type":"result","app":{"name":"Tip Splitter","source":"src","bundle":"const x = 1;","manifest":{},"schema":{}}}\nid: 1\n\n';
      const fetchImpl = (async () => sseResponse([badFrame])) as typeof fetch;
      try {
        await collect(generateApp({ ...BASE, fetchImpl }, { prompt: 'p' }));
        h.ok(false, 'expected a throw');
      } catch (err) {
        h.ok(err instanceof GenerationClientError, 'throws GenerationClientError');
        h.eq((err as GenerationClientError).kind, 'stream_parse', 'kind is "stream_parse"');
      }
    },
  );

  // generateApp: result frame with a runnable bundle (contains __WHIM_APP_MODULE__) yields normally
  await h.test('generateApp: a result frame with a runnable bundle yields normally', async () => {
    const event: GenerationEvent = {
      type: 'result',
      app: {
        name: 'Tip Splitter',
        source: 'src',
        bundle: 'window.__WHIM_APP_MODULE__ = {};',
        manifest: {},
        schema: {},
      },
    };
    const fetchImpl = (async () => sseResponse([sseFrame(event, 1)])) as typeof fetch;
    const got = await collect(generateApp({ ...BASE, fetchImpl }, { prompt: 'p' }));
    h.eq(got, [event], 'yields the result event');
  });

  // rewritePrompt: a 200 body that fails RewriteResponse shape validation still raises 'http'
  await h.test(
    'rewritePrompt: a 200 body with the wrong shape raises GenerationClientError{kind:"http"}',
    async () => {
      const fetchImpl = (async () => new Response(JSON.stringify({ notRewrittenPrompt: 'oops' }), { status: 200 })) as typeof fetch;
      try {
        await rewritePrompt({ ...BASE, fetchImpl }, 'hi');
        h.ok(false, 'expected a throw');
      } catch (err) {
        h.ok(err instanceof GenerationClientError, 'throws GenerationClientError');
        h.eq((err as GenerationClientError).kind, 'http', 'kind is "http" even though the HTTP status was 200');
      }
    },
  );

  // generateApp: aborted stream — no terminal event, no throw
  await h.test('generateApp: an aborted stream yields no terminal event and does not throw', async () => {
    const controller = new AbortController();
    const startEvent: GenerationEvent = { type: 'stage', stage: 'generate', status: 'start' };
    const fetchImpl = (async (_url: string, init?: RequestInit) =>
      abortableSseResponse(startEvent, init?.signal)) as typeof fetch;

    const got: GenerationEvent[] = [];
    let threw: unknown;
    try {
      for await (const event of generateApp({ ...BASE, fetchImpl }, { prompt: 'p' }, controller.signal)) {
        got.push(event);
        controller.abort();
      }
    } catch (err) {
      threw = err;
    }
    h.eq(got, [startEvent], 'yields the events seen before the abort');
    h.eq(threw, undefined, 'does not throw');
  });

  // --- flow-wait-hygiene chain-1: leaving compose/plan cancels the in-flight unary request ---

  await h.test('clarifyPrompt: the caller signal reaches the request and an abort surfaces as AbortError, not a network failure', async () => {
    const record: { signal?: AbortSignal } = {};
    const controller = new AbortController();
    const pending = clarifyPrompt({ ...BASE, fetchImpl: hangingFetch(record) }, 'hi', undefined, controller.signal);
    const caught = settledOrHung(pending, 1000);
    h.ok(record.signal !== undefined, 'the signal is threaded into the fetch call');
    controller.abort();
    const err = await caught;
    h.ok(err !== 'hung', 'the aborted call settles instead of hanging');
    h.ok(err instanceof Error && err.name === 'AbortError', 'the abort surfaces as an AbortError');
    h.ok(!(err instanceof GenerationClientError), 'a user cancel is NOT reclassified as a GenerationClientError');
  });

  await h.test('rewritePrompt: the caller signal reaches the request and an abort surfaces as AbortError, not a network failure', async () => {
    const record: { signal?: AbortSignal } = {};
    const controller = new AbortController();
    const pending = rewritePrompt({ ...BASE, fetchImpl: hangingFetch(record) }, 'hi', [], undefined, controller.signal);
    const caught = settledOrHung(pending, 1000);
    h.ok(record.signal !== undefined, 'the signal is threaded into the fetch call');
    controller.abort();
    const err = await caught;
    h.ok(err !== 'hung', 'the aborted call settles instead of hanging');
    h.ok(err instanceof Error && err.name === 'AbortError', 'the abort surfaces as an AbortError');
    h.ok(!(err instanceof GenerationClientError), 'a user cancel is NOT reclassified as a GenerationClientError');
  });

  // --- flow-wait-hygiene chain-1: the connect / first-event window on the fetch transport ---

  await h.test(
    'generateApp (fetch path): no first event within the connect window raises GenerationClientError{kind:"network"}',
    async () => {
      const opts: ClientOptions = { ...BASE, fetchImpl: hangingFetch(), connectTimeoutMs: WINDOW_MS };
      const err = await settledOrHung(collect(generateApp(opts, { prompt: 'p' })), 1000);
      h.ok(err !== 'hung', 'the hung connect is bounded rather than waiting forever');
      h.ok(err instanceof GenerationClientError, 'raises GenerationClientError');
      h.eq(err instanceof GenerationClientError ? err.kind : undefined, 'network', 'classified as a network failure, not left in progress');
    },
  );

  await h.test(
    'generateApp (fetch path): headers but no first event surfaces the connect-timeout hint, not a nested message',
    async () => {
      // The post-open half of the same window: the response headers land, the body never emits.
      // The transport already classified this failure, so the surfaced error must be THAT error —
      // re-wrapping it keeps `kind` but buries the hint the failure screen shows.
      const hold: { controller?: ReadableStreamDefaultController<Uint8Array> } = {};
      const opts: ClientOptions = { ...BASE, fetchImpl: openEndedSseFetch(hold), connectTimeoutMs: WINDOW_MS };
      const err = await settledOrHung(collect(generateApp(opts, { prompt: 'p' })), 1000);
      h.ok(err !== 'hung', 'the silent stream is bounded rather than waiting forever');
      h.ok(err instanceof GenerationClientError, 'raises GenerationClientError');
      h.eq(err instanceof GenerationClientError ? err.kind : undefined, 'network', 'classified as a network failure');
      h.eq(err instanceof GenerationClientError ? err.hint : undefined, CONNECT_TIMEOUT_HINT, 'carrying the connect-timeout hint itself');
    },
  );

  await h.test(
    'generateApp: a failure the transport already classified reaches the caller unchanged',
    async () => {
      // Re-wrapping an already-classified error re-classifies it: `kind` is forced to 'network'
      // and everything the transport attached beyond the message (a status, in particular) is
      // dropped. The stream reader must rethrow such an error as-is.
      const classified = new GenerationClientError('http', { status: 503, hint: 'The service is warming up' });
      const opts: ClientOptions = {
        ...BASE,
        streamTransport: async () => ({ read: async () => { throw classified; } }),
      };
      const err = await settledOrHung(collect(generateApp(opts, { prompt: 'p' })), 1000);
      h.ok(err === classified, 'the transport’s own error instance is what surfaces');
      h.eq(err instanceof GenerationClientError ? err.kind : undefined, 'http', 'its kind is not forced to network');
      h.eq(err instanceof GenerationClientError ? err.status : undefined, 503, 'and its status survives');
      h.eq(err instanceof GenerationClientError ? err.hint : undefined, 'The service is warming up', 'as does its hint');
    },
  );

  await h.test(
    'generateApp (fetch path): the connect window never applies once the first event has arrived',
    async () => {
      const enc = new TextEncoder();
      const eventA: GenerationEvent = { type: 'stage', stage: 'generate', status: 'start' };
      const eventB: GenerationEvent = { type: 'token', text: 'still going' };
      const hold: { controller?: ReadableStreamDefaultController<Uint8Array> } = {};
      const fetchImpl = openEndedSseFetch(hold);

      const gen = generateApp({ ...BASE, fetchImpl, connectTimeoutMs: WINDOW_MS }, { prompt: 'p' });
      const first = gen.next();
      hold.controller?.enqueue(enc.encode(sseFrame(eventA, 1)));
      const firstResult = await settledOrHung(first, 1000);
      h.eq(firstResult !== 'hung' && !(firstResult instanceof Error) ? firstResult.value : undefined, eventA, 'yields the first event');

      // Idle for several windows with the stream open -- a long generation, mid-flight.
      await sleep(WINDOW_MS * 4);
      hold.controller?.enqueue(enc.encode(sseFrame(eventB, 2)));
      hold.controller?.close();

      const second = await settledOrHung(gen.next(), 1000);
      h.eq(
        second !== 'hung' && !(second instanceof Error) ? second.value : second,
        eventB,
        'a stream idle far longer than the connect window keeps running and yields its next event',
      );
    },
  );

  // clarifyPrompt: a mapped error records a generation-channel breadcrumb before throwing.
  // obs-v1: the breadcrumb is a SEAM record, not a console line — so this reads the seam's ring
  // buffer and asserts NAMED FIELDS (spec "A breadcrumb carries structure, not a formatted
  // string"), which is also what makes the assertion independent of any formatting.
  await h.test(
    'clarifyPrompt: a non-2xx response still throws AND records a structured breadcrumb on the generation channel',
    async () => {
      const fetchImpl = (async () =>
        new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })) as typeof fetch;

      const before = log.buffer.snapshot().length;
      await h.throws(
        () => clarifyPrompt({ ...BASE, fetchImpl }, 'hi'),
        '',
        'clarifyPrompt still throws on a 404',
      );

      const logged = log.buffer
        .snapshot()
        .slice(before)
        .find((r) => r.channel === CHANNELS.gen && r.fields.path === '/v1/clarify');
      h.ok(logged !== undefined, 'records a breadcrumb at the httpErrorFrom mapping site');
      if (logged) {
        h.eq(logged.fields.status, 404, 'the response status is a named field');
        h.eq(logged.fields.kind, 'http', 'the mapped error kind is a named field');
        h.ok(!logged.message.includes('whim:gen'), 'the retired prefix is not pasted into the message');
      }
    },
  );
}
