# Context chains: server-cancellation

Two chains, sequential, no cross-chain contract — the wrapper is unmounted (research.md §5), so chain-2 consumes nothing chain-1 produces; they share no files.

## chain-1: cancellation plumbing (pipeline → SSE → route → contract prose → tests)

- tasks: 1.1, 1.2, 1.3, 1.4, 1.5 (verbatim from tasks.md §1)
- rationale: one causal path (route creates the controller, sse fires it, pipeline honors it), four files that only make sense edited together, one vocabulary (AbortSignal / GenerationEvent / terminal event)
- reads: `specs/generation-server/spec.md` (this change's delta — ADDED disconnect requirement + MODIFIED SSE-endpoint requirement) and `specs/generation-contract/spec.md` (this change's delta — scoped terminal-event rule); research.md §§1-4, 6-7 (current `buildSseStream`/`stubRun`/`interceptUsage` shapes, usage-store row shape, F1 test's structural gap); design.md D1-D5, D7 (signal shape, dual-surface wiring, stub semantics, abort = early return, metering = credit nothing)
- reads-contracts: none
- writes-contract: none (chain-2 does not consume these outputs)

## chain-2: OpenRouter wrapper hooks + batch validation

- tasks: 2.1, 2.2, 2.3, 3.1, 3.2 (verbatim from tasks.md §2–3)
- rationale: one file (`openrouter.ts`) plus its fake-transport suite, isolated from chain-1's path because no route mounts the wrapper; change-wide validation tasks belong in the last chain
- reads: `specs/generation-server/spec.md` (this change's delta — MODIFIED OpenRouter-client-wrapper requirement, esp. the abort/id scenario); research.md §5 (current `stream()`/`StreamResult`/`fetchFn` shape, id-never-captured); design.md D6 (additive signature, id-as-promise, provider-variance caveat recorded for #11)
- reads-contracts: none
- writes-contract: none
