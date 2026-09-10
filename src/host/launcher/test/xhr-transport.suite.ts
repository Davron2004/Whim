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
 *
 * It also owns the streaming loop's COST, not just its output: the last two checks pin that a
 * reasoning-length stream is decoded, split and parsed once end to end rather than once per
 * delivery, and that a block separator landing across two deliveries still closes its frame.
 */

import { Harness } from './harness';
import { generateApp, GenerationClientError } from '../generation-client';
import type { ClientOptions } from '../generation-client';
import { openXhrGenerateStream } from '../xhr-transport';
import { FakeXMLHttpRequest } from './fake-xhr';
import type { GenerationEvent } from '@whim/contract';
import { log } from '../../logging';
import { CHANNELS } from '../../logging/channels';

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

/** The connect window used by the timeout scenarios below — milliseconds, not the production
 *  15s, so the suite proves the behaviour without sleeping through it. */
const WINDOW_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withFakeXhrTimeout(fakeXhr: FakeXMLHttpRequest): ClientOptions {
  return { ...withFakeXhr(fakeXhr), connectTimeoutMs: WINDOW_MS };
}

// --- fixtures for the linear-consumption check below ---

/** A reasoning run's frame counts, as observed on the device: the server forwards EVERY reasoning
 *  delta as its own `thinking` frame, so they outnumber `token` frames roughly ten to one. */
const THINKING_FRAMES = 20_000;
const TOKEN_FRAMES = 2_000;
/** How many XHR progress deliveries carry them. Fewer than one per frame -- deliberately the
 *  GENEROUS end of what the device sees, since the cost being pinned grows with this number. */
const PROGRESS_DELIVERIES = 500;
/** How many times over the body may be decoded before the loop is no longer "decode once". Slack
 *  for the trailing partial block each delivery re-buffers, not for a second full pass. */
const DECODE_BUDGET = 2;
/** Wall-clock backstop for the same input (measured ~0.1s; see the check's comment). */
const LINEAR_CONSUMPTION_BUDGET_MS = 2_000;

/** `thinkingCount` `thinking` frames interleaved with `tokenCount` `token` frames, a keepalive
 *  comment every 500 frames, and a terminal `result` -- one canned SSE body, plus what a correct
 *  consumer must observe in it. */
function thinkingHeavyBody(
  thinkingCount: number,
  tokenCount: number,
): { text: string; eventCount: number; keepaliveCount: number } {
  const parts: string[] = [];
  let id = 0;
  let events = 0;
  let keepalives = 0;
  const everyNth = Math.max(1, Math.round(thinkingCount / tokenCount));
  parts.push(sseFrame({ type: 'stage', stage: 'generate', status: 'start' }, id++));
  events++;
  for (let i = 0; i < thinkingCount; i++) {
    parts.push(sseFrame({ type: 'thinking', chars: 3 }, id++));
    events++;
    if (i % everyNth === everyNth - 1) {
      parts.push(sseFrame({ type: 'token', text: 'abcdefgh' }, id++));
      events++;
    }
    if (i % 500 === 499) {
      parts.push(': keepalive\n\n');
      keepalives++;
    }
  }
  parts.push(sseFrame(RESULT_EVENT, id++));
  events++;
  return { text: parts.join(''), eventCount: events, keepaliveCount: keepalives };
}

/** The terminal frame the canned body ends with. `bundle` must carry the runnable-bundle marker
 *  the client's own `GenerationEvent` guard checks for. */
const RESULT_EVENT: GenerationEvent = {
  type: 'result',
  app: {
    name: 'Timer',
    bundle: 'var App = 1; // __WHIM_APP_MODULE__',
    source: 'export default function App() {}',
    manifest: {},
    schema: {},
  },
};

/** `text` cut into `count` roughly equal pieces -- one XHR progress delivery each. */
function splitIntoChunks(text: string, count: number): string[] {
  const size = Math.ceil(text.length / count);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

/** Bytes handed to `TextDecoder.decode` since the counting decoder was last installed. */
let decodedByteTotal = 0;

/** Install a `TextDecoder` that counts what it is asked to decode over the global one
 *  `generation-client.ts` constructs, and return the restore function. Measuring the loop's
 *  APPETITE rather than its wall time is what makes the check below independent of how fast the
 *  machine running the suite happens to be. */
function installCountingDecoder(): () => void {
  const NativeTextDecoder = TextDecoder;
  decodedByteTotal = 0;
  class CountingTextDecoder extends NativeTextDecoder {
    decode(input?: Uint8Array | ArrayBuffer): string {
      if (input !== undefined) {
        decodedByteTotal += input instanceof ArrayBuffer ? input.byteLength : input.length;
      }
      return super.decode(input);
    }
  }
  const globals = globalThis as unknown as { TextDecoder: unknown };
  globals.TextDecoder = CountingTextDecoder;
  return () => {
    globals.TextDecoder = NativeTextDecoder;
  };
}

/** Await `promise`, resolving to its rejection value, or to `'hung'` if it never settles within
 *  `ms`. A bare `await` here would turn a regression (no window armed at all) into a suite-wide
 *  hang instead of a failed check. */
function outcomeOrHung(promise: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([
    promise.then(
      (value) => value,
      (err: unknown) => err,
    ),
    new Promise<'hung'>((resolve) => {
      setTimeout(() => resolve('hung'), ms);
    }),
  ]);
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

  // build-liveness B2: the XHR path shares `generateApp`'s SSE-block parser (it never parses
  // framing itself — see `generation-client.ts`'s module doc), so `onKeepalive` fires identically
  // over this transport too.
  await h.test('openXhrGenerateStream: onKeepalive fires over the XHR transport too, never as an event', async () => {
    const fakeXhr = new FakeXMLHttpRequest();
    const event: GenerationEvent = { type: 'token', text: 'hello' };
    let keepalives = 0;
    const collected = collect(generateApp({ ...withFakeXhr(fakeXhr), onKeepalive: () => keepalives++ }, { prompt: 'p' }));
    fakeXhr.respondHeaders(200);
    fakeXhr.respondIncremental(sseFrame(event, 1));
    fakeXhr.respondIncremental(': keepalive\n\n');
    fakeXhr.respondComplete();
    h.eq(await collected, [event], 'still yields only the real event');
    h.eq(keepalives, 1, 'and the caller hears about the keepalive frame');
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

  // obs-v1: the breadcrumb is a SEAM record on the generation channel, not a console line — read
  // back off the seam's ring buffer and asserted as named fields.
  await h.test(
    'openXhrGenerateStream: a transport failure records a structured breadcrumb on the generation channel',
    async () => {
      const fakeXhr = new FakeXMLHttpRequest();
      const before = log.buffer.snapshot().length;
      const first = generateApp(withFakeXhr(fakeXhr), { prompt: 'p' }).next();
      fakeXhr.respondError(); // no respondHeaders() call first -- status stays 0, reader never handed back
      const caught = await expectThrow(first);
      h.ok(caught instanceof GenerationClientError, 'still throws GenerationClientError');

      const logged = log.buffer
        .snapshot()
        .slice(before)
        .find((r) => r.channel === CHANNELS.gen && r.fields.path === '/v1/generate');
      h.ok(logged !== undefined, 'records a breadcrumb at the transport-error mapping site');
      if (logged) {
        h.eq(logged.fields.kind, 'network', 'the mapped error kind is a named field');
        h.ok(!logged.message.includes('whim:gen'), 'the retired prefix is not pasted into the message');
      }
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

  // --- flow-wait-hygiene chain-1: the connect / first-event window on the XHR transport ---

  await h.test(
    'openXhrGenerateStream: a connect with no response within the window raises GenerationClientError{kind:"network"} and aborts the request',
    async () => {
      const fakeXhr = new FakeXMLHttpRequest();
      // The fake is deliberately never driven: no headers, no data -- a hung connect.
      const err = await outcomeOrHung(collect(generateApp(withFakeXhrTimeout(fakeXhr), { prompt: 'p' })), 1000);
      h.ok(err !== 'hung', 'the hung connect is bounded rather than waiting forever');
      h.ok(err instanceof GenerationClientError, 'raises GenerationClientError');
      h.eq(err instanceof GenerationClientError ? err.kind : undefined, 'network', 'classified as a network failure, not left in progress');
      h.eq(fakeXhr.abortCount, 1, 'the underlying request is aborted rather than left holding a socket');
    },
  );

  await h.test(
    'openXhrGenerateStream: headers but no first event within the window is still a network failure',
    async () => {
      const fakeXhr = new FakeXMLHttpRequest();
      const collected = outcomeOrHung(collect(generateApp(withFakeXhrTimeout(fakeXhr), { prompt: 'p' })), 1000);
      fakeXhr.respondHeaders(200); // the reader is handed back, but no body event ever arrives
      const err = await collected;
      h.ok(err !== 'hung', 'the hung stream is bounded rather than waiting forever');
      h.ok(err instanceof GenerationClientError, 'raises GenerationClientError');
      h.eq(err instanceof GenerationClientError ? err.kind : undefined, 'network', 'classified as a network failure');
    },
  );

  await h.test(
    'openXhrGenerateStream: the connect window never applies once the first event has arrived',
    async () => {
      const fakeXhr = new FakeXMLHttpRequest();
      const eventA: GenerationEvent = { type: 'stage', stage: 'generate', status: 'start' };
      const eventB: GenerationEvent = { type: 'token', text: 'still going' };
      // The rejection handler is attached UP FRONT, not after the sleep below: a regression that
      // kills the live stream would otherwise reject with no handler attached yet and crash the
      // whole runner on an unhandled rejection instead of failing this one check.
      const collected = collect(generateApp(withFakeXhrTimeout(fakeXhr), { prompt: 'p' })).catch(
        (err: unknown) => err,
      );
      fakeXhr.respondHeaders(200);
      fakeXhr.respondIncremental(sseFrame(eventA, 1));

      // Idle for several windows mid-stream -- a long generation that has begun emitting.
      await sleep(WINDOW_MS * 4);
      fakeXhr.respondIncremental(sseFrame(eventB, 2));
      fakeXhr.respondComplete();

      const got = await Promise.race([
        collected,
        new Promise<'hung'>((resolve) => {
          setTimeout(() => resolve('hung'), 1000);
        }),
      ]);
      h.eq(got, [eventA, eventB], 'a stream idle far longer than the connect window is never killed');
      h.eq(fakeXhr.abortCount, 0, 'the live stream is never aborted');
    },
  );

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
        app: { name: 'Tip Splitter', source: 'src', bundle: 'window.__WHIM_APP_MODULE__ = {};', manifest: {}, schema: {} },
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

  // --- the streaming loop's cost (bug: the build screen froze for minutes mid-generation) ---

  await h.test(
    'generateApp: a thinking-heavy stream is consumed in linear time -- every byte decoded, split and parsed ONCE',
    async () => {
      // The shape of a real reasoning run since the server began forwarding every reasoning delta
      // as its own `thinking` frame: tens of thousands of tiny frames, ~1.4MB of body, arriving
      // over hundreds of XHR progress deliveries. Re-decoding the accumulated body on every
      // delivery costs O(deliveries x body) and froze the device's JS thread for minutes -- the
      // liveness clock stopped, the step checkmarks stopped advancing, taps did nothing.
      const body = thinkingHeavyBody(THINKING_FRAMES, TOKEN_FRAMES);
      const deliveries = splitIntoChunks(body.text, PROGRESS_DELIVERIES);
      const fakeXhr = new FakeXMLHttpRequest();
      let keepalives = 0;

      const restoreDecoder = installCountingDecoder();
      const startedAt = Date.now();
      let events: GenerationEvent[];
      try {
        const collected = collect(generateApp({ ...withFakeXhr(fakeXhr), onKeepalive: () => keepalives++ }, { prompt: 'p' }));
        fakeXhr.respondHeaders(200);
        for (const delivery of deliveries) fakeXhr.respondIncremental(delivery);
        fakeXhr.respondComplete();
        events = await collected;
      } finally {
        restoreDecoder();
      }
      const elapsedMs = Date.now() - startedAt;

      h.eq(events.length, body.eventCount, 'every event still arrives, none dropped or doubled');
      h.eq(keepalives, body.keepaliveCount, 'and every keepalive comment still fires onKeepalive exactly once');
      h.eq(events[events.length - 1].type, 'result', 'the terminal result still ends the stream');

      // THE DISCRIMINATING CHECK. Wall time alone cannot carry this test: Node decodes natively and
      // even the quadratic version finishes the same input in a few hundred milliseconds here,
      // while the DEVICE decoder is `text-encoding-polyfill`'s pure-JS one (Hermes ships no
      // TextDecoder), where the same input took 66s before this bound existed and 0.3s after.
      // Counting decoded bytes measures the property directly and is machine-independent: linear
      // is ~1x the body, the quadratic version was ~250x it.
      h.ok(
        decodedByteTotal <= body.text.length * DECODE_BUDGET,
        `the stream is decoded ~once (decoded ${decodedByteTotal} bytes for a ${body.text.length}-byte body; ` +
          `budget ${body.text.length * DECODE_BUDGET})`,
      );
      // A generous wall-clock backstop for costs the byte counter cannot see (re-splitting,
      // re-parsing, buffer copies). Measured at ~0.1s on the fix, ~0.3s on the quadratic version
      // with Node's native decoder.
      h.ok(elapsedMs < LINEAR_CONSUMPTION_BUDGET_MS, `consumed in ${elapsedMs}ms (budget ${LINEAR_CONSUMPTION_BUDGET_MS}ms)`);
    },
  );

  await h.test(
    'generateApp: a block separator split across two XHR deliveries still closes its frame',
    async () => {
      // The buffering loop scans only the bytes each delivery ADDED, which is only correct if the
      // scan starts one byte early -- otherwise a `\n\n` with one newline in each delivery is
      // never seen and the frame before it is never yielded.
      const fakeXhr = new FakeXMLHttpRequest();
      const first: GenerationEvent = { type: 'token', text: 'one' };
      const second: GenerationEvent = { type: 'token', text: 'two' };
      const frames = sseFrame(first, 1) + sseFrame(second, 2);
      const splitAt = sseFrame(first, 1).length - 1; // between the two newlines ending frame one

      const collected = collect(generateApp(withFakeXhr(fakeXhr), { prompt: 'p' }));
      fakeXhr.respondHeaders(200);
      fakeXhr.respondIncremental(frames.slice(0, splitAt)); // ends on the FIRST newline of `\n\n`
      fakeXhr.respondIncremental(frames.slice(splitAt)); // opens with the second
      fakeXhr.respondComplete();
      h.eq(await collected, [first, second], 'both frames are yielded, in order');
    },
  );

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
