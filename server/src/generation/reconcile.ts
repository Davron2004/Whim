/**
 * server/src/generation/reconcile.ts — post-abort usage reconciliation (design D9, spec "Aborted
 * runs reconcile their authoritative usage"). The route (task 7.3) stays the sole crediting
 * authority: the normal path credits through `interceptUsage`'s `usage` event exactly as before;
 * this module is called ONLY on the abort path, for the ids the machine's `RunTrace` recorded
 * (`handoff/pipeline-machine.md`'s `RunTrace = { generationIds: string[] }`) — a run that never
 * started a model call reconciles nothing (`generationIds` is empty), and a run that completed
 * normally is never routed here at all (design D9: "two crediting paths in one component is how
 * double-counting bugs are born").
 *
 * Reduced (design D7) to a thin, token-only wrapper over `../usage/resolve.ts`'s shared retry
 * internals, which now also carry cost. This module's exported `GenerationStatsTransport` and
 * `reconcileAbortedUsage` signatures are UNCHANGED so every existing import site (`app.ts`,
 * `main.ts`, `routes/generate.ts`, `generation/index.ts`) keeps working untouched; those sites
 * migrate to `resolveRequestUsage` directly in a later chain (composition, `handoff/composition.md`).
 * Introduces NO server-side persistence beyond the existing per-device `UsageStore` counter — no
 * new table, no in-memory retry queue that survives this one call.
 */
import type { Usage } from '@whim/contract';
import type { UsageStore } from '../usage-store';
import { sumGenerationStats, type ResolveBounds, type UsageAndCostTransport } from '../usage/resolve';

/**
 * Fetches the provider's authoritative post-hoc usage for one generation id. Injectable so tests
 * never touch a real network. Returns `null` for "not yet resolved" (a normal, expected,
 * pre-resolution state — retried); rejects only on a genuine transport failure, which this module
 * treats identically to `null` (quiet give-up covers both).
 */
export interface GenerationStatsTransport {
  fetchStats(generationId: string): Promise<Usage | null>;
}

export type { ResolveBounds as ReconcileBounds };

export const DEFAULT_RECONCILE_BOUNDS: Readonly<ResolveBounds> = Object.freeze({
  maxAttempts: 5,
  totalBudgetMs: 5000,
  retryDelayMs: 500,
  perAttemptTimeoutMs: 2000,
});

export interface ReconcileDeps {
  transport: GenerationStatsTransport;
  usageStore: UsageStore;
  bounds?: Partial<ResolveBounds>;
}

/** Adapts the token-only legacy transport to the resolver's `{usage, totalCostUsd}` shape (cost
 *  is always 0 here — this wrapper never records a ledger row, so cost is never observed). */
function adaptTransport(transport: GenerationStatsTransport): UsageAndCostTransport {
  return {
    async fetchStats(generationId: string) {
      const usage = await transport.fetchStats(generationId);
      return usage ? { usage, totalCostUsd: 0 } : null;
    },
  };
}

/**
 * Reconciles authoritative usage for every id in `generationIds` and credits the accumulated
 * total through `deps.usageStore.credit` exactly once. Retries each id up to
 * `bounds.maxAttempts` times, bounded overall by the shared `bounds.totalBudgetMs` deadline —
 * whichever is hit first for a given id, that id is skipped (never throws, never retried beyond
 * budget). Credits nothing when nothing resolved (spec "Reconciliation gives up quietly": "no
 * error surfaces to any client, and no new state is persisted"). This function itself NEVER
 * throws — a transport failure (rejection) is treated the same as an unresolved `null`, and any
 * unexpected error (including from `usageStore.credit`) is swallowed, because reconciliation runs
 * after the SSE stream has already ended and must never surface anything user-visible.
 */
export async function reconcileAbortedUsage(deviceId: string, generationIds: readonly string[], deps: ReconcileDeps): Promise<void> {
  if (generationIds.length === 0) return;
  try {
    const bounds: ResolveBounds = { ...DEFAULT_RECONCILE_BOUNDS, ...deps.bounds };
    const deadline = Date.now() + bounds.totalBudgetMs;
    const { totalUsage, foundAny } = await sumGenerationStats(generationIds, deadline, bounds, adaptTransport(deps.transport));
    if (foundAny) await deps.usageStore.credit(deviceId, totalUsage);
  // eslint-disable-next-line no-restricted-syntax -- intentional: best-effort per spec "gives up quietly" — must never surface a user-visible failure
  } catch {
    // best-effort — reconciliation must never fail anything user-visible (spec "gives up quietly")
  }
}
