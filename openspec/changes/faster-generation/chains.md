# Context chains: faster-generation

Two independent chains with disjoint file scopes; they may run in parallel. Neither writes a contract the
other reads: the flow benchmark reaches the server over HTTP only.

## chain-1: server-roster

- tasks: 1.1–1.6
- rationale: one vertical slice through the model seam — roster type, env loading, wire mapping, timing log and every call site move together, and their tests live in the suites that already cover those files.
- reads: specs/generation-pipeline/spec.md (whole delta: §"Every model call goes through an injectable client", §"Every model call states its reasoning mode", §"Per-role model overrides fall back to the two roster models"); specs/generation-server/spec.md §"OpenRouter client wrapper"; `openspec/changes/public-generation-server/specs/content-policy/spec.md` lines 55–66 (classifier call shape); design.md D1–D4; research.md; handoff: none
- writes-contract: none
- file scope: `server/src/openrouter.ts`, `server/src/config.ts`, `server/src/lifecycle.ts`, `server/src/generation/model.ts`, `server/src/generation/machine.ts`, `server/src/generation/summarise.ts`, `server/src/policy/policy.ts`, `server/src/routes/clarify.ts`, `server/src/routes/rewrite.ts`, existing suites and helpers under `server/test/` except `acceptance.ts`, `docs/deploy.md`

## chain-2: server-flowbench

- tasks: 2.1–2.3
- rationale: a new, self-contained operator tool plus its suite and doc; it consumes only the wire contract (`contract/src/index.ts`, unchanged by this change).
- reads: specs/flow-benchmark/spec.md (whole); design.md D5; `server/loadtest.mjs` + `server/src/loadtest/drive.ts` (the run-time bundling pattern to mirror); `contract/src/index.ts` (`ClarifyRequest`/`ClarifyResponse`/`RewriteRequest`/`RewriteResponse`/`GenerateRequest`/`GenerationEvent`/`ApiError`); `evals/sets/visible/manifest.json` (case shape); handoff: none
- writes-contract: none
- file scope: `server/src/flowbench/**`, `server/flowbench.mjs`, `server/test/flowbench.suite.ts`, `server/test/acceptance.ts` (one import + one call), `docs/evals.md`
