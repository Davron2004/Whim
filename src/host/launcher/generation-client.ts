/**
 * generation-client — a small, injectable client for the two device→server endpoints
 * (prompt-flow-ux D2): `POST /v1/rewrite` (canned JSON) and `POST /v1/generate` (SSE over a
 * POST `fetch` response body — no `EventSource`, since POST+body isn't representable in it,
 * per `contract/src/index.ts`'s transport notes).
 *
 * `generateApp` parses the same `event:`/`data:`/`id:`/blank-line SSE framing the server writes
 * (`server/src/sse.ts`) directly off the `Response.body` reader, incrementally — frames are
 * yielded as they arrive, not buffered to stream completion. Every frame is validated against
 * `GenerationEvent`'s shape (hand-rolled structural guards below, mirroring `@whim/contract`'s
 * zod schema field-for-field — see the guards' doc comment for why) before being yielded; a
 * frame that fails to parse as valid JSON or fails shape validation raises
 * `GenerationClientError{kind:'stream_parse'}` rather than silently passing bad data to the UI.
 * Keepalive comment lines (`: ...`) are recognized and skipped, never treated as malformed
 * frames — but they still fire `ClientOptions.onKeepalive` (build-liveness B2), since a keepalive
 * is real evidence the connection is alive even though it carries no `GenerationEvent`.
 *
 * `fetchImpl` defaults to global `fetch` and is injectable so `launcher:test` can supply canned
 * `Response` objects with no real HTTP server. `POST /v1/generate`'s stream additionally has its
 * own `streamTransport` injection point (see `ClientOptions` in `transport-shared.ts`) — a
 * module-level runtime capability determination picks the `fetch`-based path or the XHR-based one
 * (`xhr-transport.ts`) by default, since not every `fetch` implementation streams a response
 * body (design "fix-generate-stream-transport" D1).
 */

import type {
  Clarification,
  ClarifyQuestion,
  ClarifyRequest,
  ClarifyResponse,
  Diagnostic,
  GenerateRequest,
  GenerationEvent,
  RewriteRequest,
  RewriteResponse,
  Usage,
  WireAppRecord,
} from '@whim/contract';

import { openXhrGenerateStream } from './xhr-transport';
import {
  CONNECT_TIMEOUT_HINT,
  GenerationClientError,
  connectTimeoutOf,
  httpErrorFrom,
  isNonEmptyString,
  isRecord,
  logMappedError,
  requestHeaders,
} from './transport-shared';
import type { ClientOptions } from './transport-shared';

/** Re-exported for callers that historically imported these from this module (`LauncherRoot.tsx`,
 *  the acceptance suites) — the canonical definitions now live in `transport-shared.ts`, shared
 *  with `xhr-transport.ts` without either transport module importing the other. */
export { GenerationClientError };
export type { ClientOptions };

/**
 * Hand-rolled structural guards standing in for `@whim/contract`'s zod schemas
 * (`DeviceIdError`/`RewriteResponse`/`GenerationEvent`.`safeParse`). `@whim/contract` is a
 * TYPE-ONLY import at the top of this file — importing the zod schema VALUES here would pull
 * zod into the Metro bundle graph, and zod's dist uses `export * from` namespace syntax that RN's
 * babel config doesn't transform (`guard:metro`). These guards mirror each schema's shape
 * field-for-field; keep them in sync by hand if `contract/src/index.ts` changes.
 */
function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === 'number';
}

function isRewriteResponse(value: unknown): value is RewriteResponse {
  return isRecord(value) && typeof value.rewrittenPrompt === 'string';
}

function isClarifyQuestion(value: unknown): value is ClarifyQuestion {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.question === 'string' &&
    Array.isArray(value.options) &&
    value.options.every((option) => typeof option === 'string')
  );
}

function isClarifyResponse(value: unknown): value is ClarifyResponse {
  return isRecord(value) && Array.isArray(value.questions) && value.questions.every(isClarifyQuestion);
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return (
    isRecord(value) &&
    typeof value.kind === 'string' &&
    (value.severity === undefined || value.severity === 'error' || value.severity === 'warning') &&
    isOptionalString(value.message) &&
    isOptionalString(value.symbol) &&
    isOptionalNumber(value.line) &&
    isNonEmptyString(value.hint)
  );
}

function isUsage(value: unknown): value is Usage {
  return (
    isRecord(value) &&
    Number.isInteger(value.promptTokens) &&
    Number.isInteger(value.completionTokens) &&
    Number.isInteger(value.totalTokens)
  );
}

// This is a contract assertion, not a re-parse — `__WHIM_APP_MODULE__` is the loader's runtime
// binding contract.
function isRunnableBundle(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.includes('__WHIM_APP_MODULE__');
}

function isWireAppRecord(value: unknown): value is WireAppRecord {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.source === 'string' &&
    isRunnableBundle(value.bundle) &&
    isOptionalString(value.sourceMap) &&
    isRecord(value.manifest) &&
    isRecord(value.schema)
  );
}

/** Structural guard for `GenerationEvent`'s discriminated union — one arm per `type` literal,
 *  matching `contract/src/index.ts`'s zod union exactly. An unrecognized `type` (or a `type` that
 *  isn't a string at all) fails, same as the zod union rejecting an unknown discriminant. */
function isGenerationEvent(value: unknown): value is GenerationEvent {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  switch (value.type) {
    case 'stage':
      return (
        (value.stage === 'plan' ||
          value.stage === 'generate' ||
          value.stage === 'check' ||
          value.stage === 'run' ||
          value.stage === 'repair') &&
        (value.status === 'start' || value.status === 'done') &&
        isOptionalNumber(value.attempt)
      );
    case 'token':
      return typeof value.text === 'string';
    case 'thinking':
      return typeof value.chars === 'number' && Number.isInteger(value.chars) && value.chars > 0;
    case 'diagnostic':
      return isDiagnostic(value.diagnostic);
    case 'usage':
      return isUsage(value.usage);
    case 'result':
      return isWireAppRecord(value.app);
    case 'failure':
      return (
        typeof value.reason === 'string' &&
        typeof value.attempts === 'number' &&
        Array.isArray(value.diagnostics) &&
        value.diagnostics.every(isDiagnostic)
      );
    default:
      return false;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * `POST /v1/clarify` — the pre-stream exchange, fast and unary, plain JSON, never SSE. Zero
 * questions is a SUCCESS meaning "nothing needs clarifying" (the common case), so callers get an
 * empty list rather than an error. A `502` (`clarify_not_configured`/`model_failure`) surfaces as
 * `GenerationClientError{kind:'http', status:502}`, which the flow treats as "skip to the plan
 * step" rather than a dead end (`prompt-flow.ts#isClarifySkip`).
 *
 * `app` is the SAME display-name context `rewritePrompt` carries (`generation-request.ts
 * #buildRewriteAppContext`, shared by `RewriteRequest.app` and `ClarifyRequest.app`): its presence
 * tells the clarifier this exchange is about a CHANGE to an app the user already has, so it can
 * ask about the change instead of re-deriving what the app already is. Omitted entirely when
 * absent — no `app` key is what tells the server this is a new app. */
export async function clarifyPrompt(
  opts: ClientOptions,
  prompt: string,
  app?: ClarifyRequest['app'],
  signal?: AbortSignal,
): Promise<ClarifyResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${opts.baseUrl}/v1/clarify`, {
      method: 'POST',
      headers: requestHeaders(opts),
      body: JSON.stringify({ prompt, ...(app ? { app } : {}) } satisfies ClarifyRequest),
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    logMappedError('/v1/clarify', opts.baseUrl, 'network', { message: messageOf(err) });
    throw new GenerationClientError('network', { hint: messageOf(err) });
  }

  if (!response.ok) {
    throw await httpErrorFrom(response, '/v1/clarify', opts.baseUrl);
  }

  const bodyJson: unknown = await response.json().catch(() => null);
  if (!isClarifyResponse(bodyJson)) {
    throw new GenerationClientError('http', { status: response.status, hint: 'Unexpected clarify response shape' });
  }
  return bodyJson;
}

/** `POST /v1/rewrite` — fast and unary, plain JSON, no stream. `clarifications` carries the
 *  clarify exchange's answers so the rewrite (and the plan rows it returns) reflect them; an empty
 *  list is sent as no field at all, since absent and empty mean the same thing on the wire.
 *
 *  `app` is the display-name context of the app a re-prompt is CHANGING, built by
 *  `generation-request.ts#buildRewriteAppContext` — this client only carries it. Omitted entirely
 *  when absent: no `app` key is what tells the server this is a new app. */
export async function rewritePrompt(
  opts: ClientOptions,
  prompt: string,
  clarifications: readonly Clarification[] = [],
  app?: RewriteRequest['app'],
  signal?: AbortSignal,
): Promise<RewriteResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${opts.baseUrl}/v1/rewrite`, {
      method: 'POST',
      headers: requestHeaders(opts),
      body: JSON.stringify({
        prompt,
        ...(clarifications.length > 0 ? { clarifications: [...clarifications] } : {}),
        ...(app ? { app } : {}),
      } satisfies RewriteRequest),
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) {
      throw err;
    }
    logMappedError('/v1/rewrite', opts.baseUrl, 'network', { message: messageOf(err) });
    throw new GenerationClientError('network', { hint: messageOf(err) });
  }

  if (!response.ok) {
    throw await httpErrorFrom(response, '/v1/rewrite', opts.baseUrl);
  }

  const bodyJson: unknown = await response.json().catch(() => null);
  if (!isRewriteResponse(bodyJson)) {
    throw new GenerationClientError('http', { status: response.status, hint: 'Unexpected rewrite response shape' });
  }
  return bodyJson;
}

/** One parsed SSE block: a validated event, the server's keepalive comment (`: keepalive\n\n`,
 *  build-liveness B2 — transport noise, never a `GenerationEvent`), or a truly empty block (an
 *  incidental extra blank line, distinct from a keepalive so only the real keepalive frame ever
 *  invokes `onKeepalive`). */
type SseBlockResult = { kind: 'event'; event: GenerationEvent } | { kind: 'keepalive' } | { kind: 'empty' };

/** Parse one SSE block (the text between blank-line separators, `\n\n`-delimited). Raises
 *  `GenerationClientError{kind:'stream_parse'}` for anything that looks like a real frame but
 *  fails to parse. */
function parseSseBlock(block: string): SseBlockResult {
  const lines = block.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { kind: 'empty' };
  }
  if (lines.every((l) => l.startsWith(':'))) {
    return { kind: 'keepalive' };
  }

  const dataLine = lines.find((l) => l.startsWith('data: '));
  if (dataLine === undefined) {
    throw new GenerationClientError('stream_parse', { hint: 'SSE frame missing a data: field' });
  }

  let dataJson: unknown;
  try {
    dataJson = JSON.parse(dataLine.slice('data: '.length));
  } catch {
    throw new GenerationClientError('stream_parse', { hint: 'SSE frame data is not valid JSON' });
  }

  if (!isGenerationEvent(dataJson)) {
    throw new GenerationClientError('stream_parse', { hint: 'SSE frame did not match GenerationEvent' });
  }
  return { kind: 'event', event: dataJson };
}

function connectTimeoutError(opts: ClientOptions): GenerationClientError {
  logMappedError('/v1/generate', opts.baseUrl, 'network', { message: CONNECT_TIMEOUT_HINT });
  return new GenerationClientError('network', { hint: CONNECT_TIMEOUT_HINT });
}

/**
 * Open the `POST /v1/generate` SSE stream over `fetch` and return its body reader, or
 * `'aborted'` if `signal` fired before/during the request. Every other failure throws
 * `GenerationClientError`. Only reachable when the runtime capability determination below has
 * decided this runtime's `fetch` actually streams (or a caller injects it directly via
 * `ClientOptions.streamTransport`).
 *
 * Bounded by the connect / first-event window (design "flow-wait-hygiene" D2): a timer armed
 * before the request aborts it through the SAME `AbortController` that relays the caller's
 * `signal`, so one abort path serves both — but a timer-triggered abort sets `timedOut` first and
 * is therefore classified `GenerationClientError{kind:'network'}` rather than silently ending the
 * iteration the way a user cancel does. The window covers request start → the first `read()`
 * outcome only; the returned reader disarms it there, so a long generation that has begun
 * emitting is NEVER timed out. The timer is cleared on every exit path (abort, HTTP error,
 * transport error, first chunk, stream end) — a live `setTimeout` outliving its request is a
 * leak class.
 */
async function openFetchGenerateStream(
  opts: ClientOptions,
  request: GenerateRequest,
  signal: AbortSignal | undefined,
): Promise<ResponseBodyReader | 'aborted'> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;

  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    timer = undefined;
    timedOut = true;
    controller.abort();
  }, connectTimeoutOf(opts));

  function disarm(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }
  const onCallerAbort = (): void => {
    disarm();
    controller.abort();
  };
  function cleanup(): void {
    disarm();
    signal?.removeEventListener('abort', onCallerAbort);
  }

  if (signal?.aborted) {
    cleanup();
    return 'aborted';
  }
  signal?.addEventListener('abort', onCallerAbort, { once: true });

  let response: Response;
  try {
    response = await fetchImpl(`${opts.baseUrl}/v1/generate`, {
      method: 'POST',
      headers: requestHeaders(opts),
      body: JSON.stringify(request satisfies GenerateRequest),
      signal: controller.signal,
    });
  } catch (err) {
    cleanup();
    if (timedOut) {
      throw connectTimeoutError(opts);
    }
    if (isAbortError(err)) {
      return 'aborted';
    }
    logMappedError('/v1/generate', opts.baseUrl, 'network', { message: messageOf(err) });
    throw new GenerationClientError('network', { hint: messageOf(err) });
  }

  if (!response.ok) {
    cleanup();
    throw await httpErrorFrom(response, '/v1/generate', opts.baseUrl);
  }
  if (!response.body) {
    cleanup();
    throw new GenerationClientError('network', { hint: 'Response has no body' });
  }

  const inner = response.body.getReader();
  return {
    async read() {
      try {
        const chunk = await inner.read();
        disarm(); // first byte observed — no further timeout applies for the stream's lifetime
        if (chunk.done) {
          cleanup();
        }
        return chunk;
      } catch (err) {
        cleanup();
        if (timedOut) {
          throw connectTimeoutError(opts);
        }
        throw err;
      }
    },
  };
}

/**
 * Runtime capability determination (design D1): does this runtime's `fetch` actually produce a
 * `Response` that streams its body? Evaluated exactly ONCE, at module load, as a static
 * feature-detection on `Response.prototype` — never by inspecting a `Response` INSTANCE after a
 * request has been issued. A post-hoc check (`await fetch(...)`; retry over XHR if
 * `response.body` is missing) is unviable, not merely inelegant: RN's `whatwg-fetch` polyfill
 * settles its promise only in `xhr.onload`, by which point the server has already run the full
 * generation pipeline to completion, so that fallback would issue a SECOND `POST /v1/generate`
 * on every single generation, doubling LLM spend/latency and double-counting against
 * `usage-store` (design D1).
 *
 * `whatwg-fetch`'s `Body` mixin (applied to `Response.prototype`, see `transport-shared.ts`'s
 * `declare global` augmentation of `Body`) never defines a `body` accessor; a standards-compliant
 * native `fetch` (Node's, in particular) does. This is a fixed property of the runtime's `fetch`
 * implementation — not of any particular request or any particular OS — so it is knowable
 * before any request is issued, correctly lands Node (`launcher:test`, real streaming `fetch`)
 * and React Native (non-streaming `fetch`) on their respective default paths, and needs no
 * `Platform.OS` branch (design D1: no such branch, or `.native.ts`/`.android.ts` suffix file,
 * exists anywhere in `src/host`).
 *
 * Guarded against a `Response` whose `.prototype` is itself `undefined` (e.g. a runtime that
 * defines `Response` as a plain factory function rather than a constructor) — not reachable in
 * either real target runtime today, but this determination runs at module load, the worst
 * possible place for a throw.
 */
const fetchCanStream = typeof Response !== 'undefined' && Response.prototype !== undefined && 'body' in Response.prototype;

/** Open the `POST /v1/generate` stream via the caller-injected `streamTransport` when present,
 *  otherwise via the runtime capability determination's chosen default: the `fetch`-based path
 *  when this runtime's `fetch` can stream, the XHR transport (`xhr-transport.ts`) otherwise.
 *  `readNext`/`generateApp`/`parseSseBlock` below consume whichever `ResponseBodyReader` comes
 *  back identically — they never know which transport produced it. */
async function openGenerateStream(
  opts: ClientOptions,
  request: GenerateRequest,
  signal: AbortSignal | undefined,
): Promise<ResponseBodyReader | 'aborted'> {
  const transport = opts.streamTransport ?? (fetchCanStream ? openFetchGenerateStream : openXhrGenerateStream);
  return transport(opts, request, signal);
}

type ReadOutcome = { done: boolean; value?: Uint8Array } | 'aborted';

/** One `reader.read()`, translating an abort into `'aborted'` and any other failure into
 *  `GenerationClientError{kind:'network'}` — except one the transport ALREADY classified, which
 *  passes through untouched: re-wrapping it would keep the kind but bury its hint (the post-open
 *  connect timeout's `CONNECT_TIMEOUT_HINT`) inside a nested message. */
async function readNext(reader: ResponseBodyReader): Promise<ReadOutcome> {
  try {
    return await reader.read();
  } catch (err) {
    if (isAbortError(err)) {
      return 'aborted';
    }
    if (err instanceof GenerationClientError) {
      throw err;
    }
    throw new GenerationClientError('network', { hint: messageOf(err) });
  }
}

/** `onKeepalive` fires once per real keepalive block — never for a merely-empty one, and never as
 *  a `GenerationEvent` (build-liveness B2: "do NOT add a client-local event type to the
 *  GenerationEvent union"). Every block handed here is one the caller has already decided is
 *  COMPLETE, so each is parsed exactly once over the life of the stream. */
function* framesIn(blocks: string[], onKeepalive?: () => void): Generator<GenerationEvent> {
  for (const block of blocks) {
    const result = parseSseBlock(block);
    if (result.kind === 'event') {
      yield result.event;
    } else if (result.kind === 'keepalive') {
      onKeepalive?.();
    }
  }
}

/** `\n`. An SSE block separator is two of these, and — UTF-8 being self-synchronizing — this byte
 *  can never occur INSIDE a multi-byte sequence, which is what makes "decode everything up to a
 *  separator" safe to do with a non-streaming decoder. */
const LF = 0x0a;

/** The two bytes of the `\n\n` block separator. */
const SEPARATOR_LENGTH = 2;

/** The index of the LAST `\n\n` in `bytes` at or after `from`, or `-1` when there is none.
 *
 *  Searching BACKWARDS from the end is what makes the common case cheap: a read that completed at
 *  least one frame stops on its first comparison. `from` bounds the other case — it is set by the
 *  caller to just before the bytes this read added, so a read that completed no frame scans only
 *  its own new bytes and never the whole buffer again. */
function lastBlockSeparator(bytes: Uint8Array, from: number): number {
  for (let i = bytes.length - SEPARATOR_LENGTH; i >= from; i--) {
    if (bytes[i] === LF && bytes[i + 1] === LF) {
      return i;
    }
  }
  return -1;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * `POST /v1/generate` — streams `GenerationEvent`s off the SSE response body as they arrive.
 *
 * An aborted stream (via `signal`) ends the iteration silently — no terminal event, no throw.
 * Any other stream failure (network error mid-read) raises `GenerationClientError{kind:'network'}`.
 *
 * Hermes ships a TextDecoder polyfill whose streaming-decode option is unverified (this
 * project's own ambient TextDecoder type — `src/host/version-store/env.d.ts` — declares only the
 * single-argument, non-streaming `decode(input)` form). To stay correct across multi-byte UTF-8
 * characters split at a chunk boundary, this buffers RAW BYTES across reads and decodes with the
 * single-argument form only.
 *
 * EACH BYTE IS DECODED, SPLIT AND PARSED EXACTLY ONCE, and that is a performance CONTRACT, not an
 * incidental property. The buffer holds only the tail after the last completed block; a read
 * decodes just the blocks that read completed. Re-decoding the whole accumulated body on every
 * read instead costs O(reads x body) — with a reasoning model's `thinking` deltas that is
 * thousands of reads over a body of hundreds of KB, and the device's TextDecoder is the pure-JS
 * `text-encoding-polyfill` (Hermes ships none), so the JS thread stops answering for minutes:
 * the clock freezes, the steps stop advancing, taps do nothing. Regression-pinned by
 * `xhr-transport.suite.ts` ("a thinking-heavy stream is consumed in linear time").
 *
 * Decoding only up to a separator is what keeps the non-streaming decode correct: `\n` never
 * appears inside a multi-byte UTF-8 sequence, so a block boundary is always a character boundary,
 * and any partial character stays in the byte buffer until the block it belongs to is complete.
 */
export async function* generateApp(
  opts: ClientOptions,
  request: GenerateRequest,
  signal?: AbortSignal,
): AsyncIterable<GenerationEvent> {
  const reader = await openGenerateStream(opts, request, signal);
  if (reader === 'aborted') {
    return;
  }

  const decoder = new TextDecoder();
  // The bytes that have arrived and are NOT yet part of a completed block: at most one partial
  // frame, never the accumulated body.
  let pending: Uint8Array = new Uint8Array(0);
  // How far into `pending` the separator search has already looked. It trails the buffer's end by
  // one byte rather than sitting on it, because a `\n\n` whose two bytes arrive in different
  // reads must still be found.
  let searchedThrough = 0;

  while (true) {
    const chunk = await readNext(reader);
    if (chunk === 'aborted') {
      return;
    }
    if (chunk.value) {
      pending = concatBytes([pending, chunk.value]);
    }

    if (chunk.done) {
      // Nothing follows, so the trailing block (if any) is final too — the one case where a block
      // with no separator after it is still complete.
      if (pending.length > 0) {
        yield* framesIn(decoder.decode(pending).split('\n\n'), opts.onKeepalive);
      }
      break;
    }

    const separator = lastBlockSeparator(pending, searchedThrough);
    if (separator >= 0) {
      const completed = decoder.decode(pending.subarray(0, separator));
      // COPIED out, not a view: a `subarray` would keep the whole consumed buffer alive behind the
      // few bytes of the next partial frame.
      pending = concatBytes([pending.subarray(separator + SEPARATOR_LENGTH)]);
      searchedThrough = Math.max(0, pending.length - SEPARATOR_LENGTH + 1);
      yield* framesIn(completed.split('\n\n'), opts.onKeepalive);
    } else {
      searchedThrough = Math.max(0, pending.length - SEPARATOR_LENGTH + 1);
    }
  }
}
