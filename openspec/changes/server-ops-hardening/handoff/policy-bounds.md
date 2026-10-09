# Contract: policy-bounds (chain-2, #119/#120)

Consumers: chain-4 (forwards the env keys), chain-6 (runbook prose).

## Environment (`server/src/config.ts`)

| Variable | Default | Validation | `ServerConfig` field |
|---|---|---|---|
| `WHIM_POLICY_TIMEOUT_MS` | `10000` | positive integer (unchanged) | `policyTimeoutMs` |
| `WHIM_POLICY_ATTEMPT_TIMEOUT_MS` | `4500` | integer from `500` to `WHIM_POLICY_TIMEOUT_MS` | `policyAttemptTimeoutMs` |
| `WHIM_LIMIT_POLICY_CHECKS_PER_DEVICE_DAY` | `30` | positive integer | `limitPolicyChecksPerDeviceDay` |
| `WHIM_LIMIT_POLICY_CHECKS_PER_DAY` | `800` | positive integer | `limitPolicyChecksPerDay` |

- A bad value fails boot with `ServerConfigError` naming the variable.
- An unset attempt timeout whose default (4500) exceeds a shortened `WHIM_POLICY_TIMEOUT_MS` also
  fails boot, naming `WHIM_POLICY_ATTEMPT_TIMEOUT_MS`, and the message says `(its default)`.
- All three new keys are optional; chain-4 forwards them as optional keys.

## Classifier retry (`server/src/policy/policy.ts`)

`ModelContentPolicyOptions` gains `attemptTimeoutMs?: number`. If omitted, an attempt is bounded by
the deadline alone. `lifecycle.ts` passes `config.policyAttemptTimeoutMs`.

- There is one deadline, `timeoutMs`, measured from the start of `check`.
- Each attempt is bounded by `min(attemptTimeoutMs, remaining)`.
- At most 2 attempts.
- A second attempt runs only when all of these hold:
  - the first attempt ended without a verdict, by its own attempt timeout, an
    `isUpstreamModelFailure` error (rate limit, 5xx, or a network error with no status), or
    malformed/unknown verdict output;
  - the request signal has not aborted;
  - the deadline has not fired;
  - at least 1000 ms remain.
- A verdict (`allow` or `refuse`) is never retried. Auth (401), credit (402), other 4xx and
  non-provider errors are never retried.
- If no attempt yields a verdict, `PolicyUnavailableError` is thrown, which routes report as
  `503 policy_unavailable`.

Carriers. `generationId`/`usage` were replaced by per-call records:

```ts
export interface PolicyCall { usage?: Usage; generationId?: string }
export interface PolicyCheckResult { verdict: PolicyVerdict; calls: readonly PolicyCall[] }
export class PolicyUnavailableError extends Error {
  constructor(message: string, readonly calls: readonly PolicyCall[] = []);
}
export interface PolicyMetering {
  usage: Usage | undefined;                         // sum of the calls' delivered usage
  generationIds: string[];                          // every call's id, in call order
  creditedGenerationIds: ReadonlySet<string>;       // ids whose tokens `usage` carries
}
export function policyMetering(calls: readonly PolicyCall[]): PolicyMetering;
```

- `calls` has one entry per attempt; it is `[]` for a cache hit and for `StubContentPolicy`.
- The routes credit `usage` when the check returns, and every id goes to the gated row's cost. Ids
  outside `creditedGenerationIds` (an attempt that ended before its usage arrived) get their tokens
  reconciled by `resolveRequestUsage`.
- `UnaryAdmissionOutcome.ok` now carries `policy: PolicyMetering` instead of `policyGenerationId`.
  `resolveUnaryUsage` takes the same type.

## Log field

The `content policy check` record (`cache.ts`) gains `attempts: number`, the classifier calls the
check made: `1`, or `2` after a retry; `0` for `cached-*` and the stub; on `unavailable`, the calls
made before it gave up. It still carries no checked text.

## `policy-check` kind and row id (`server/src/usage-store.ts`)

```ts
export type RequestKind = 'generate' | 'clarify' | 'rewrite' | 'report' | 'policy-check';
export function policyCheckRowId(requestId: string): string; // `${requestId}:policy-check`
```

- No store needed a schema change. Firestore counters are `{day}:policy-check:{device}` and
  `{day}:global:policy-check`. Conformance case: "a policy-check row admits, limits and purges as
  its own kind, and its cost joins its generation's".

### Line path (`routes/generate.ts`, `admitIntoLine`)

1. The credit check and the `generate` `unitAvailable` check run as before.
2. The row `policyCheckRowId(requestId)` of kind `policy-check` is admitted with
   `deviceLimit = limitPolicyChecksPerDeviceDay` and `globalLimit = limitPolicyChecksPerDay`.
   - If either limit refuses, the answer is `429 daily_limit` with `Retry-After` set to UTC
     midnight, and no classifier call is made.
3. The check runs. Its usage is credited.
4. The row is settled:
   - allow → `ok`;
   - refuse → `refused`/`content_policy`;
   - no verdict → `unavailable`/`policy_unavailable`.

   The row carries `usage`, and its cost is resolved onto it. It is never refunded.
5. On a refusal (product-owner ruling 3), the request's own `generate` row (id = `requestId`) is
   also admitted and settled `refused`/`content_policy`, with no usage and cost 0. Its unit is
   spent and not refunded, as on a free slot. If the ceiling was reached since the check, that
   row is skipped.
6. On an allow, the generation waits. Its later `generate` row carries only pipeline cost.

- A throw after a row was admitted settles it `error`/`internal_error` (first settlement wins).
  The free-slot path and the unary routes write no `policy-check` row.

## Summary and report (`computeSummary`, `whim-admin usage`)

- `countByKind`/`costUsdByKind` list `policy-check` as its own kind. The CLI prints
  `policy-check=N`.
- `generationStats` groups each `generate` row with the in-window `policy-check` row of
  `policyCheckRowId(row.id)`:
  - generation cost = sum of both rows;
  - `unresolved` if either row is `unresolved`;
  - pending (excluded) while either row is pending.
- `failureReasonCounts` counts rows. A refusal in line therefore counts `content_policy` twice:
  once for the check row and once for the generate row.

## Older image reading new rows

An image without this change reads `policy-check` rows without error, so a rollback needs no data
change: the SQLite `kind` column has no CHECK, Firestore `toLedgerRow` passes `kind` through, and
`computeSummary` keys counts by the raw kind string (it shows `policy-check=N`). Its
`generationStats` leaves out the check's cost of generations that waited in line. Purge, device
export/delete and the cost sweep do not depend on the kind.
