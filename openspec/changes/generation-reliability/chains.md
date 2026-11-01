# Context chains: generation-reliability

Four chains. `chain-run-verdict` and `chain-wire` have no dependency on each other and touch
disjoint files, so they run in parallel. `chain-upstream` follows both: it shares `machine.ts` with
the first and reads the second's refusal builder. `chain-breaker` follows `chain-upstream`. No chain
touches Class-2 files (`build/`, `invariants/`, `.claude/**`, gate scripts, `package.json`).

Every builder runs only its targeted suites (`--only`), eslint on touched files and
`npm run -s typecheck`, all through `/Users/davrondjabborov/.cache/whim-run/capped-run.sh`.
Rewritten assertions keep their count, or carry a `Check-removal:` trailer. Commits carry no
`Co-Authored-By` or other attribution line.

## chain-run-verdict: harness phase → run-stage split → machine repair/re-run → e2e (#58)

- tasks: 1.1–1.5
- rationale: one data path. A synthrun report field feeds the run-stage adapter, which feeds a new `RunOutcome` arm, which the machine consumes and logs. The same vocabulary (phase, rerun, repairable) holds throughout, and the e2e at the end proves it with real Chromium.
- files: `synthrun/contract.ts`, `synthrun/observe.ts`, `synthrun/test/resilience.ts`, `server/src/generation/stages/run.ts`, `server/src/generation/machine.ts` (the `RunOutcome` type, the run branch, `failureTerminalFor`, `emitCompletion` log fields, doc comments), `server/test/run-stage.suite.ts`, `server/test/run-stage-fixtures.ts`, `server/test/machine.suite.ts`, `server/test/e2e.ts`, `server/test/e2e-fixtures.ts`
- reads: specs/synthetic-run/spec.md §"An unobserved verdict names the phase that kept it away", §"The unobserved phase comes from the channel, never the message"; specs/generation-pipeline/spec.md §"The run stage is the synthetic harness, and containment failure is terminal", §"An unverified or failed containment verdict is logged without content"; design.md D1, D2, D3; rc-58.md §ROOT CAUSE, §ALL PATHS, §RECOMMENDED FIX item 5; `git show 58b8df82:server/test/rc58-repro.ts` (the e2e pattern); handoff: none
- writes-contract: handoff/run-verdict.md (the final `RunOutcome` union, `UnobservedPhase`, the `terminal failure` log field names, and which `machine.ts` functions changed, so chain-upstream can merge onto them)
- verify: `npm run synthrun:test -- --only <suite>`, `npm run server:test -- --only run-stage,machine`, `npm run server:e2e`

## chain-wire: provider_unavailable at protocol level 2, contract to device (#66)

- tasks: 2.1–2.5
- rationale: one wire code end to end. The contract enum and level, the server registry and refusal builder, and the device mirrors and landing tests have to move together, or the mirror and typecheck guards fail.
- files: `contract/src/index.ts`, `server/src/admission/refusals.ts`, `server/src/wire-level.ts`, `server/test/contract.suite.ts`, `server/test/wire-level.suite.ts`, `server/test/request-edge.suite.ts`, `server/test/wire-v2.suite.ts` (only if its fixtures use level 2 as the future), `src/host/launcher/wire-headers.ts`, `src/host/launcher/wire-compat.ts`, `src/host/launcher/service-refusal.ts`, `src/host/launcher/test/{wire-future-frames,service-refusal,refusal-landing,failure-screen}.suite.ts*`
- reads: specs/generation-contract/spec.md §"The refusal vocabulary gains provider_unavailable", §"The provider_unavailable code is introduced at protocol level 2"; specs/service-refusals/spec.md §"A refusal is recognised by the contract's closed refusal vocabulary", §"An availability or limit refusal lands on the step whose action sent the request"; specs/prompt-flow/spec.md §"Failure is shown by kind, honestly, never as a crash"; design.md D7, D9; research.md §Q3, §Q4; handoff: none
- writes-contract: handoff/wire.md (`ServiceRefusalCode` member, `PROTOCOL_LEVEL = 2`, the exact `REFUSAL_HINTS.provider_unavailable` sentence, `providerUnavailableRefusal(retryAfterSeconds?)` signature and status/headers, the registry entry and compat object verbatim)
- verify: `npm run server:test -- --only contract,wire-level,request-edge,wire-v2`, `npm run launcher:test -- --only wire-future-frames,service-refusal,refusal-landing,failure-screen`

## chain-upstream: classify upstream failures, resend plan, provider_unavailable terminal and 503 (#57, #66)

- tasks: 3.1–3.5
- rationale: everything that decides "was this the provider's fault" and what a run or unary route says when it was. There is one shared classifier and its three consumers: the log line, the machine and the unary routes.
- files: `server/src/model-failure.ts` (new), `server/src/generation/model.ts`, `server/src/openrouter.ts`, `server/src/generation/machine.ts` (`runModelTurn`, `endOnThrow`, the reason constant), `server/src/generation/failure-codes.ts`, `server/src/routes/clarify.ts`, `server/src/routes/rewrite.ts`, `server/test/openrouter.suite.ts`, `server/test/routes-generate.suite.ts`, `server/test/routes-unary.suite.ts`
- reads: specs/generation-server/spec.md §"A failed model call is classified and logged with its status and error kind", §"An upstream failure is exactly a server, rate-limit, network or timeout failure", §"Clarify endpoint", §"Rewrite endpoint over the real rewrite model"; specs/generation-pipeline/spec.md §"A model turn that loses its provider is retried once", §"A run whose provider stays down ends with its own reason"; specs/server-admission-control/spec.md §"Unary model calls have a bounded lifetime"; specs/server-observability/spec.md §"The ledger records a closed failure code"; design.md D4, D5, D6; research.md §Q1; handoff: handoff/wire.md, handoff/run-verdict.md
- writes-contract: handoff/upstream.md (`modelFailureOf` signature, `ModelErrorKind` union, the upstream set, the `model call` field names, the `provider_unavailable` terminal code, `PROVIDER_UNAVAILABLE_REASON`)
- after: chain-run-verdict, chain-wire
- verify: `npm run server:test -- --only openrouter,routes-generate,routes-unary,ledger`

## chain-breaker: process-level provider breaker, admission wiring, probe, alert (#66)

- tasks: 4.1–4.6
- rationale: one new admission component and its wiring. Config, the state machine and probe, the model-client feed, the three routes' admission step, and the operator alert share the breaker's vocabulary (open, cooldown, probe, Retry-After) and its fake-clock suite.
- files: `server/src/config.ts`, `server/src/admission/provider-breaker.ts` (new), `server/src/generation/model.ts` (`ModelCallLabel` gains `'probe'`), `server/src/lifecycle.ts`, `server/src/generation/index.ts`, `server/src/app.ts`, `server/src/routes/generate.ts`, `server/src/routes/clarify.ts`, `server/src/routes/rewrite.ts` (admission step only), `server/test/provider-breaker.suite.ts` (new), `server/test/acceptance.ts` (register it), `server/test/config.suite.ts`, `server/test/admission.suite.ts`, `server/test/deploy-config.suite.ts`, `deploy/monitoring/policy-provider-breaker-open.json` (new), `docs/deploy.md`
- reads: specs/server-admission-control/spec.md §"The provider breaker counts consecutive upstream failures", §"The provider breaker opens for a cooldown and says so in the log", §"An open provider breaker refuses admission", §"A lazy probe decides when the provider breaker closes", §"Admission checks run in a fixed order before any model work", §"The server refuses admission when the operator's provider credit is exhausted", §"Every refusal is a structured, user-facing ApiError", §"Admission limits are environment-configurable with public-beta defaults"; specs/server-observability/spec.md §"The owner is alerted by email"; design.md D8; research.md §Q5, §Q6; handoff: handoff/upstream.md, handoff/wire.md
- writes-contract: none
- after: chain-upstream
- verify: `npm run server:test -- --only provider-breaker,config,admission,deploy-config,routes-unary,routes-generate`
