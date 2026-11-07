# Contract: chain-upstream (interface only)

For chain-breaker (feeds `modelFailureOf` at the model-client seam, adds `'probe'` to
`ModelCallLabel`, adds the admission step to `clarify.ts`/`rewrite.ts`/`generate.ts`).

## server/src/model-failure.ts (new, leaf: no imports)

```ts
export type ModelErrorKind =
  | 'server' | 'rate_limit' | 'network' | 'timeout'      // upstream
  | 'auth' | 'credit' | 'client' | 'cancelled' | 'other'; // not upstream
export interface ModelFailure { errorKind: ModelErrorKind; status?: number; upstream: boolean }
export function modelFailureOf(err: unknown, signal?: AbortSignal): ModelFailure;
```

- `upstream` is true exactly for `server | rate_limit | network | timeout`.
- Order of decision: (1) `signal?.aborted`: reason `.name === 'TimeoutError'` -> `timeout`, any other
  abort -> `cancelled` (no `status`); (2) `status >= 500` -> `server`; (3) `kind: 'rate_limit'` ->
  `rate_limit` (status only if the error carries one); (4) `kind: 'network'` with no status -> `network`; (5) `kind: 'auth'` or 401
  -> `auth`; `kind: 'credit'` or 402 -> `credit`; other 4xx -> `client`; anything else (not an
  object, plain `Error`) -> `other`.
- Pass the signal the call ran under (the combined one, for unary routes). Without it an abort reads
  as the status-less `network` error the client throws.
- Structural only: never reads a message.

`generation/model.ts` `isUpstreamModelFailure(err)` = `modelFailureOf(err).upstream` (no signal; same
call sites: machine resend, `policy.ts`).

## `model call` log line (`openrouter.ts` `logSettle`, info)

Existing fields unchanged. On `outcome` `failed` or `aborted` it adds `errorKind: ModelErrorKind` and,
when the error carried one, `status: number` (never implied by the class: `OpenRouterAuthError` and `OpenRouterRateLimitError` now carry `status` 401 and 429 themselves). A completed line has neither. No message text.
(`status`/`errorKind` are not redacted names.)

## Machine (`generation/machine.ts`)

- `plan`, `generate`, `repair` turns are resent once on an upstream failure (`MODEL_TURN_RETRIES = 1`).
  A plan turn streams no tokens, so no `restart`. Info line `model turn retried {role, errorClass, restart}`.
- `export const PROVIDER_UNAVAILABLE_REASON = REFUSAL_HINTS.provider_unavailable` (the one sentence;
  same string as the refusal hint).
- `endOnThrow(err, signal, state)`, in order: 402 -> `credit_exhausted` (unchanged); else
  `modelFailureOf(err, signal).upstream` -> terminal
  `{ type: 'failure', reason: PROVIDER_UNAVAILABLE_REASON, attempts, diagnostics, cause: 'provider_unavailable' }`
  with ledger code `provider_unavailable`; else `internal_error`. The `run failed` line stays error level.
  Only this terminal sets `failure.cause`; the machine never gates it by level (the route's
  `eventForLevel` strips it for level-1 clients).
- `failure-codes.ts`: `TERMINAL_FAILURE_CODES` gains `'provider_unavailable'` (the ledger's closed set
  picks it up; same string as `ServiceRefusalCode`).

## Unary routes

`clarify.ts` (`runClarifyWork`, which returns `{body,status,headers?}` and the handler answers via `c.json`, so the level gate and the request log see every error) and `rewrite.ts`, after the 402 branch: an error with
`modelFailureOf(err, <the call's combined signal>).upstream` answers `providerUnavailableRefusal()`
(`503`, `{error:'provider_unavailable', hint}`, no `Retry-After`) and settles the row with
`failureReason: 'provider_unavailable'`. Anything else stays `502 model_failure`. The per-call timeout
(`AbortSignal.timeout(unaryModelTimeoutMs)`) is `timeout`, hence upstream. The rewrite route's attempt
result gained `upstream: boolean`; the rewrite has no transport retry (only the unusable-reply retry).

## For chain-breaker

- Feed the breaker with `modelFailureOf(err, signal)` per settled call: count `upstream`, ignore the rest.
- A 402 keeps its own path; `provider_unavailable` mid-call answers carry no `Retry-After`, an admission
  refusal from the breaker passes whole seconds to `providerUnavailableRefusal(retryAfterSeconds)`.
- Tests: `npm run server:test -- --only openrouter,routes-generate,routes-unary,machine`.
