## Context

The proposal names three bad endings. Two documents in this folder hold the evidence: `research.md` (the researcher digest; cited as R§Qn) and `rc-58.md` (the #58 root cause, all paths to `run_unverified`, and the production log survey; cited as RC§).

- **#58.** A candidate that throws during module evaluation aborts the inline script, so `__whimAfterBundle()` never runs. With no mount, no paint and no probes, the report carries `contained: null`. The run stage maps `null` to the terminal `run_unverified`, and no repair happens (RC§root cause, table rows 1–9). The log line the issue asked for already exists (`machine.ts` `terminal failure {reason, verdict, check}`, beta-1 D11). It can't tell a candidate's CDP throw from the loader's own `[where]` error frames, though (RC§evidence).
- **#57.** Beta-1 D10 already resends a generate or repair turn once after an upstream failure, with `restart` when tokens had streamed (R§Q1, R§Q2). Plan is the only engineer turn with no resend (`machine.ts` `runModelTurn`, `retries = 0` unless generate/repair).
- **#66.** An upstream failure that survives the resend ends as `internal_error` with "Something went wrong while I was making this app" (R§Q1 terminal outcome; RC§"What the app shows today"). Clarify and rewrite answer `502 model_failure`. A failed `model call` line has no status or error kind (RC§provider-failure evidence). There is no breaker. The closest analogue is the lazily refreshed credit check in `admission/credit.ts` (R§Q5).
- Production has seen none of these failures (RC§provider-failure evidence: 17 runs, 0 terminal failures, 0 upstream errors). Everything here comes from benchmarks and code reading.
- Wire: `ServiceRefusalCode` is a closed enum. The device's `REFUSAL_RULES` is a mapped type over it, and `KNOWN_ERROR_CODES` is a hand mirror. A new code is sent safely by protocol level through `WIRE_REGISTRY`/`errorForLevel` (R§Q3).

## Goals / Non-Goals

**Goals:**
- A candidate that never mounted by its own fault goes to repair. Only a harness fault can end as "couldn't verify", and only after one fresh re-run.
- Logs say which phase kept the verdict away and whether a re-run happened, without content.
- Plan gets the same one resend as generate and repair.
- An upstream outage is named honestly to the user, in one sentence that no build misreads, and the server stops making users wait during one.
- An email reaches the owner when the breaker opens.

**Non-Goals:**
- Changing the sandbox runtime (`src/runtime/web/loader.js`), `invariants/`, or the containment verdict's meaning.
- A fallback model (#66 rules it out explicitly).
- A first-token timeout for engineer turns.
- A new device failure kind or new failure UI. The server's sentence carries the message, and a structured cause (D11) only removes the rewording advice.
- Persisting breaker state across instances. Production runs `--max-instances 1` (R§Q5).

## Decisions

### D1 — Split the unobserved verdict by phase. Repair the candidate's own faults, re-run harness faults once

`stages/run.ts` reads the report's new `unobservedPhase` (D3) when `contained === null`:

- **`module-eval`, `bundle`, `mount-timeout` mean the candidate's fault, so the candidate is repaired.** The stage returns a new repairable `RunOutcome` arm. Its diagnostics are the report's diagnostics minus every `containment_*` kind: the CDP `runtime_throw` or `unhandled_rejection` with its mapped `line`, the loader's `[bundle]` throw, or the `mount_timeout`. `machine.ts` handles this arm like the existing build-failure branch. It closes the `run` stage with the diagnostics streamed as `diagnostic` events, then returns `repair` while `repairsUsed < repairAttempts`, else `failed` with `repair_exhausted`. That arm never delivers.
- **`mount`, `deliver`, `probes`, `none` mean a harness fault, so the candidate is re-run once.** The stage calls the bound `runCandidate` a second time with the same source. Each call already gets a fresh browser context (synthetic-run "Session lifecycle isolates candidates"; `synthrun/session.ts` `newContext`). A `true` or `false` re-run verdict is handled exactly as a first-run one. A re-run that is still `null`, in any phase, returns the terminal unobserved arm with `rerun: true`. An aborted signal skips the re-run.
- **This replaces `openspec/changes/archive/2026-08-11-harden-containment-observation/design.md` D3** ("an unobserved verdict is terminal, and is not re-run"). That D3 rejected a re-run because the remaining `null` causes were "dominated by deterministic ones: a candidate that never mounts…". Those causes now go to repair instead, so what is left for the re-run is mostly harness or Chromium faults: the case D3 granted a retry would help.

The re-run lives in the stage, not the machine, because the stage owns the bound `runCandidate` and the build output. The machine sees one outcome per candidate and only needs `rerun` for its log line.

Safety:
- Only an observed `true` ever delivers. Neither new path can deliver the candidate that went unobserved.
- The repair prompt carries candidate-authored text, the throw's message. That is not a new channel: every ordinary `runtime_throw` repair already forwards the candidate's own message.
- No `containment_*` detail and nothing about forgeries is forwarded, because the stage filters by kind.
- A candidate that suppresses its own verdict after paint gains at most one extra run. That is the "resource multiplier" the old D3 worried about, and it is bounded at 2×.

*Alternatives rejected:*
- Classifying in the machine from diagnostic messages: the `[where]` prefix is message text, and D2 forbids deriving from it.
- Re-running every unobserved verdict: a module-scope throw is deterministic, so a re-run only doubles the dead end.
- Fixing the loader so probes run even when the bundle fails (RC§fix 3): that is the runtime/invariants area, and it is parked (below).

### D2 — Log the phase and the re-run, never content

Every `terminal failure` line gains:
- `phase`: the unobserved phase of the run that ended the attempt, or `none`.
- `rerun`: `true` or `false`.

Both are closed values next to the existing `{reason, verdict, check}`. A never-mounted candidate sent to repair also logs one info line, `run never mounted {phase}`. Without it, a repaired #58 case would leave no trace in production logs, and the next real occurrence is exactly what #58 wants to see. Logger redaction (R§Q6) already keeps `code`/`source`/`prompt` out. These fields carry no message, symbol or hint.

### D3 — The harness reports the phase. Minimal surface: one optional report field

`RunReport` gains `unobservedPhase?: 'module-eval' | 'bundle' | 'mount' | 'deliver' | 'probes' | 'mount-timeout' | 'none'`. It is present exactly when `contained === null`.

`synthrun/observe.ts` already knows each cause's channel:
- `onException`, CDP: the top frame's `url === ''` means the candidate's own inserted script. Whether a paint has arrived is known at that point.
- `recordMountError`: the loader's `where`.
- The mount-budget path.

So observe.ts records the first cause's phase into `ObservationState`, and `finalizeContainmentVerdict` stamps it, with `none` when nothing was recorded.

*Alternative rejected:* a per-diagnostic `origin` field. It widens `RuntimeDiagnostic`, which mirrors the checks contract's closed shape, and every consumer would have to learn it. The server needs one answer per report, not per diagnostic.

### D4 — Plan gets the one resend

In `runModelTurn`, `retries` becomes `MODEL_TURN_RETRIES` for `plan | generate | repair`. Plan streams no tokens, so `yieldedTokens` is false and no `restart` is emitted. The failed attempt is still metered through `failedAttempt`. Everything else from beta-1 D10 stays.

### D5 — One classifier, in a leaf module

`server/src/model-failure.ts` exports two things:
- `modelFailureOf(err: unknown, signal?: AbortSignal): { errorKind: ModelErrorKind; status?: number; upstream: boolean }`, which decides upstream as `server | rate_limit | network | timeout`.
- `ModelErrorKind = 'server' | 'rate_limit' | 'network' | 'timeout' | 'auth' | 'credit' | 'client' | 'cancelled' | 'other'`.

It has to be a leaf module: `openrouter.ts` needs it for the log line, and `generation/model.ts` imports `openrouter.ts`, so putting it in `model.ts` would create a cycle. `isUpstreamModelFailure` delegates to it and keeps its call sites.

The signal is checked first, because an abort currently surfaces as `OpenRouterNetworkError('fetch failed')` with no status, which the old classifier would call upstream:
- `signal.aborted` with `reason.name === 'TimeoutError'` is `timeout`. That covers the clarify and rewrite `AbortSignal.timeout` and the policy attempt timer.
- Any other abort is `cancelled`. That covers a client disconnect and the run-wide deadline, which call `controller.abort()` with no reason. The summary timeout is also `cancelled`.
- After that, the typed error decides: `status` 5xx is `server`, `kind: 'rate_limit'` is `rate_limit`, `network` without status is `network`, then 401 `auth`, 402 `credit`, other 4xx `client`.

`openrouter.ts` `logSettle` adds `errorKind` and `status` on failed and aborted lines.

### D6 — Its own terminal code and sentence. 503 on clarify and rewrite

- `TERMINAL_FAILURE_CODES` gains `provider_unavailable`. The ledger's closed set picks it up, and it is the same string as the refusal code.
- `REFUSAL_HINTS.provider_unavailable` holds the sentence (chain-wire), and the machine's `PROVIDER_UNAVAILABLE_REASON` imports it, so the two can't drift. The `CREDIT_EXHAUSTED_REASON` precedent kept a duplicate. The sentence is ≤200 chars, has a typographic apostrophe, and names no vendor or model (legal-surface notes, R§Q4).
- `endOnThrow`: a 402 stays first (`credit_exhausted`). Next, the error of a failed plan, generate or repair resend that `modelFailureOf` calls upstream gives `provider_unavailable`; `runModelTurn` marks that error where it throws it, and `endOnThrow` reads only the mark. An upstream-shaped error thrown from anywhere else (a stage, an adapter) is `internal_error`.
- Clarify and rewrite: after the existing 402 branch and the rewrite's existing retries, an upstream failure answers `503 provider_unavailable` with no `Retry-After` and ledgers `provider_unavailable`. This mirrors the mid-call 402 → `503 budget_exhausted` precedent (R§Q1).

*Alternative rejected:* `Retry-After` on a mid-call 503 when the breaker happens to be open. It would couple chain-upstream to chain-breaker for a marginal gain, and the device still lands the refusal neutrally.

### D7 — `provider_unavailable` at protocol level 2

- `contract`: `ServiceRefusalCode` gains `provider_unavailable`, and `PROTOCOL_LEVEL = 2`.
- `wire-level.ts`: `ERROR_LEVELS.provider_unavailable = { level: 2, compat: { min: 2, fallback: 'fail', notice: REFUSAL_HINTS.provider_unavailable } }`.
- Device: `PROTOCOL_LEVEL = 2` (`wire-headers.ts`), `KNOWN_ERROR_CODES` gains the code, and `REFUSAL_RULES.provider_unavailable = { landing: 'sender', tone: 'neutral' }` with no `text`, so the server hint shows verbatim. Retry-After handling is code-agnostic (`retryAtOf`).

How the server treats a declared level:
- `ProtocolLevelHeader` is `PositiveIntegerText` with no upper bound, and `forLevel` sends a message as-is when `entry.level <= clientLevel` (R§Q3; `server/src/wire-level.ts`). A client declaring a level above the server's own is therefore served normally and never receives anything the server doesn't have.
- **Server-first deploy:** level-1 builds get the `{error, hint, compat}` envelope and show the notice, which is the same sentence.
- **Client-first deploy:** a level-2 build against a level-1 server just never sees the code.
- Rollback is equally safe.
- The `failure` event is level 1 and its `reason` is a free string, so every build shows the terminal sentence (R§Q3). Its optional `cause` is a level-2 field (D11) that the server strips for level-1 clients.

Device side effects of the bump:
- `stillNeedsUpdate(record, PROTOCOL_LEVEL)` will clear any stored `min: 2` needs-update record. None exist in the field, because no level-2 message has ever shipped.
- Device and server suites that use "level 2" as the made-up future level (`wire-future-frames.suite.ts` `levelTwo(...)`, `PROTOCOL_LEVEL + 1` fixtures) must move to `PROTOCOL_LEVEL + 1`.

*Alternative rejected:* a `downgrade` to `server_busy` for level-1 clients. It keeps the neutral landing but tells old builds the wrong cause.

### D8 — A process-level breaker, fed at the model-client seam, checked before credit

- **Module.** `server/src/admission/provider-breaker.ts` exports `createProviderBreaker({ failures, windowMs, cooldownMs, clock, log, probe })`. It is created once in the composition root (`server/src/lifecycle.ts`) and injected. That is deliberate: credit.ts keeps module-level state instead, and injecting lets the route suites build their own instance with a fake clock.
- **State.** `closed{count, firstAt}` → `open{since, until}` → `probing{promise}` → `closed | open`.
  - `record(outcome)` handles the outcomes, and only calls to the roster's engineer model are recorded. An upstream failure increments the count, and if `now - firstAt > windowMs` the streak restarts at this failure. A completed call resets the count and closes an open breaker, since a completed call proves the engineer model's provider answers. Anything else does nothing.
  - `admit()` returns `{ok: true}` or `{ok: false, retryAfterSeconds}`. After the cooldown, the first `admit()` starts the probe and every caller awaits the same promise, the shared in-flight pattern of `admission/credit.ts`.
  - `failures = 0` makes `admit()` always pass and `record()` a no-op.
- **Feed.** A `ModelClient` decorator, `withProviderBreaker(inner, breaker, engineerModel)`, wraps the one client the composition root hands to every role. For a request whose `model` is the engineer model it observes the stream's settle (delta iterator end or throw, plus the `usage` promise) and calls `record(modelFailureOf(err, signal))`; a request for any other model passes through unobserved. Counting every role's calls was rejected: policy, clarify and rewrite succeed between an engineer-model outage's failures and kept resetting the count below the threshold, so the breaker never opened while every generation still waited through two failed plan turns. Putting the feed inside `OpenRouterClient.stream` instead was rejected because the route and machine suites inject `ScriptedModelClient` and would never exercise the breaker. Chain-breaker verifies that the policy check, summary and unary routes really share that client, and wraps any that doesn't.
- **Admission.** `admitGeneration` and the clarify and rewrite admission helpers call `breaker.admit()` immediately before `checkCredit`. A refusal is `providerUnavailableRefusal(retryAfterSeconds)` (`503`, `Retry-After = ceil((until - now)/1000)`) and comes before any slot, unit or credit lookup. During an outage the credit lookup's I/O is skipped.
- **Probe.**
  - It calls the inner, undecorated client so its outcome is not double-counted: `{model: roster.engineer.model, messages: [one short user message], maxTokens: 1, reasoning: 'off', role: 'probe'}` under `AbortSignal.timeout(10_000)`. `ModelCallLabel` gains `'probe'`.
  - A completed stream closes the breaker. A failure always logs `provider probe failed {errorKind, status}`. If it failed upstream the breaker re-opens for a full cooldown and logs `provider breaker open` again (marked `reopened: true`), so the log and the alert show a continuing outage. Any other failure (a `401`, `402` or `400`) says the provider is up and the problem is ours: the breaker closes, with the probe's `errorKind` and `status` on the `provider breaker closed` line, and admission goes on to the credit check, where `budget_exhausted` and its alert can fire. Re-opening on those would fail every probe the same way and hide them behind `provider_unavailable` until a restart.
  - The probe has its own `model call` line and no ledger row, so it is credited to no device. Its cost is about one token per cooldown.
- **Config.** `WHIM_PROVIDER_BREAKER_FAILURES` (default 4, ≥0), `WHIM_PROVIDER_BREAKER_WINDOW_MS` (180000), `WHIM_PROVIDER_BREAKER_COOLDOWN_MS` (60000), read in `config.ts`.
- **Logs.**
  - `provider breaker open` (warn) `{failures, windowMs, cooldownMs, errorKind, status}`.
  - `provider breaker closed` (info) `{openMs}`, plus `errorKind` and `status` when a non-upstream probe failure closed it.
  - `provider probe failed` (warn).
- **Alert.** `deploy/monitoring/policy-provider-breaker-open.json` has the same shape as `policy-credit-exhausted.json`:
  - one `conditionMatchedLog` with filter `resource.type="cloud_run_revision" AND resource.labels.service_name="whim-server" AND logName:"run.googleapis.com%2Fstdout" AND jsonPayload.msg="provider breaker open"`
  - `notificationRateLimit` 3600 s and `autoClose`
  - `{{CHANNEL}}`/`{{SPEC}}` placeholders
  - documentation naming docs/deploy.md "Operating: Alerts"

  `deploy/lib.sh` globs `policy-*.json`, so no deploy-script change is needed (R§Q6). `deploy-config.suite.ts` already checks every policy file for the Cloud Run filter and a single condition.

### D9 — No report prompt, pinned rather than built

`FailurePage.tsx` has no report affordance. The content-report sheet opens only from a running app, History or Settings (R§Q4). A `failure-screen` suite case pins it. The case renders the provider sentence as a terminal failure and asserts it shows verbatim with a retry action and no report control. The red-check is to add a report control temporarily.

### D11 — A structured `cause` on the `failure` event, so a provider failure doesn't advise rewording

Today a terminal `failure` sets `rephraseHelps: input.remedy == null` (`LauncherRoot.tsx` `showStreamFailure` call, and again when a failed run is reopened from its tile), so the page leads with "Change the description". That contradicts "It’s not something you did." The device must not read wording, and D9 forbids a new failure kind, so the fact travels as data.

- **Contract (chain-wire).** `failure` gains `cause: z.enum(['provider_unavailable']).optional()`, introduced at level 2 (the same bump as D7). The server's `FailureCause` is closed; the device's reader is not (below).
- **Server (chain-upstream).** The terminal built for the `provider_unavailable` code (D6, `endOnThrow`) sets `cause: 'provider_unavailable'`. No other terminal sets it.
- **Level gating.** Verified in `server/src/wire-level.ts`: the registry is per event type or error code. `forLevel` sends a message unchanged when `entry.level <= clientLevel`, and `downgrade`/the envelope exist only for a whole message above the level. `failure` stays level 1, so today nothing strips a field from it. Chain-wire therefore adds one optional member to `WireEntry`, `fields?: Readonly<Record<string, number>>` (field name to the level it was introduced at). `forLevel` drops every listed field whose level is above `clientLevel` from the message it returns, after the level check and before `withCompat`. `EVENT_LEVELS.failure` becomes `{ level: 1, fields: { cause: 2 } }`. `eventForLevel` is already the single exit of `routes/generate.ts` (`forClient`), so the gating reaches the stream with no route change. A level-1 client sees the exact event it saw before.
- **Device reader (chain-wire).** The failure guard in `generation-client.ts` (`EVENT_GUARDS.failure`) checks only the fields it knows and `knownEventOf` keeps the rest, so an unknown field never fails parsing. `EVENT_OPTIONAL.failure` gains `cause: true` (a `null` reads as absent). `knownEventOf` keeps `cause` only when it is a member of the build's own closed set and otherwise deletes it, so an unknown future value reads as "no cause" and never reaches a screen.
- **Device behaviour (chain-wire).** `PendingFailureCause` (`pending-builds.ts`) gains `'provider_unavailable'`, stored on the failed record beside `'connection'`, so the same run reopened from its tile reads alike. `rephraseHelps` becomes `remedy == null && cause !== 'provider_unavailable'` at both sites, so `failureActions` already gives `[Try again]` and no "Change the description". `failureKindOf` returns `other` for this cause even when every repair try was used (the cause outranks the `couldnt-run` count), so the sentence is always the server's; the cause is read from the stored field, never from wording. There is no new kind or page, and the report action stays absent (D9's pin).

*Alternative rejected:* leaving the advice as is and parking the question. It shipped a sentence ("not something you did") next to an action that says the opposite.

### D10 — Out of scope

No fallback model and no first-token timeout for engineer turns (see Parked).

## Risks / Trade-offs

- [Plan or repair runs on a model other than the engineer model (`WHIM_PLAN_MODEL` / `WHIM_REPAIR_MODEL` overrides)] → Those calls neither count toward nor reset the breaker, which counts only the engineer model its probe checks. Production sets no override today; an outage of an overridden model ends runs with `provider_unavailable` after the resend but does not open the breaker.
- [A residual re-run doubles harness time on a slow harness fault: total budget 45 s, or the sweep] → It is bounded to once per candidate and still inside `WHIM_GENERATION_MAX_MS`. The `rerun` log field shows how often it happens.
- [A deterministic candidate fault lands in a residual phase, for example a candidate that wedges the probes after paint] → It costs one re-run, then ends as `run_unverified` exactly as today. That is no regression.
- [The breaker opens on a burst that one user's stream causes] → It needs 4 consecutive upstream failures with no success in between. One generation contributes at most 2 per turn (the turn and its resend), and any completed engineer-model call resets the count.
- [The breaker stays open while the provider has recovered] → Any completed engineer-model call closes it, and the probe runs on the first admission after a 60 s cooldown.
- [An outage of only the policy, clarify or rewrite model is not covered by the breaker] → It counts the engineer model alone, because a count over every role is reset by the working one. Those routes already fail fast through their own refusals: `policy_unavailable` from the content-policy check and `provider_unavailable` from clarify and rewrite after their retries. An upstream failure of the content-policy check answers `503 policy_unavailable`, never `provider_unavailable`.
- [A breaker refusal and a mid-call `provider_unavailable` look the same on the request line] → A refusal by the open breaker also carries `refusedBy: 'breaker'`.
- [Terminal failures during an outage also trip the ">5 terminal failures/hour" alert] → Two emails in the first hour, both rate-limited. Accepted.
- [Bumping `PROTOCOL_LEVEL` touches test fixtures that treated 2 as "the future"] → Those fixtures move to `PROTOCOL_LEVEL + 1` in chain-wire, gated by `wire-future-frames`.
- [Changing existing assertions on the old unobserved behaviour (machine, run-stage and e2e suites) trips the removal ratchet] → Assertions are rewritten, not dropped. A count that falls needs a `Check-removal:` trailer naming the replaced expectation.
- [The held-run e2e fixtures (`heldRunTurns` with `MOUNT_HANG`) relied on a mount timeout being terminal] → Chain-run-verdict gives them a repair turn (another `MOUNT_HANG`) so the run still holds.

## Migration Plan

1. Merge and deploy the server. Old level-1 builds get the compat notice for `provider_unavailable`. Everything else is unchanged, because the `failure` reason is a free string.
2. Ship a device build at level 2. It lands `provider_unavailable` like `budget_exhausted` and honours `Retry-After`.
3. Rollback: redeploy the previous revision. Level-2 builds against a level-1 server never see the code. The breaker holds no persisted state.
4. Operators: no new secret. The three breaker env vars have defaults. The new alert is applied by the next plain deploy.

## Open Questions

None.

## Parked (filed as `ai-proposed` issues at closure)

1. `src/runtime/web/loader.js` `try { … } finally { __whimAfterBundle() }`, so the trusted probes run even when the bundle fails to evaluate or mount. A module-scope escape that ends in a throw would then be caught as `containment_failed` (RC§fix 3). This is the sandbox runtime area: it needs its own change with `npm run invariants` and `bridge:invariants`.
2. The `awaitMount` race: a pre-paint diagnostic settles mount early, so `sweepApp` starts before mount (RC§side note).
3. A first-token timeout for engineer turns. None exists, so a stalled provider holds a turn until `WHIM_GENERATION_MAX_MS` (R§Q1).
4. Flowbench (`server/src/flowbench/drive.ts`) handling `provider_unavailable`: wait out `Retry-After` and record it apart from model faults.
5. A fallback model behind the breaker (#66 "Out of scope"). The breaker's open state is where it would plug in.
