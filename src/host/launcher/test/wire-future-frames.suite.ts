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
import { GenerationClientError, clarifyPrompt, generateApp, rewritePrompt } from '../generation-client';
import { serviceRefusalOf } from '../service-refusal';
import { GENERIC_STREAM_ERROR, errorReason } from '../error-reason';
import { acceptClarifyQuestions, stepAfterClarifyExchange } from '../prompt-flow';
import { PROTOCOL_LEVEL } from '../wire-headers';
import { KNOWN_ERROR_CODES } from '../wire-compat';
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

/** What `generateApp` made of the stream `fetchImpl` answered: the events it yielded, and what it
 *  threw, if anything. */
async function drainWith(fetchImpl: typeof fetch): Promise<{ events: GenerationEvent[]; error?: unknown }> {
  const events: GenerationEvent[] = [];
  const run = async (): Promise<{ events: GenerationEvent[]; error?: unknown }> => {
    try {
      for await (const event of generateApp({ ...OPTS, fetchImpl }, { prompt: 'p' })) events.push(event);
      return { events };
    } catch (error) {
      return { events, error };
    }
  };
  return bounded(run(), 'the generation stream');
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
    h.eq(serviceRefusalOf(error)?.code, 'update_required', 'the shell reads it as the update refusal, so the update screen opens');
    h.eq(serviceRefusalOf(error)?.hint, NOTICE, 'carrying the notice');
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
    h.eq(serviceRefusalOf(error)?.code, 'update_required', 'the shell reads it as the update refusal');
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
    h.eq(serviceRefusalOf(update)?.code, 'update_required', 'update: the update path');
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

  // ── Level-1 additions this build handles before their own UI exists ─────────────────────────

  await h.test('future frames: queued and restart are non-terminal activity, and the stream runs on to its result', async () => {
    const line: GenerationEvent[] = [{ type: 'queued', position: 2 }, { type: 'queued', position: 1 }, STAGE, TOKEN, { type: 'restart' }, TOKEN, RESULT];
    const { events, error } = await drain(sseFromServer(line.map((event) => adapted(event, WIRE_REGISTRY))));
    h.eq(outcomeOf(error), 'none', 'nothing is thrown');
    h.eq(events, line, 'every event arrives in order, the result last');
  });

  await h.test('future frames: a clarify limit falls through to the zero-question path', async () => {
    const limit = { reason: 'Mini-apps can’t fetch live weather.', alternative: 'a packing list you fill in yourself' };
    const fetchImpl = (async () => json({ questions: [], limit }, 200)) as typeof fetch;
    const response = await bounded(clarifyPrompt({ ...OPTS, fetchImpl }, 'what to wear today'), 'clarify');
    h.eq(stepAfterClarifyExchange(acceptClarifyQuestions(response.questions)), 'plan', 'the flow goes straight to the plan step');
  });
}
