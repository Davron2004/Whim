# chain-2 handoff: launcher-xhr-transport

Interface only. Source: `src/host/launcher/xhr-transport.ts` (new file).

## 1. Exported function signature (verbatim)

```ts
export async function openXhrGenerateStream(
  opts: ClientOptions,
  request: GenerateRequest,
  signal: AbortSignal | undefined,
  createXhr: () => XMLHttpRequest = () => new XMLHttpRequest(),
): Promise<ResponseBodyReader | 'aborted'>
```

`ClientOptions` and `ResponseBodyReader` are the exact types from `handoff/transport-seam.md`
(unchanged). `createXhr` is the sole test injection point — it defaults to the global
constructor and exists so tests never mutate `globalThis.XMLHttpRequest`.

## 2. Return type / relation to `ResponseBodyReader | 'aborted'`

Identical shape and settlement semantics to `generation-client.ts`'s private
`openGenerateStream` — this function is a drop-in replacement chain-3 wires behind the
capability probe:
- Resolves a `ResponseBodyReader` as soon as the response status is known to be 2xx (at
  `HEADERS_RECEIVED`, before any body bytes arrive).
- Resolves `'aborted'` if `signal` fired before that point (including if already aborted when
  called — no XHR is ever created in that case).
- Otherwise rejects (throws, once awaited) with a `GenerationClientError`.

## 3. Error classification

| Condition | When decided | `kind` | `status` / `hint` source |
|---|---|---|---|
| `signal.aborted` before/while opening | before any 2xx decision | resolves `'aborted'`, does not throw | n/a |
| `xhr.onerror` / `xhr.ontimeout` before a reader is handed back | before `decide()` resolves ok | `network` | `hint`: fixed string (`'The generate request failed'` / `'...timed out'`) — XHR's error/timeout events carry no message |
| non-2xx `xhr.status` at `onload` (full body available) | after `decide()` sees `ok === false` | `device_id` or `http`, via `httpErrorFrom` unchanged | delegated entirely to `httpErrorFrom` — see `transport-seam.md` §4 |
| `xhr.onabort` / `xhr.onerror` / `xhr.ontimeout` **after** the reader was already returned | mid-stream | surfaces via `reader.read()` rejecting, not via this function's promise | abort: `Error` named `'AbortError'` (message `'The generate request was aborted'`) → `generation-client.ts`'s existing `readNext` maps it to `'aborted'`. Other failures: plain `Error(hint)` → `readNext` wraps it into `GenerationClientError{kind:'network', hint: err.message}` itself — this module does **not** construct `GenerationClientError` for the mid-stream case, to avoid a second classification path. |

`stream_parse` is never produced here — it belongs entirely to `parseSseBlock`, below the seam.

Non-2xx classification always happens via `httpErrorFrom({ status: xhr.status, json: async () =>
JSON.parse(xhr.responseText) } as unknown as Response)` — a minimal adapter, not a real
`Response`. Chain-3/4 should not expect any other `Response` member to exist on it.

## 4. Abort surface

- **Before any status is known** (open→send→headers-received gap): `onabort` resolves the
  outer promise with `'aborted'`. Caller (`generateApp`) sees a reader that never came to be and
  returns immediately — no throw, no event.
- **After the reader was handed back** (status was 2xx): `onabort` instead delivers an
  `AbortError`-named `Error` to the reader's next (or currently pending) `read()` call. The
  existing `readNext`/`generateApp` in `generation-client.ts` already turn that into silent
  iteration end — untouched by this chain.
- **Wiring:** the module adds one `signal.addEventListener('abort', () => xhr.abort(), { once:
  true })` at open time and removes it once the stream reaches any terminal state (success,
  error, or abort) — abort after completion is a documented no-op in RN's `XMLHttpRequest.abort()`
  (it checks `readyState === DONE` and skips re-firing events), so no defensive guard was needed
  beyond that.
- There is exactly one terminal transition per request: `finished`/`opened` booleans inside the
  closure guard every terminal handler (`finishOk`/`finishAbort`/`finishTransportError`/
  `finishHttpError`) against double-invocation, in case a fake XHR fires more than one terminal
  event.

## 5. Assumed `XMLHttpRequest` surface — build the fake to satisfy exactly this

**Constructed via:** `createXhr()` (test seam), otherwise `new XMLHttpRequest()`.

**Methods called, in this order:** `open('POST', url, true)` → `setRequestHeader(name, value)`
(once per header from `requestHeaders(opts)`) → handlers assigned (see below) → `send(bodyJsonString)`.
On abort: `abort()` is called exactly once, only via the module's own `signal` listener.

**Properties read:**
- `status` (number) — read inside `decide()` (called from `onreadystatechange` and defensively
  from `onprogress`/`onload`) and inside `finishHttpError`'s adapter object. Must be `0` before
  headers arrive and the real HTTP status from `HEADERS_RECEIVED` onward.
- `responseText` (string) — read on every `onprogress`/`onload`. Must be the FULL text
  accumulated so far (not a delta) — the module slices by character offset itself (design D3).
- `readyState` (number) — read only inside `onreadystatechange`, compared against `HEADERS_RECEIVED`.
- `HEADERS_RECEIVED` (number) — read as an **instance** property (real RN sets both the static
  and instance versions to `2`); the fake must expose it on the instance, not only statically.

**Handlers set (all optional single-callback properties, never `addEventListener`):**
`onreadystatechange`, `onprogress`, `onload`, `onerror`, `ontimeout`, `onabort`. The fake must
invoke each at least once for the corresponding real-XHR transition it simulates; the module
never reads `onloadstart`/`onloadend`/`upload`/`responseType`/`getAllResponseHeaders`/
`withCredentials`/`timeout`, so the fake need not implement them for this module's tests (chain-4
may still need them for its own realism goals, but this module places no requirement on them).

**Never called or read:** `getResponseHeader`, `getAllResponseHeaders`, `responseURL`,
`response` (non-text), `timeout` (value), `withCredentials`, `upload`, `addEventListener`.
