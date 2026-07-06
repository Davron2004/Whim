# Design: server-cancellation

## Context

SRV-1 (openspec/critic/2026-07-02-product-sweep.md, reconciled alive at HEAD): `buildSseStream`'s `cancel()` clears only the keepalive interval — the `for await` loop over the pipeline source keeps running (research.md §1), `Pipeline.run` has no abort parameter (§2), and no `AbortSignal` exists anywhere in `server/src`. Constraints: the terminal-event invariant lives in both the contract doc comment and the generation-contract spec (§6); Model 1 forbids any server persistence beyond the per-device counter (§Constraints); the existing F1 cancel test is structurally unable to detect the leak (§7). Companion web research (verified against OpenRouter's official streaming and usage-accounting docs, 2026-07-02): aborting a streamed request "immediately stops model processing and billing" on supported providers (OpenAI, Anthropic, Together, DeepSeek, …) but NOT on others (Bedrock, Google, Groq, Mistral, …); no usage chunk arrives on an aborted stream; authoritative post-abort token counts and cost are retrievable from `GET /api/v1/generation?id=<response id>` (which also carries a `cancelled` flag), with the `id` taken from the stream's first SSE chunk; a non-streaming request aborted client-side always bills the full completion.

## Goals / Non-Goals

**Goals:** abort the pipeline on client disconnect (both runtime surfaces); make the behavior deterministically testable against the stub; scope the terminal-event invariant honestly; give the OpenRouter wrapper the two hooks (#11 will need) — signal pass-through and generation-id capture.

**Non-Goals:** mounting `openrouter.ts` (roadmap #11); the post-abort usage-reconciliation poller against the generation-stats endpoint (#11 — it needs the mounting context); provider filtering/selection policy for cancellation support (#11 product decision); partial-usage estimation; any new persistence or usage-store schema change; `/v1/rewrite` (unary JSON, shares none of this machinery — research.md §8).

## Decisions

**D1 — Cancellation travels as an optional `AbortSignal` parameter: `Pipeline.run(request, signal?)`.** Alternative considered: relying on `source[Symbol.asyncIterator]().return()`. Rejected as the primary mechanism: `return()` only settles after the generator's current `await` resolves, so a stub sleeping 200ms (or a future fetch awaiting the model) wouldn't stop promptly, and it gives the future OpenRouter pipeline nothing to hand to `fetch`. `AbortSignal` is the platform primitive that reaches all the way down to the transport. Optional, so existing callers/tests compile unchanged.

**D2 — The route owns one `AbortController` per request and wires BOTH cancellation surfaces to it.** `buildSseStream` gains an `onCancel` hook invoked from `cancel()` (alongside the existing keepalive cleanup); the route also subscribes to `c.req.raw.signal`'s `abort` event when present. Research.md flags each surface individually as an external-runtime assumption (nothing local asserts which one `@hono/node-server` actually fires on TCP disconnect) — wiring both to an idempotent abort covers whichever fires, and the deterministic tests drive the `cancel()` surface directly.

**D3 — The stub pipeline honors the signal now.** Research.md open question 2, resolved: yes. The interface contract "every implementation honors the signal" is worthless unexercised, and the F1 test proves the current suite can't detect the leak (its `neverYields` source would hang forever if awaited). Mechanism: the stub's `delay()` helper becomes signal-aware (resolve early/clean up its timer on abort — never reject unhandled), plus an aborted-check before each `yield`.

**D4 — Abort semantics: the generator returns early — no terminal event, no throw.** A cancelled stream has no listener; synthesizing a `failure` event for nobody would force `interceptUsage` and the SSE encoder to process fiction, and throwing from the generator risks unhandled-rejection noise in `start()`'s `for await`. The contract invariant is re-scoped accordingly (delta specs): exactly-one-terminal applies to streams that run to completion; a client-aborted stream ends without one and is not a conformance violation.

**D5 — Metering on cancel: credit nothing, persist nothing new.** Research.md open question 1, resolved by two facts: Model 1 forbids new server state (no cancelled-flag column, no per-generation rows), and the web research shows the accurate answer arrives out-of-band anyway — after an abort, `GET /api/v1/generation?id=...` returns authoritative native token counts, `total_cost`, and a `cancelled` flag (short retry until the record resolves). So in-band partial-usage guessing is both forbidden and unnecessary. This change lays the prerequisite — the wrapper captures and exposes the generation `id` (D6) — and #11 wires the reconciliation poller when it mounts the wrapper. Until then, a cancelled stub stream credits nothing (stub tokens are canned; nothing real is lost), asserted in the tests.

**D6 — Wrapper changes are additive: optional `signal` in `stream()` options (forwarded in the `fetchFn` request-init) and generation-`id` capture from the first SSE chunk, exposed on `StreamResult` (a promise resolving with the first chunk, `undefined` if the stream ends without one).** The wrapper stays unmounted; both hooks are fake-transport-testable today. Cost-control caveat recorded here for #11: cancellation stops upstream billing only on supported providers — provider preference/filtering is a #11 decision, and non-streaming proxying is never acceptable where aborts matter (a non-streaming abort always bills in full).

**D7 — `interceptUsage` is untouched.** It re-yields and credits on `usage` events; an aborted source simply ends, so it ends too. Credit-before-terminal ordering (pinned by metering.suite §6.3-6.5) is unaffected for completed streams.

## Risks / Trade-offs

- [Whether `@hono/node-server` fires `ReadableStream.cancel()` and/or `Request.signal` on real TCP disconnect is unverified locally] → D2 wires both, idempotently; deterministic tests drive `cancel()` directly; a manual LAN check (device kills the app mid-generation, server log shows the abort) is the acceptance step when #11 goes live.
- [OpenRouter honoring an aborted fetch mid-stream is live-network behavior with no local test] → documented; the fake-transport test asserts our side (signal present in request-init, iteration stops); the provider-variance caveat is D6's recorded input to #11.
- [Signal-aware `delay()` must not leak timers or reject unhandled] → explicit task-level requirement (1.1); the cancel test asserts timers are released.
- [Re-scoping the terminal-event invariant could be read as weakening it] → it is a truthful scoping, not a weakening: the old wording was unsatisfiable under client disconnect; completed streams keep the exact old guarantee, pinned by the unchanged round-trip scenario.

## Migration Plan

None — `signal` is optional everywhere it appears, no wire shape changes, no persistence changes. Deploy = merge behind the standard gate; rollback = revert the merge commit.

## Open Questions

None blocking. Deferred to #11 by design: the generation-stats reconciliation poller, provider cancellation-support policy, and the live-network abort check.
