# chain-wire report (builder)

Branch `chain/generation-reliability-wire`, BASE b6a3b2d6. Tasks 2.1–2.6 done (tasks.md not ticked).

## Tests added (suite -> case)

Server (`npm run server:test`):
- `contract`: `ServiceRefusalCode` accepts `provider_unavailable`; `PROTOCOL_LEVEL === 2`; `failure` with `cause: 'provider_unavailable'` validates and keeps it, `cause: 'other'` fails, no cause still validates.
- `wire-level`: new section "provider_unavailable and failure.cause at the production registry" (level-1 envelope with notice = hint and <= 200 chars; levels 2 and 3 full body validating as `ApiError` + `ServiceRefusalCode`; failure `cause` stripped at 1, kept at 2 and 3, no-cause unchanged at 1/2/3; a synthetic `fields` entry drops only listed fields above the level).
- `request-edge`: levels `[1, PROTOCOL_LEVEL, 3]` are all served (3 is above the server).
- `admission` (outside the chain's list, needed): the "every ServiceRefusalCode has a builder" check requires a case; plus Retry-After present exactly when a window is given.
Device (`npm run launcher:test`):
- `wire-future-frames`: every "future level" fixture moved from literal `2` to `FUTURE = PROTOCOL_LEVEL + 1` (assertion count unchanged); mirror test now covers the new code.
- `service-refusal`: the server's own `providerUnavailableRefusal(45)` through the real client -> recognised, 503, hint, `retryAfterSeconds` 45, `retryAtOf`, hint verbatim, rule `sender`/`neutral`, remedy `retry`.
- `generation-client`: `failure.cause` kept for every `FailureCause.options` member; unknown string, `null`, and a number read as no cause with the failure kept.
- `failure-screen`: page-level pin for the provider sentence (verbatim, Try again runs, no report-named control/text/prop).
- `prompt-flow-ui` (outside the listed files; the landing is only driven through the rendered shell there, see `refusal-landing.suite.ts` header): generate refused `provider_unavailable` + `Retry-After: 45` lands on Plan with the hint, neutral tone, `retryAt` ~ +45 s, rows preserved, `Make it` disabled, no Failure page, no tile; clarify refusal lands on Describe with the words.
- `flow-messages-ui` (same reason): provider-caused terminal `failure` -> sentence once, no rewording advice, Try again present, no `ReportScreen`/"report" text, record stores `cause`; same after reopening from the tile; no-cause and unknown-cause failures still lead with "Change the description" and "Try again as it is" (live and from the tile). Also asserts the device-pinned sentence equals `REFUSAL_HINTS.provider_unavailable`.

## Red before (BASE behaviour)

- 2.1/2.2/2.6 server: with the tests added and no source change `npm run server:test -- --only contract,wire-level,request-edge,wire-v2,admission` exited 2 on typecheck, e.g. `wire-level.suite.ts(103,32): error TS2551: Property 'provider_unavailable' does not exist on type ...REFUSAL_HINTS` and `'fields' does not exist in type 'WireEntry<WireEvent>'`. (The runtime string "not a registered wire message" is not reachable before the type error stops the run.)
- 2.6 device (device mirrors already in, reader/handler not): `generation-client` `a cause this build does not know reads as no cause ... (got [ ... cause: 'some_future_cause' ], want [ ... ])` and the null/number variants; `flow-messages-ui`: `nothing suggests rewording (got [ 'Change the description', 'Try again as it is' ], want [])`, `the record stores the cause (got undefined, want 'provider_unavailable')`, `still no rewording advice (...)`. 1040 passed, 6 failed.
- 2.3/2.4 device: with only `REFUSAL_RULES.provider_unavailable` removed: `provider_unavailable is recognised`, `recognised, with the window parsed from the header (got undefined ...)`, `flow: a generation refused during a provider outage lands on the plan page ...: threw timed out waiting for the refusal to land on the plan page`, and the clarify landing likewise. 398 passed, 7 failed. Restored.
- 2.5 is a standing-invariant pin (passes before). Its red-check (temporarily add a report action to `FailurePage.tsx`) was NOT run by me; left to the runner.

## Commands and exit codes (all through capped-run.sh)

- `npm run server:test -- --only contract,wire-level,request-edge,wire-v2,admission`: 955 passed, 0 failed, exit 0
- `npm run launcher:test -- --only wire-future-frames,service-refusal,refusal-landing,failure-screen,generation-client,flow-messages-ui,prompt-flow-ui` (`--mb 4096`): 1046 passed, 0 failed, exit 0
- `npm run -s typecheck`: exit 0 (it prints "2 diagnostic(s) in server/ or contract/ files left to their own projects"; not checked against BASE, the server project's own run is green)
- `npx eslint --max-warnings 0` on every touched file: exit 0 (after replacing a conditional spread in the `failure` handler, which tripped `sonarjs/cognitive-complexity`)

## Deviations

- [A] Test files outside the chain's list were edited because the work required them: `server/test/admission.suite.ts` (closed-set builder check), `src/host/launcher/test/prompt-flow-ui.suite.tsx` and `flow-messages-ui.suite.tsx` (where Plan/Describe landing and the reopened-tile behaviour are driven; `refusal-landing.suite.ts` is the pure arithmetic suite).
- [A] `wire-v2.suite.ts` needed no change (no fixture treats 2 as the future).
- [A] The unknown-cause drop goes through `withoutMalformedOptional`, so it logs `malformed optional field dropped {route, field}` at warn (no value).
- `wire-level.ts` now imports `REFUSAL_HINTS` from `admission/refusals` (a leaf with only a type import back); no cycle.
