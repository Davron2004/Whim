# pipeline-budget (chain-8)

The run's wall-clock budget, its end-cause record, and the mid-run provider `402` ending, all in
`server/src/generation/machine.ts`. The 402 detection surface is in `model.ts` and `openrouter.ts`.

Unrelated to the budget, but nowhere else is documented: the generate and repair turns' candidate
source both pass through `unwrapSourceFence` (`source-block.ts`) before the check stage, so an
engineer reply wrapped in a leading ```typescript fence costs no repair round on the fence itself.

## `maxRunMs`

```ts
// machine.ts
export interface GenerationPipelineDeps {
  // ...existing fields...
  /** Total wall-clock budget on `clock` from the start of the run. Default 600000. */
  maxRunMs?: number; // positive integer, else the constructor throws RangeError
}

export interface Clock {
  now(): number;
  /** One-shot timer on this clock; returns its disarm function. Absent → host timers (unref'd). */
  setTimer?(delayMs: number, onFire: () => void): () => void;
}

// index.ts
export interface CreatePipelineOptions {
  // ...existing fields...
  maxRunMs?: number; // wire `ServerConfig.generationMaxMs`; absent → machine default
}
```

`createGenerationPipeline` keeps its `{ now: () => Date.now() }` clock, so production runs the
deadline on host timers. `main.ts` does not pass `maxRunMs` yet (chain-10 wires it).

- The deadline is armed when the generator first runs (the first `next()`), not at `run()`. A
  request signal that is already aborted arms nothing.
- The machine aborts an INTERNAL controller linked to the request signal. Every stage, model call,
  summariser and synthetic run receives that internal signal. **The deadline never aborts the
  caller's signal.** A route's own abort listener (reconciliation) does not fire on expiry.
- The deadline is disarmed when the run starts its completion envelope (just before `usage`), when
  the request signal aborts, and when the generator finishes. Once `usage` has been yielded, the
  deadline can never add a second envelope.

## `RunTrace.outcome`

```ts
export type RunTraceOutcome = 'delivered' | 'failed' | 'expired' | 'aborted';
export interface RunTrace {
  generationIds: string[];
  outcome?: RunTraceOutcome; // optional: `{ generationIds: [] }` still conforms
}
```

Written once, by the FIRST ending, and never changed afterwards:

| Value | Set when |
|---|---|
| `expired` | synchronously, inside the deadline timer callback |
| `aborted` | synchronously, inside the machine's abort listener on the request signal; also when the signal was already aborted at the first `next()`, or when the consumer calls `return()`/stops the generator with no ending recorded |
| `failed` | just before a `failure` terminal is yielded (any reason except expiry, including the 402 ending) |
| `delivered` | just before the `result` terminal is yielded |

- An abort after expiry leaves `expired`. An expiry after an abort cannot happen, because the abort
  disarms the deadline. An abort between `usage` and the terminal records `aborted`, and the
  terminal is suppressed.
- `undefined` means the run has not ended, or its generator was never iterated.
- The machine registers its abort listener at the first `next()`. A listener the route added to the
  same signal earlier fires BEFORE it, so read `outcome` from the stream's teardown path, not from
  inside an earlier abort listener.

## Expiry ending

When the deadline elapses before the completion envelope starts, in-flight work is torn down
through the internal signal, and the stream then ends as a completed run:

```
usage → failure { reason: "This took too long to build. Please try again.",
                  attempts: <candidates produced>, diagnostics: <accumulated> }
```

Both events are skipped if the REQUEST signal is aborted: `usage` is not emitted if the abort comes
before it, and the failure is not emitted if the abort comes between the two. `outcome` stays
`expired` either way. A client abort before expiry emits nothing, as before. Log: `run expired`
(scope `run`, info).

## Provider `402`

Detection surface:

```ts
// server/src/openrouter.ts
export class OpenRouterCreditError extends Error {
  readonly kind: 'credit'; readonly status: 402; // name 'OpenRouterCreditError'
} // thrown by OpenRouterClient.stream's deltas (and rejects `usage`) on HTTP 402

// server/src/generation/model.ts
export function isCreditExhaustedError(err: unknown): boolean; // structural: err.status === 402
```

Any `ModelClient` adapter signals credit exhaustion by throwing an error whose `status` is `402`.
Before this chain a 402 surfaced as `OpenRouterNetworkError('OpenRouter: HTTP 402')` with no
status field. Routes (clarify/rewrite) should detect it through `isCreditExhaustedError` too.

Detection point: the machine's single top-level catch around every stage and model call
(`GenerationMachine.endOnThrow`). In order:
1. `isCreditExhaustedError(err)` → `invalidateCreditCache()`. This runs even when the run was already
   aborted or expired.
2. The run signal is aborted (client abort or expiry) → stop. The expiry ending above still applies.
3. Otherwise emit `usage` → `failure { reason, attempts, diagnostics }`, with
   `reason = "Whim has used up its generation budget for now. Try again later."` on a 402. The
   generic reason stays `"Something went wrong while generating this app. Please try again."`.
   Log message: `provider credit exhausted` (error level) instead of `run failed`.

The run makes no repair and no retry after a 402. `outcome` is `failed`. A 402 raised by the
summariser is still swallowed by the summariser's own catch — the run still delivers with no
summary — but now calls `invalidateCreditCache()` too: `summarise.ts`'s turn catch
(`noteCreditExhaustion`) and `machine.ts`'s `summariseDelivery` catch both do.
