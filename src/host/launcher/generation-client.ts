/**
 * generation-client — a small, injectable client for the two device→server endpoints
 * (prompt-flow-ux D2): `POST /v1/rewrite` (canned JSON) and `POST /v1/generate` (SSE over a
 * POST `fetch` response body — no `EventSource`, since POST+body isn't representable in it,
 * per `contract/src/index.ts`'s transport notes).
 *
 * `generateApp` parses the same `event:`/`data:`/`id:`/blank-line SSE framing the server writes
 * (`server/src/sse.ts`) directly off the `Response.body` reader, incrementally — frames are
 * yielded as they arrive, not buffered to stream completion. Every frame is validated against
 * `GenerationEvent` (zod, `@whim/contract`) before being yielded; a frame that fails to parse as
 * valid JSON or fails schema validation raises `GenerationClientError{kind:'stream_parse'}`
 * rather than silently passing bad data to the UI. Keepalive comment lines (`: ...`) are
 * recognized and skipped, never treated as malformed frames.
 *
 * `fetchImpl` defaults to global `fetch` and is injectable so `launcher:test` can supply canned
 * `Response` objects with no real HTTP server.
 */

import {
  DeviceIdError,
  GenerateRequest,
  GenerationEvent,
  RewriteResponse,
  type RewriteRequest,
} from '@whim/contract';

/**
 * RN's shipped ambient fetch types (`react-native/src/types/globals.d.ts`) predate its actual
 * runtime capability: `fetch` on Hermes/new-arch DOES stream response bodies (RN 0.85), but the
 * project's `Body` interface has no `body` member (this project's `lib` list excludes `dom` —
 * same gap `src/host/version-store/env.d.ts` already ambient-declares for TextEncoder/
 * TextDecoder). Declares only the minimal reader shape `generateApp` needs, no `lib.dom` import.
 */
declare global {
  interface ResponseBodyReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
  }
  interface Body {
    readonly body: { getReader(): ResponseBodyReader } | null;
  }
}

/** Per-request client config. `deviceId` is attached as the `x-whim-device` header on every
 *  call (spec "Every server request carries a persisted anonymous device identity"). */
export interface ClientOptions {
  baseUrl: string;
  deviceId: string;
  fetchImpl?: typeof fetch;
}

export type GenerationClientErrorKind = 'network' | 'device_id' | 'http' | 'stream_parse';

/**
 * - `network`    — the request itself failed (fetch threw, not an abort).
 * - `device_id`  — the server rejected the `x-whim-device` header (400, `DeviceIdError` body).
 * - `http`       — any other non-2xx response.
 * - `stream_parse` — a `generateApp` SSE frame failed JSON parsing or `GenerationEvent`
 *   validation.
 */
export class GenerationClientError extends Error {
  readonly kind: GenerationClientErrorKind;
  readonly status?: number;
  readonly hint?: string;

  constructor(kind: GenerationClientErrorKind, opts?: { status?: number; hint?: string }) {
    super(opts?.hint ?? kind);
    this.name = 'GenerationClientError';
    this.kind = kind;
    this.status = opts?.status;
    this.hint = opts?.hint;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Build the `GenerationClientError` for a non-ok `Response`: `device_id` when the body matches
 *  the device-identity middleware's `DeviceIdError` shape, `http` otherwise (carrying `hint`
 *  when the body has one, e.g. the `invalid_request` shape the route handlers return). */
async function httpErrorFrom(response: Response): Promise<GenerationClientError> {
  const bodyJson: unknown = await response.json().catch(() => null);
  const deviceIdError = DeviceIdError.safeParse(bodyJson);
  if (deviceIdError.success) {
    return new GenerationClientError('device_id', { status: response.status, hint: deviceIdError.data.hint });
  }
  const hint =
    bodyJson !== null && typeof bodyJson === 'object' && typeof (bodyJson as Record<string, unknown>).hint === 'string'
      ? ((bodyJson as Record<string, unknown>).hint as string)
      : undefined;
  return new GenerationClientError('http', { status: response.status, hint });
}

/** `POST /v1/rewrite` — fast and unary, plain JSON, no stream. */
export async function rewritePrompt(opts: ClientOptions, prompt: string): Promise<RewriteResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${opts.baseUrl}/v1/rewrite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-whim-device': opts.deviceId },
      body: JSON.stringify({ prompt } satisfies RewriteRequest),
    });
  } catch (err) {
    throw new GenerationClientError('network', { hint: messageOf(err) });
  }

  if (!response.ok) {
    throw await httpErrorFrom(response);
  }

  const bodyJson: unknown = await response.json().catch(() => null);
  const parsed = RewriteResponse.safeParse(bodyJson);
  if (!parsed.success) {
    throw new GenerationClientError('http', { status: response.status, hint: 'Unexpected rewrite response shape' });
  }
  return parsed.data;
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

  const parsed = GenerationEvent.safeParse(dataJson);
  if (!parsed.success) {
    throw new GenerationClientError('stream_parse', { hint: 'SSE frame did not match GenerationEvent' });
  }
  return parsed.data;
}

/** Open the `POST /v1/generate` SSE stream and return its body reader, or `'aborted'` if
 *  `signal` fired before/during the request. Every other failure throws `GenerationClientError`. */
async function openGenerateStream(
  opts: ClientOptions,
  request: GenerateRequest,
  signal: AbortSignal | undefined,
): Promise<ResponseBodyReader | 'aborted'> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${opts.baseUrl}/v1/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-whim-device': opts.deviceId },
      body: JSON.stringify(request satisfies GenerateRequest),
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) {
      return 'aborted';
    }
    throw new GenerationClientError('network', { hint: messageOf(err) });
  }

  if (!response.ok) {
    throw await httpErrorFrom(response);
  }
  if (!response.body) {
    throw new GenerationClientError('network', { hint: 'Response has no body' });
  }
  return response.body.getReader();
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
