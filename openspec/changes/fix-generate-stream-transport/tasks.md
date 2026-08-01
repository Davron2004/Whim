## 1. Transport seam

- [x] 1.1 Confirm whether the launcher path already invokes `src/host/version-store/polyfills.ts`'s installer before generation runs (design open question 1). If it does not, make the transport module ensure `TextEncoder` availability itself rather than assuming it.
- [x] 1.2 Extract the shared request-header construction (`content-type`, `x-whim-device`) in `src/host/launcher/generation-client.ts` into one helper used by both the unary and streaming paths, so the two injection seams cannot drift (design D2 mitigation).
- [x] 1.3 Add the optional stream-transport hook to `ClientOptions` alongside `fetchImpl`, typed to return `Promise<ResponseBodyReader | 'aborted'>` — the exact shape `openGenerateStream` already returns. Leave `fetchImpl` and `rewritePrompt` untouched.
- [x] 1.4 Add the module-level capability determination that selects the streaming transport before any request is issued, and wire `openGenerateStream` to use the injected hook when present, the determined default otherwise. Do NOT inspect `response.body` after awaiting `fetch` — design D1 records why that path double-bills every generation.
- [x] 1.5 Correct the false claim in `generation-client.ts`'s `declare global` doc comment (currently asserts RN 0.85 fetch streams response bodies) and rewrite the block to describe what the runtime actually provides.

## 2. XHR streaming transport

- [x] 2.1 Create the XHR-backed transport module under `src/host/launcher/`, exposing a function that opens `POST /v1/generate` and returns a `ResponseBodyReader`-conforming reader.
- [x] 2.2 Enable incremental delivery by setting `onreadystatechange`/`onprogress` (RN enables incremental events only when one is set — `XMLHttpRequest.js:557`), and slice new text off the accumulated `responseText` by character offset, never off per-chunk deltas (design D3 — accumulation is what heals a split multi-byte character).
- [x] 2.3 Encode each sliced text segment to `Uint8Array` via `TextEncoder` so the reader satisfies `ResponseBodyReader.read(): Promise<{done, value?: Uint8Array}>` and `generateApp`'s buffering loop stays byte-identical.
- [x] 2.4 Map non-2xx responses through the same classification `httpErrorFrom` performs — `device_id` for a `DeviceIdError` body, `http` otherwise, carrying `status` and `hint`.
- [x] 2.5 Map transport-level failures (`onerror`, `ontimeout`) to `GenerationClientError{kind:'network'}`.
- [x] 2.6 Wire `AbortSignal` to `xhr.abort()` and surface the same `'aborted'` sentinel `openGenerateStream`/`readNext` already use, so iteration ends silently with no terminal event and no throw.
- [x] 2.7 Verify nothing below the seam changed: `readNext`, `generateApp`, `parseSseBlock`, and the `GenerationEvent` guards must be untouched by this change.

## 3. Acceptance coverage

- [x] 3.1 Build a fake `XMLHttpRequest` for the Node suite modeled on the observable contract in `react-native/Libraries/Network/XMLHttpRequest.js` — readyState transitions, accumulated `responseText`, `abort()`, status/headers.
- [x] 3.2 Add transport tests for incremental delivery, keepalive-comment skipping, and a multi-byte UTF-8 character split across two deliveries decoding intact.
- [x] 3.3 Add transport tests for the error taxonomy: `device_id` on a `DeviceIdError` 400, `http` on other non-2xx, `network` on transport failure, `stream_parse` on a malformed frame.
- [x] 3.4 Add a transport test for abort: iteration ends silently, no further events, no throw, and the underlying request is actually aborted.
- [x] 3.5 Add the negative control required by the spec — a case that fails if the transport is changed to yield all events only after the response completes. Red-check it by actually making that change and confirming the suite fails.
- [x] 3.6 Add a test asserting exactly one `POST /v1/generate` request is issued per generation on a non-streaming-`fetch` runtime (guards against the rejected double-request fallback ever being reintroduced).
- [x] 3.7 Confirm the existing `generation-client.suite.ts` cases still pass unmodified, proving the fetch path and everything below the seam were not disturbed.

## 4. Server dev logging

- [x] 4.1 Add minimal per-request dev logging to the generation server (method, path, status, duration) so an arrived-and-completed request is distinguishable from one that never arrived. Keep it out of the response path's hot loop and do not log request or response bodies.

## 5. Docs

- [x] 5.1 Append decision #58 to `docs/decisions.md` (current tail is #57, `eval-harness`) recording that RN 0.85's `fetch` is `whatwg-fetch` over XHR with no streaming body, that `/v1/generate` uses XHR incremental delivery, and why post-hoc fallback and body-shimming were both rejected.
- [x] 5.2 Correct `contract/src/index.ts:8-11`'s transport-notes doc comment, which currently asserts RN's fetch streams responses.
- [x] 5.3 Add the `generation-stream-transport` capability to `docs/capabilities.md` pointing at its spec.

## 6. On-device verification

- [ ] 6.1 Build and install the offline release APK (`npm run android:release`) and run a real generation end to end on the emulator against the dev server.
- [ ] 6.2 Confirm stage/token events render progressively in `GeneratingScreen` rather than appearing all at once at completion — this is the claim the Node fake cannot settle (design risk 2).
- [ ] 6.3 Generate an app whose output contains non-ASCII characters and confirm no replacement characters appear, exercising the multi-byte split path on the real native layer (design risk 1).
- [ ] 6.4 Cancel a generation mid-stream on-device and confirm the request is aborted and the UI returns cleanly with no install.
- [ ] 6.5 If incremental delivery does not fire on RN 0.85.3 Android, report it explicitly rather than accepting a non-streaming UI silently (design open question 3).
