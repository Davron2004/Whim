# Research digest: where do clarify, plan writing and generation spend their time, and what would per-role model and reasoning control touch?

<!-- Condensed from the researcher subagent's digest (sections A–H, 2026-09-22) to the 120-line cap;
     citations kept as the researcher gave them. Measurements live in design.md, not here. -->

## Relevant files
- `server/src/openrouter.ts` — the one OpenRouter client. `requestBody` (:121-131) builds every request: model, messages, `stream: true`, optional `max_tokens`/`temperature`, `reasoning: { enabled: true }` only when the caller's `reasoning` is truthy, `stream_options.include_usage`. Never sends `reasoning: { enabled: false }`, never sends `provider`. Reads `OPENROUTER_API_KEY` from `process.env` directly (:275).
- `server/src/generation/model.ts` — `ModelRequest` (`reasoning?: boolean`), `ModelRoster { rewrite, engineer }`, `modelRosterFromEnv` (throws `ModelRosterEnvError` naming every missing var, never defaults), `openRouterModelClient` (1:1 pass-through adapter).
- `server/src/config.ts:107-179` — the typed env loader for every `WHIM_*` var (timeouts, limits, data dir, log flags).
- `server/src/lifecycle.ts:376-389` — composition root: Chromium launch + boot self-test, roster → content policy (`rewriteModelId: roster.rewrite`) and pipeline.
- `server/src/policy/policy.ts:59,112-128` — classifier: rewrite model, `maxTokens: 48`, `reasoning: false`, own `WHIM_POLICY_TIMEOUT_MS` (10 s); `parseVerdict` is a strict guard; anything unparseable → `PolicyUnavailableError` → `503 policy_unavailable`.
- `server/src/routes/clarify.ts:290,459-521` — admission → classifier → clarify call on `roster.rewrite` (:485, no `maxTokens`, no `reasoning`) → `shapeClarify` (malformed → `502`, no retry).
- `server/src/routes/rewrite.ts:101-128,183` — classifier → 1–2 rewrite calls on `roster.rewrite` (one retry when the reply has no plan rows).
- `server/src/generation/machine.ts:653-689` — `runModelTurn`, shared by plan/generate/repair: `{ model: roster.engineer, messages, reasoning: true }`.
- `server/src/generation/summarise.ts:63,216-219` — post-run summariser on `roster.rewrite`, own 20 s timeout, awaited before the terminal `result` event.
- `server/src/loadtest/drive.ts`, `server/loadtest.mjs` — existing `/v1/generate`-only load driver (time-to-first-event and total, p50/p95); `knip.json` lists `src/loadtest/drive.ts` as a server entry.
- `evals/cli.mjs:68,106` — `run --generate` is hard-wired to `createStubPipeline(0)`; `run --source-dir <dir>` scores `<dir>/<caseId>.ts` offline (Tier A static+containment, Tier B assertions).
- `evals/sets/visible/manifest.json` — `visible-dev-v1`, 22 cases (`caseId`, `appSlug`, `prompt`, assertions).

## Current behavior
- Two model ids exist. `WHIM_REWRITE_MODEL` serves four call sites (classifier, clarify, rewrite, summariser); `WHIM_ENGINEER_MODEL` serves three (plan, generate, repair).
- Serial model calls per request: clarify = classifier + clarify (2); rewrite = classifier + 1–2 rewrite (2–3); generate = classifier + plan + generate + 0–3 repair + summariser (4–7). Nothing overlaps.
- The code's comments (`openrouter.ts:116-120`, `model.ts:29-34`) assume a request without `reasoning` gets no reasoning: "this only unhides a stream that already happens, it doesn't change it". Callers that omit it (classifier, clarify, rewrite, summariser) therefore take the provider default.
- No call sets `temperature` or `response_format`; JSON replies are prose-instructed and parsed by `generation/json-block.ts`. Only the classifier carries `max_tokens`.
- Generate/repair system message ≈ 47.5k chars (SDK reference ≈ 27k + five few-shot fixtures ≈ 18.5k + instructions), resent on every repair round. Plan/clarify/rewrite/summary system messages are 0.7–1.4k chars.
- Stage events carry `stage`/`status`/`attempt` only; the server logs request `durationMs` and the policy check's `durationMs`, nothing per model call or per stage.
- The ledger records per-request tokens, cost and OpenRouter generation ids (`usage-store.ts:293-307`); `admin.mjs usage` reports cost and counts, no latency.

## Constraints and invariants
- Content policy (`openspec/changes/public-generation-server/specs/content-policy/spec.md`, unarchived but deployed): the check runs after admission and before any clarify, rewrite or pipeline model call and before any SSE stream opens (:3-6); it classifies "using the roster's `rewrite` model id, with reasoning disabled, a small output-token cap, and the policy timeout" (:55); its scenario requires the call to carry an output-token cap and request no reasoning stream (:65). Fail closed: `503 policy_unavailable`, daily unit refunded.
- `generation-pipeline` §"Every model call goes through an injectable client": model ids are caller parameters read from the environment per role; no model-id literal under `server/src/generation/` (tripwire in `server/test/prompts.suite.ts`); no gate test makes a live call (throwing transport, `OPENROUTER_API_KEY` unset).
- `generation-server` §"Rewrite endpoint over the real rewrite model": the rewrite model is "a small, fast model distinct from the engineer model".
- `generation-contract`: exactly one terminal event; `result.summary` is optional; `thinking` carries a length only — reasoning text never crosses the wire.
- Logging redacts prompt/source/device id/API key at the serializer (`logger.ts:35-106`).
- Model ids are operator config (privacy page names only OpenRouter).

## Integration points
- `requestBody` (wire mapping of reasoning and provider preference); the `OpenRouterClient` constructor (a per-client provider preference); `ModelRequest` (per-call reasoning and a role label).
- `modelRosterFromEnv` / `config.ts` (new optional env vars, validated at boot like every other `WHIM_*`).
- Call sites: `policy.ts:112-128`, `clarify.ts:485`, `rewrite.ts:183`, `summarise.ts:216-219`, `machine.ts:663`.
- A flow benchmark would sit beside `server/src/loadtest/` and reach the server over HTTP only.

## Risks and unknowns
- The researcher did not verify whether a bare `npm install` downloads Playwright's Chromium; preflight checks package resolution only.
- Admission: `WHIM_LIMIT_GENERATIONS_PER_DEVICE_DAY` (15) would stop a same-device benchmark loop; per-case fresh device ids avoid it.
- `/v1/clarify` has no retry on malformed output; `/v1/rewrite` and plan each retry once (a full extra model call).

## Open questions for the planner
- None from the terrain. Which models to run is an operator decision the benchmark informs.
