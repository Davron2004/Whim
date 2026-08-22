# Contract — chain-1 `transport-cancel-timeout`

Interface produced for chain-2 (screen wiring). Modules: `src/host/launcher/generation-client.ts`,
`src/host/launcher/xhr-transport.ts`, `src/host/launcher/transport-shared.ts`.

## Signatures (verbatim)

```ts
export async function clarifyPrompt(
  opts: ClientOptions,
  prompt: string,
  signal?: AbortSignal,
): Promise<ClarifyResponse>;

export async function rewritePrompt(
  opts: ClientOptions,
  prompt: string,
  clarifications: readonly Clarification[] = [],
  signal?: AbortSignal,
): Promise<RewriteResponse>;

export async function* generateApp(
  opts: ClientOptions,
  request: GenerateRequest,
  signal?: AbortSignal,
): AsyncIterable<GenerationEvent>; // unchanged
```

`ClientOptions` (`transport-shared.ts`) gains one optional field:

```ts
export interface ClientOptions {
  baseUrl: string;
  deviceId: string;
  fetchImpl?: typeof fetch;
  streamTransport?: StreamTransport;
  connectTimeoutMs?: number; // TEST SEAM ONLY — production callers never set it
}

export const CONNECT_TIMEOUT_MS = 15_000;
export const CONNECT_TIMEOUT_HINT = 'The generate request timed out before the first event';
export function connectTimeoutOf(opts: ClientOptions): number;
```

## Invariants

- `signal` is threaded into the underlying request on both unary endpoints. Aborting it cancels
  the in-flight request; nothing else about either endpoint changed.
- The connect window on `POST /v1/generate` covers **request start → first byte/event only**, on
  BOTH transports (`fetch` and `XMLHttpRequest`). Once the first event is observed the window is
  disarmed permanently — a long generation streams indefinitely. There is no overall duration
  timeout anywhere.
- Every timer is cleared on every exit path (first chunk, stream end, abort, HTTP error,
  transport error): no dangling `setTimeout`.
- The XHR transport does **not** arm `xhr.timeout`. RN reads `this.timeout` once at `send()`
  (never re-read, so it could not be disarmed) and Android maps it to OkHttp `callTimeout`, which
  bounds the whole call including the body read — arming it would kill any generation streaming
  longer than the window. The window is a JS `setTimeout` that calls the existing
  network-classifying failure path and then `xhr.abort()`. `xhr.ontimeout` remains wired.

## Error surface (what chain-2 must handle)

| Situation | What callers see |
| --- | --- |
| `clarifyPrompt` / `rewritePrompt` aborted via `signal` | the original `AbortError` (`err.name === 'AbortError'`) rethrown as-is — **not** a `GenerationClientError`, and no `network` breadcrumb is logged. Screens leaving compose/plan should swallow it. |
| `generateApp` aborted via `signal` | unchanged: iteration ends silently, no terminal event, no throw. |
| No first event within the connect window (either transport) | `GenerationClientError{ kind: 'network', hint: CONNECT_TIMEOUT_HINT }`, thrown from the iteration; one `logMappedError('/v1/generate', …, 'network')` breadcrumb. Never presented as in-progress. |
| Everything else (`http`, `device_id`, `stream_parse`) | unchanged. |
