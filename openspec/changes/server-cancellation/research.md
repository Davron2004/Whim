# Research digest: wire request-cancellation through the generation server (SRV-1)

Researcher subagent digest, saved verbatim 2026-07-02. Question: terrain for aborting the pipeline on client disconnect + metering implications. Companion web research (OpenRouter cancellation billing) is summarized in design.md D5.

## Relevant files
- `server/src/sse.ts` — `buildSseStream`, drains the pipeline source into an SSE `ReadableStream`; its `cancel()` is the only client-disconnect signal today.
- `server/src/pipeline.ts` — `Pipeline` interface + `createStubPipeline`/`stubRun`, paced with `setTimeout`.
- `server/src/routes/generate.ts` — wires request → `pipeline.run()` → `interceptUsage` → `buildSseStream` → `Response`.
- `server/src/app.ts` — `createApp`, mounts `/v1/generate`, no signal/abort plumbing anywhere.
- `server/src/usage-store.ts` — `UsageStore`/`NodeSqliteUsageStore`, durable per-device counter, credited from `interceptUsage`.
- `server/src/openrouter.ts` — `OpenRouterClient.stream()`, unmounted, `fetchFn` injectable, no `signal` passed to fetch.
- `contract/src/index.ts` — `GenerationEvent` union, terminal-event invariant (doc comment), `Usage` shape.
- `openspec/specs/generation-server/spec.md` — governing behavior spec; no cancellation requirement exists yet.
- `openspec/specs/generation-contract/spec.md` §"SSE generation event stream schema" — terminal-event rule as a formal requirement.
- `server/test/server-core.suite.ts:308-374` — `testSseCancelClearsKeepalive`, the only existing cancel-path test.
- `server/test/metering.suite.ts` — pins credit-before-terminal and restart-durability behavior.

## 1. `server/src/sse.ts`
`buildSseStream(source: AsyncIterable<GenerationEvent>, keepaliveMs?: number): ReadableStream<Uint8Array>` (line 30-33). Input is a plain `AsyncIterable<GenerationEvent>` — the caller (`routes/generate.ts`) constructs it by composing `pipeline.run()` through `interceptUsage`. `start(controller)` sets up an optional `setInterval` keepalive, then does `for await (const event of source) { ... controller.enqueue(...) }`, closing the stream and clearing the interval when the source completes or throws. `cancel()` (lines 64-66) is exactly:

    cancel() {
      if (keepaliveInterval !== undefined) clearInterval(keepaliveInterval);
    }

It does nothing to `source` — the `for await` loop inside `start()` keeps running (blocked on the generator's next `await`) even after `cancel()` fires. `buildSseStream` has no `AbortSignal` parameter at all.

## 2. `server/src/pipeline.ts`

    export interface Pipeline {
      run(request: GenerateRequest): AsyncIterable<GenerationEvent>;
    }

No abort parameter. `createStubPipeline(delayMs = 200)` returns an object whose `run` calls the async-generator `stubRun(request, delayMs)`. Pacing is entirely via a local `delay()` helper (`ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()`), called before every `yield` across the `plan→generate→check→run` stage loop, the `token` sub-loop, the `usage` event, and the terminal event. An abort would need to be observed either (a) inside `delay()` — reject/short-circuit the timer — or (b) as a check at the top of each loop iteration, before each `yield`. `stubRun` currently takes no signal and has no early-return path.

## 3. `server/src/routes/generate.ts`
`makeGenerateRoute(pipeline, usageStore, keepaliveMs)` — inside the `POST /` handler: validates body, then `const source = interceptUsage(pipeline.run(parsed.data), deviceId, usageStore); const stream = buildSseStream(source, keepaliveMs); return new Response(stream, {...})`. `interceptUsage` (lines 51-62) is an async generator: `for await (const event of source) { if (event.type === 'usage') await usageStore.credit(deviceId, event.usage); yield event; }` — no abort/cleanup semantics of its own; it would propagate whatever `source` does if aborted upstream. On Hono/`c.req.raw.signal`: NOT verified in the repo — no code anywhere in `server/src` reads `c.req.raw` or `.signal` (grep zero matches). Hono's `Context.req.raw` is a standard Fetch `Request` which per the Fetch/Hono API carries `.signal`, and `@hono/node-server` is documented upstream to wire that signal to the underlying Node socket's close/abort — but nothing in this codebase exercises or asserts that; treat it as an external-library assumption, not a confirmed local fact.

## 4. Usage metering
`UsageStore` interface (`server/src/usage-store.ts:8-13`): `credit(deviceId, usage): Promise<void>`, `read(deviceId): Promise<Usage>`. `NodeSqliteUsageStore` table: `usage(device_id TEXT PRIMARY KEY, prompt_tokens INTEGER, completion_tokens INTEGER, total_tokens INTEGER)` — no status/cancelled flag column, no per-generation row (accumulating counter keyed by `device_id` only). `credit()` is only called from `interceptUsage` on a `usage`-typed event (spec: "credits usage through the UsageStore BEFORE the terminal event is emitted" — `routes/generate.ts:3`). If a stream ends or is cancelled without a `usage` event, nothing is credited — no partial-usage accounting exists, and no row/flag records that a generation was cancelled or under-metered.

## 5. `server/src/openrouter.ts`
`OpenRouterClient.stream(options: OpenRouterOptions): StreamResult` where `StreamResult = { deltas: AsyncIterable<string>; usage: Promise<Usage> }` (lines 60-66, 151). `fetchFn` is constructor-injected (`constructor(fetchFn: FetchFn = globalThis.fetch)`), and the internal `makeDeltas()` generator calls `fetchFn(url, { method, headers, body })` (lines 165-172) with **no `signal` field** — nothing prevents adding one, but it isn't wired. The response's OpenRouter-side `id` (needed for `GET /api/v1/generation` reconciliation) is **not captured anywhere** — parsing only extracts `usage` and `choices[0].delta.content`; the top-level `id` of each SSE chunk is never read or exposed. Module doc comment: "No route imports this module in this change (#8); it is wired in #11." — confirmed still unmounted.

## 6. Contract terminal-event rule / governing specs
`contract/src/index.ts:12-14` (module doc comment, prose): "A `GenerationEvent` stream carries EXACTLY ONE terminal event (`result` | `failure`), always last. That is a stream-level invariant enforced by the emitter — it is not (and cannot be) expressed in the per-event schema below." Same rule as a formal requirement in `openspec/specs/generation-contract/spec.md:39-46` ("every stream SHALL contain exactly one terminal event as its last event") with scenario "Round-trip validation" (48-51). `Usage` shape (`contract/src/index.ts:21-26`): `{ promptTokens, completionTokens, totalTokens }` (ints).

Governing server spec: `openspec/specs/generation-server/spec.md`. Relevant requirement headers: "SSE generation endpoint over a stub pipeline" (line 43 — quotes the `Pipeline` signature verbatim and mandates "Exactly one terminal event SHALL be emitted, after which the stream closes", line 52-53; no mention of client-disconnect), "Token metering — the only server state" (line 80 — "No other server-side persistence of any kind SHALL exist", §4.7 Model 1), "Usage readback" (line 97), "OpenRouter client wrapper" (line 106 — transport injectable, nothing about abort). **No requirement currently addresses client-disconnect or cancellation — a genuine spec gap, not merely an implementation bug.**

## 7. Existing tests
`server/test/server-core.suite.ts:308-374`, `testSseCancelClearsKeepalive` (labeled "F1"): stubs `setInterval`/`clearInterval`, builds a stream over a `neverYields()` generator (awaits a never-resolving promise), calls `stream.getReader().cancel()`, asserts only that the keepalive interval is cleared. It does **not** assert the generator/pipeline stops — the `neverYields` source would hang forever if awaited to completion, proving the test cannot distinguish fixed vs. unfixed pipeline-abort behavior. `server/test/metering.suite.ts`: pins restart durability and credit-before-terminal (`check('credit before terminal: totalTokens credited after stream', usage.totalTokens > 0)`, line 210); no cancelled-stream case. `contract.suite.ts`/`openrouter.suite.ts` exist (round-trip, fake-transport) — not read in detail.

## 8. Other Pipeline/SSE consumers
`server/src/routes/rewrite.ts` is a plain unary JSON handler — no `pipeline.run()`, no `buildSseStream`. `routes/usage.ts` only reads `UsageStore.read()`. `server/src/main.ts` is the only construction site (`createStubPipeline(200)` → `createApp`).

## Constraints and invariants
- Terminal-event invariant (contract doc comment + generation-contract spec:39-46): any abort design must not violate it for streams that complete, and must define what a cancelled stream's ending looks like (nothing is defined today).
- Model 1 (generation-server spec:85): "No other server-side persistence of any kind SHALL exist" beyond the per-device counter — cancellation bookkeeping must not add storage.
- Credit-before-terminal ordering (metering.suite §6.3-6.5) must hold for whatever partial-usage semantics are chosen.

## Risks and unknowns
- Whether `@hono/node-server`'s `Request.signal` actually fires on TCP-level client disconnect in this Node version — external-library assumption, unasserted locally.
- Whether OpenRouter's real endpoint honors an aborted `fetch` mid-stream — live-network behavior, untested ("no live-network test exists").

## Open questions for the planner
1. On cancellation, credit partial usage or nothing (no partial/cancelled row shape exists)?
2. Should the stub pipeline gain the signal now (testability) or only the future #11 pipeline?
3. Spec gap: add a cancellation requirement, or treat disconnect-handling as internal robustness?
