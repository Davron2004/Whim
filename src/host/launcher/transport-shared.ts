/**
 * transport-shared — the request/error surface shared by `generation-client.ts`'s `fetch`-based
 * `POST /v1/generate` stream transport and `xhr-transport.ts`'s `XMLHttpRequest`-based one, kept
 * in a third module so neither transport needs to import the other.
 *
 * (A prior version had `generation-client.ts` import `openXhrGenerateStream` from
 * `xhr-transport.ts` while `xhr-transport.ts` imported these symbols back from
 * `generation-client.ts` — a module cycle. It never broke Metro's CommonJS output in practice
 * (Babel hoists function-declaration exports above the re-entrant `require()`, and the one class
 * export was never read until after its live binding was reassigned), but nothing in the gate
 * enforces that "no top-level code reads the cross-import" invariant, so a future top-level read
 * in either file could silently reintroduce a temporal-dead-zone failure only a real device would
 * catch. This module removes the cycle instead of continuing to rely on that invariant holding.)
 *
 * `ResponseBodyReader` is the minimal reader shape both transports produce and
 * `generation-client.ts`'s `generateApp`/`readNext` consume; it is declared here (no `lib.dom`
 * import — this project's `lib` list excludes `dom`, same gap `src/host/version-store/env.d.ts`
 * already ambient-declares for TextEncoder/TextDecoder) purely as a shared type, not as a claim
 * that RN's real `fetch`/`Body` provides it. The `declare global` augmentation of `Body` below
 * applies program-wide regardless of which module declares it or who imports this one — it only
 * needs to be part of the TypeScript program, which it is by virtue of `tsconfig.json`'s
 * `include` glob picking up every `.ts` file in the tree.
 */

import type { ConsentVersion, DeviceIdError, GenerateRequest } from '@whim/contract';
import type { ConsentStatus } from './ai-consent';
import type { TermsStatus } from './terms-acceptance';
import type { AppInfo } from './app-info';
import { APP_VERSION_HEADER, BUILD_HEADER, CONSENT_HEADER, PLATFORM_HEADER, REQUEST_ID_HEADER } from './wire-headers';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

declare global {
  interface ResponseBodyReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    /** The stream response's `x-whim-request-id`, set when the transport opened it. */
    readonly requestId?: string;
  }
  interface Body {
    readonly body: { getReader(): ResponseBodyReader } | null;
  }
}

/** Shared with `generation-client.ts`'s own `@whim/contract`-mirroring structural guards
 *  (`isRewriteResponse`/`isDiagnostic`/`isUsage`/`isWireAppRecord`/`isGenerationEvent`), which
 *  import these back from here rather than duplicating them. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isDeviceIdError(value: unknown): value is DeviceIdError {
  return (
    isRecord(value) &&
    (value.error === 'missing_device_id' || value.error === 'invalid_device_id') &&
    isNonEmptyString(value.hint)
  );
}

/** Structural mirror of `@whim/contract`'s `ApiError` (`{ error: string, hint: string.min(1) }`)
 *  — the shape design D8 requires before `GenerationClientError.code` is filled (store-launch-
 *  compliance, spec "A refusal is recognised by the contract's closed refusal vocabulary"). */
function isApiErrorBody(value: unknown): value is { error: string; hint: string } {
  return isRecord(value) && typeof value.error === 'string' && isNonEmptyString(value.hint);
}

/** A bare non-negative integer, digits only — `Number()` also accepts scientific notation
 *  (`1e3`) and hex (`0x10`), neither of which is a delta-seconds value per HTTP's `Retry-After`
 *  grammar, so parsing goes through this pattern first rather than through `Number()` alone. */
const DELTA_SECONDS_PATTERN = /^\d+$/;

/** The response's `Retry-After` header as a positive integer number of seconds, or `undefined`
 *  for a missing, malformed, zero, or negative value (spec "The streaming transport preserves
 *  the client error taxonomy" — a malformed header SHALL NOT change the error's `kind`, and
 *  SHALL simply leave this field absent). Accepts only HTTP's delta-seconds form (digits only);
 *  the HTTP-date form is deliberately treated as absent rather than parsed — `Date.parse` is
 *  lenient (Hermes parses differently from V8) and a server-controlled date far in the future
 *  would disable a client action for years. `response.headers` is optional-chained: every REAL
 *  `Response` (fetch's, and `xhr-transport.ts`'s fake-`Response` adapter) has one, but several
 *  existing test doubles across this codebase build a bare `{ status, json }` stand-in with no
 *  `headers` at all — that is simply another shape of "missing", not a reason to throw. */
function retryAfterSecondsOf(response: Response): number | undefined {
  const raw = response.headers?.get('Retry-After') ?? null;
  if (raw === null || !DELTA_SECONDS_PATTERN.test(raw)) {
    return undefined;
  }
  const seconds = Number(raw);
  return seconds > 0 ? seconds : undefined;
}

/** A response's `x-whim-request-id` (request-envelope D6), or `undefined` when it carries none: a
 *  server from before the header, or a response with no headers at all (optional for the same
 *  test-double reason `retryAfterSecondsOf` gives). An empty value counts as none. */
export function requestIdOf(headers: { get(name: string): string | null } | undefined): string | undefined {
  const id = headers?.get(REQUEST_ID_HEADER) ?? '';
  return id === '' ? undefined : id;
}

/** The exact shape `openGenerateStream` resolves to (`generation-client.ts`). Any conforming
 *  producer — the built-in `fetch`-based path or `xhr-transport.ts`'s `openXhrGenerateStream` —
 *  can serve as `ClientOptions.streamTransport` (design D2). */
type StreamTransport = (
  opts: ClientOptions,
  request: GenerateRequest,
  signal: AbortSignal | undefined,
) => Promise<ResponseBodyReader | 'aborted'>;

/** Per-request client config. `deviceId` is attached as the `x-whim-device` header on every
 *  call (spec "Every server request carries a persisted anonymous device identity").
 *
 *  `appInfo` and `consent` are the rest of the client envelope every `/v1` request carries
 *  (request-envelope spec "Every /v1 request carries the client envelope"). `appInfo` is a reader,
 *  not the values: `requestHeaders` calls it each time it builds a request and never before, so a
 *  build missing the native module fails that request (a `client` error) instead of the render
 *  that made these options, and never sends a partial envelope. `consent` is the consent version
 *  the request is sent under — the current grant's, or `'none'` when there is no grant (only a
 *  report can be sent without one).
 *
 *  `streamTransport` overrides the module's own runtime capability determination for
 *  `POST /v1/generate` (design D1/D2) — it is what lets the acceptance suite drive the XHR
 *  transport directly, against a fake `XMLHttpRequest`, instead of only ever exercising Node's
 *  native streaming `fetch`. Independent of `fetchImpl`, which only affects the unary
 *  `rewritePrompt` call and the fetch-based stream path's own request when it is in effect.
 *
 *  `connectTimeoutMs` overrides the shared connect / first-event window (`CONNECT_TIMEOUT_MS`)
 *  applied by both stream transports.
 *
 *  `onKeepalive` fires once per SSE comment-only block (the server's `: keepalive\n\n` frame,
 *  `server/src/main.ts` `keepaliveMs: 15_000`) — build-liveness B2: a keepalive is transport noise,
 *  never a `GenerationEvent`, so it is a plain callback here rather than a new union arm. Both
 *  transports feed it through the SAME `generateApp` SSE-block parser
 *  (`generation-client.ts#parseSseBlock`/`framesIn`), so this one option point covers the fetch
 *  path and the XHR path identically — neither transport module parses SSE framing itself. */
export interface ClientOptions {
  baseUrl: string;
  deviceId: string;
  appInfo: () => AppInfo;
  consent: ConsentVersion;
  fetchImpl?: typeof fetch;
  streamTransport?: StreamTransport;
  connectTimeoutMs?: number;
  onKeepalive?: () => void;
}

/** The connect / first-event window for `POST /v1/generate` (design "flow-wait-hygiene" D2):
 *  request start → first byte/event only, NEVER the stream's lifetime. Once the first event is
 *  observed both transports disarm, so a long generation runs indefinitely. Overridable per
 *  request through `ClientOptions.connectTimeoutMs` solely so the acceptance suites can drive the
 *  window in milliseconds instead of sleeping fifteen seconds; production callers never set it. */
/** Unexported brand key — see `ConsentedClientOptions` below. Nothing outside this module can
 *  spell this symbol, so a plain object literal can never structurally satisfy the branded type
 *  by accident. */
declare const CONSENTED: unique symbol;

/** A `ClientOptions` proven to have been built from a CURRENT terms acceptance and a CURRENT
 *  AI-data consent grant (design D2; legal-surface-v2 design D5; spec ai-data-consent "Request
 *  options for clarify, rewrite, generate and connectivity probes SHALL come from one gate that
 *  yields nothing without a current grant, so a call site cannot build a request that skips it";
 *  spec terms-acceptance "The send gate requires both a terms acceptance and a consent grant").
 *  `consentedClientOptions` below is the only constructor. `sendReport` is the deliberate
 *  exception (design D3) and keeps taking plain `ClientOptions`. */
export type ConsentedClientOptions = ClientOptions & { readonly [CONSENTED]: true };

/** The one gate `clarifyPrompt`, `rewritePrompt`, `generateApp` and the connectivity probe require
 *  their options through. Returns `null` unless `terms.kind === 'accepted'` AND
 *  `consent.kind === 'granted'` — a missing or outdated acceptance, or a missing or outdated grant,
 *  yields no options, so a caller has nothing to send a request with. The options it does yield
 *  carry the grant's version as their `consent`, so a gated request can never say `none`. */
export function consentedClientOptions(
  terms: TermsStatus,
  consent: ConsentStatus,
  baseUrl: string,
  deviceId: string,
  appInfo: () => AppInfo,
): ConsentedClientOptions | null {
  if (terms.kind !== 'accepted' || consent.kind !== 'granted') {
    return null;
  }
  return { baseUrl, deviceId, appInfo, consent: consent.version } as ConsentedClientOptions;
}

/** The options `sendReport` takes (design D3: a report needs no grant and no terms acceptance, so
 *  this never gates): the current grant's version as `consent` when there is one, `'none'`
 *  otherwise. */
export function reportClientOptions(
  status: ConsentStatus,
  baseUrl: string,
  deviceId: string,
  appInfo: () => AppInfo,
): ClientOptions {
  return { baseUrl, deviceId, appInfo, consent: status.kind === 'granted' ? status.version : 'none' };
}

export const CONNECT_TIMEOUT_MS = 15_000;

export function connectTimeoutOf(opts: ClientOptions): number {
  return opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
}

/** The hint carried by the `GenerationClientError{kind:'network'}` both transports raise when the
 *  connect window expires — a hung connect is a network failure, never an in-progress stream. */
export const CONNECT_TIMEOUT_HINT = 'The generate request timed out before the first event';

export type GenerationClientErrorKind = 'network' | 'device_id' | 'http' | 'stream_parse' | 'client';

/**
 * - `network`    — the request itself failed (fetch threw, not an abort).
 * - `device_id`  — the server rejected the `x-whim-device` header (400, `DeviceIdError` body).
 * - `http`       — any other non-2xx response.
 * - `stream_parse` — a `generateApp` SSE frame failed JSON parsing or `GenerationEvent`
 *   validation.
 * - `client`     — the request could not be built, so nothing was sent: the installed app's
 *   version could not be read (`requestHeaders`). `hint` is the reader's own message.
 *
 * `code` and `retryAfterSeconds` are `http`-only (store-launch-compliance design D8/D11):
 * `code` is the body's `ApiError.error` identifier, present only when the body structurally
 * validates as `ApiError`; `retryAfterSeconds` is the response's `Retry-After` header, present
 * only when it is a positive integer. Both are `undefined` on every other `kind`. `requestId` is
 * the response's `x-whim-request-id` (request-envelope D6), so only an error the server answered
 * (`http`/`device_id`) can carry one.
 */
export class GenerationClientError extends Error {
  readonly kind: GenerationClientErrorKind;
  readonly status?: number;
  readonly hint?: string;
  readonly code?: string;
  readonly retryAfterSeconds?: number;
  readonly requestId?: string;

  constructor(
    kind: GenerationClientErrorKind,
    opts?: { status?: number; hint?: string; code?: string; retryAfterSeconds?: number; requestId?: string },
  ) {
    super(opts?.hint ?? kind);
    this.name = 'GenerationClientError';
    this.kind = kind;
    this.status = opts?.status;
    this.hint = opts?.hint;
    this.code = opts?.code;
    this.retryAfterSeconds = opts?.retryAfterSeconds;
    this.requestId = opts?.requestId;
  }
}

/** Build the headers of a `/v1` request — `content-type`, `x-whim-device` and the four envelope
 *  headers — shared by every `/v1` call and both stream transports, so no path can drift in how it
 *  builds them (design D2 mitigation). Only `/v1` calls use this; `/healthz` sends none of it.
 *
 *  The installed app's version is read here, per request. A reader that throws fails the request
 *  before anything is sent — `GenerationClientError{kind:'client'}`, with a breadcrumb for `path`
 *  — rather than sending the request with part of the envelope, or none. */
export function requestHeaders(opts: ClientOptions, path: string): Record<string, string> {
  let app: AppInfo;
  try {
    app = opts.appInfo();
  } catch (err) {
    const hint = err instanceof Error ? err.message : String(err);
    logMappedError(path, opts.baseUrl, 'client', { message: hint });
    throw new GenerationClientError('client', { hint });
  }
  return {
    'content-type': 'application/json',
    'x-whim-device': opts.deviceId,
    [PLATFORM_HEADER]: app.platform,
    [APP_VERSION_HEADER]: app.version,
    [BUILD_HEADER]: String(app.build),
    [CONSENT_HEADER]: String(opts.consent),
  };
}

/** route path only (no query/body) */
function hostPortOf(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, '');
}

/** Breadcrumb for every GenerationClientError mapping site across both transports, on the seam's
 *  generation channel: path, host:port, kind, status, readyState and detail are NAMED FIELDS, not
 *  a formatted line, so a reader can filter on them (spec "A breadcrumb carries structure, not a
 *  formatted string"). NEVER pass prompt/body text, the x-whim-device value, or the API key here. */
export function logMappedError(
  path: string,
  baseUrl: string,
  kind: GenerationClientErrorKind,
  detail?: { status?: number; readyState?: number; message?: string },
): void {
  log.error(CHANNELS.gen, 'transport failed', {
    path,
    host: hostPortOf(baseUrl),
    kind,
    status: detail?.status,
    readyState: detail?.readyState,
    detail: detail?.message,
  });
}

/** Build the `GenerationClientError` for a non-ok `Response`: `device_id` when the body matches
 *  the device-identity middleware's `DeviceIdError` shape, `http` otherwise (carrying `hint`
 *  when the body has one, e.g. the `invalid_request` shape the route handlers return). Logs a
 *  generation-channel dev breadcrumb immediately before returning either mapped error (`logMappedError`
 *  above), attributed to `path`/`baseUrl` so both transports' call sites are traceable. */
export async function httpErrorFrom(response: Response, path: string, baseUrl: string): Promise<GenerationClientError> {
  const bodyJson: unknown = await response.json().catch(() => null);
  const requestId = requestIdOf(response.headers);
  if (isDeviceIdError(bodyJson)) {
    logMappedError(path, baseUrl, 'device_id', { status: response.status, message: bodyJson.hint });
    return new GenerationClientError('device_id', { status: response.status, hint: bodyJson.hint, requestId });
  }
  const hint =
    bodyJson !== null && typeof bodyJson === 'object' && typeof (bodyJson as Record<string, unknown>).hint === 'string'
      ? ((bodyJson as Record<string, unknown>).hint as string)
      : undefined;
  const code = isApiErrorBody(bodyJson) ? bodyJson.error : undefined;
  const retryAfterSeconds = retryAfterSecondsOf(response);
  logMappedError(path, baseUrl, 'http', { status: response.status, message: hint });
  return new GenerationClientError('http', { status: response.status, hint, code, retryAfterSeconds, requestId });
}
