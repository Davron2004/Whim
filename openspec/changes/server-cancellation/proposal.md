# Proposal: server-cancellation

## Why

Critic finding SRV-1 (reconciled alive at HEAD): when a client disconnects from a `/v1/generate` SSE stream, `buildSseStream`'s `cancel()` only clears the keepalive timer — the pipeline keeps running to completion server-side, and no `AbortSignal` exists anywhere in `server/src` to stop it. Today the stub bounds the leak; the moment roadmap #11 mounts the OpenRouter-backed pipeline behind this same interface, a disconnected client leaves a live LLM call streaming with no listener — real API cost with no cost-control lever. Verified against OpenRouter's docs (design.md D5): aborting a streamed fetch stops billing on cancellation-supporting providers, and accurate post-abort token counts are retrievable out-of-band — so abort-on-disconnect is both the cost lever and metering-safe. This must land before #11.

## What Changes

- **`Pipeline.run` gains an optional `AbortSignal`** (`run(request, signal?)`) — spec-visible: the interface signature is quoted verbatim in the generation-server spec. Optional parameter, so not breaking for existing callers.
- **The generate route owns a per-request `AbortController`** and wires *both* cancellation surfaces the runtime may fire — the SSE `ReadableStream`'s `cancel()` (via a new hook on `buildSseStream`) and the request's own `Request.signal` — to the same abort.
- **The stub pipeline honors the signal now**: signal-aware inter-event delay, early return before the next yield, no terminal event, no unhandled rejection. This makes the behavior deterministically testable today instead of deferred until a real LLM sits behind the interface (the existing F1 cancel test is structurally unable to detect the leak).
- **Contract prose: the terminal-event invariant is scoped to streams that run to completion** — a client-aborted stream ends without a terminal event, stated in both the contract doc comment and the generation-contract spec.
- **Metering on cancel: credit nothing, add no persistence** (Model 1 forbids new server state). Accurate post-abort reconciliation via OpenRouter's generation-stats endpoint is #11's job; this change captures its prerequisite —
- **The OpenRouter client wrapper accepts an `AbortSignal`** (forwarded to the injected `fetch`) **and captures the generation `id`** from the first SSE chunk, exposing it on `StreamResult` as the handle for post-abort usage lookup.
- New tests: cancel stops the stub pipeline (instrumented source), cancelled-before-usage credits nothing and later runs meter normally, wrapper abort reaches the fake transport, id captured.

## Capabilities

- **New Capabilities:** none.
- **Modified Capabilities:**
  - `generation-server` — the SSE-endpoint requirement (Pipeline signature + terminal sentence), a new client-disconnect-aborts-generation requirement, and the OpenRouter-client-wrapper requirement (signal + id capture).
  - `generation-contract` — the SSE event-stream requirement's terminal-event rule scoped to completed streams.

## Impact

- `server/src/pipeline.ts`, `server/src/sse.ts`, `server/src/routes/generate.ts`, `server/src/openrouter.ts`, `contract/src/index.ts` (doc comment only — no wire-shape change), `server/test/*`.
- No new dependencies; no persistence-schema change; `/v1/rewrite` and `/v1/usage` untouched (research.md §8: they share none of this machinery).
- Known external assumptions, documented in design.md: `@hono/node-server` signal propagation on TCP disconnect, and per-provider cancellation support on OpenRouter.
