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
 * frames.
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
  GenerationClientError,
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

function isWireAppRecord(value: unknown): value is WireAppRecord {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.source === 'string' &&
    typeof value.bundle === 'string' &&
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
 */
export async function clarifyPrompt(opts: ClientOptions, prompt: string): Promise<ClarifyResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${opts.baseUrl}/v1/clarify`, {
      method: 'POST',
      headers: requestHeaders(opts),
      body: JSON.stringify({ prompt } satisfies ClarifyRequest),
    });
  } catch (err) {
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
 *  list is sent as no field at all, since absent and empty mean the same thing on the wire. */
export async function rewritePrompt(
  opts: ClientOptions,
  prompt: string,
  clarifications: readonly Clarification[] = [],
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
      } satisfies RewriteRequest),
    });
  } catch (err) {
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

/** Parse one SSE block (the text between blank-line separators, `\n\n`-delimited) into a
 *  validated `GenerationEvent`, or `undefined` for a keepalive comment block. Raises
 *  `GenerationClientError{kind:'stream_parse'}` for anything else that fails to parse. */
function parseSseBlock(block: string): GenerationEvent | undefined {
  const lines = block.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) {
    return undefined;
  }
  if (lines.every((l) => l.startsWith(':'))) {
    return undefined; // keepalive comment block
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
  return dataJson;
}

/** Open the `POST /v1/generate` SSE stream over `fetch` and return its body reader, or
 *  `'aborted'` if `signal` fired before/during the request. Every other failure throws
 *  `GenerationClientError`. Only reachable when the runtime capability determination below has
 *  decided this runtime's `fetch` actually streams (or a caller injects it directly via
 *  `ClientOptions.streamTransport`). */
async function openFetchGenerateStream(
  opts: ClientOptions,
  request: GenerateRequest,
  signal: AbortSignal | undefined,
): Promise<ResponseBodyReader | 'aborted'> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${opts.baseUrl}/v1/generate`, {
      method: 'POST',
      headers: requestHeaders(opts),
      body: JSON.stringify(request satisfies GenerateRequest),
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) {
      return 'aborted';
    }
    logMappedError('/v1/generate', opts.baseUrl, 'network', { message: messageOf(err) });
    throw new GenerationClientError('network', { hint: messageOf(err) });
  }

  if (!response.ok) {
    throw await httpErrorFrom(response, '/v1/generate', opts.baseUrl);
  }
  if (!response.body) {
    throw new GenerationClientError('network', { hint: 'Response has no body' });
  }
  return response.body.getReader();
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
 *  `GenerationClientError{kind:'network'}`. */
async function readNext(reader: ResponseBodyReader): Promise<ReadOutcome> {
  try {
    return await reader.read();
  } catch (err) {
    if (isAbortError(err)) {
      return 'aborted';
    }
    throw new GenerationClientError('network', { hint: messageOf(err) });
  }
}

function* framesIn(blocks: string[], from: number, to: number): Generator<GenerationEvent> {
  for (let i = from; i < to; i++) {
    const event = parseSseBlock(blocks[i]);
    if (event) {
      yield event;
    }
  }
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
 * characters split at a chunk boundary, this buffers RAW BYTES across reads and re-runs a full,
 * non-streaming decode of the accumulated buffer each time, tracking how many complete
 * `\n\n`-delimited blocks have already been yielded by index (never re-parsing one twice).
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
  const chunks: Uint8Array[] = [];
  let emittedBlocks = 0;

  while (true) {
    const chunk = await readNext(reader);
    if (chunk === 'aborted') {
      return;
    }
    if (chunk.value) {
      chunks.push(chunk.value);
    }

    const blocks = decoder.decode(concatBytes(chunks)).split('\n\n');
    // Every block is complete except a possible trailing partial one — UNLESS the stream is
    // done, in which case the trailing block (if any) is final too.
    const completeCount = chunk.done ? blocks.length : blocks.length - 1;
    yield* framesIn(blocks, emittedBlocks, completeCount);
    emittedBlocks = completeCount;

    if (chunk.done) {
      break;
    }
  }
}
