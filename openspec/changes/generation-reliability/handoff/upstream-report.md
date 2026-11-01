# chain-upstream report (builder)

Base 6f30bc57. Tasks 3.1 to 3.6 implemented; tasks.md not ticked.

## Tasks

| Task | Production change | Regression (suite) |
|---|---|---|
| 3.1 classifier | new `server/src/model-failure.ts` (`modelFailureOf`, `ModelErrorKind`); `generation/model.ts` `isUpstreamModelFailure` delegates | `openrouter.suite.ts` "modelFailureOf" table: real `OpenRouter*Error`s from the client (503 frame, 502 HTTP, 429, fetch throw, 401, 402, 400) plus a real `AbortSignal.timeout`, a plain abort, and both signals combined with `AbortSignal.any` |
| 3.2 log line | `openrouter.ts` `logSettle` adds `errorKind`/`status` on failed and aborted | `openrouter.suite.ts`: mid-stream 503 frame -> `server`/503, caller abort -> `cancelled` with no status, real timeout -> `timeout`, 401 -> `auth`/401, completed has neither, provider message text never logged |
| 3.3 plan resend | `machine.ts` `runModelTurn` retries `plan|generate|repair` | `routes-generate.suite.ts` "a plan turn that fails upstream is sent once more": result, no `restart`, one `model turn retried {role:'plan'}`; `machine.suite.ts` plan-drop block |
| 3.4 terminal | `failure-codes.ts` + `PROVIDER_UNAVAILABLE_REASON` (= `REFUSAL_HINTS.provider_unavailable`) + `endOnThrow` | `routes-generate.suite.ts`: engineer 503 x2, plan network then 429 (sentence, no repair stage, ledger code), 503-then-401 -> `internal_error`, 503-then-402 -> `credit_exhausted` |
| 3.5 clarify/rewrite | `routes/clarify.ts`, `routes/rewrite.ts` -> `providerUnavailableRefusal()` | `routes-unary.suite.ts`: clarify 503 and 429 -> 503, clarify/rewrite 401 -> 502, rewrite transport failure first attempt and on the retry -> 503, stalled-rewrite timeout rewritten to 503 (slot released), 9c timeout cases 502 -> 503; ledger code, no `Retry-After` |
| 3.6 cause | same `endOnThrow` terminal sets `cause: 'provider_unavailable'` | `routes-generate.suite.ts`: levels 1 and 2 x {provider_unavailable, internal_error, credit_exhausted}: only the first at level 2 has `cause`; the level-1 event has no `cause` key; reasons equal at both levels |

Existing assertions of the old behaviour were rewritten in place, not dropped: `machine.suite.ts`
(HTTP 500 -> provider sentence, plus a new HTTP 401 case; second drop -> provider sentence and trace
code; the "plan turn that drops is not resent" case became two non-upstream plan cases plus a
plan-drop-is-resent block). Assertion counts only grew; no `Check-removal:` trailer needed.

## Red evidence (type-satisfying mutation of production, then `git checkout`)

- 3.1 `signal?.aborted` check disabled: `openrouter` 6 failed ("a plain abort is cancelled" got network/upstream, timeout got network, combined x2, log-line cancelled and timeout).
- 3.2 `errorKind`/`status` spread removed: `openrouter` 6 failed (`failed: errorKind` got undefined, mid-stream 503 kind/status, aborted, timeout).
- 3.3 `plan` removed from the retried labels: `routes-generate,machine` 17 failed (plan resend x4, plan-drop x3, plus 503-then-401/402 ending as provider_unavailable).
- 3.4 `providerUnavailable = false`: failures on engineer 503 twice, plan network then 429, HTTP 500, level cases (internal_error sentence). Weaker variant `= !creditExhausted`: 503-then-401, both 400/non-provider cases on plan and generate, HTTP 401 failed.
- 3.6 `cause` line removed: 1 failed ("provider_unavailable at level 2: carries cause"). Weaker variant (cause on internal_error too): 2 failed ("carries no cause key" for internal_error and credit_exhausted).
- 3.5 clarify condition disabled: `routes-unary` 7 failed (clarify 503, 429, timeout); rewrite condition disabled: 9 failed (timeout x2, both transport cases). Weaker variant (rewrite `upstream: true` always): 6 failed (401 -> 503, failed-retry plain Error status/ledger).

## Commands and exit codes

- `npm run -s server:test` (all suites, before the red checks): exit 0, 5409 passed, 0 failed.
- `npm run -s server:test -- --only openrouter,routes-generate,routes-unary,ledger,machine` after restoring: exit 0, 1695 passed, 0 failed.
- `npx eslint --max-warnings 0` on every touched src and test file: exit 0.
- `npm run -s typecheck`: exit 0.
- All through `capped-run.sh`. No gate.sh, no launcher suite.

## Deviations

- [A] `server/test/machine.suite.ts` is outside chains.md's file list, but it held the old-behaviour assertions (HTTP 500, second drop, plan not resent) that this change contradicts; rewritten as above.
- [A] `ModelFailure.status` for a typed `rate_limit`/`auth`/`credit` error is the status implied by the class (429/401/402), since `OpenRouterRateLimitError` and `OpenRouterAuthError` carry no `status` field.
- [A] `endOnThrow` classifies any upstream error (not only ones thrown by an engineer turn): plan turns are included, as the 3.4 plan test requires; no other stage throws a provider-shaped error.
- Rewrite has no transport retry today (only the unusable-reply retry), so "after the existing retries" needed no new loop.

## Side notes

- `typecheck:tests` prints "3 diagnostic(s) in server/ or contract/ files left to their own projects" on this branch; `server:test` runs the server tsc and passes. I did not look for their source.
