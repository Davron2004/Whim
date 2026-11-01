# Research digest: what would fixing #57/#66 (and the #58 surface) touch?

Paths are relative to /Users/davrondjabborov/Work/other/Whim. Specs consulted: generation-pipeline, generation-server, generation-contract, service-refusals, prompt-flow, server-admission-control, server-observability, server-deployment.

## Headline finding
**#57 is mostly already shipped** as beta-1 D10, archived at `openspec/changes/archive/2026-10-09-beta-1/design.md:179`. Live requirement: "A model turn that loses its provider is retried once" (`openspec/specs/generation-pipeline/spec.md:695`). The remaining gap is narrower than the issue text implies (see Q1).

## Q1. Model calls and error propagation (server)
**Call sites**
- `server/src/openrouter.ts:339` `OpenRouterClient.stream` is the only HTTP wrapper. `server/src/generation/model.ts:245` `openRouterModelClient` adapts it to `ModelClient`.
- Policy check: `server/src/policy/policy.ts:248`. It makes up to 2 attempts within one deadline and retries when `isUpstreamModelFailure` is true (`policy.ts:269`).
- Clarify: `server/src/routes/clarify.ts:557`. Any throw returns 502 `model_failure`. Only a 402 is distinguished.
- Rewrite: `server/src/routes/rewrite.ts:222`. Retry loop `rewriteWithRetry` (~:150-210). A failure returns `MODEL_FAILURE` 502 (`rewrite.ts:47,372`).
- Plan: `server/src/generation/machine.ts:895`. Generate: `:935`. Repair: `:974`. All three go through `runModelTurn` (`:788`).
- Summary: `server/src/generation/summarise.ts:250`. It never throws, swallows failures, and only invalidates the credit cache on a 402 (`:217`).

**Error classes** (`server/src/openrouter.ts`)
- `OpenRouterAuthError` (401), `OpenRouterRateLimitError` (429, `kind:'rate_limit'`), `OpenRouterCreditError` (402, `status` 402), `OpenRouterNetworkError` (`kind:'network'`, optional `status`).
- Single status mapping: `statusError` (`:214`). A mid-stream `data:{"error":{code}}` frame becomes the same typed error (`streamFrameError :307`, thrown at `:484`).
- Message `OpenRouter: stream error (502)` is `statusError(502, …)`, so `OpenRouterNetworkError` with `status` 502.
- There is no timeout error class. Timeouts are AbortSignals: unary `WHIM_UNARY_MODEL_TIMEOUT_MS` 60 s (`config.ts:412`), policy attempt bounds, and the run-wide `WHIM_GENERATION_MAX_MS` 600 s (`config.ts:364`).
- I found no first-token timeout on engineer turns (`streamModelTurn`, `machine.ts:809`). I did not verify this exhaustively.

**Classifiers** (`server/src/generation/model.ts`)
- `isCreditExhaustedError` (`:82`).
- `isUpstreamModelFailure` (`:91`): `rate_limit`, or `network` with status undefined or >=500. It already exists and is used by the machine and the policy check.

**Existing retry** (`machine.ts:340` `MODEL_TURN_RETRIES = 1`, `:797-804`)
- Only `label === 'generate' | 'repair'` retry. Plan, clarify and summary get 0 retries in the machine.
- If tokens were yielded, a `restart` event is emitted before the resend. The second failure is thrown.
- The failed attempt's generation id is recorded as uncredited (`failedAttempt :352`).

**Terminal outcome today**
- Any throw reaches `endOnThrow` (`machine.ts:724`).
- A 402 (`isCreditExhaustedError`) gives `CREDIT_EXHAUSTED_REASON` (`:249`), code `credit_exhausted`, and `invalidateCreditCache()` (`:728`).
- Everything else gives `GENERIC_INTERNAL_ERROR_REASON` (`:244`, "Something went wrong while I was making this app…") with code `internal_error`.
- Upstream 5xx and 429 get no distinct reason or code today.
- `emitCompletion` (`:752`) emits usage, then `state.budget.recordTerminal(…, code)`, then logs `info 'terminal failure'` with `{reason: code}` (`:767`), then yields the terminal. The `code` field name is redacted by the logger, hence `reason`.

**Ledger codes**
- Terminal codes: `server/src/generation/failure-codes.ts:8` (`plan_failed, repair_exhausted, containment_failed, run_unverified, expired, credit_exhausted, internal_error`).
- Request codes: `:25` (`model_failure, internal_error`).
- `FailureReason = TerminalFailureCode | RequestFailureCode | ServiceRefusalCode` (`server/src/usage-store.ts:184`), validated against a closed set on write (`:186,280`). A new refusal code becomes ledger-legal automatically. A new terminal code needs the array extended.
- The ledger row's code is `ledgerFailureReason` (`server/src/routes/generate.ts:802-807`): `trace.failureCode ?? 'internal_error'`.

**402 precedent, end to end**
- Pre-admission: `checkCredit` (`admission/credit.ts:131`) leads to `budgetExhaustedRefusal` (503, no Retry-After; `admission/refusals.ts:98`) at `routes/generate.ts:277-278`.
- Mid-call on generate: it is a stream `failure` terminal, not an HTTP 503. Test: `server/test/routes-generate.suite.ts:1396-1415`.
- Mid-call on clarify and rewrite: an HTTP 503 `budget_exhausted` (`clarify.ts:583`, `rewrite.ts:364-366`).
- The reason text is deliberately identical to the refusal hint (`machine.ts:247`).
- The alert keys on `jsonPayload.msg="provider credit exhausted"` (`deploy/monitoring/policy-credit-exhausted.json:8`).

## Q2. Streaming during an engineer turn
- Server emits `stage`, `token` (generate and repair only, `emitTokens`), `thinking` (length only, every turn), `diagnostic`, `usage`, `queued`, `restart`, `result` and `failure` (`contract/src/index.ts:397-421`). Plan emits no tokens (`machine.ts:895`, `false`).
- Model text does reach the device as `token{text}`, but the device only counts it.
  - `accumulateRunAggregates` (`src/host/launcher/prompt-flow.ts:675`) adds length and a count and discards the text.
  - `journalStreamEvent` (`src/host/launcher/build-lifecycle.ts:136`) throttles aggregates into the journal.
- **A discard event already exists:** `restart` (`contract/src/index.ts:410`, registered LEVEL_1 at `server/src/wire-level.ts:60`).
  - The device handler `withRestart` (`prompt-flow.ts:~650-660`) resets chars and tokens to the turn start. Turn start is set on a stage `start` edge (`build-lifecycle.ts:153`).
  - It writes no journal entry. Test: `src/host/launcher/test/flow-messages-ui.suite.tsx:139`.
- So "retry after tokens streamed" is not hard on the wire. It is already implemented for generate and repair.

## Q3. Contract: failure schema, refusal vocabulary, old-build behavior
- The terminal is `{type:'failure', reason: z.string(), attempts, diagnostics, compat?}` (`contract/src/index.ts:414-420`). `reason` is a free string with no enum or kind, so a new reason sentence is wire-safe.
  - The device shows an unknown reason verbatim as kind `other` (`src/host/launcher/failure-kind.ts:81`; prompt-flow spec: "an unknown reason SHALL show the server's text", `spec.md:417`).
  - The kind is derived from facts, never from wording (`failure-kind.ts:6-9,47`).
- `ServiceRefusalCode` is a closed zod enum of 9 values (`contract/src/index.ts:501`). The device table `REFUSAL_RULES` is a mapped type over it, so a new member breaks the typecheck until added (`src/host/launcher/service-refusal.ts:40`).
- Device hand-mirror `KNOWN_ERROR_CODES` is at `src/host/launcher/wire-compat.ts:41`.
- **Old build, unknown refusal code:**
  - `httpErrorFrom` (`src/host/launcher/transport-shared.ts:346`) runs `gateMessage(body, isKnownErrorCode(code))`.
  - Unknown code with no `compat` means fallback `fail`, which yields the generic reason `GENERIC_STREAM_ERROR` (`error-reason.ts:25,35`).
  - Unknown code with `compat{min, fallback, notice}` shows the `notice` (<=200 chars, plain text) on the failure screen.
  - In either case `serviceRefusalOf` returns undefined (`service-refusal.ts:76`), so Retry-After handling and the neutral notice landing are lost.
- **Mechanism for sending a new code safely** is protocol level, not build number.
  - `PROTOCOL_LEVEL = 1` (`contract/src/index.ts:45`). The client declares its level in `x-whim-protocol`. A request with no level gets 426 (`server/src/request-edge.ts:157-163`).
  - Every ApiError goes through `errorForLevel` via the wrapped `c.json` (`request-edge.ts:165-167`).
  - A code registered above level 1 in `WIRE_REGISTRY` (`server/src/wire-level.ts:65-86`) needs `compat`, and a lower-level client gets only the `{error, hint, compat}` envelope. Events work the same through `eventForLevel` (`generate.ts:599`).
  - Raising the level has consequences: `PROTOCOL_LEVEL` is shared with `wire-headers.ts`, and the device suite `wire-future-frames.suite.ts` holds the mirrors to the contract.
- The build number is in the envelope (`c.get('envelope').build`, `request-edge.ts:174-177`; spec request-envelope). It is used by the min-build gate (`server/src/min-build.ts`, 426). There is no per-build sending of reasons today. I did not look for a build-keyed code path.

## Q4. Device: failure copy, report, refusal hints
- Kind map: `failureKindOf`, `failureSentence`, `failureActions` in `src/host/launcher/failure-kind.ts:47,67,112`. Kinds: couldnt-run, refused, needs-update, closed, stopped, connection, other. The page is `FailurePage.tsx`. Title and static strings are in `copy.ts:185-196`.
- Terminal `failure` event handling: `src/host/launcher/LauncherRoot.tsx:3068-3082`. Thrown errors go through `errorReason` / `errorRemedy` (`error-reason.ts:29-78`).
  - A `server_refused` code covers a 4xx or 5xx with a hint, shown verbatim.
  - Rewording is not advised for `server_refused`; the remedy is `retry` (`error-reason.ts:71-78`).
- Refusals during a flow: `serviceRefusalOf` (`LauncherRoot.tsx:2072, 2612`). `REFUSAL_RULES` gives `landing: 'text'|'sender'` and tone. `refusalText` prefers the rule's own `text`, else the server hint. `retryAtOf` / `retryLine` render Retry-After (`service-refusal.ts:99-147`). Spec: `openspec/specs/service-refusals/spec.md` (headers in Q9).
- **"Report this" on a failure: I found none.**
  - `FailurePage.tsx` has no report code.
  - The content-report sheet (`ReportScreen.tsx`) opens only from a running app (`LauncherRoot.tsx:3599,3865`), History, or Settings (`:3823`).
  - Whether #66's "no report prompt" refers to something else (run details, an unmerged branch) I did not verify.
- Copy tone sources:
  - `COPY` table with a `prose` / `control` class map (`copy.ts:~560-600`).
  - Server hints are fixed in the `REFUSAL_HINTS` table (`server/src/admission/refusals.ts:25`).
  - The spec bans internal identifiers, model names and env names in hints (`server-admission-control` "Every refusal is a structured, user-facing ApiError").
  - The legal-surface notes say the #66 outage message must not name the vendor and sends no new data (`docs/research/legal-surface-2026-09/README.md:80,565,631`).

## Q5. Admission control
- Fixed order (`server-admission-control/spec.md:138`): device identity 400, raw body cap 413, body validation 400, prompt cap 413, **operator credit 503**, drain, device exclusivity, global cap, daily units (429 then server_busy), content policy, then the route's work.
- Code: `admitGeneration` (`server/src/routes/generate.ts:273-318`), credit first (`:276-282`) and slot acquire at `:284`. Clarify and rewrite call the same `checkCredit`.
- A breaker refusal would sit beside or around the credit step. The spec says a refusal at that step consumes no daily unit and acquires no slot.
- **Credit check analogue** (`server/src/admission/credit.ts`):
  - Module-level state (`cached`, `inflight`, `cacheEpoch`; `:73-77`).
  - TTL cache (`WHIM_CREDIT_CACHE_TTL_MS`, default 60000), shared in-flight lookup, 5 s lookup timeout.
  - It fails open on lookup failure and is invalidated on a 402.
  - There is no timed background probe: the lookup happens lazily on the next admission after TTL expiry.
  - Refusal code `budget_exhausted`, 503, no Retry-After (`refusals.ts:98`).
- Retry-After exists only on `daily_limit` and the ceiling `server_busy`, via `retryAfterUntilMidnight` (`refusals.ts:57,67,82`). The spec says it is "present exactly where knowable" (`server-admission-control/spec.md:161`), so a breaker refusal with Retry-After would touch that requirement.
- Deployment: `--max-instances 1` and gen2 (`server-deployment/spec.md:152-159`), so in-memory state is one instance's. The Firestore backend holds admission counters, not credit or policy cache state. I did not verify a store for non-ledger state.

## Q6. Observability and alerts
- Alerts are committed JSON in `deploy/monitoring/` (`policy-*.json`, `metric-*.json`, `channel-email.json`). `whim_apply_monitoring` (`deploy/lib.sh:327-335`) globs `policy-*.json` and `metric-*.json`, and applies them by fingerprint on every plain deploy (`deploy/cloudrun/deploy.sh`). A new alert is a new file plus a doc note in `docs/deploy.md` ("Operating: Alerts"). Spec: `server-deployment/spec.md:307-320`; fast-gate coverage is in `server/test/deploy-config.suite.ts`.
- Two alert styles exist:
  - Log-match with `notificationRateLimit` 3600 s (`policy-credit-exhausted.json`).
  - Metric threshold: `metric-whim-terminal-failures.json` counts `jsonPayload.msg="terminal failure"`, and `policy-terminal-failures.json` alerts at >5 in an hour.
- Any upstream-failure terminal would be counted by that metric unless its log message differs.
- Filters must include `resource.type="cloud_run_revision"` and the service name `whim-server`, and may not reference docker or GCE (spec above).
- Log conventions (`server/src/logger.ts`): pino JSON with `severity`. The serializer redacts `code`, `prompt`, `source`, `deviceId`, `email` and similar at depth <=3, so closed codes go in a `reason` field. Request-bound loggers carry `requestId` (`state.log`, `requestLog`). Model-call lines: `'model call'` with `outcome` completed/failed/aborted (`openrouter.ts:408`).
- Server-observability spec: "The owner is alerted by email" names the policies in prose, so a new alert implies a delta there.

## Q7. Test seams
- Stub: `[[fail]]` (`server/src/pipeline.ts:196`), `[[limit]]`, `[[noclarify]]`, `[[future:skip|fail|update]]` (`server/src/stub-markers.ts`), policy `[[refuse]]` / `[[policy-down]]` (`policy/policy.ts:281-282`). There is no stub marker for a provider failure.
- `server/test/scripted-model.ts`: `ScriptedTurn{role, deltas, usage?, id?, error?}` throws `error` after the deltas and rejects `usage`. Real `OpenRouterNetworkError` and credit doubles are used in `routes-generate.suite.ts:200-202,1575`. The retry is covered at `:1575-1589` (token, restart, token, result).
- `server/test/openrouter.suite.ts`: SSE frame fakes covering HTTP statuses and mid-stream error frames (:646-724). `machine.suite.ts` covers the terminal reasons. `routes-unary.suite.ts` covers clarify and rewrite failures (:1053-1176, 402 → 503).
- Suites use a `section()` / `eq()` / `check()` style. Run with `npm run server:test -- --only <suite>`.
- Flowbench (`server/src/flowbench/drive.ts`) retries only `policy_unavailable` 503s (`:166,185-193,328`). It records a `failure` terminal's reason and attempts (`:346,429`). It has no upstream-failure handling.
- Device suites (`npm run launcher:test -- --only <name>`): `failure-screen`, `error-reason`, `service-refusal`, `refusal-landing`, `wire-future-frames`, `flow-messages-ui`, `prompt-flow-*`, `build-lifecycle`.

## Q8. #58 terrain (names only)
- Copy: `UNVERIFIED_RUN_REASON` = "We couldn’t verify this app ran safely. Please try again." (`server/src/generation/machine.ts:243`). Spec text: `generation-pipeline/spec.md:~286`. The device has no copy of its own; it shows the server's reason as kind `other`.
- Ledger code `run_unverified` (`failure-codes.ts:12`), produced by `failureTerminalFor`, case `'containment-unobserved'` (`machine.ts:622-627`).
- Path:
  1. `machine.ts:1192` `this.deps.run.run(...)`.
  2. `runOutcome.contained !== true` (`:1203`) leads to `unverifiedRunOutcome` (`:585`), where `contained === null` gives `containment-unobserved`.
  3. `createRunStage` (`server/src/generation/stages/run.ts:54`) returns `{contained: null, verdict: unobservedVerdict(report)}` (`:75`).
  4. `createRunCandidate` (`synthrun/report.ts`, wired at `server/src/generation/index.ts:97`).
- Logging: `'terminal failure'` carries `verdict` and `check` (`machine.ts:767`); spec `generation-pipeline/spec.md:711`. Tests: `run-stage.suite.ts`, `machine.suite.ts`.

## Q9. Requirement headers likely touched (verbatim)
- generation-pipeline: "A model turn that loses its provider is retried once" (`:695`); "A run ends cleanly when the operator's provider credit is exhausted" (`:585`); "Exactly one terminal event per completed run" (`:84`); "Every model call goes through an injectable client" (`:121`).
- generation-server: "SSE generation endpoint over the real generation pipeline"; "OpenRouter client wrapper"; "Clarify endpoint"; "Rewrite endpoint over the real rewrite model".
- generation-contract: "Service refusal codes are a closed vocabulary" (`:322`); "The client declares the protocol level it understands" (`:337`); "Every wire message carries a forward-compatibility envelope with a closed fallback vocabulary" (`:348`); "SSE generation event stream schema" (`:142`); "Structured API error body" (`:255`).
- service-refusals: "A refusal is recognised by the contract's closed refusal vocabulary"; "An availability or limit refusal lands on the step whose action sent the request"; "Retry-After holds the retry action until the window passes"; "A refusal from compose, clarify, or plan never opens the failure screen".
- prompt-flow: "Failure is shown by kind, honestly, never as a crash" (`:415`).
- server-observability: "The ledger records a closed failure code"; "The owner is alerted by email".
- server-admission-control: "The server refuses admission when the operator's provider credit is exhausted" (`:114`); "Admission checks run in a fixed order before any model work" (`:137`); "Every refusal is a structured, user-facing ApiError" (`:158`).
- server-deployment: "Log-based alerts match the Cloud Run service's logs" (`:307`); "The server runs on Cloud Run gen2 with Chromium's sandbox" (`:152`).

## Must not break
- Exactly one terminal `GenerationEvent` per completed stream, with `usage` immediately before it (`machine.ts:752`; spec "Exactly one terminal event per completed run"). A client abort ends the stream with no terminal.
- Every `/v1/*` route is gated by `x-whim-device`, then the envelope and protocol-level middleware. A request without a protocol level gets 426.
- A refusal is an `ApiError` with a hint, using a closed code and a user-facing sentence with no model, provider or env names. Refusals consume no slot or daily unit before the slot step.
- The ledger holds closed codes only. A write outside the sets is rejected and no free text is stored.
- A new wire code or event above level 1 needs `compat`, registry entries on both sides, and the device mirror kept equal to the contract (`wire-compat.ts` hand-mirror, `wire-future-frames.suite.ts`).
- Metro-safety: the device imports `@whim/contract` types only, never zod values.
- The 402 path stays authoritative: no repair after a 402, and `invalidateCreditCache()` runs.
- Retries must still meter the failed attempt's usage and record uncredited generation ids (`failedAttempt`).
- Alert definitions must filter `cloud_run_revision` / `whim-server`.
- Logs carry no prompt, source or device id, and field names `code`, `source`, `prompt` are redacted.

## Risks and unknowns
- I did not read `gh` issue bodies, so #57 and #66 are taken from the summary. The two sets of claims may not match: the issue says "no retry", but D10 shipped on 2026-10-09. I did not check whether production runs a build older than D10.
- I did not verify a first-token timeout for engineer turns, or whether the breaker's "timeouts before first token" would need a new one.
- I did not read `server/src/app.ts`, `main.ts` or `pipeline.ts` wiring for where a process-level breaker object would be constructed and injected, or `deploy/smoke.sh` interactions.
- Unverified: whether `ServiceRefusalCode` additions have other mirrors besides `KNOWN_ERROR_CODES`, `REFUSAL_RULES`, `WIRE_REGISTRY` and `REFUSAL_HINTS` (e.g. `server/test/contract.suite.ts`, docs listings).
- I did not read the full `FailurePage` / `LauncherRoot` failure wiring (`:3700-3720`) for report or run-details affordances.

## Open questions for the planner
1. Is the #57 residual scope plan-turn retry (retries=0 today), the second-failure case, or only the missing distinct classification? D10 already covers generate and repair.
2. Should a new upstream reason go out as a new sentence on the existing `failure` event (wire-safe for all builds), or also as a new ledger or log code? Either way, a new refusal code needs a protocol-level bump for old-build safety.
3. Should the breaker refusal be a new `ServiceRefusalCode`, which implies a `compat` envelope for level-1 clients? Or should it reuse an existing code (e.g. `server_busy`) with a new hint?
