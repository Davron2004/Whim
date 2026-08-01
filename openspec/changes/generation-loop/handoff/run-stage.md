# Handoff: run-stage-and-cancellation (chain 6)

The harness adapter (`RunStage`), post-abort usage reconciliation, and the harness's own
cancellation seam that plug into `machine.ts`'s injected `RunStage` interface (design D8/D9,
`handoff/pipeline-machine.md`) and `synthrun`'s `RunCandidate` (`synthetic-run-harness`'s
`handoff/harness-core.md`).

## 1. `synthrun/contract.ts` — `RunOptions.signal` (design D8, task 6.1)

```ts
export interface RunOptions {
  budgets?: Partial<RunBudgets>;
  appId?: string;
  beforeNavigate?: (page: Page, context: BrowserContext) => Promise<void>;
  signal?: AbortSignal;
}
```

Threaded into `observe.ts`'s `withTotalBudget` ONLY (design D8: "threaded, not raced") — the exact
cleanup path the total-budget watchdog already uses:

```ts
export async function withTotalBudget<T>(
  ctx: RunContext, obs: AttachedObservers, budgets: RunBudgets, work: () => Promise<T>,
  signal?: AbortSignal,
): Promise<{ truncated: boolean; aborted?: boolean; result?: T }>;
```

An abort races `work()` exactly like a budget overrun: hard-kills `ctx.page`, but sets
`aborted:true` (never `truncated:true`, and appends NO diagnostic — a cancelled run is not a
truncated one). `createRunCandidate` (`report.ts`) forwards `opts.signal` into this call; an abort
during build/boot/mount-wait is observed the next time control reaches `withTotalBudget`, not
before — a candidate that never reaches the sweep still bounds cleanup by `mountBudgetMs`, not a
new watchdog. `dispose()` (context close + semaphore release) runs unconditionally from the
caller's own `finally`, regardless of which path closed the page first — Playwright's
`context.close()`/`page.close()` are idempotent, so no double-close guard is needed.

## 2. `server/src/generation/stages/run.ts` — the `RunStage` adapter (design D8, task 6.2)

```ts
export function createRunStage(runCandidate: RunCandidate): RunStage;
```

Takes an ALREADY-BOUND `RunCandidate` (`synthrun/report.ts`'s `createRunCandidate(session)`) —
this module owns no session lifecycle. **The composition root (chain 7) launches ONE
`SynthRunSession` for the process's lifetime, binds it once, and passes the bound function in
here; every run takes its own slot from that session's semaphore ("one session per pipeline,
per-run slot").**

Mapping policy:
- `report.contained === false` → `{ contained: false, diagnostics: [] }` — TERMINAL (design D7):
  `diagnostics` is always `[]` here regardless of what the harness reported, so "feeds nothing back
  to the model" holds at the type level, not just by the machine's own branch ignoring the field.
- `report.contained === true` → `{ contained: true, diagnostics, record }`. `diagnostics` is every
  `RuntimeDiagnostic` mapped verbatim to the wire `Diagnostic` shape (`kind`/`severity`/`message`/
  `symbol`/`line`/`hint`).
  - **Truncation is never a silent pass**: if `report.truncated` and no `run_truncated` diagnostic
    is already present (the harness's own total-budget watchdog adds one; a per-screen sweep
    truncation — `SweepResult.truncated` — does not), one is synthesized (`severity: 'error'`) so
    the machine's ordinary errors-block repair gate handles it like any other error.
  - `record` is assembled via `record.ts`'s `assembleRecord(input.source, manifest, input.build)`.
    `input.manifest` is required at this point (the machine only reaches `RUN` once `CHECK` is
    clean, design D6) — a missing manifest throws (an upstream invariant violation, not a normal
    outcome; caught by the machine's own top-level catch → one generic `failure`).

## 3. `server/src/generation/reconcile.ts` — post-abort usage reconciliation (design D9, task 6.3)

```ts
export interface GenerationStatsTransport {
  fetchStats(generationId: string): Promise<Usage | null>; // null = not yet resolved, retried
}
export interface ReconcileBounds { maxAttempts: number; totalBudgetMs: number; retryDelayMs: number }
export const DEFAULT_RECONCILE_BOUNDS: Readonly<ReconcileBounds>; // { maxAttempts:5, totalBudgetMs:5000, retryDelayMs:500 }
export interface ReconcileDeps { transport: GenerationStatsTransport; usageStore: UsageStore; bounds?: Partial<ReconcileBounds> }

export function reconcileAbortedUsage(
  deviceId: string, generationIds: readonly string[], deps: ReconcileDeps,
): Promise<void>;
```

Retries each id up to `bounds.maxAttempts` times, bounded overall by ONE shared
`bounds.totalBudgetMs` deadline across every id (not per id — the record resolves asynchronously
upstream). Sums every resolved `Usage` and credits the total through `deps.usageStore.credit`
**exactly once**, only when at least one id resolved. **Never throws**: a transport rejection is
treated identically to an unresolved `null` (quiet retry, not a fast-fail); any other unexpected
error (including from `usageStore.credit` itself) is swallowed — reconciliation runs after the SSE
stream has already ended and must never surface anything user-visible (spec "gives up quietly").
Introduces no persistence beyond the existing per-device `UsageStore` counter.

**Not wired into the route by this chain** (task 7.3, `server/src/routes/generate.ts`, is chain
7's job): the route owns the `AbortController` and device id, calls this ONLY on its abort path
with the `RunTrace.generationIds` the machine recorded, and stays the sole normal-path crediting
authority via `interceptUsage`'s `usage` event unchanged (design D9: two crediting paths in one
component is how double-counting bugs are born).

## Containment/truncation policy (summary)

| harness report                    | `RunOutcome`                                    | machine effect                          |
|------------------------------------|--------------------------------------------------|------------------------------------------|
| `contained: false`                 | `{contained:false, diagnostics:[]}`               | immediate `failure`, no repair consumed   |
| `contained: true, truncated: true` | `{contained:true, diagnostics:[...,run_truncated]}` | repair loop (never a silent `result`)   |
| `contained: true`, clean           | `{contained:true, diagnostics:[], record}`        | delivered as `result` (if machine agrees) |

## Tests (`server/test/e2e.ts` + `server/test/e2e.run.mjs`, task 6.4 — Class-2 pending, run directly)

`node server/test/e2e.run.mjs` — 31 checks: `RunStage`'s containment short-circuit and truncation
synthesis against injected stub `RunCandidate`s (plus red-checks proving neither is hardcoded); an
honest corpus fixture through the REAL check/build/run stages to a delivered record whose bundle
matches the production build modulo the one documented text-vs-file-path builder difference
(`synthrun/builder.ts`'s filename-derived comment/identifiers); a real escape-attempting fixture
(`fixtures/adversarial/evil.app.tsx`) through the real harness staying `contained:true`
(non-vacuity for the stub-based short-circuit tests — genuine escape cannot succeed by
construction, so the short-circuit path itself is only exercisable via an injected report);
cancellation mid-sweep disposing the page/context and releasing the concurrency slot (proven by a
second run completing promptly on the same `concurrency:1` session); and `reconcile.ts`'s full
scenario set. `synthrun/test/acceptance.ts` gained its own `withTotalBudget` signal coverage
(task 6.1, 82 checks total, up from 75).
