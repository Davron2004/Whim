# Tasks: server-cancellation

## 1. Core cancellation plumbing

- [ ] 1.1 `server/src/pipeline.ts`: `Pipeline.run(request, signal?: AbortSignal)`; `stubRun` honors the signal — signal-aware `delay()` (settles early and clears its timer on abort, never rejects unhandled) plus an aborted-check before each `yield`; on abort the generator returns early with no terminal event
- [ ] 1.2 `server/src/sse.ts`: `buildSseStream` gains an `onCancel` hook; `cancel()` invokes it in addition to clearing the keepalive interval; a source that ends early (aborted) still closes the stream cleanly
- [ ] 1.3 `server/src/routes/generate.ts`: per-request `AbortController`; pass `controller.signal` to `pipeline.run`; wire the stream's `onCancel` AND `c.req.raw.signal`'s `abort` event (when present) to `controller.abort()` (idempotent)
- [ ] 1.4 `contract/src/index.ts` doc comment: scope the terminal-event invariant to streams that run to completion; a client-aborted stream ends without one (doc-comment only — no schema change)
- [ ] 1.5 Server-suite tests: (a) cancelling the stream stops the stub pipeline — instrumented source shows no further events after cancel and delay timers are released (replaces/extends the F1 `neverYields` test, keeping its keepalive assertion); (b) a stream cancelled before its `usage` event credits nothing, and a subsequent completed generation for the same device meters normally

## 2. OpenRouter wrapper: abort + generation id

- [ ] 2.1 `server/src/openrouter.ts`: `stream()` options accept an optional `AbortSignal`, forwarded in the `fetchFn` request-init
- [ ] 2.2 Capture the top-level generation `id` from the first SSE chunk and expose it on `StreamResult` (promise resolving with the first chunk; `undefined` if the stream ends without one)
- [ ] 2.3 Fake-transport tests: the abort signal appears in the outgoing request-init and iteration stops promptly on abort; the generation id is captured; existing delta/usage/typed-error tests stay green

## 3. Validation

- [ ] 3.1 `npm run server:test` green; `./scripts/gate.sh` green
- [ ] 3.2 `openspec validate server-cancellation --strict` green
