/**
 * generation-client Node suite (prompt-flow-ux chain-1, tasks 1.1/2.1) — `device-id.ts` and
 * `generation-client.ts` against canned `fetchImpl`/`Response` objects, no real HTTP server.
 * Mirrors `server/test/sse-reader.ts`'s SSE-framing idiom, inverted (this reads frames the
 * server writes, per `server/src/sse.ts`).
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
 *   - generateApp: stage/token/diagnostic/usage/result/failure SSE frames all parse into their
 *     validated `GenerationEvent` shapes, in order; a frame whose `data:` JSON does not match
 *     `GenerationEvent` raises `kind:'stream_parse'`; a stream aborted mid-flight (`AbortError`
 *     from the reader) ends iteration with no terminal event and does not throw.
 */

import { Harness } from './harness';
import { MapKVBackend } from '../../version-store';
import { getDeviceId } from '../device-id';
import { GenerationClientError, generateApp, rewritePrompt } from '../generation-client';
import type { ClientOptions } from '../generation-client';
import type { GenerationEvent } from '@whim/contract';

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

  // generateApp: parses stage/token/diagnostic/usage/result frames, in order
  await h.test('generateApp: parses stage/token/diagnostic/usage/result frames off the Response', async () => {
    const events: GenerationEvent[] = [
      { type: 'stage', stage: 'generate', status: 'start' },
      { type: 'token', text: 'const x = 1;' },
      { type: 'diagnostic', diagnostic: { kind: 'type-error', symbol: 'x', hint: 'declare a type' } },
      { type: 'usage', usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
      {
        type: 'result',
        app: { name: 'Tip Splitter', source: 'src', bundle: 'bundle', manifest: {}, schema: {} },
      },
    ];
    const text = events.map((e, i) => sseFrame(e, i + 1)).join('');
    const fetchImpl = (async () => sseResponse([text])) as typeof fetch;
    const got = await collect(generateApp({ ...BASE, fetchImpl }, { prompt: 'make a tip splitter' }));
    h.eq(got, events, 'yields every frame, validated, in order');
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
}
