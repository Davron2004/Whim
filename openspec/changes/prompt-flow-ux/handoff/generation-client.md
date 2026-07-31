# handoff: generation-client (chain-1)

`src/host/launcher/device-id.ts` and `src/host/launcher/generation-client.ts`. Import via
relative path from `../device-id` / `../generation-client` (launcher-local, not a new
workspace — `@whim/contract` is imported inside `generation-client.ts` only).

## `device-id.ts`

```ts
export function getDeviceId(kv: KVBackend): string
```
Reads `whim.device:v1` from `kv` (the same `KVBackend` — `../version-store/fs/kv-fs` —
`LauncherRoot`'s shared `whim.launcher` MMKV instance uses for the app index/theme pref);
generates + persists a UUID-v4-shaped id via `crypto.randomUUID()` (feature-detected) or a
`Math.random` fallback on first call. Idempotent: every later call over the same `kv` returns
the identical string, including across a fresh `KVBackend` instance wrapping the same backing
store (process restart).

## `generation-client.ts`

```ts
export interface ClientOptions {
  baseUrl: string;       // e.g. from SettingsScreen's server-url pref (D3)
  deviceId: string;       // from getDeviceId(kv) — attached as x-whim-device on every call
  fetchImpl?: typeof fetch; // defaults to global fetch; inject a canned impl in tests
}

export type GenerationClientErrorKind = 'network' | 'device_id' | 'http' | 'stream_parse';

export class GenerationClientError extends Error {
  readonly kind: GenerationClientErrorKind;
  readonly status?: number;   // HTTP status, when kind is 'device_id' or 'http'
  readonly hint?: string;     // user-safe hint text, when the server/frame provided one
  constructor(kind: GenerationClientErrorKind, opts?: { status?: number; hint?: string });
}

export async function rewritePrompt(opts: ClientOptions, prompt: string): Promise<RewriteResponse>;

export function generateApp(
  opts: ClientOptions,
  request: GenerateRequest,          // @whim/contract
  signal?: AbortSignal,
): AsyncIterable<GenerationEvent>;    // @whim/contract — stage/token/diagnostic/usage/result/failure
```

### Error kinds — when each fires
- `network` — `fetch` itself threw (not an abort), the read loop failed mid-stream (not an
  abort), or a 200 response had no body.
- `device_id` — a non-2xx response whose JSON body matches `DeviceIdError` (`@whim/contract`:
  `{error: 'missing_device_id'|'invalid_device_id', hint}`). `hint` is the server's hint.
- `http` — any other non-2xx response (`hint` populated when the body has a string `hint`
  field, e.g. the `invalid_request` shape `/v1/rewrite` and `/v1/generate` return on a bad
  body); also used for a 200 `/v1/rewrite` body that fails `RewriteResponse` shape validation.
- `stream_parse` — a `generateApp` SSE block's `data:` JSON failed to parse or failed
  `GenerationEvent` shape validation. Only ever raised by `generateApp`, never `rewritePrompt`.

### Validation mechanism (guard:metro)
`@whim/contract` is imported **type-only** (`import type`) — zod's dist uses `export * from`
namespace syntax RN's babel config can't transform, so importing the zod schema *values* would
break `guard:metro`. `generation-client.ts` instead validates `DeviceIdError`/`RewriteResponse`/
`GenerationEvent` with local hand-rolled structural guards that mirror `contract/src/index.ts`'s
zod shapes field-for-field. Observable behavior (which `GenerationClientErrorKind` each failure
raises) is unchanged from a zod-backed implementation.

### Abort semantics (consumer contract)
Passing `signal` and calling `.abort()` makes `generateApp`'s iteration end **silently** —
the `for await` loop just stops (no thrown error, no terminal `result`/`failure` event
observed). Per spec ("Stream error before any terminal event"), the CALLER is responsible for
distinguishing "loop ended because I aborted it" from "loop ended with no terminal event for
some other reason" (both look identical from `generateApp`'s output: a truncated event
sequence with no `result`/`failure`) — track cancellation intent on the caller's own flag/ref
before calling `.abort()`, don't infer it from `generateApp`'s behavior.

### Rendering discipline (spec, not enforced by this file)
`generateApp` yields raw `GenerationEvent`s including `token.text` and
`diagnostic.kind`/`diagnostic.symbol` — this module does NOT filter them. The spec constraint
("Token and diagnostic internals never render live") is a UI-layer obligation for whatever
consumes this iterable (`GeneratingScreen`/`LauncherRoot`, per design D1): render only `stage`
events live, and on a `failure` event render `reason` + each diagnostic's `hint` only.
