## Context

`POST /v1/generate` has never worked on a real device. `research.md` establishes the terrain: `generation-client.ts` is the only transport module, `LauncherRoot.tsx:260`/`:283` are its only two call sites in the repo, and `openGenerateStream` (private, lines 266-294) is the single seam between "get bytes" and "parse SSE frames". Everything downstream of that seam — `readNext`, the `generateApp` generator, the raw-byte accumulate-and-redecode loop, `parseSseBlock`, the `GenerationEvent` structural guards — is transport-independent and correct.

The failure is entirely above the seam. RN 0.85.3's `fetch` is `whatwg-fetch` over `XMLHttpRequest` (`react-native/Libraries/Network/fetch.js` is three lines that `require('whatwg-fetch')`), and that polyfill contains no `ReadableStream` implementation, so `response.body` is `undefined` and line 290's guard throws on every attempt.

Two constraints shape the whole design, both verified rather than assumed:

- **`whatwg-fetch` resolves only in `xhr.onload`** (fetch.umd.js:546) and registers no `onprogress` handler. The promise settles at readyState 4 with the entire body buffered.
- **RN's own `XMLHttpRequest` does stream.** `XMLHttpRequest.js:370` `__didReceiveIncrementalData` fires repeated `LOADING` readyState events with growing `responseText`, and incremental mode is enabled automatically once `onreadystatechange` or `onprogress` is set (line 557).

`research.md` also clears a false lead: `neutralize.js:64` strips `XMLHttpRequest`, but only inside the sandboxed mini-app iframe. The launcher runs on the RN host thread, where XHR is unrestricted and no containment invariant applies.

## Goals / Non-Goals

**Goals:**
- Generate works on-device, with stage and token events arriving incrementally as the server emits them — not batched at completion.
- Everything below the `ResponseBodyReader` seam stays byte-identical. No change to SSE framing, buffering, validation, or the `GenerationEvent` guards.
- The `GenerationClientError` taxonomy (`network`/`device_id`/`http`/`stream_parse`) and abort semantics ("aborted ends iteration silently — no terminal event, no throw") are preserved exactly, because `LauncherRoot.tsx:118-123` and `FailureScreen`'s hint-only contract pattern-match on them.
- The on-device code path becomes reachable from the Node suite. Today it is structurally untestable, which is why this shipped broken.

**Non-Goals:**
- Changing `rewritePrompt`. It is unary JSON and works.
- Changing any UI module. `LauncherRoot`, `GeneratingScreen`, `FailureScreen`, `copy.ts`, `generation-request.ts` keep their current signatures.
- Changing the server's SSE wire format. `server/src/sse.ts` is correct and `generation-contract`'s requirements are transport-agnostic.
- Archiving `prompt-flow-ux`. Flagged in the proposal as a separate gap.
- Adding a streams polyfill. Swapping in `web-streams-polyfill` would give a `ReadableStream` type but not make `whatwg-fetch` produce one; it does not address the cause.

## Decisions

### D1 — Choose the transport before issuing the request, not after inspecting the response

**Decision:** a module-level capability probe picks the transport up front. The XHR path is used whenever the runtime's `fetch` cannot stream.

**Alternative rejected — post-hoc fallback** (`research.md` open question 1, the cheapest-looking option): `await fetch(...)`, and if `response.body` is missing, retry over XHR. This is unviable on cost, not style. Because `whatwg-fetch` settles in `xhr.onload`, by the time the check runs the server has already executed the full pipeline and closed the stream. The fallback would issue a **second** `/v1/generate`, doubling LLM spend and latency on every single generation, and would double-count against `usage-store`.

**Alternative rejected — shim `body` onto the fetch response**: the bytes exist only once the response is complete, so events would arrive in one burst at the end. Working, but non-streaming, which defeats `GeneratingScreen`'s purpose.

**Alternative rejected — `Platform.OS === 'android'` branch**: `research.md` confirms no `Platform.OS` branch or `.native.ts`/`.android.ts` suffix file exists anywhere in `src/host`, so this would introduce a pattern the repo does not otherwise use. It is also the wrong predicate — the question is "can this runtime stream a response body", not "which OS is this". A capability probe answers that directly and keeps Node and device on the same code path selection logic.

### D2 — The XHR transport implements the existing `ResponseBodyReader`, and the seam becomes injectable

`openGenerateStream` already returns `Promise<ResponseBodyReader | 'aborted'>`. The XHR transport produces a conforming reader, so `readNext` and `generateApp` are untouched — the highest-value property of this design, since the buffering and validation logic is the subtle part and it is already proven.

`ClientOptions` gains an optional stream-transport hook alongside `fetchImpl`. This is what makes the on-device path testable: the suite can inject the XHR transport directly and drive it against a fake `XMLHttpRequest`, rather than only ever exercising Node's native streaming `fetch`.

**Trade-off:** two injection points (`fetchImpl` for unary, the transport hook for streaming) instead of one. The alternative — collapsing both into a single general transport type — would touch every test in `generation-client.suite.ts` and rewrite `rewritePrompt`, which is working code. Not worth it for the symmetry.

### D3 — The reader re-encodes text to bytes at the seam

RN's XHR exposes progressively-growing **decoded text** (`responseText`), while `ResponseBodyReader.read()` yields `Uint8Array`. The transport therefore tracks a character offset into `responseText`, slices the new suffix on each progress event, and `TextEncoder.encode()`s it.

The decode→encode→decode round trip is redundant on its face. It is still right: it keeps `generateApp`'s proven byte-buffering loop unmodified, and it is lossless for any valid text. The alternative — a second text-mode reader path in `generateApp` — would fork the parsing loop into two variants that must be kept in agreement, which is precisely the kind of divergence that produced this bug.

`TextEncoder` availability is established (Hermes native, plus `text-encoding-polyfill`), but `src/host/version-store/polyfills.ts` installs it via an explicit call. The launcher path must be confirmed to invoke that installer before the transport depends on it — carried into tasks.

### D4 — Test the blindness, not just the bug

The reason a fully-broken path shipped green is structural: `generation-client.suite.ts:36` builds canned responses from real Node `ReadableStream`s, so the suite validates a capability the device does not have. A fix that only adds "XHR transport works" tests leaves the same shape of hole.

Coverage therefore includes a **negative control**: a case that fails if the transport stops delivering incrementally (asserting events are observable before the response completes, not merely that all events eventually arrive). Per the repo's test-classification rule, this is a behavioral, red-checkable test, not a source-grep.

### D5 — Dev request logging on the server

The server logs only at startup (`server/src/main.ts:65`), so "request arrived and ran the full pipeline" and "request never arrived" look identical from the console. During this bug the server had in fact completed generation every time. Minimal per-request dev logging (method, path, status, duration) removes that ambiguity. Small and separable — its own chain, and droppable without affecting the fix.

## Risks / Trade-offs

- **Multi-byte UTF-8 split across incremental chunks** → RN's native Android layer may split a multi-byte character across two `didReceiveIncrementalData` deliveries, yielding replacement characters. Mitigation: slice on `responseText` (already-decoded, accumulated) rather than on per-chunk deltas, so any split is healed by the accumulation; plus an explicit on-device check with non-ASCII generated content. This is a runtime fact `research.md` explicitly did not verify, and a Node fake cannot settle it.
- **RN XHR incremental delivery unconfirmed on 0.85.3 Android** → the code at `XMLHttpRequest.js:370`/`:557` says it works; nobody has run it here. Mitigation: the on-device acceptance check is a required task, not an optional one. If incremental delivery turns out not to fire, the fallback is buffered-at-completion parsing — correct but non-streaming — and that outcome must be reported, not silently accepted.
- **Testing against a fake `XMLHttpRequest` re-creates the original trap** → a hand-written fake can be as wrong about RN's XHR as the old comment was about RN's fetch. Mitigation: the fake is modeled on the observable contract in `XMLHttpRequest.js` (readyState transitions, accumulated `responseText`, `abort()`), and the on-device check remains the authority. The Node suite proves the parsing and error mapping; only the device proves the transport.
- **Two injection seams invite drift** → `fetchImpl` and the stream hook could diverge in how they build headers or handle `x-whim-device`. Mitigation: keep header construction in one shared helper used by both paths.
- **Abort timing differs between fetch and XHR** → `fetch` rejects with an `AbortError`; `xhr.abort()` fires `onabort` and transitions readyState. Mitigation: the transport must map abort onto the same `'aborted'` sentinel `openGenerateStream`/`readNext` already return, so the "silent iteration end" contract holds identically. Covered by a dedicated test case.

## Migration Plan

No data migration and no wire change — this is a device-side transport swap behind an existing internal seam. Rollout is the normal build; rollback is reverting the change folder's commits, which restores the current (broken-on-device) behavior with no residue. Nothing persisted changes shape, so there is no forward/backward compatibility concern with installed apps or the version store.

## Open Questions

1. Does the launcher path already invoke `src/host/version-store/polyfills.ts`'s installer before generation runs, or must the transport ensure `TextEncoder` itself? (Resolvable in implementation; carried as a task.)
2. Should the capability probe be evaluated once at module load or per call? Module load is cheaper and the runtime cannot change mid-session; per-call is easier to override in tests. Leaning module-load with the injection hook as the test override, but the implementer may find a reason to prefer otherwise.
3. If on-device verification shows RN's XHR does *not* deliver incrementally on 0.85.3, does the change still land as buffered-at-completion (fixing the hard failure but not the progress UI), or does it stop and re-plan? Recommend landing it — a working generate beats a broken one — but flagging it loudly rather than quietly shipping a non-streaming UI.
