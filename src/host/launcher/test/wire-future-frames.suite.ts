/**
 * wire-future-frames — the device decoder against frames from a later protocol level (beta-1
 * design D16 layer 3, task 1.4; spec generation-contract "Every wire message carries a
 * forward-compatibility envelope with a closed fallback vocabulary").
 *
 * Where a conforming server can produce the frame, it comes from the server's own code: a
 * synthetic level-2 message adapted for this build's level by `server/src/wire-level.ts`, framed by
 * `server/src/sse.ts`. The inputs no conforming server sends — an unknown message without `compat`,
 * a fallback outside the frozen set, a `compat` the reader cannot read, a level-2 payload sent
 * unadapted — are written by hand. Every stream read is bounded, so a regression fails by name.
 *
 * Also holds the device's mirrors to their sources: the protocol level it declares (read back with
 * the contract's own header schema), the compat values it can read (against the contract's
 * `WireEnvelope`), and the error codes it knows (against the server's registry).
 */
import type { Compat, GenerationEvent } from '@whim/contract';
import { CompatFallback, COMPAT_NOTICE_MAX_CHARS, PROTOCOL_HEADER, PROTOCOL_LEVEL as CONTRACT_LEVEL, ProtocolLevelHeader, WireEnvelope } from '@whim/contract';
import { Harness } from './harness';
import { grantedOptions } from './client-fixtures';
import { GenerationClientError, clarifyPrompt, generateApp, rewritePrompt, sendReport, type ConsentedClientOptions } from '../generation-client';
import { openXhrGenerateStream } from '../xhr-transport';
import { FakeXMLHttpRequest } from './fake-xhr';
import { serviceRefusalOf } from '../service-refusal';
import { GENERIC_STREAM_ERROR, errorReason } from '../error-reason';
import { acceptClarifyQuestions, clarifyLimitOf, stepAfterClarifyExchange } from '../prompt-flow';
import { fallbackNotice, terminalFallbackOf } from '../wire-fallback';
import { PROTOCOL_LEVEL } from '../wire-headers';
import { COMPAT_NOTICE_MAX_CHARS as COMPAT_NOTICE_MAX_CHARS_DEVICE, KNOWN_ERROR_CODES } from '../wire-compat';
import { buildSseStream } from '../../../../server/src/sse';
import { WIRE_REGISTRY, errorForLevel, eventForLevel, type WireEvent, type WireRegistry } from '../../../../server/src/wire-level';

const OPTS = grantedOptions('https://example.invalid', 'device-1');
const WAIT_MS = 2000;

const STAGE: GenerationEvent = { type: 'stage', stage: 'generate', status: 'start' };
const TOKEN: GenerationEvent = { type: 'token', text: 'const x = 1;' };
const RESULT: GenerationEvent = {
  type: 'result',
  app: { name: 'Tip Splitter', source: 'src', bundle: 'window.__WHIM_APP_MODULE__ = {};', manifest: {}, schema: {} },
};

/** A level-2 event and a level-2 error code this build has never heard of. */
const ETA = { type: 'eta', seconds: 40 };
const QUOTA = { error: 'quota_changed', hint: 'Your daily allowance changed.' };
const NOTICE = 'Update Whim to see how long the wait is.';

/** The server's registry plus `eta` and `quota_changed` at level 2 with `compat`, and `token`
 *  re-meant at level 2 when `tokenToo` is set. */
function levelTwo(compat: Compat, tokenToo = false): WireRegistry {
  return {
    events: { ...WIRE_REGISTRY.events, eta: { level: 2, compat }, ...(tokenToo ? { token: { level: 2, compat } } : {}) },
    errors: { ...WIRE_REGISTRY.errors, quota_changed: { level: 2, compat } },
  };
}

/** What the server sends this build for `event`, under `registry`. */
function adapted(event: WireEvent, registry: WireRegistry): WireEvent {
  return eventForLevel(event, PROTOCOL_LEVEL, registry);
}

/** A `Response` streaming `events` framed by the server's own `buildSseStream`. */
function sseFromServer(events: readonly unknown[]): Response {
  async function* source(): AsyncGenerator<WireEvent> {
    for (const event of events) yield event as WireEvent;
  }
  const body = buildSseStream(source()) as unknown as ConstructorParameters<typeof Response>[0];
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Options whose `fetch` answers with `body` at `status`. */
function answering(body: unknown, status = 200): ConsentedClientOptions {
  return { ...OPTS, fetchImpl: (async () => json(body, status)) as typeof fetch };
}

/** `promise`, or a thrown error naming `what` once `WAIT_MS` has passed. */
async function bounded<T>(promise: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${WAIT_MS} ms`)), WAIT_MS);
  });
  try {
    return await Promise.race([promise, hung]);
  } finally {
    clearTimeout(timer);
  }
}

type Drained = { events: GenerationEvent[]; error?: unknown };

/** What `generateApp` made of the stream `opts` opens: the events it yielded, and what it threw, if
 *  anything. The request is sent before this returns its promise; `stopAfterFirst` stops iterating
 *  after the first event, as a consumer that leaves the loop does. */
function drainOpts(opts: ConsentedClientOptions, what: string, stopAfterFirst = false): Promise<Drained> {
  const events: GenerationEvent[] = [];
  const run = async (): Promise<Drained> => {
    try {
      for await (const event of generateApp(opts, { prompt: 'p' })) {
        events.push(event);
        if (stopAfterFirst) break;
      }
      return { events };
    } catch (error) {
      return { events, error };
    }
  };
  return bounded(run(), what);
}

/** What `generateApp` made of the stream `fetchImpl` answered. */
async function drainWith(fetchImpl: typeof fetch): Promise<Drained> {
  return drainOpts({ ...OPTS, fetchImpl }, 'the generation stream');
}

/** How a generation stream is carried: the streaming `fetch` path, or the XHR path the device takes. */
type Transport = 'fetch' | 'xhr';

/** A generate stream that delivered the server-framed `events` and is still open, as a server
 *  mid-build leaves it (`complete` ends it after them instead, as a server that finished does): what
 *  `generateApp` made of it over `transport`, and how many times that transport aborted the request.
 *  An aborted fetch errors its body, as a real one does. */
async function midBuild(transport: Transport, events: readonly unknown[], how: { complete?: boolean; stopAfterFirst?: boolean } = {}): Promise<Drained & { aborts: number }> {
  const text = await sseFromServer(events).text();
  if (transport === 'xhr') {
    const xhr = new FakeXMLHttpRequest();
    const opts = {
      ...OPTS,
      streamTransport: (o, r, s) => openXhrGenerateStream(o, r, s, () => xhr as unknown as XMLHttpRequest),
    } as ConsentedClientOptions;
    const drained = drainOpts(opts, 'the XHR generation stream', how.stopAfterFirst);
    xhr.respondHeaders(200);
    xhr.respondIncremental(text);
    if (how.complete) xhr.respondComplete();
    return { ...(await drained), aborts: xhr.abortCount };
  }
  let aborts = 0;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    signal?.addEventListener('abort', () => { aborts += 1; });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        if (how.complete) controller.close();
        else signal?.addEventListener('abort', () => controller.error(new DOMException('The operation was aborted.', 'AbortError')));
      },
    }) as unknown as ConstructorParameters<typeof Response>[0];
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }) as typeof fetch;
  return { ...(await drainOpts({ ...OPTS, fetchImpl }, 'the fetch generation stream', how.stopAfterFirst)), aborts };
}

function drain(response: Response): Promise<{ events: GenerationEvent[]; error?: unknown }> {
  return drainWith((async () => response) as typeof fetch);
}

/** What a unary call threw for `response`, or `undefined` when it resolved. */
async function unaryError(call: 'rewrite' | 'clarify', response: Response): Promise<unknown> {
  const fetchImpl = (async () => response) as typeof fetch;
  const run = async (): Promise<unknown> => {
    try {
      if (call === 'rewrite') await rewritePrompt({ ...OPTS, fetchImpl }, 'p');
      else await clarifyPrompt({ ...OPTS, fetchImpl }, 'p');
      return undefined;
    } catch (error) {
      return error;
    }
  };
  return bounded(run(), `the ${call} call`);
}

/** The outcome a thrown value stands for: the fallback it carries, `stream_parse`/`http` for the
 *  other client errors, or `none`. */
function outcomeOf(error: unknown): string {
  if (error === undefined) return 'none';
  if (!(error instanceof GenerationClientError)) return 'thrown';
  return error.kind === 'fallback' ? (error.fallback?.kind ?? 'fallback') : error.kind;
}

export async function runWireFutureFramesTests(h: Harness): Promise<void> {
  // ── Events a later server sends, as it sends them to this build ──────────────────────────────

  await h.test('future frames: an unknown event marked skip is ignored and the stream runs on to its terminal event', async () => {
    const skip = adapted(ETA, levelTwo({ min: 2, fallback: 'skip' }));
    h.eq(skip, { type: 'eta', compat: { min: 2, fallback: 'skip' } }, 'setup: the server sends this build only the envelope');
    const { events, error } = await drain(sseFromServer([STAGE, skip, TOKEN, RESULT]));
    h.eq(outcomeOf(error), 'none', 'nothing is thrown');
    h.eq(events, [STAGE, TOKEN, RESULT], 'every other event arrives, the result last');
  });

  await h.test('future frames: an unknown event marked fail ends the flow on the failure screen, with its notice', async () => {
    const fail = adapted(ETA, levelTwo({ min: 2, fallback: 'fail', notice: NOTICE }));
    const { events, error } = await drain(sseFromServer([STAGE, fail, TOKEN, RESULT]));
    h.eq(outcomeOf(error), 'fail', 'the stream ends with the fail outcome');
    h.eq(events, [STAGE], 'nothing after it is used');
    h.eq(errorReason(error).reason, NOTICE, 'the failure screen shows the notice as its reason');
    h.eq(serviceRefusalOf(error), undefined, 'and it is not read as a refusal');
  });

  await h.test('future frames: an unknown event marked update ends the flow on the update path, and nothing is delivered', async () => {
    const update = adapted(ETA, levelTwo({ min: 2, fallback: 'update', notice: NOTICE }));
    const { events, error } = await drain(sseFromServer([STAGE, update, RESULT]));
    h.eq(outcomeOf(error), 'update', 'the stream ends with the update outcome');
    h.ok(!events.some((event) => event.type === 'result'), 'the result after it is never yielded');
    h.eq(terminalFallbackOf(error)?.kind, 'update', 'the shell reads it as an update fallback, so the update screen opens');
    h.eq(terminalFallbackOf(error)?.notice, NOTICE, 'carrying the notice');
    h.eq(serviceRefusalOf(error), undefined, 'and not as a refusal, which would drop the attempt instead of failing it');
  });

  await h.test('future frames: a known event whose compat.min is above this build takes its fallback', async () => {
    const remeant = adapted(TOKEN, levelTwo({ min: 2, fallback: 'skip' }, true));
    h.eq(remeant, { type: 'token', compat: { min: 2, fallback: 'skip' } }, 'setup: the server sends this build only the envelope');
    const skipped = await drain(sseFromServer([STAGE, remeant, RESULT]));
    h.eq([outcomeOf(skipped.error), skipped.events], ['none', [STAGE, RESULT]], 'a skip drops the known event, even though its type is known');
    // A server that sends the level-2 payload unadapted: layer 3 still applies the fallback.
    const unadapted = { ...TOKEN, compat: { min: PROTOCOL_LEVEL + 1, fallback: 'fail' } };
    const failed = await drain(sseFromServer([STAGE, unadapted, RESULT]));
    h.eq([outcomeOf(failed.error), failed.events], ['fail', [STAGE]], 'a known event with its full payload and min above the level is not decoded');
  });

  // ── Frames no conforming server sends ────────────────────────────────────────────────────────

  await h.test('future frames: an unknown event with no compat is treated as fail, with the generic reason', async () => {
    const { events, error } = await drain(sseFromServer([STAGE, ETA, RESULT]));
    h.eq(outcomeOf(error), 'fail', 'the stream ends with the fail outcome, not a parse error');
    h.eq(events, [STAGE], 'nothing after it is used');
    h.eq(errorReason(error).reason, GENERIC_STREAM_ERROR, 'with no notice, the failure screen shows the generic reason');
  });

  await h.test('future frames: a fallback outside the frozen set is treated as fail', async () => {
    const odd = { ...ETA, compat: { min: 2, fallback: 'retry', notice: 'Try again later.' } };
    const { error } = await drain(sseFromServer([STAGE, odd, RESULT]));
    h.eq(outcomeOf(error), 'fail', 'the stream ends with the fail outcome');
    h.eq(errorReason(error).reason, 'Try again later.', 'and the notice still reaches the failure screen');
  });

  await h.test('future frames: a known event with an extra field is used and the field ignored', async () => {
    const richer = { ...TOKEN, tokenIndex: 12, style: { emphasis: true } };
    const { events, error } = await drain(sseFromServer([STAGE, richer, RESULT]));
    h.eq(outcomeOf(error), 'none', 'nothing is thrown');
    h.eq(
      events.map((event) => (event.type === 'token' ? { type: event.type, text: event.text } : event)),
      [STAGE, TOKEN, RESULT],
      'the event arrives with its own fields intact, and the stream runs on',
    );
  });

  await h.test('future frames: every fallback in the contract’s frozen vocabulary resolves to its own outcome', async () => {
    for (const fallback of CompatFallback.options) {
      const { error } = await drain(sseFromServer([STAGE, { ...ETA, compat: { min: 2, fallback } }, RESULT]));
      h.eq(outcomeOf(error), fallback === 'skip' ? 'none' : fallback, `"${fallback}" ends the way it names`);
    }
  });

  await h.test('future frames: this build reads exactly the compat values the contract’s WireEnvelope reads', async () => {
    const notice = (length: number): string => 'n'.repeat(length);
    const corpus: readonly unknown[] = [
      { min: 2, fallback: 'skip' },
      { min: 1, fallback: 'skip' },
      { min: 2, fallback: 'skip', notice: '' },
      { min: 2, fallback: 'skip', notice: notice(COMPAT_NOTICE_MAX_CHARS) },
      { min: 2, fallback: 'skip', notice: notice(COMPAT_NOTICE_MAX_CHARS + 1) },
      { min: 2, fallback: 'skip', notice: 7 },
      { min: 2, fallback: 'skip', notice: null },
      { min: null, fallback: 'skip' },
      { min: 2, fallback: null },
      { min: 2, fallback: 'skip', extra: true },
      { min: Number.MAX_SAFE_INTEGER, fallback: 'skip' },
      { min: 2 ** 53, fallback: 'skip' },
      { min: 0, fallback: 'skip' },
      { min: -1, fallback: 'skip' },
      { min: 1.5, fallback: 'skip' },
      { min: '2', fallback: 'skip' },
      { fallback: 'skip' },
      { min: 2 },
      { min: 2, fallback: 3 },
      'skip',
      null,
      [],
    ];
    for (const compat of corpus) {
      const read = WireEnvelope.safeParse({ type: 'eta', compat }).success;
      const { error } = await drain(sseFromServer([{ type: 'eta', compat }, RESULT]));
      h.eq(outcomeOf(error) === 'none', read, `compat ${JSON.stringify(compat)}: read by this build exactly when the contract reads it (else fail)`);
    }
  });

  // ── A stream the client ends releases the server's build ─────────────────────────────────────

  const clientEndings = [
    { name: 'a fail fallback', frame: adapted(ETA, levelTwo({ min: 2, fallback: 'fail', notice: NOTICE })), outcome: 'fail' },
    { name: 'an update fallback', frame: adapted(ETA, levelTwo({ min: 2, fallback: 'update', notice: NOTICE })), outcome: 'update' },
    { name: 'a frame that fails to parse', frame: { type: 'token' }, outcome: 'stream_parse' },
  ];
  for (const transport of ['fetch', 'xhr'] as const) {
    for (const ending of clientEndings) {
      await h.test(`client ending (${transport}): ${ending.name} mid-build aborts the request, so the server stops building`, async () => {
        const { events, error, aborts } = await midBuild(transport, [STAGE, ending.frame, TOKEN]);
        h.eq([outcomeOf(error), events], [ending.outcome, [STAGE]], 'setup: the stream ends on the client, after the first event');
        h.eq(aborts, 1, 'the transport aborted the request');
      });
    }

    await h.test(`client ending (${transport}): a consumer that stops iterating mid-build aborts the request`, async () => {
      const { events, aborts } = await midBuild(transport, [STAGE, TOKEN], { stopAfterFirst: true });
      h.eq(events, [STAGE], 'setup: the consumer left after the first event');
      h.eq(aborts, 1, 'the transport aborted the request');
    });

    await h.test(`client ending (${transport}): a stream the server ended is not aborted`, async () => {
      const { events, error, aborts } = await midBuild(transport, [STAGE, RESULT], { complete: true });
      h.eq([outcomeOf(error), events], ['none', [STAGE, RESULT]], 'setup: the stream runs to its result');
      h.eq(aborts, 0, 'nothing aborts a request the server finished');
    });
  }

  // ── Error bodies and unary success bodies ────────────────────────────────────────────────────

  await h.test('future frames: an unknown error code marked fail shows its notice on the failure screen', async () => {
    const body = errorForLevel(QUOTA, PROTOCOL_LEVEL, levelTwo({ min: 2, fallback: 'fail', notice: NOTICE }));
    const error = await unaryError('rewrite', json(body, 429));
    h.eq(outcomeOf(error), 'fail', 'the call ends with the fail outcome');
    h.eq((error as GenerationClientError).status, 429, 'carrying the status it arrived with');
    h.eq(errorReason(error).reason, NOTICE, 'the failure screen shows the notice, not the hint');
    h.eq(serviceRefusalOf(error), undefined, 'and it is not read as a refusal');
  });

  await h.test('future frames: an unknown error code marked update opens the update path', async () => {
    const body = errorForLevel(QUOTA, PROTOCOL_LEVEL, levelTwo({ min: 2, fallback: 'update', notice: NOTICE }));
    const error = await unaryError('clarify', json(body, 403));
    h.eq(terminalFallbackOf(error), { kind: 'update', notice: NOTICE }, 'the shell reads it as an update fallback, with its notice');
  });

  await h.test('future frames: an unknown error code marked skip keeps the handling of a code this build doesn’t know', async () => {
    const body = errorForLevel(QUOTA, PROTOCOL_LEVEL, levelTwo({ min: 2, fallback: 'skip' }));
    const error = await unaryError('rewrite', json(body, 429));
    h.eq(outcomeOf(error), 'http', 'an ordinary HTTP error');
    h.eq(errorReason(error).reason, QUOTA.hint, 'whose hint the failure screen shows, as it always has');
  });

  await h.test('future frames: an unknown error code with no compat is treated as fail, with the generic reason', async () => {
    const error = await unaryError('rewrite', json(QUOTA, 429));
    h.eq(outcomeOf(error), 'fail', 'the fail outcome, not an HTTP error carrying the hint');
    h.eq(errorReason(error).reason, GENERIC_STREAM_ERROR, 'the failure screen shows the generic reason');
  });

  await h.test('future frames: a success body whose compat.min is above this build takes its fallback', async () => {
    const update = await unaryError('clarify', json({ questions: [], compat: { min: PROTOCOL_LEVEL + 1, fallback: 'update' } }, 200));
    h.eq(terminalFallbackOf(update), { kind: 'update' }, 'update: the update path, with no notice');
    const skip = await unaryError('clarify', json({ questions: [], compat: { min: PROTOCOL_LEVEL + 1, fallback: 'skip' } }, 200));
    h.eq(outcomeOf(skip), 'none', 'skip: the body is read the way this build reads it');
  });

  // ── The mirrors, held to their sources ───────────────────────────────────────────────────────

  await h.test('future frames: every /v1 request declares the contract’s protocol level', async () => {
    const sent: Headers[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      sent.push(new Headers(init?.headers as Record<string, string>));
      return url.endsWith('/v1/generate') ? sseFromServer([RESULT]) : json({ questions: [] }, 200);
    }) as typeof fetch;
    await bounded(clarifyPrompt({ ...OPTS, fetchImpl }, 'p'), 'clarify');
    h.eq((await drainWith(fetchImpl)).events, [RESULT], 'setup: the stream ran');
    const levels = sent.map((headers) => ProtocolLevelHeader.safeParse(headers.get(PROTOCOL_HEADER)));
    h.eq(levels.map((level) => (level.success ? level.data : 'unreadable')), [CONTRACT_LEVEL, CONTRACT_LEVEL], 'clarify and generate each carry it, readable by the server’s schema');
  });

  await h.test('future frames: this build knows exactly the error codes the server registers at its level', async () => {
    const registered = Object.entries(WIRE_REGISTRY.errors)
      .filter(([, entry]) => entry.level <= PROTOCOL_LEVEL)
      .map(([code]) => code)
      .sort((a, b) => a.localeCompare(b));
    h.eq([...KNOWN_ERROR_CODES].sort((a, b) => a.localeCompare(b)), registered, 'the two lists match');
    for (const code of registered) {
      const error = await unaryError('rewrite', json({ error: code, hint: 'h' }, 400));
      h.ok(outcomeOf(error) !== 'fail', `"${code}" with no compat keeps today's handling`);
    }
  });

  // ── Level-1 additions, as the flow receives them ─────────────────────────────────────────────

  await h.test('future frames: queued and restart are non-terminal activity, and the stream runs on to its result', async () => {
    const line: GenerationEvent[] = [{ type: 'queued', position: 2 }, { type: 'queued', position: 1 }, STAGE, TOKEN, { type: 'restart' }, TOKEN, RESULT];
    const { events, error } = await drain(sseFromServer(line.map((event) => adapted(event, WIRE_REGISTRY))));
    h.eq(outcomeOf(error), 'none', 'nothing is thrown');
    h.eq(events, line, 'every event arrives in order, the result last');
  });

  await h.test('future frames: a clarify limit reaches the flow as the limit, with no questions', async () => {
    const limit = { reason: 'Mini-apps can’t fetch live weather.', alternative: 'a packing list you fill in yourself' };
    const fetchImpl = (async () => json({ questions: [], limit }, 200)) as typeof fetch;
    const response = await bounded(clarifyPrompt({ ...OPTS, fetchImpl }, 'what to wear today'), 'clarify');
    h.eq(clarifyLimitOf(response), limit, 'the flow reads the reason and the alternative');
    h.eq(acceptClarifyQuestions(response.questions), [], 'and there is nothing to ask');
  });

  await h.test('future frames: a notice is shown at most the contract’s length, whatever the error carries', async () => {
    h.eq(COMPAT_NOTICE_MAX_CHARS_DEVICE, COMPAT_NOTICE_MAX_CHARS, 'the device’s cap is the contract’s');
    const forged = new GenerationClientError('fallback', { fallback: { kind: 'fail', notice: 'n'.repeat(COMPAT_NOTICE_MAX_CHARS + 40) } });
    h.eq(errorReason(forged).reason.length, COMPAT_NOTICE_MAX_CHARS, 'a notice longer than the decoder lets through is still cut to the cap');
    h.eq(fallbackNotice({ kind: 'update', notice: 'Update Whim.' }), 'Update Whim.', 'a notice inside the cap is shown as sent');
  });

  // ── null on an optional field is the field left out (this build is the oldest reader) ─────────
  // No conforming server sends null there today; a later one may write "none" that way, and this
  // build can't be patched to meet it.

  await h.test('oldest reader: a clarify limit of null is no limit, so the flow takes the zero-question path', async () => {
    const response = await bounded(clarifyPrompt(answering({ questions: [], limit: null }), 'a packing list'), 'clarify');
    h.eq(response, { questions: [] }, 'the reply is read, with no limit on it');
    h.eq(clarifyLimitOf(response), undefined, 'the flow finds no limit to show');
    h.eq(stepAfterClarifyExchange(acceptClarifyQuestions(response.questions)), 'plan', 'and goes straight to the plan step');
  });

  await h.test('oldest reader: compat null on a known event is no compat, so the event is used', async () => {
    const { events, error } = await drain(sseFromServer([STAGE, { ...TOKEN, compat: null }, RESULT]));
    h.eq(outcomeOf(error), 'none', 'nothing is thrown');
    h.eq(events, [STAGE, TOKEN, RESULT], 'the event arrives without the null, and the stream runs on to its result');
  });

  await h.test('oldest reader: compat null on a unary body is no compat, on success and error bodies alike', async () => {
    h.eq(await bounded(clarifyPrompt(answering({ questions: [], compat: null }), 'p'), 'clarify'), { questions: [] }, 'a clarify reply is read');
    h.eq(
      await bounded(rewritePrompt(answering({ rewrittenPrompt: 'A tip splitter.', compat: null }), 'p'), 'rewrite'),
      { rewrittenPrompt: 'A tip splitter.' },
      'a rewrite reply is read',
    );
    h.eq(await bounded(sendReport(answering({ reportId: 'r-1', compat: null }, 202), { reason: 'broken' }), 'report'), { reportId: 'r-1' }, 'a report receipt is read');
    const refused = await unaryError('rewrite', json({ error: 'daily_limit', hint: 'Come back tomorrow.', compat: null }, 429));
    h.eq([outcomeOf(refused), serviceRefusalOf(refused)?.code], ['http', 'daily_limit'], 'a known error code is still the refusal it names');
    const unknown = await unaryError('rewrite', json({ ...QUOTA, compat: null }, 429));
    h.eq([outcomeOf(unknown), errorReason(unknown).reason], ['fail', GENERIC_STREAM_ERROR], 'an unknown code with a null compat is one with none: fail, with the generic reason');
  });

  await h.test('oldest reader: null on every other optional field of a known message is the field left out', async () => {
    const app = { name: 'Tip Splitter', source: 'src', bundle: 'window.__WHIM_APP_MODULE__ = {};', manifest: {}, schema: {} };
    const diagnostic = { kind: 'type', hint: 'Lay it out with Stack.' };
    const nullDetails = { severity: null, message: null, symbol: null, line: null };
    const built = await drain(sseFromServer([
      { ...STAGE, attempt: null },
      { type: 'diagnostic', diagnostic: { ...diagnostic, ...nullDetails } },
      { type: 'result', app: { ...app, sourceMap: null }, summary: null },
    ]));
    h.eq(outcomeOf(built.error), 'none', 'setup: nothing is thrown');
    h.eq(built.events, [STAGE, { type: 'diagnostic', diagnostic }, { type: 'result', app }], 'stage attempt, diagnostic details, source map and summary arrive absent');
    const failed = await drain(sseFromServer([{ type: 'failure', reason: 'It did not build.', attempts: 2, diagnostics: [{ ...diagnostic, ...nullDetails }] }]));
    h.eq(failed.events, [{ type: 'failure', reason: 'It did not build.', attempts: 2, diagnostics: [diagnostic] }], 'and so do a failure’s diagnostic details');

    h.eq(
      await bounded(rewritePrompt(answering({ rewrittenPrompt: 'A tip splitter.', plan: null }), 'p'), 'rewrite'),
      { rewrittenPrompt: 'A tip splitter.' },
      'a rewrite plan of null is no plan',
    );
    const question = { id: 'units', question: 'Which units?', options: ['Kilometres', 'Miles'] };
    const asked = await bounded(clarifyPrompt(answering({ questions: [{ ...question, select: null, other: null }] }), 'p'), 'clarify');
    h.eq(asked.questions, [{ ...question, select: 'one', other: false }], 'a question’s null select and other take the server’s defaults');
  });

  await h.test('oldest reader: null on a required field still fails its guard', async () => {
    const frames: readonly unknown[] = [
      { type: 'token', text: null },
      { type: 'stage', stage: null, status: 'start' },
      { type: 'queued', position: null },
      { type: 'diagnostic', diagnostic: { kind: 'type', hint: null } },
      { type: 'result', app: null },
      { type: 'failure', reason: 'It did not build.', attempts: 2, diagnostics: [null] },
    ];
    for (const frame of frames) {
      const { events, error } = await drain(sseFromServer([STAGE, frame, RESULT]));
      h.eq([outcomeOf(error), events], ['stream_parse', [STAGE]], `${JSON.stringify(frame)} is a frame that fails to parse`);
    }
    const clarifyBodies: readonly unknown[] = [
      { questions: null },
      { questions: [null] },
      { questions: [], limit: { reason: null, alternative: 'a packing list you fill in yourself' } },
      { questions: [{ id: 'units', question: null, options: ['Kilometres'] }] },
      { questions: [{ id: 'units', question: 'Which units?', options: null }] },
      { questions: [{ id: 'units', question: 'Which units?', options: ['Kilometres', null] }] },
    ];
    for (const body of clarifyBodies) {
      const error = await unaryError('clarify', json(body, 200));
      h.eq([outcomeOf(error), (error as GenerationClientError | undefined)?.hint], ['http', 'Unexpected clarify response shape'], `${JSON.stringify(body)} is a malformed clarify reply`);
    }
    const rewrite = await unaryError('rewrite', json({ rewrittenPrompt: null }, 200));
    h.eq([outcomeOf(rewrite), (rewrite as GenerationClientError | undefined)?.hint], ['http', 'Unexpected rewrite response shape'], 'a null rewritten prompt is a malformed rewrite reply');
  });

  await h.test('oldest reader: a compat notice of null is no notice, so the fallback it names still applies', async () => {
    const skipped = await drain(sseFromServer([STAGE, { ...ETA, compat: { min: 2, fallback: 'skip', notice: null } }, TOKEN, RESULT]));
    h.eq([outcomeOf(skipped.error), skipped.events], ['none', [STAGE, TOKEN, RESULT]], 'an unknown event marked skip is ignored, and the stream runs on to its result');
    const remeant = await drain(sseFromServer([STAGE, { ...TOKEN, compat: { min: PROTOCOL_LEVEL + 1, fallback: 'skip', notice: null } }, RESULT]));
    h.eq([outcomeOf(remeant.error), remeant.events], ['none', [STAGE, RESULT]], 'a known event above this build’s level is dropped the same way');
    const failed = await drain(sseFromServer([STAGE, { ...ETA, compat: { min: 2, fallback: 'fail', notice: null } }, RESULT]));
    h.eq([outcomeOf(failed.error), errorReason(failed.error).reason], ['fail', GENERIC_STREAM_ERROR], 'fail ends the flow with the generic reason, as a fail with no notice does');
    const updated = await drain(sseFromServer([STAGE, { ...ETA, compat: { min: 2, fallback: 'update', notice: null } }, RESULT]));
    h.eq(terminalFallbackOf(updated.error), { kind: 'update' }, 'update opens the update path, with no notice');
    const body = await unaryError('clarify', json({ questions: [], compat: { min: PROTOCOL_LEVEL + 1, fallback: 'skip', notice: null } }, 200));
    h.eq(outcomeOf(body), 'none', 'a success body marked skip is read the way this build reads it');
    const code = await unaryError('rewrite', json({ ...QUOTA, compat: { min: 2, fallback: 'fail', notice: null } }, 429));
    h.eq([outcomeOf(code), errorReason(code).reason], ['fail', GENERIC_STREAM_ERROR], 'an unknown error code marked fail shows the generic reason');
  });

  await h.test('oldest reader: only null is an absent compat; any other compat this build cannot read still fails a known event', async () => {
    for (const compat of ['skip', [], 0, false, '', { fallback: 'skip' }, { min: null, fallback: 'skip' }, { min: 2, fallback: null }, { min: null, fallback: null, notice: null }]) {
      const { events, error } = await drain(sseFromServer([STAGE, { ...TOKEN, compat }, RESULT]));
      h.eq([outcomeOf(error), events], ['fail', [STAGE]], `compat ${JSON.stringify(compat)} on a known event is unreadable, so fail`);
    }
  });
}
