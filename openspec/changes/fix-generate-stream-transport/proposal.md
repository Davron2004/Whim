## Why

Every on-device generation fails. `POST /v1/generate` never yields a single event on the Android emulator — the user sees "Couldn't build this app / Response has no body" after the spinner runs, because React Native 0.85.3's global `fetch` is the `whatwg-fetch` polyfill over `XMLHttpRequest` and has no streaming response body at all (`Response.prototype.body` is never defined; `grep -c "ReadableStream" node_modules/whatwg-fetch/dist/fetch.umd.js` is 0). `src/host/launcher/generation-client.ts:290` guards on exactly that and throws. The generate path has therefore never worked on a real device, and the failure is silent in logcat because the error is caught and rendered rather than logged.

The premise that put it there is written down in two places as fact — `generation-client.ts:139-145` ("fetch on Hermes/new-arch DOES stream response bodies (RN 0.85)") and `contract/src/index.ts:8-11`'s transport notes — so the correction has to land in the docs, not just the code, or it will be re-derived wrong a third time.

## What Changes

- **Add an XHR-backed streaming transport** for `POST /v1/generate`, satisfying the existing `ResponseBodyReader` seam (`read(): Promise<{done, value?: Uint8Array}>`) so `generateApp`'s SSE framing, raw-byte buffering, block-index tracking and `GenerationEvent` validation are untouched. RN's `XMLHttpRequest` supports true incremental delivery (`XMLHttpRequest.js:370` `__didReceiveIncrementalData`, auto-enabled once `onreadystatechange`/`onprogress` is set at line 557).
- **Select the transport before the request is issued**, via an explicit capability probe — never as a post-hoc fallback after `fetch` resolves. See Design Constraint below; this is the load-bearing correction to the research digest's open question 1.
- **Generalize the injection seam**: `ClientOptions` gains an optional stream-transport hook alongside `fetchImpl`, so the on-device path is exercisable under Node instead of being structurally untestable.
- **Close the test blind spot.** `generation-client.suite.ts` injects Node `Response` objects built from real `ReadableStream`s, so it greens a path with no on-device equivalent. Add coverage that drives the XHR transport against a fake `XMLHttpRequest` — including incremental delivery, abort, non-2xx, and a multi-byte UTF-8 character split across progress events — plus a negative control proving the suite fails if the transport stops streaming.
- **Correct the two stale claims**: the `declare global` doc comment in `generation-client.ts` and `contract/src/index.ts`'s transport notes. Record the corrected fact as decision **#58** in `docs/decisions.md` (current tail is #57, `eval-harness`).
- **Add minimal dev request logging** to the generation server. It logs only at startup (`server/src/main.ts:65`), so a request that arrived and ran the full pipeline was indistinguishable from one that never arrived — that ambiguity cost real diagnostic time on this very bug.
- `POST /v1/rewrite` is unary JSON and works today; it is explicitly **not** touched.

### Design Constraint (why the obvious fix is wrong)

`whatwg-fetch` resolves its promise only in `xhr.onload` (line 546) — readyState 4, whole response buffered — and registers no `onprogress` handler at all, so RN never enables incremental events for it. Two consequences:

1. **Capability-detecting on `response.body` after `await fetch(...)` is not viable.** By then the server has already run the entire generation and closed the stream. Falling back to XHR at that point means issuing a **second** `/v1/generate` request — double LLM spend and double latency for every app.
2. **Shimming `body` onto the fetch response cannot work either.** The bytes only exist once the stream is complete, so the UI would jump from empty to done with no stage or token progress — defeating `GeneratingScreen`.

The transport decision must therefore happen up front, off a static feature probe rather than a response inspection.

## Capabilities

### New Capabilities
- `generation-stream-transport`: how the device consumes the `/v1/generate` SSE stream — incremental delivery under React Native, transport selection, abort semantics, and the preserved `network`/`device_id`/`http`/`stream_parse` error taxonomy.

### Modified Capabilities

None. `generation-contract`'s requirements were checked and are all transport-agnostic — "SSE generation event stream schema" constrains the event union and the terminal-event invariant, and "Metro-safe device consumption" constrains Metro resolution; neither asserts how the device reads the stream. The false premise lives only in `contract/src/index.ts:8-11`'s doc comment, which is a code fix, not a requirement change. All spec-level content for this change therefore lands in the new `generation-stream-transport` capability.

### Out of scope (flagged, not fixed here)
- `openspec/changes/prompt-flow-ux/` is still un-archived despite decision #53 marking it BUILT; its `prompt-flow` requirements live in `openspec/changes/`, not `openspec/specs/`. This change routes around it by declaring a new capability rather than writing a delta against an un-archived spec. The archiving gap needs its own resolution.

## Impact

- **Code**: `src/host/launcher/generation-client.ts` (transport seam, corrected doc comment), one net-new transport module under `src/host/launcher/`, `src/host/launcher/test/generation-client.suite.ts` + a new XHR-transport suite, `contract/src/index.ts` (comment only), `server/src/main.ts` or its route layer (dev logging).
- **Not changed**: `LauncherRoot.tsx`, `GeneratingScreen.tsx`, `FailureScreen.tsx`, `copy.ts`, `generation-request.ts`. The two call sites (`LauncherRoot.tsx:260`, `:283`) keep their current signatures, and the `GenerationClientError` shape the failure UI pattern-matches on is preserved exactly.
- **Dependencies**: none added. `TextEncoder` is already available (Hermes native, plus `text-encoding-polyfill` installed by `src/host/version-store/polyfills.ts`) — but that installer is invoked explicitly, so the launcher path must be confirmed to trigger it before the transport relies on it.
- **Docs**: `docs/decisions.md` (#58), and the capability map entry for the new spec.
- **Risk carried into design**: RN's XHR delivers already-decoded *text*, not bytes, so the transport must re-encode to `Uint8Array` to satisfy `ResponseBodyReader`. Whether RN's native Android layer can split a multi-byte UTF-8 character across two incremental chunks is unverified and needs an on-device check, not just a Node test.
