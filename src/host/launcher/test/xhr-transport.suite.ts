/**
 * xhr-transport Node suite (fix-generate-stream-transport chain-4, tasks 3.2-3.6) — drives
 * `generateApp`/`openXhrGenerateStream` end to end against `FakeXMLHttpRequest`, never against a
 * real streaming `fetch`/`ReadableStream`. `generation-client.suite.ts` proves the fetch path;
 * this suite proves the XHR path, since a Node `ReadableStream`-backed fake exercises a streaming
 * capability the device does not actually have (design §D4 — "test the blindness, not just the
 * bug").
 *
 * Every "this resolves before the stream completes" assertion below races the awaited promise
 * against a short timeout (`withTimeout`) rather than a bare `await`, so a regression to
 * buffer-until-complete fails the check cleanly instead of hanging the whole suite.
 */

import { Harness } from './harness';
import { generateApp, GenerationClientError } from '../generation-client';
import type { ClientOptions } from '../generation-client';
import { openXhrGenerateStream } from '../xhr-transport';
import { FakeXMLHttpRequest } from './fake-xhr';
import type { GenerationEvent } from '@whim/contract';

function sseFrame(event: GenerationEvent, id: number): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\nid: ${id}\n\n`;
}

async function collect(source: AsyncIterable<GenerationEvent>): Promise<GenerationEvent[]> {
  const out: GenerationEvent[] = [];
  for await (const event of source) {
    out.push(event);
  }
  return out;
}

const BASE: ClientOptions = { baseUrl: 'https://example.invalid', deviceId: 'device-1' };

/** Wire `generateApp` to drive `openXhrGenerateStream` against `fakeXhr`, bypassing the module's
 *  own runtime capability probe (`ClientOptions.streamTransport`, per `generation-client.ts`). */
function withFakeXhr(fakeXhr: FakeXMLHttpRequest): ClientOptions {
  return {
    ...BASE,
    streamTransport: (opts, request, signal) =>
      openXhrGenerateStream(opts, request, signal, () => fakeXhr as unknown as XMLHttpRequest),
  };
}

type NextResult = IteratorResult<GenerationEvent, void>;

/** Await `promise`, but resolve to the string `'timeout'` instead of hanging forever if it does
 *  not settle within `ms` — turns "this resolves without waiting for X" into a clean, bounded
 *  assertion rather than a suite-hanging `await`. */
function withTimeout(promise: Promise<NextResult>, ms: number): Promise<NextResult | 'timeout'> {
  return Promise.race([
    promise,
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), ms);
    }),
  ]);
}

async function expectThrow(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err;
  }
}

export async function runXhrTransportTests(h: Harness): Promise<void> {
  // --- task 3.2: incremental delivery, keepalive skipping, multi-byte survival ---

  await h.test('openXhrGenerateStream: events surface incrementally, before the response completes', async () => {
    const fakeXhr = new FakeXMLHttpRequest();
    const eventA: GenerationEvent = { type: 'stage', stage: 'generate', status: 'start' };
    const eventB: GenerationEvent = { type: 'token', text: 'const x = 1;' };
    const gen = generateApp(withFakeXhr(fakeXhr), { prompt: 'p' });

    const first = gen.next();
    fakeXhr.respondHeaders(200);
    fakeXhr.respondIncremental(sseFrame(eventA, 1));
    const firstResult = await withTimeout(first, 200);
    h.ok(firstResult !== 'timeout', 'the first event resolves without waiting for the stream to complete');
    if (firstResult !== 'timeout') {
      h.eq(firstResult.value, eventA, 'yields the first event as soon as its frame arrives');
    }

    const second = gen.next();
    fakeXhr.respondIncremental(sseFrame(eventB, 2));
    const secondResult = await withTimeout(second, 200);
    h.ok(secondResult !== 'timeout', 'the second event also resolves before completion');
    if (secondResult !== 'timeout') {
      h.eq(secondResult.value, eventB, 'yields the second event');
    }

    fakeXhr.respondComplete();
    const third = await gen.next();
    h.ok(third.done === true, 'iteration ends once the response completes with no further frames');
  });

  await h.test('openXhrGenerateStream: a keepalive comment block is skipped, not yielded or errored', async () => {
    const fakeXhr = new FakeXMLHttpRequest();
    const event: GenerationEvent = { type: 'token', text: 'hello' };
    const collected = collect(generateApp(withFakeXhr(fakeXhr), { prompt: 'p' }));
    fakeXhr.respondHeaders(200);
    fakeXhr.respondIncremental(sseFrame(event, 1));
    fakeXhr.respondIncremental(': keepalive\n\n');
    fakeXhr.respondComplete();
    h.eq(await collected, [event], 'yields only the real event; the keepalive block produces nothing and no error');
  });

  await h.test(
    'openXhrGenerateStream: a multi-byte UTF-8 character delivered adjacent to an XHR chunk boundary decodes intact',
    async () => {
      const fakeXhr = new FakeXMLHttpRequest();
      // café (2-byte 'é'), 中 (3-byte), and 🎉 (astral, surrogate-pair, 4-byte) cover every
      // multi-byte UTF-8 width. The split lands immediately BEFORE the astral character -- the
      // sharpest boundary reachable without landing between its two UTF-16 surrogate halves,
      // which is a distinct, native-decoder-dependent question this Node fake cannot settle (see
      // the chain-4 report's multi-byte findings).
      const text = 'café 中 \u{1f389} world';
      const event: GenerationEvent = { type: 'token', text };
      const frame = sseFrame(event, 1);
      const splitIdx = frame.indexOf('\u{1f389}');
      h.ok(splitIdx > 0, 'the test frame actually contains the astral character (sanity check on the fixture)');

      const collected = collect(generateApp(withFakeXhr(fakeXhr), { prompt: 'p' }));
      fakeXhr.respondHeaders(200);
      fakeXhr.respondIncremental(frame.slice(0, splitIdx));
      fakeXhr.respondIncremental(frame.slice(splitIdx));
      fakeXhr.respondComplete();
      const got = await collected;
      h.eq(got, [event], 'reassembles every multi-byte character intact across the XHR delivery boundary');
      h.ok(!JSON.stringify(got).includes('�'), 'no replacement character appears anywhere in the decoded event');
    },
  );

  await h.test(
    'openXhrGenerateStream: an XHR delivery boundary landing between the two UTF-16 surrogate halves of an astral ' +
      'character still decodes intact (fix-generate-stream-transport chain-8: encoding a lone surrogate half alone ' +
      'produces a replacement character that accumulation on the decoded string cannot heal)',
    async () => {
      const fakeXhr = new FakeXMLHttpRequest();
      const text = 'hello \u{1f389} world';
      const event: GenerationEvent = { type: 'token', text };
      const frame = sseFrame(event, 1);
      const highSurrogateIdx = frame.indexOf('\u{1f389}');
      h.ok(highSurrogateIdx > 0, 'the test frame actually contains the astral character (sanity check on the fixture)');
      // Split immediately AFTER the high (leading) surrogate and BEFORE the low (trailing)
      // surrogate -- the exact boundary the design's "accumulation heals any split" reasoning
      // does not cover, because each half is `TextEncoder.encode()`-d on its own before
      // accumulation gets a chance to run.
      const splitIdx = highSurrogateIdx + 1;

      const collected = collect(generateApp(withFakeXhr(fakeXhr), { prompt: 'p' }));
      fakeXhr.respondHeaders(200);
      fakeXhr.respondIncremental(frame.slice(0, splitIdx));
      fakeXhr.respondIncremental(frame.slice(splitIdx));
      fakeXhr.respondComplete();
      const got = await collected;
      h.eq(got, [event], 'reassembles the astral character intact even when split mid-surrogate-pair');
      h.ok(!JSON.stringify(got).includes('�'), 'no replacement character appears anywhere in the decoded event');
    },
  );

  // --- task 3.3: error taxonomy, including the end-to-end mid-stream `network` case ---

  await h.test('openXhrGenerateStream: a 400 DeviceIdError body is classified device_id, not network', async () => {
    const fakeXhr = new FakeXMLHttpRequest();
    const first = generateApp(withFakeXhr(fakeXhr), { prompt: 'p' }).next();
    fakeXhr.respondHeaders(400);
    fakeXhr.respondIncremental(
      JSON.stringify({ error: 'missing_device_id', hint: 'Include a UUID in the x-whim-device request header.' }),
    );
    fakeXhr.respondComplete();
    const caught = await expectThrow(first);
    h.ok(caught instanceof GenerationClientError, 'throws GenerationClientError');
    h.eq((caught as GenerationClientError).kind, 'device_id', 'kind is device_id, not network');
    h.eq(
      (caught as GenerationClientError).hint,
      'Include a UUID in the x-whim-device request header.',
      'carries the server hint',
    );
  });

  await h.test('openXhrGenerateStream: a non-2xx, non-DeviceIdError response is classified http', async () => {
    const fakeXhr = new FakeXMLHttpRequest();
    const first = generateApp(withFakeXhr(fakeXhr), { prompt: 'p' }).next();
    fakeXhr.respondHeaders(500);
    fakeXhr.respondIncremental(JSON.stringify({ error: 'server_error', hint: 'boom' }));
    fakeXhr.respondComplete();
    const caught = await expectThrow(first);
    h.ok(caught instanceof GenerationClientError, 'throws GenerationClientError');
    h.eq((caught as GenerationClientError).kind, 'http', 'kind is http');
    h.eq((caught as GenerationClientError).status, 500, 'status is carried through');
    h.eq((caught as GenerationClientError).hint, 'boom', 'carries the body hint');
  });

  await h.test(
    'openXhrGenerateStream: a transport failure before any status is known is classified network',
    async () => {
      const fakeXhr = new FakeXMLHttpRequest();
      const first = generateApp(withFakeXhr(fakeXhr), { prompt: 'p' }).next();
      fakeXhr.respondError(); // no respondHeaders() call first -- status stays 0, reader never handed back
      const caught = await expectThrow(first);
      h.ok(caught instanceof GenerationClientError, 'throws GenerationClientError');
      h.eq((caught as GenerationClientError).kind, 'network', 'kind is network');
      h.eq((caught as GenerationClientError).hint, 'The generate request failed', 'carries the fixed transport-failure hint');
    },
  );

  await h.test(
    'generateApp: a transport failure AFTER the reader is already open surfaces end to end as GenerationClientError{kind:"network"} ' +
      '-- xhr-transport.ts raises a plain Error here; readNext (untouched, below the seam) does the classification',
    async () => {
      const fakeXhr = new FakeXMLHttpRequest();
      const startEvent: GenerationEvent = { type: 'stage', stage: 'generate', status: 'start' };
      const gen = generateApp(withFakeXhr(fakeXhr), { prompt: 'p' });

      const first = gen.next();
      fakeXhr.respondHeaders(200);
      fakeXhr.respondIncremental(sseFrame(startEvent, 1));
      const firstResult = await first;
      h.eq(firstResult.value, startEvent, 'the stream opened and yielded its first event normally');

      const second = gen.next();
      fakeXhr.respondError(); // a transport failure AFTER the reader was already handed back
      const caught = await expectThrow(second);
      h.ok(caught instanceof GenerationClientError, 'the CALLER of generateApp sees a GenerationClientError, not a raw Error');
      h.eq((caught as GenerationClientError).kind, 'network', 'classified network end to end');
      h.eq(
        (caught as GenerationClientError).hint,
        'The generate request failed',
        'the transport error message propagates through readNext unchanged',
      );
    },
  );

  await h.test('generateApp: a malformed SSE frame over the XHR transport still raises GenerationClientError{kind:"stream_parse"}', async () => {
    const fakeXhr = new FakeXMLHttpRequest();
    const first = generateApp(withFakeXhr(fakeXhr), { prompt: 'p' }).next();
    fakeXhr.respondHeaders(200);
    fakeXhr.respondIncremental('event: stage\ndata: {"type":"not-a-real-type"}\nid: 1\n\n');
    fakeXhr.respondComplete();
    const caught = await expectThrow(first);
    h.ok(caught instanceof GenerationClientError, 'throws GenerationClientError');
    h.eq(
      (caught as GenerationClientError).kind,
      'stream_parse',
      'kind is stream_parse -- parseSseBlock (below the seam) is reached unchanged via the XHR transport too',
    );
  });

  // --- fix-generate-stream-transport chain-9 task 9.3: abort racing a classified HTTP error ---

  await h.test(
    'openXhrGenerateStream: an abort landing between a completed non-2xx response and its async HTTP-error ' +
      'classification still ends iteration silently, not as a thrown http error',
    async () => {
      const fakeXhr = new FakeXMLHttpRequest();
      const controller = new AbortController();
      const first = generateApp(withFakeXhr(fakeXhr), { prompt: 'p' }, controller.signal).next();
      fakeXhr.respondHeaders(500);
      fakeXhr.respondIncremental(JSON.stringify({ error: 'server_error', hint: 'boom' }));
      // `httpErrorFrom`'s classification is asynchronous (an `async` function wrapping the fake's
      // own synchronous `.json()`), so it resolves on a later microtask even though the response
      // is already known complete here. Aborting synchronously, right after `respondComplete()`,
      // lands in that window: `finished` is already true and the abort-signal listener has
      // already been removed, so nothing reacts to this abort until classification settles.
      fakeXhr.respondComplete();
      controller.abort();

      const result = await first;
      h.ok(result.done === true, 'the abort wins the race -- iteration ends silently, not with a thrown http error');
      h.eq(fakeXhr.abortCount, 0, 'the underlying XHR is never told to abort -- its response had already fully arrived');
    },
  );

  // --- task 3.4: cancellation ---

  await h.test('generateApp: aborting mid-stream ends iteration silently and actually aborts the underlying XHR', async () => {
    const fakeXhr = new FakeXMLHttpRequest();
    const controller = new AbortController();
    const startEvent: GenerationEvent = { type: 'stage', stage: 'generate', status: 'start' };
    const gen = generateApp(withFakeXhr(fakeXhr), { prompt: 'p' }, controller.signal);

    const first = gen.next();
    fakeXhr.respondHeaders(200);
    fakeXhr.respondIncremental(sseFrame(startEvent, 1));
    const firstResult = await first;
    h.eq(firstResult.value, startEvent, 'yields the event seen before the abort');

    const second = gen.next();
    controller.abort();
    const secondResult = await second;
    h.ok(secondResult.done === true, 'iteration ends silently -- no further events');
    h.eq(fakeXhr.abortCount, 1, 'aborting the signal calls abort() on the underlying XHR exactly once');

    const caught = await expectThrow(gen.next());
    h.eq(caught, undefined, 'no error is raised past the abort');
  });

  // --- task 3.6: exactly one request per generation ---

  await h.test(
    'generateApp: exactly one POST /v1/generate request is issued per generation on a non-streaming-fetch runtime (no double-request fallback)',
    async () => {
      const fakeXhr = new FakeXMLHttpRequest();
      let transportCalls = 0;
      let fetchCalls = 0;
      const fetchImpl = (async () => {
        fetchCalls++;
        throw new Error('the fetch path must never be used once a streamTransport is selected');
      }) as typeof fetch;
      const event: GenerationEvent = {
        type: 'result',
        app: { name: 'Tip Splitter', source: 'src', bundle: 'bundle', manifest: {}, schema: {} },
      };
      const opts: ClientOptions = {
        ...BASE,
        fetchImpl,
        streamTransport: (o, r, s) => {
          transportCalls++;
          return openXhrGenerateStream(o, r, s, () => fakeXhr as unknown as XMLHttpRequest);
        },
      };
      const collected = collect(generateApp(opts, { prompt: 'p' }));
      fakeXhr.respondHeaders(200);
      fakeXhr.respondIncremental(sseFrame(event, 1));
      fakeXhr.respondComplete();
      h.eq(await collected, [event], 'the generation completes normally');
      h.eq(transportCalls, 1, 'the stream transport is invoked exactly once');
      h.eq(fakeXhr.sendCount, 1, 'exactly one underlying XHR send() -- one POST /v1/generate');
      h.eq(fetchCalls, 0, 'the fetch-based path is never used as a fallback once a stream transport is selected');
    },
  );

  // --- task 3.5 / spec "Incremental delivery has a negative control" ---

  await h.test(
    'negative control: the first event resolves before the stream completes (red-checked in the chain-4 report by ' +
      'temporarily making the transport buffer until completion and observing this exact check fail)',
    async () => {
      const fakeXhr = new FakeXMLHttpRequest();
      const event: GenerationEvent = { type: 'stage', stage: 'generate', status: 'start' };
      const first = generateApp(withFakeXhr(fakeXhr), { prompt: 'p' }).next();
      fakeXhr.respondHeaders(200);
      fakeXhr.respondIncremental(sseFrame(event, 1));
      // Deliberately NOT calling fakeXhr.respondComplete() yet -- `first` must already be
      // observable without it.
      const settled = await withTimeout(first, 200);
      h.ok(settled !== 'timeout', 'the first event resolves without the response ever completing');
      if (settled !== 'timeout') {
        h.eq(settled.value, event, 'yields the correct event');
      }
      fakeXhr.respondComplete();
    },
  );
}
