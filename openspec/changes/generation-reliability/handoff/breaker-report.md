# chain-breaker report (generation-reliability, #66)

Branch `chain/generation-reliability-breaker`, BASE 612c9de5. Builder run: targeted suites only, all
through `capped-run.sh`. No gate.sh / gate-full.sh was run.

## Tasks

| Task | Done | Where |
|---|---|---|
| 4.1 config | yes | `server/src/config.ts` (`providerBreakerFailures` via `readNonNegativeInt`, `providerBreakerWindowMs`, `providerBreakerCooldownMs`); `server/test/config.suite.ts` (`runProviderBreakerTests`, plus three `PARSE_CASES` rows) |
| 4.2 breaker module | yes | `server/src/admission/provider-breaker.ts` (`createProviderBreaker`, `record`, `admit`, the three log messages as exported constants) |
| 4.3 lazy shared probe | yes | same file (`startProbe`, `createModelProbe`); `ModelCallLabel` gained `'probe'` in `server/src/generation/model.ts`; `server/test/scripted-model.ts` maps `probe` to the `engineer` roster role |
| 4.4 feed | yes | `withProviderBreaker` and `guardModel` in `provider-breaker.ts`; `server/src/lifecycle.ts` calls `guardModel` once on the client every role shares |
| 4.5 admission wiring | yes | `generate.ts` (`admitGeneration`), `clarify.ts` (`admitUnaryRequest`, which `rewrite.ts` shares), `app.ts` (`providerBreaker` option), each calling `providerBreaker.admit()` immediately before the credit check |
| 4.6 alert and docs | yes | `deploy/monitoring/policy-provider-breaker-open.json`, `docs/deploy.md` (alert row, paragraph, the three env vars), `server/test/deploy-config.suite.ts` |
| carried LOW | yes | `routes-unary.suite.ts` `testProviderUnavailableByProtocolLevel`: the level-2 check now deepEquals the whole body incl. `compat` |

## Verified wiring (4.4)

Every role takes `model.client` out of the single `guardModel` result in `lifecycle.ts`: the
pipeline (plan, generate, repair) and its summariser via `createGenerationPipeline({modelDeps})`, the
content-policy classifier (`ModelContentPolicy.modelClient`), and clarify and rewrite via `createApp({model})`.
Nothing else in `server/src` calls a `ModelClient.stream` (grep). `generation/index.ts` needed no change:
`buildModelDepsFromEnv` still builds the raw client and the composition wraps it afterwards.

## Tests and suites

- `server/test/provider-breaker.suite.ts` (new, registered in `acceptance.ts`): counting, Retry-After
  60 then 40, success resets, 401/402/400/cancel neither open nor reset, window (past, at the edge,
  restart), `failures: 0`, log fields and no content, the probe (three concurrent admits make one call,
  success closes, 502 refuses with the full cooldown and logs `provider probe failed`, a completed call
  closes an open breaker), the probe request (`maxTokens:1`, `reasoning:'off'`, engineer model, role
  `probe`), the decorator over `ScriptedModelClient` with real `OpenRouter*Error` classes, and `guardModel`.
- `server/test/admission.suite.ts`: the real `createApp` with an open breaker: generate, clarify and rewrite
  each answer `503 provider_unavailable`, valid `ApiError`, `Retry-After: 40`, no ledger row, no slot
  acquired, no credit lookup, no model call; ordering against drain and body validation; closed passes.
- `server/test/config.suite.ts`, `server/test/deploy-config.suite.ts` (the alert's filter against the line
  the real breaker writes, one condition, 3600 s, docs name it), `server/test/routes-unary.suite.ts` (carried item).

## Red evidence (each mutation type-satisfying, tsc passes, restored after)

| Task | Mutation | Failing check (from the log) |
|---|---|---|
| 4.1 | `providerBreakerFailures` read with `readPositiveInt` | `WHIM_PROVIDER_BREAKER_FAILURES=0 loads` (got "must be a positive integer"), `... with the breaker disabled` |
| 4.2 | window restart removed | `a fourth failure past the window does not open it`, `the streak restarted at that failure...` |
| 4.2 | non-upstream failures counted | `401, 402, 400 and a client cancel never open it...`, `a 401, a 402 and a cancel between upstream failures do not reset the streak`, `a 402, a 401, a 400 and two client disconnects through the wrapper never open it` |
| 4.2 | non-upstream failures reset the count | `... so the next upstream failure is the fourth` |
| 4.3 | `probing` state starts a new probe instead of sharing | `three concurrent admissions after the cooldown make exactly one probe call` (got 3), `a later admission needs no probe`, `one probe-failed warning...` (3 lines) |
| 4.4 | `withProviderBreaker` returns the stream unobserved | `the fourth failed turn opens the breaker`, `the second opens it, for the configured cooldown...` |
| 4.5 | generate: breaker check moved after the credit check; clarify/rewrite: check dead | `/v1/generate: the credit endpoint was not queried...` (got 1); 12 clarify/rewrite checks (500 not 503, ledger row, slot acquired, credit queried), `an open breaker is checked before drain state`, `the Retry-After counts down...` |
| 4.6 | policy filter `msg="provider breaker opened"` | `its filter matches the one line the breaker writes when it opens...` (got [], expected ['provider breaker open']); the whole deploy-config run: 786 passed, 1 failed |

## Commands and exit codes

All through `/Users/davrondjabborov/.cache/whim-run/capped-run.sh`, from the worktree.

| Command | Exit |
|---|---|
| `npm run -s typecheck` (final; "2 diagnostic(s) in server/ or contract/ files left to their own projects" is the same count as before the chain's tests) | 0 |
| `npx eslint --max-warnings 0 <15 touched files>` | 0 |
| `npm run -s server:test -- --only provider-breaker,admission,runConfigTests,routes-unary,routes-generate` (final green: 1442 passed, 0 failed) | 0 |
| `npm run -s server:test -- --only deploy-config` (green: 787 passed, 0 failed; about 8 min) | 0 |
| red runs (one per mutation above, `--only provider-breaker`, `--only admission`, `--only runConfigTests`, `--only deploy-config`) | 1 each, the failing checks named above |

`--only config` also matches `deploy-config`; use `--only runConfigTests` for the config suite alone.

## Deviations

- [A] `server/test/scripted-model.ts` (not in the chain file list) gained `probe: 'engineer'` in `ROSTER_ROLE_OF`; the `Record<ModelCallLabel, ModelRole>` would not typecheck otherwise.
- [A] `generation/index.ts` untouched: `lifecycle.ts` is the only composition point (the chain lists both as options).
- [A] `guardModel` (build the breaker from config and wrap the client) lives in `provider-breaker.ts` and `lifecycle.ts` calls it, so the composition is unit-testable without Chromium.
- Gap (closed in fix round 1): the deploy scripts (`deploy/lib.sh`, `deploy/cloudrun/deploy.sh`, `operator.env.example`) do not forward the three new env vars, so on Cloud Run the defaults apply. `docs/deploy.md` says so. Forwarding them is a separate change outside this chain's file list.
- Gap (closed in fix round 1): `lifecycle.ts`'s 3-line composition (call `guardModel`, pass `providerBreaker` to `createApp`) is covered by typecheck and `guardModel`'s test, not by a startServer test (that needs Chromium; `server/test/e2e.ts` is the only suite that boots it).
- Not run: `launcher:test`, e2e, gate, knip.

## Fix round 1 (after breaker-review-1 REJECT)

| # | Finding | Change | Test | Red evidence (mutation, type-satisfying; failing checks from the log) |
|---|---|---|---|---|
| 1 | production wiring untested | none (test only) | `server/test/e2e.ts` `testProviderBreakerOnComposedServer`: real `startServer` + scripted model; two `/v1/clarify` whose policy check gets 503s (4 upstream failures) answer `policy_unavailable`; the next answers `503 provider_unavailable`, integer `Retry-After` in 1..60, and the scripted client (which has a 5th, allowing turn) records no 5th request | `providerBreaker: breaker` deleted from `createApp(...)` in `lifecycle.ts` (tsc 0): `the next clarify is refused 503 provider_unavailable by the open breaker` (got 500), `... carrying an integer Retry-After...`, `... and made no model request` (got 5, expected 4); 71 passed, 3 failed. (With only 4 scripted turns the third check could not fail: the script threw before recording. A fifth turn fixed that.) |
| 2 | env vars not forwarded | the three `WHIM_PROVIDER_BREAKER_*` keys added to `deploy/lib.sh` `WHIM_VALUE_KEYS`, `deploy/deploy.sh` and `deploy/cloudrun/deploy.sh` `server_optional_keys`, `deploy/operator.env.example`; rows in the `docs/deploy.md` env table; the "none of them forwarded" sentence replaced | `deploy-config.suite.ts`: the VM full deploy and the Cloud Run plain deploy each carry `FAILURES=0`, `WINDOW_MS`, `COOLDOWN_MS` from the operator file into the config the server loads (`loadServerConfig` reads them back as `[0, 90000, 30000]`) | the three keys removed from both `server_optional_keys` lists: both new `eq`s fail (got `[4, 180000, 60000]`, expected `[0, 90000, 30000]`), 787 passed, 2 failed |
| 3 | stale probe acts on a newer cycle | `provider-breaker.ts`: a settling probe changes state only if `state` is still its own probing object (`isCurrent`); a stale one logs its failure and answers its waiters from the current state | `provider-breaker.suite.ts` "A probe that is no longer the current one has no say" (success and failure variants, closed line count) | `isCurrent` always true: 66 passed, 7 failed, incl. `a probe that completes after a newer cycle opened...` (got ok:true), `... with one closed line...` (got [60000, 65000]), `a stale probe that fails refuses its waiter by the newer cycle's clock` (got 60, expected 55) |
| 4 | probe timeout rests on the client | the probe is raced against an abort of its own deadline signal; deadline factory injectable (`probeDeadline`, default a real unref'd timer, stopped when the probe settles) | `a probe that ignores its signal... when its time limit fires` -> re-opens with a full cooldown, `provider probe failed` carries `errorKind: 'timeout'`, timer stopped, no second probe; fake deadline, no sleeps (a 1 s guard only on failure) | race removed: `when its time limit fires...` (got `hung`), `... the probe-failed line carrying errorKind timeout` (got []), `... its timer stopped` (got 0); run then hit exit 13 (a later admit awaits the never-settled probe) |
| 5 | sync-throwing probe | `const attempt = (async () => probe(signal))()` | `a probe that throws synchronously refuses its admission like a failed probe` and its logged `server`/503 | `const attempt = probe(signal)`: both checks fail (`threw`), 71 passed, 2 failed |
| 6 | docs wording | `docs/deploy.md` alert row: the first admission after the cooldown probes the provider | none (prose) | n/a |

Deviation [A]: finding 5 asked for `Promise.resolve().then(() => probe(signal))`; that defers the call by a microtask and would break the existing synchronous "exactly one probe call" check, so an async IIFE does the same job (the probe runs at once, a sync throw becomes a rejection).

The `Check-removal` ratchet: no assertion removed anywhere (all additions).

Commands (all through `capped-run.sh`, from the worktree), exit codes:
- `npm run -s server:test -- --only provider-breaker` green 0 (73 passed incl. new cases); three red runs 1, 13 (hung, see #4), 1
- `npm run -s server:test -- --only deploy-config` (4096 MB, 900 s) 0, 789 passed, 0 failed
- `npm run -s server:e2e` (4096 MB, 900 s): final green 0 (74 passed, 0 failed); red 1 twice (4-turn script: 72 passed/2 failed; final 5-turn script: 71 passed/3 failed)
- red run of `--only deploy-config` with the keys removed from both scripts: 1
- `npm run -s typecheck` 0; `npx eslint --max-warnings 0` on the 4 touched TS files 0
