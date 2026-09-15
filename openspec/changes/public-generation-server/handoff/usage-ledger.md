# usage-ledger (chain-2)

`server/src/usage-store.ts` extends `UsageStore` (`credit`/`read` unchanged). `admit` is the ONLY
way to consume a daily unit; both implementations count-then-insert with no `await` between them,
so two overlapping calls can never both win the last unit.

```ts
export type RequestKind = 'generate' | 'clarify' | 'rewrite' | 'report';
export type RequestOutcome =
  | 'delivered' | 'failed' | 'aborted' | 'expired' | 'refused' | 'unavailable' | 'ok' | 'error';
export type CostState = 'pending' | 'resolved' | 'unresolved';

export interface AdmitParams {
  deviceId: string; kind: RequestKind; now: number;   // injected clock, drives UTC-day + Retry-After
  deviceLimit: number; globalLimit?: number;
  globalKinds?: readonly RequestKind[];  // counted-across set for globalLimit; defaults to [kind]
}
export type AdmitResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: 'device' | 'global'; retryAfterSec: number };  // device wins when both exhausted

export interface UsageStore {
  credit(deviceId: string, usage: Usage): Promise<void>;
  read(deviceId: string): Promise<Usage>;
  admit(params: AdmitParams): Promise<AdmitResult>;
  refund(requestId: string): Promise<void>;                                   // idempotent no-op on repeat/unknown id
  settle(requestId: string, p: { outcome: RequestOutcome; usage?: Usage; now?: number }): Promise<void>; // idempotent: keeps FIRST outcome; never touches utc_day; now stamps ended_at, defaults Date.now()
  recordCost(requestId: string, p: { state: CostState; costUsd?: number }): Promise<void>; // idempotent: only writes while state is 'pending'
  summary(params: SummaryParams): Promise<UsageSummary>;
  purgeLedger(beforeUtcDay: string): Promise<number>;  // 'YYYY-MM-DD', returns rows deleted
}
export interface SummaryParams { days: number; top?: number; now: number; }
export interface UsageSummary {
  days: { utcDay: string; countByKind: Partial<Record<RequestKind, number>>; costUsdByKind: Partial<Record<RequestKind, number>> }[];
  topDevicesByCost: { deviceId: string; costUsd: number }[];
  generationStats: { count: number; meanCostUsd: number; medianCostUsd: number; p95CostUsd: number; maxCostUsd: number; unresolvedCount: number };
}
```

`requests` table (design D7 verbatim): `id, device_id, kind, utc_day, started_at, ended_at,
outcome, prompt_tokens, completion_tokens, cost_usd, cost_state, refunded`, indexed on
`(utc_day, kind, device_id)`. WAL + `busy_timeout=5000` set at construction. No prompt/source/
bundle/manifest/schema column exists — closed column set is a locked test (`ledger.suite.ts`).

## `server/src/usage/resolve.ts` — the post-request resolver

```ts
export interface GenerationStats { usage: Usage; totalCostUsd: number; }
export interface UsageAndCostTransport {
  fetchStats(generationId: string, signal: AbortSignal): Promise<GenerationStats | null>; // null = not yet resolved; a promise that ignores `signal` is still cut off by the resolver's own race
}
export interface ResolveBounds {
  maxAttempts: number; totalBudgetMs: number; retryDelayMs: number; perAttemptTimeoutMs: number;
}
export const DEFAULT_RESOLVE_BOUNDS: Readonly<ResolveBounds>; // {5, 5000, 500, 2000}
export interface ResolveDeps { transport: UsageAndCostTransport; usageStore: UsageStore; bounds?: Partial<ResolveBounds>; }

/** requestId '' is a valid no-op sentinel (no ledger row to update) — used by the legacy
 *  reconcileAbortedUsage wrapper below. creditOwned=true skips the token credit (already
 *  credited in-stream) but still records cost. NEVER throws. */
export function resolveRequestUsage(
  requestId: string, deviceId: string, generationIds: readonly string[],
  creditOwned: boolean, deps: ResolveDeps,
): Promise<void>;
// sumGenerationStats also returns resolvedAll (every id resolved, not just foundAny). recordCost
// is 'resolved' only when resolvedAll; else 'unresolved' and the partial cost is discarded — but
// when creditOwned is false the partial tokens from the ids that DID resolve are still credited.

export class ResolveTracker {
  track<T>(promise: Promise<T>): Promise<T>;   // register a detached resolveRequestUsage(...) call
  get pendingCount(): number;
  drain(timeoutMs: number): Promise<void>;     // never rejects; races settlement against timeoutMs
}
```

Callers (chain-9/10/11) construct ONE `ResolveTracker` in composition and wrap every detached
`resolveRequestUsage(...)` call in `tracker.track(...)`; drain (chain-11) calls
`tracker.drain(windowMs)` before closing stores. The REAL `UsageAndCostTransport` (reaching
`GET https://openrouter.ai/api/v1/generation` for both tokens and `total_cost`) still needs to be
built — `generation/index.ts`'s existing `openRouterGenerationStatsTransport` only returns tokens
(`Usage | null`) and is untouched by this chain (out of file scope). Whoever wires
`resolveRequestUsage` into production (composition, `handoff/composition.md`) must add a transport
conforming to `UsageAndCostTransport` above, parsing OpenRouter's `total_cost` field alongside the
existing token fields.

`server/src/generation/reconcile.ts` is now a thin wrapper: same exported
`GenerationStatsTransport`/`ReconcileBounds`/`ReconcileDeps`/`reconcileAbortedUsage` signatures as
before (no import site changes), internally calling `resolve.ts`'s shared `sumGenerationStats` with
`requestId=''` and `totalCostUsd` always 0 (this legacy path never touches the ledger).
