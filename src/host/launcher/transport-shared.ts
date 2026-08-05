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

import type { DeviceIdError, GenerateRequest } from '@whim/contract';

declare global {
  interface ResponseBodyReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
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
 *  `streamTransport` overrides the module's own runtime capability determination for
 *  `POST /v1/generate` (design D1/D2) — it is what lets the acceptance suite drive the XHR
 *  transport directly, against a fake `XMLHttpRequest`, instead of only ever exercising Node's
 *  native streaming `fetch`. Independent of `fetchImpl`, which only affects the unary
 *  `rewritePrompt` call and the fetch-based stream path's own request when it is in effect. */
export interface ClientOptions {
  baseUrl: string;
  deviceId: string;
  fetchImpl?: typeof fetch;
  streamTransport?: StreamTransport;
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

/** Build the `content-type: application/json` + `x-whim-device` request headers shared by both
 *  the unary (`rewritePrompt`) and streaming (`openGenerateStream`) request paths, so the two
 *  injection seams cannot drift in how they construct headers (design D2 mitigation). Exported
 *  so `xhr-transport.ts` (chain-2) can reuse it rather than reimplementing header construction. */
export function requestHeaders(opts: ClientOptions): Record<string, string> {
  return { 'content-type': 'application/json', 'x-whim-device': opts.deviceId };
}

/** route path only (no query/body) */
function hostPortOf(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, '');
}

/** Dev breadcrumb for every GenerationClientError mapping site across both transports.
 *  NEVER pass prompt/body text, the x-whim-device value, or the API key here. */
export function logMappedError(
  path: string,
  baseUrl: string,
  kind: GenerationClientErrorKind,
  detail?: { status?: number; readyState?: number; message?: string },
): void {
  console.log(
    '[whim:gen]',
    path,
    hostPortOf(baseUrl),
    `kind=${kind}`,
    detail?.status !== undefined ? `status=${detail.status}` : 'status=-',
    detail?.readyState !== undefined ? `readyState=${detail.readyState}` : 'readyState=-',
    detail?.message ? `detail=${detail.message}` : 'detail=-',
  );
}

/** Build the `GenerationClientError` for a non-ok `Response`: `device_id` when the body matches
 *  the device-identity middleware's `DeviceIdError` shape, `http` otherwise (carrying `hint`
 *  when the body has one, e.g. the `invalid_request` shape the route handlers return). Logs a
 *  `[whim:gen]` dev breadcrumb immediately before returning either mapped error (`logMappedError`
 *  above), attributed to `path`/`baseUrl` so both transports' call sites are traceable. */
export async function httpErrorFrom(response: Response, path: string, baseUrl: string): Promise<GenerationClientError> {
  const bodyJson: unknown = await response.json().catch(() => null);
  if (isDeviceIdError(bodyJson)) {
    logMappedError(path, baseUrl, 'device_id', { status: response.status, message: bodyJson.hint });
    return new GenerationClientError('device_id', { status: response.status, hint: bodyJson.hint });
  }
  const hint =
    bodyJson !== null && typeof bodyJson === 'object' && typeof (bodyJson as Record<string, unknown>).hint === 'string'
      ? ((bodyJson as Record<string, unknown>).hint as string)
      : undefined;
  logMappedError(path, baseUrl, 'http', { status: response.status, message: hint });
  return new GenerationClientError('http', { status: response.status, hint });
}
