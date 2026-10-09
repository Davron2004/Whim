## Why

On a phone, clarify takes ~35 s and plan writing ~25 s before generation even starts (#55), and plan and answer submits intermittently fail with `policy_unavailable` (#51). Measured locally on 2026-09-22 against the production roster, both have one root cause. The server believes a request without a `reasoning` field gets no reasoning, but DeepSeek V4 reasons by default. So the classifier, clarify, rewrite and the post-run summariser all run a hidden reasoning pass nobody asked for:

- The classifier's 48-token cap is spent on hidden reasoning, so its verdict comes back empty or cut off and the check fails closed. That happened on 4 of 15 direct replays and 5 of 8 classifier calls in a local end-to-end run. With reasoning disabled it was 0 of 15.
- One clarify call reasoned past the 60 s unary timeout and returned `502`. Rewrites took 8–24 s.
- The summariser ran into its own 20 s timeout after a finished, verified build. In the first complete baseline run, 20 of 44.6 s of "generation" was this tail.

On top of that, OpenRouter's default routing favours cheap providers. The same model streamed at 26–45 tok/s on one provider and 300+ tok/s on another, and nothing in the request asks for the fast one. The owner also has no way to measure a model choice: the corpus-eval `--generate` path runs only the stub pipeline, and nothing times the device's clarify → plan → build flow.

## What Changes

- Every model call states its reasoning mode explicitly on the wire. A per-role setting replaces the implicit provider default. The classifier, clarify, rewrite and summariser default to reasoning **off**; plan, generate and repair keep reasoning on (the "thinking" indicator depends on it). The classifier's reasoning is always off, as its spec already requires.
- Optional per-role model overrides: clarify, summariser and plan can each run a different model than the one they share today. Unset, they fall back to `WHIM_REWRITE_MODEL` / `WHIM_ENGINEER_MODEL`, so today's two-variable config keeps working unchanged.
- An optional provider-routing preference (`WHIM_PROVIDER_SORT` = `price` | `throughput` | `latency`) sent on every request.
- One structured log line per model call: role, model, upstream provider, time to first delta, duration, and token counts including reasoning tokens. No message content.
- A flow benchmark (`server/flowbench.mjs`) that drives clarify → rewrite → generate against any server URL the way the device does. It reports per-phase and per-stage timings and outcomes, and saves delivered sources as `<caseId>.ts` so `evals/cli.mjs run --source-dir` can score a model choice. This is the measurement the model roster is picked by.

## Capabilities

### New Capabilities
- `flow-benchmark`: an operator tool that measures a configured server's clarify → rewrite → generate latency and outcome per phase and per stage, and saves delivered sources for corpus-eval scoring.

### Modified Capabilities
- `generation-pipeline`: the model-client requirement's roster grows optional per-role overrides; every model call carries an explicit reasoning setting and a role label.
- `generation-server`: the OpenRouter client wrapper sends the reasoning setting and the optional provider preference explicitly and logs one timing line per call.

## Impact

- Code: `server/src/openrouter.ts`, `server/src/generation/model.ts`, `server/src/config.ts`, `server/src/lifecycle.ts`, `server/src/policy/policy.ts`, `server/src/routes/clarify.ts`, `server/src/routes/rewrite.ts`, `server/src/generation/summarise.ts`, `server/src/generation/machine.ts`, their suites under `server/test/`; new `server/src/flowbench/` and `server/flowbench.mjs`.
- Config: new optional env vars (`WHIM_CLARIFY_MODEL`, `WHIM_SUMMARY_MODEL`, `WHIM_PLAN_MODEL`, `WHIM_<ROLE>_REASONING`, `WHIM_PROVIDER_SORT`). Existing deployments need no change; the reasoning-off default applies on the next deploy. Every model on the rewrite side must accept `reasoning: { enabled: false }` (some models reject it); `docs/deploy.md` says so.
- Wire contract: unchanged. Fixes #51 and addresses #55.
- Docs: `docs/deploy.md` (env reference), `docs/evals.md` (the bakeoff protocol uses the flow benchmark), and the measured model choice in `docs/decisions.md`.
