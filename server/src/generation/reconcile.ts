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
 * Introduces NO server-side persistence beyond the existing per-device `UsageStore` counter — no
 * new table, no in-memory retry queue that survives this one call.
 */
import type { Usage } from '@whim/contract';
import type { UsageStore } from '../usage-store';

/**
 * Fetches the provider's authoritative post-hoc usage for one generation id. Injectable so tests
 * never touch a real network. Returns `null` for "not yet resolved" (a normal, expected,
 * pre-resolution state — retried); rejects only on a genuine transport failure, which this module
 * treats identically to `null` (quiet give-up covers both).
 */
export interface GenerationStatsTransport {
  fetchStats(generationId: string): Promise<Usage | null>;
}

export interface ReconcileBounds {
  /** Per-id cap on resolution attempts. */
  maxAttempts: number;
  /** Shared wall-clock deadline for the WHOLE call (every id), not per id — the record resolves
   *  asynchronously upstream and this must stay bounded regardless of how many ids a run left. */
  totalBudgetMs: number;
  /** Delay between attempts for the same id. */
  retryDelayMs: number;
}

export const DEFAULT_RECONCILE_BOUNDS: Readonly<ReconcileBounds> = Object.freeze({
  maxAttempts: 5,
  totalBudgetMs: 5000,
  retryDelayMs: 500,
});

export interface ReconcileDeps {
  transport: GenerationStatsTransport;
  usageStore: UsageStore;
  bounds?: Partial<ReconcileBounds>;
}

function sumUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One id's retry loop: up to `bounds.maxAttempts` attempts, never past `deadline`. Returns the
 *  resolved `Usage`, or `null` if the id never resolved within budget — a transport rejection is
 *  treated identically to an unresolved `null` (quiet give-up covers both). */
async function resolveOneId(id: string, deadline: number, bounds: ReconcileBounds, transport: GenerationStatsTransport): Promise<Usage | null> {
  for (let attempt = 0; attempt < bounds.maxAttempts && Date.now() < deadline; attempt++) {
    let usage: Usage | null;
    try {
      usage = await transport.fetchStats(id);
    } catch {
      usage = null;
    }
    if (usage) return usage;

    const isLastAttempt = attempt === bounds.maxAttempts - 1;
    const remaining = deadline - Date.now();
    if (!isLastAttempt && remaining > 0) await sleep(Math.min(bounds.retryDelayMs, remaining));
  }
  return null;
}

/** Sums the resolved usage across every id in `generationIds`, stopping once the shared
 *  `deadline` passes. `foundAny` distinguishes "resolved zero-valued usage" from "resolved
 *  nothing at all" — only the latter skips crediting entirely. */
async function resolveAll(
  generationIds: readonly string[],
  deadline: number,
  bounds: ReconcileBounds,
  transport: GenerationStatsTransport,
): Promise<{ total: Usage; foundAny: boolean }> {
  let total = ZERO_USAGE;
  let foundAny = false;
  for (const id of generationIds) {
    if (Date.now() >= deadline) break;
    const usage = await resolveOneId(id, deadline, bounds, transport);
    if (usage) {
      total = sumUsage(total, usage);
      foundAny = true;
    }
  }
  return { total, foundAny };
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
    const bounds = { ...DEFAULT_RECONCILE_BOUNDS, ...deps.bounds };
    const deadline = Date.now() + bounds.totalBudgetMs;
    const { total, foundAny } = await resolveAll(generationIds, deadline, bounds, deps.transport);
    if (foundAny) await deps.usageStore.credit(deviceId, total);
  } catch {
    // best-effort — reconciliation must never fail anything user-visible (spec "gives up quietly")
  }
}
