## Context

Issue #55 reports ~35 s for clarify and ~25 s for plan writing on a phone; #51 reports plan and answer submits failing with `policy_unavailable` and passing on retry. The terrain is in `research.md`. These numbers were measured on 2026-09-22 against a local server with the production roster (`WHIM_REWRITE_MODEL=deepseek/deepseek-v4-flash-0731`, `WHIM_ENGINEER_MODEL=deepseek/deepseek-v4.1-flash`), driven the way the device drives it. Scratch driver and raw data are in the session's bench folder; the committed successor is this change's flow benchmark.

| case | clarify | rewrite | generate | plan | code | run | after last stage |
|---|---|---|---|---|---|---|---|
| tip-splitter-p1 | 3.5 s | 17.3 s | 44.6 s | 6.3 s | 13.5 s | 2.5 s | 20.0 s |
| habit-tracker-p1 | 29.5 s | 29.6 s | 122.6 s | 28.1 s | 63.3 s | 9.7 s | 20.0 s |
| flashcards-p2 | 32.0 s | 34.5 s | 225.9 s (1 repair) | 13.6 s | 82.0 s | 2.1 s | 20.0 s |

An earlier pass of the same three cases got `503 policy_unavailable` on 2 of 3 clarifies and 3 of 3 generates. Its third clarify ran 61.7 s and ended `502`, past the 60 s unary timeout.

Why, from direct replays of the same requests against OpenRouter:

- **Hidden default reasoning.** `requestBody` only ever adds `reasoning: { enabled: true }`. DeepSeek V4 reasons when the field is absent. The replayed classifier call (48-token cap, no reasoning field) finished `length` with an empty or cut-off verdict on 4 of 15 calls. With `reasoning: { enabled: false }` it was 0 of 15, 7 output tokens, median 1.1 s vs 1.7 s. On a clarify-sized JSON task, `v4-flash-0731` took 6.0 s with default reasoning and 1.0 s with it off; `v4.1-flash` took 12.8 s and 1.7 s.
- **The summariser always times out.** The "after last stage" column is 20.0 s in every run, the summariser's own timeout (`summarise.ts:63`), spent reasoning after the app was already built and verified.
- **Default provider routing is slow and uneven.** The same model streamed at 26–45 tok/s on some default-routed providers and 300–390 tok/s under `provider: { sort: 'throughput' }`. On short non-reasoning calls, latency-sorted and throughput-sorted routing were within noise of each other (DeepSeek flash medians 0.76–1.00 s). Both removed the default route's tail (max 5.2 s).
- **Effort is model-dependent.** `reasoning: { effort: 'low' }` cut `v4-flash-0731`'s reasoning on a codegen task from 2,629 to 681 tokens (14.8 s → 7.4 s) and did nothing measurable on `v4.1-flash`. Reasoning still streamed in both cases, so `thinking` events keep working.
- **Some models refuse to turn reasoning off.** `z-ai/glm-5.3-flash` and `stepfun/step-3.5-flash` answer `400 Reasoning is mandatory for this endpoint and cannot be disabled`.

## Goals / Non-Goals

**Goals:**
- No model call gets reasoning by accident: every call states its reasoning mode, and the latency-critical ones default to off. This fixes #51 and removes most of #55's wait.
- The operator can give clarify, the summariser and the plan stage their own model and reasoning mode, and can ask OpenRouter for fast providers, all without touching code.
- Every model call leaves one timing line in the log, so the next "it feels slow" is a log query.
- A committed, repeatable way to measure a roster end to end, feeding the existing corpus-eval scorer.

**Non-Goals:**
- Running the classifier concurrently with the main call. The content-policy spec requires it first, and with reasoning off it costs ~1 s.
- Streaming plan rows to the device, structured outputs, prompt caching, moving the summariser off the terminal event. These are follow-ups if the numbers still call for them.
- Choosing the production roster. The benchmark informs it; the choice is recorded in `docs/decisions.md` and applied through `deploy.env`.

## Decisions

**D1 — Reasoning is an explicit, required per-call setting.** `ReasoningSetting = 'off' | 'on' | 'low' | 'medium' | 'high' | 'default'`. The wire mapping lives in one place, the OpenRouter wrapper: `off` → `reasoning: { enabled: false }`, `on` → `{ enabled: true }`, `low`/`medium`/`high` → `{ effort }`, and `default` → no field (exactly today's behavior for a caller that omits it). `ModelRequest.reasoning` becomes required, so the type checker rejects a future call site that forgets to decide. That forgetting is how this bug happened. *Alternatives:* adding `enabled: false` wherever `reasoning` is falsy (fixes #51 but gives no per-role tuning and keeps the implicit default); one global flag (engineer turns need reasoning on for the thinking indicator while unary turns need it off).

**D2 — Roles, env vars and defaults.** `ModelRole = 'clarify' | 'rewrite' | 'summary' | 'plan' | 'engineer'`, `RoleSetting = { model; reasoning }`, `ModelRoster = Record<ModelRole, RoleSetting>`.

| role (call sites) | model var (fallback) | reasoning var (default) |
|---|---|---|
| clarify | `WHIM_CLARIFY_MODEL` (→ `WHIM_REWRITE_MODEL`) | `WHIM_CLARIFY_REASONING` (`off`) |
| rewrite | `WHIM_REWRITE_MODEL` (required) | `WHIM_REWRITE_REASONING` (`off`) |
| summary | `WHIM_SUMMARY_MODEL` (→ `WHIM_REWRITE_MODEL`) | `WHIM_SUMMARY_REASONING` (`off`) |
| plan | `WHIM_PLAN_MODEL` (→ `WHIM_ENGINEER_MODEL`) | `WHIM_PLAN_REASONING` (`on`) |
| engineer (generate, repair) | `WHIM_ENGINEER_MODEL` (required) | `WHIM_ENGINEER_REASONING` (`on`) |
| content-policy classifier | the rewrite role's model (fixed by the content-policy spec) | always `off` (fixed by the same spec) |

An empty value counts as unset. A reasoning value outside the set fails configuration loading, naming the variable and the allowed values, the same fail-fast path every other `WHIM_*` error takes. There is no `WHIM_POLICY_MODEL`: moving the classifier off the rewrite model is a policy decision this change does not make. Generate and repair share one role because nothing yet argues for splitting them.

**D3 — One provider-routing knob.** `WHIM_PROVIDER_SORT` ∈ {`price`, `throughput`, `latency`}; when set, every request carries `provider: { sort }`. It is global, not per role, because short calls showed no latency-vs-throughput difference and long engineer turns want throughput. Unset keeps today's behavior. *Alternative:* the `:nitro` model-id suffix gives throughput sorting with zero code, but it hides a routing choice inside a model id and can't express `latency`.

**D4 — One timing line per model call, emitted by the wrapper.** When a stream settles (completed, failed or aborted) the wrapper logs one `model call` line at info: `role`, `model`, `provider` (the SSE chunk's `provider` field, when present), `ttftMs` (first delta of either kind), `durationMs`, `promptTokens`, `completionTokens`, `reasoningTokens` and `cachedTokens` (usage details, when present), `generationId`, `outcome`. It carries no message content. `ModelRequest.role` is required so every line is attributable, and the classifier labels itself `policy`. Doing this in the wrapper makes it impossible to forget per call site.

**D5 — The flow benchmark measures the product over HTTP.** `server/flowbench.mjs` (esbuild-bundled at run time, like `server/loadtest.mjs`) drives clarify → rewrite → generate for eval-set cases against a server URL. It answers each clarify question with its first option, sends the rewritten prompt and the answers to generate (the device's own request shapes: `LauncherRoot.tsx` → `buildGenerateRequest`), uses a fresh device id per case, times each phase and each stage from the client-observed stage events, and writes a JSON report plus a Markdown table. `--save-sources <dir>` writes `<caseId>.ts` for `evals/cli.mjs run --source-dir`. `--retries N` re-posts `503 policy_unavailable` (default 0: report it). It imports nothing from the server beyond contract types, so it sees admission, the classifier and the network exactly as a device does. *Alternative:* wiring the real pipeline into `evals/cli.mjs --generate` skips clarify, rewrite and admission, so it can't time what the user actually waits on.

**D6 — The deploy pipeline carries the new knobs (added after review).** Production config only reaches the container through two whitelists: `deploy/lib.sh`'s `WHIM_VALUE_KEYS` (anything else in `deploy.env` fails the deploy) and `deploy/deploy.sh`'s `stage_server_files`, which writes the capacity-profile keys plus the two model ids into `/etc/whim/config.env`. The new optional variables join both: whitelisted, validated in preflight when set (model-id pattern for `*_MODEL`, the allowed sets for `*_REASONING` and `WHIM_PROVIDER_SORT`), and written to `config.env` only when non-empty, so an unset knob keeps the server default. Being deploy inputs also satisfies the runbook's documented-variable check, which removes the need for unused `ServerConfig` fields. A misspelled reasoning value fails boot in every pipeline mode, stub included.

## Risks / Trade-offs

- [A rewrite-side model that rejects `enabled: false` makes every classifier call fail closed, so every request fails.] → `docs/deploy.md` names the requirement and the measured refusers. The flow benchmark exposes it in one run. `WHIM_*_REASONING=default` restores today's wire exactly.
- [Answers might get worse with reasoning off on clarify and rewrite.] → The benchmark output (questions, plan rows) is read before a roster is recommended, and the per-role knob can switch reasoning back on.
- [Throughput sorting can route to pricier providers.] → Measured cost stays under $0.01 per call for the flash models; the knob is operator config.
- [Per-call log volume.] → At most eight lines per generation, no content.

## Migration Plan

No data or wire migration. On deploy, the unary roles switch to reasoning off by default. Rollback without a redeploy of code: set `WHIM_CLARIFY_REASONING`, `WHIM_REWRITE_REASONING` and `WHIM_SUMMARY_REASONING` to `default` (the classifier stays off, as its spec requires). New model and routing vars are opt-in.

## Open Questions

- Which roster to run in production: answered by running the flow benchmark and recorded in `docs/decisions.md`, not here.
