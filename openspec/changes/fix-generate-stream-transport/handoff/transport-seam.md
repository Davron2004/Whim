# chain-1 handoff: launcher-transport-prereqs

Interface only. Source: `src/host/launcher/generation-client.ts` after chain-1's edits.

## 1. `ResponseBodyReader` (verbatim, unchanged by chain-1)

```ts
declare global {
  interface ResponseBodyReader {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
  }
  interface Body {
    readonly body: { getReader(): ResponseBodyReader } | null;
  }
}
```

`openGenerateStream` returns `Promise<ResponseBodyReader | 'aborted'>`. Any conforming
`ResponseBodyReader` producer (XHR-backed or otherwise) can replace the current
`response.body.getReader()` call without touching `readNext`, `generateApp`, `parseSseBlock`,
or the `GenerationEvent` guards downstream of it.

## 2. `ClientOptions` (verbatim, unchanged by chain-1 — chain-3 adds the stream-transport hook)

```ts
export interface ClientOptions {
  baseUrl: string;
  deviceId: string;
  fetchImpl?: typeof fetch;
}
```

## 3. Header-construction helper (new, task 1.2)

```ts
function requestHeaders(opts: ClientOptions): Record<string, string> {
  return { 'content-type': 'application/json', 'x-whim-device': opts.deviceId };
}
```

Not exported (module-private). Used by both `rewritePrompt`'s `fetchImpl(...)` call and
`openGenerateStream`'s `fetchImpl(...)` call as the `headers` option, replacing the two
previously-inlined literals. This is the single place header construction happens — the XHR
transport chain-2 writes should call this same helper (it will need to be exported, or its body
copied verbatim — see note below) to set `content-type`/`x-whim-device` on its request, so the
two injection seams cannot drift.

**Note for chain-2/chain-3:** `requestHeaders` is currently module-private in
`generation-client.ts`. If the XHR transport module lives outside this file, export
`requestHeaders` (a one-line visibility change, same pattern as `httpErrorFrom` below) rather
than reimplementing header construction.

## 4. `httpErrorFrom` (now exported — visibility change only, behavior byte-identical)

```ts
export async function httpErrorFrom(response: Response): Promise<GenerationClientError>
```

Classification performed, given a non-`ok` `Response`:
- Attempts `response.json()`, swallowing parse failure to `null`.
- If the body matches `DeviceIdError` shape (`error` is `'missing_device_id'` or
  `'invalid_device_id'`, `hint` a non-empty string) → `GenerationClientError('device_id', { status:
  response.status, hint: bodyJson.hint })`.
- Otherwise → `GenerationClientError('http', { status: response.status, hint })`, where `hint` is
  `bodyJson.hint` if `bodyJson` is a record with a string `hint` field, else `undefined`.

The later transport module (chain-2) MUST call this exact function for its own non-2xx
classification rather than reimplementing it, to keep the `device_id`/`http` taxonomy from
drifting between the unary and streaming paths.

## 5. Task 1.1 — TextEncoder availability on the launcher path: RESOLVED

**Yes** — the launcher path already transitively invokes `installHermesPolyfills()` (which is a
run-on-import side effect, `src/host/version-store/polyfills.ts:45`) before generation can run,
via a static ES-module import chain:

- `src/host/launcher/LauncherRoot.tsx:25` — `import { createPersistentStore } from
  '../version-store';` (static, evaluated at module load, independent of whether generation ever
  runs)
- `src/host/version-store/index.ts:16` — `import { VersionStore } from './engine';`
- `src/host/version-store/engine.ts:22` — `import './polyfills';`
- `src/host/version-store/polyfills.ts:45` — `installHermesPolyfills();` runs on import.

Static import evaluation order guarantees this side effect completes before any of
`LauncherRoot`'s own code (including the generation call site) executes. Separately,
`polyfills.ts`'s own comment (`src/host/version-store/polyfills.ts:38`) states Hermes ships
`TextEncoder` natively — only `TextDecoder` is polyfilled — so `TextEncoder` is available on this
runtime independent of the installer running at all.

**Consequence for chain-2:** the XHR transport module does NOT need to call
`installHermesPolyfills()` itself or import `polyfills.ts`. It may rely on `TextEncoder` being
present when invoked from the launcher path.

## 6. `GenerationClientError` / `GenerationClientErrorKind` (verbatim, unchanged)

```ts
export type GenerationClientErrorKind = 'network' | 'device_id' | 'http' | 'stream_parse';

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
```
