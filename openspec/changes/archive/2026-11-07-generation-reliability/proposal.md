## Why

Three ways a build ends badly today tell the user the wrong thing or make them wait for nothing. A candidate that crashes while its module loads ends in under a second as "We couldn’t verify this app ran safely" with no repair (#58, root cause in `rc-58.md`): an ordinary bug gets the dead end meant for a harness fault. A plan turn that loses its provider is never resent, unlike generate and repair (#57). And when the AI provider is down, every user waits minutes for a generic "Something went wrong", with nothing saying it isn't their fault and nothing stopping the next user from trying (#66). Production has seen none of these yet (`rc-58.md` §provider-failure evidence). They all showed up in benchmarks, and fixing them now costs less than fixing them during the first outage after launch.

## What Changes

- **Never-mounted candidates are repaired, not dead-ended (#58).** The run stage splits an unobserved verdict by the phase the harness reports. A candidate that threw during module evaluation, left no default export, or hung before first paint goes to the repair loop with its own diagnostics and spends one repair attempt. It is never delivered. Any other unobserved verdict is treated as a harness fault: the same candidate is re-run once in a fresh browser context, and if the verdict is still unobserved the run ends as `run_unverified`, as today. **This reverses the archived "never re-run an unobserved verdict" rule.**
- **The synthetic-run report names the unobserved phase.** `module-eval | bundle | mount | deliver | probes | mount-timeout | none` is derived from the channel the harness heard the cause on, never from message text. The `terminal failure` log line gains `phase` and `rerun`.
- **The plan turn gets the same one resend as generate and repair (#57).**
- **Upstream failures are classified and logged.** HTTP 5xx, 429, a network or stream error, or the server's own per-call timeout is an upstream failure. A client cancel, 401, 402 and other 4xx are not. The failed `model call` line gains `status` and `errorKind`.
- **A run whose provider stays down says so (#66).** It ends with the new terminal code `provider_unavailable` and the sentence "The AI service Whim uses is having trouble right now. It’s not something you did. Please try again in a little while." Clarify and rewrite answer `503 provider_unavailable` instead of `502 model_failure` for an upstream failure, a per-call timeout included.
- **New refusal code `provider_unavailable` at protocol level 2.** `PROTOCOL_LEVEL` goes from 1 to 2. Level-1 builds get a `compat` envelope (`fallback: 'fail'`) whose notice is the same sentence. Level-2 builds treat it as an availability refusal: it lands on the sending step with a neutral tone, and the build honours `Retry-After`.
- **Provider circuit breaker.** After N consecutive upstream failures within a window, generate, clarify and rewrite refuse at admission with `503 provider_unavailable` and a `Retry-After` until the cooldown ends. The breaker check sits immediately before the operator-credit check, so it consumes no daily unit and acquires no slot. After the cooldown, the next admission sends one lazy probe: success closes the breaker, failure re-opens it. Opening logs `provider breaker open`, and an email alert keys on that line. All three knobs are env-configurable, and setting the failure threshold to `0` disables the breaker.
- **No report prompt on this failure.** The Failure page already offers none. A scenario pins that so it stays true.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `generation-pipeline`: the run stage repairs a never-mounted candidate and re-runs a residual unobserved verdict once. The plan turn joins the one-resend rule. A run whose provider stays down ends as `provider_unavailable` with its own reason. The terminal log gains `phase` and `rerun`.
- `synthetic-run`: an unobserved verdict carries the phase that kept it away.
- `generation-server`: failed model calls are classified and logged with status and error kind. An upstream clarify or rewrite failure answers `503 provider_unavailable`.
- `generation-contract`: `ServiceRefusalCode` gains `provider_unavailable`, introduced at protocol level 2 with a `compat` envelope for level-1 clients.
- `server-admission-control`: adds the provider circuit breaker and its place in the admission order. `Retry-After` is now also sent on an open-breaker refusal. A timed-out unary call answers `provider_unavailable`. Adds the breaker's environment knobs.
- `server-observability`: a provider-breaker-open email alert. The ledger names a provider outage.
- `service-refusals`: the device recognises `provider_unavailable` and lands it like the other availability refusals.
- `prompt-flow`: the Failure page offers no report action, and a provider-outage failure shows the server's sentence.

## Impact

- Server: `server/src/generation/stages/run.ts`, `server/src/generation/machine.ts`, `server/src/generation/model.ts`, `server/src/generation/failure-codes.ts`, `server/src/openrouter.ts`, `server/src/routes/{generate,clarify,rewrite}.ts`, `server/src/admission/refusals.ts`, a new `server/src/admission/provider-breaker.ts`, `server/src/wire-level.ts`, `server/src/config.ts`, composition root (`server/src/lifecycle.ts` / `server/src/generation/index.ts`).
- Harness: `synthrun/observe.ts`, `synthrun/contract.ts` (an additive report field). `src/runtime/web/loader.js` and `invariants/` are not touched.
- Contract: `contract/src/index.ts` (`ServiceRefusalCode`, `PROTOCOL_LEVEL`).
- Device: `src/host/launcher/{wire-headers,wire-compat,service-refusal}.ts` and their suites.
- Deploy: a new `deploy/monitoring/policy-provider-breaker-open.json` and `docs/deploy.md` "Operating: Alerts".
- Wire: protocol level 2. Server-first and client-first deploys are both safe (design D7). The `failure` event is unchanged, since its reason is a free string.
