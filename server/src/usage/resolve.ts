/**
 * server/src/usage/resolve.ts — the one post-request cost/reconciliation resolver (design D7,
 * generalising the old `reconcileAbortedUsage`; specs/generation-pipeline "Aborted runs reconcile
 * their authoritative usage", specs/server-admission-control "The usage store keeps a
 * content-free request ledger with resolved cost").
 *
 * Runs AFTER a request has already ended (delivered, failed, expired or aborted): it fetches the
 * provider's authoritative generation-stats data for every recorded generation id (the policy
 * call, the unary call, or every pipeline call), sums the cost onto the request's ledger row via
 * `UsageStore.recordCost`, and — only when the in-stream `usage` event was never credited
 * (`creditOwned === false`) — credits the reconciled tokens through `UsageStore.credit`. It is
 * meant to be called detached from the response (never awaited by a route), so callers track it
 * through `ResolveTracker` and drain gives it one final window before shutdown.
 *
 * NEVER throws: a transport failure is indistinguishable from "not yet resolved" and is retried
 * (or, on budget exhaustion, recorded as `'unresolved'` — spec "Unresolvable cost is explicit":
 * "no cost is invented, and no client-visible error occurs"). Introduces no persistence beyond
 * the existing `UsageStore`.
 */
import type { Usage } from '@whim/contract';
import type { UsageStore } from '../usage-store';

/** One provider generation id's authoritative stats. `usage` feeds token reconciliation;
 *  `totalCostUsd` feeds the ledger row's resolved cost. */
export interface GenerationStats {
  usage: Usage;
  totalCostUsd: number;
}

/**
 * Injectable so tests never touch a real network. `signal` is a per-attempt
 * `AbortSignal.timeout` the resolver constructs — a transport that ignores it is still cut off by
 * the resolver's own race (see `resolveOneId` below). Returns `null` for "not yet resolved" (a
 * normal, expected, pre-resolution state — retried) or rejects on a genuine transport failure,
 * which this module treats identically to `null`.
 */
export interface UsageAndCostTransport {
  fetchStats(generationId: string, signal: AbortSignal): Promise<GenerationStats | null>;
}

export interface ResolveBounds {
  /** Per-id cap on resolution attempts. */
  maxAttempts: number;
  /** Shared wall-clock deadline for the WHOLE call (every id), not per id. */
  totalBudgetMs: number;
  /** Delay between attempts for the same id. */
  retryDelayMs: number;
  /** Per-attempt timeout passed to the transport as an `AbortSignal.timeout`. */
  perAttemptTimeoutMs: number;
}

export const DEFAULT_RESOLVE_BOUNDS: Readonly<ResolveBounds> = Object.freeze({
  maxAttempts: 5,
  totalBudgetMs: 5000,
  retryDelayMs: 500,
  perAttemptTimeoutMs: 2000,
});

export interface ResolveDeps {
  transport: UsageAndCostTransport;
  usageStore: UsageStore;
  bounds?: Partial<ResolveBounds>;
}

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

function sumUsage(a: Usage, b: Usage): Usage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Races `promise` against `signal` so a transport that ignores its own abort signal still can't
 *  hang the resolver past the per-attempt timeout. Resolves `null` on abort, rejects only on a
 *  genuine promise rejection (treated by the caller identically to `null`). */
function raceAgainstAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e as Error);
      },
    );
  });
}

/** One id's retry loop: up to `bounds.maxAttempts` attempts, never past `deadline`, each attempt
 *  bounded by its own `AbortSignal.timeout(bounds.perAttemptTimeoutMs)` (clipped to the shared
 *  deadline). Returns the resolved stats, or `null` if the id never resolved within budget. */
async function resolveOneId(
  id: string,
  deadline: number,
  bounds: ResolveBounds,
  transport: UsageAndCostTransport,
): Promise<GenerationStats | null> {
  for (let attempt = 0; attempt < bounds.maxAttempts && Date.now() < deadline; attempt++) {
    const perAttemptMs = Math.max(1, Math.min(bounds.perAttemptTimeoutMs, deadline - Date.now()));
    const signal = AbortSignal.timeout(perAttemptMs);
    let stats: GenerationStats | null;
    try {
      stats = await raceAgainstAbort(transport.fetchStats(id, signal), signal);
    // eslint-disable-next-line no-restricted-syntax -- intentional: a transport rejection is treated identically to an unresolved null, per this module's doc comment above
    } catch {
      stats = null;
    }
    if (stats) return stats;

    const isLastAttempt = attempt === bounds.maxAttempts - 1;
    const remaining = deadline - Date.now();
    if (!isLastAttempt && remaining > 0) await sleep(Math.min(bounds.retryDelayMs, remaining));
  }
  return null;
}

/** Sums resolved usage and cost across every id in `generationIds`, stopping once the shared
 *  `deadline` passes. `foundAny` distinguishes "resolved nothing at all" (the whole sum stays
 *  zero and untrusted) from "resolved some ids" (a best-effort partial sum, which is still
 *  authoritative for the ids that did resolve). */
export async function sumGenerationStats(
  generationIds: readonly string[],
  deadline: number,
  bounds: ResolveBounds,
  transport: UsageAndCostTransport,
): Promise<{ totalUsage: Usage; totalCostUsd: number; foundAny: boolean }> {
  let totalUsage = ZERO_USAGE;
  let totalCostUsd = 0;
  let foundAny = false;
  for (const id of generationIds) {
    if (Date.now() >= deadline) break;
    const stats = await resolveOneId(id, deadline, bounds, transport);
    if (stats) {
      totalUsage = sumUsage(totalUsage, stats.usage);
      totalCostUsd += stats.totalCostUsd;
      foundAny = true;
    }
  }
  return { totalUsage, totalCostUsd, foundAny };
}

/**
 * Resolves cost (and, when not already credited, tokens) for one request. `requestId` identifies
 * the ledger row `recordCost` writes to — pass `''` when there is no ledger row to update (the
 * legacy `reconcileAbortedUsage` wrapper below), which is a guaranteed no-op update, never an
 * error. `creditOwned` is `true` when the run already credited its tokens in-stream (a normal
 * `usage` event), so only cost is recorded here — spec "Cost resolution SHALL NOT credit tokens
 * for a run whose `usage` event was already credited, so no run's tokens are ever counted twice."
 *
 * Never throws or rejects — this runs detached from any response and must never surface a
 * client-visible failure.
 */
export async function resolveRequestUsage(
  requestId: string,
  deviceId: string,
  generationIds: readonly string[],
  creditOwned: boolean,
  deps: ResolveDeps,
): Promise<void> {
  try {
    if (generationIds.length === 0) {
      if (requestId) await deps.usageStore.recordCost(requestId, { state: 'resolved', costUsd: 0 });
      return;
    }
    const bounds = { ...DEFAULT_RESOLVE_BOUNDS, ...deps.bounds };
    const deadline = Date.now() + bounds.totalBudgetMs;
    const { totalUsage, totalCostUsd, foundAny } = await sumGenerationStats(
      generationIds,
      deadline,
      bounds,
      deps.transport,
    );
    if (foundAny) {
      if (requestId) await deps.usageStore.recordCost(requestId, { state: 'resolved', costUsd: totalCostUsd });
      if (!creditOwned) await deps.usageStore.credit(deviceId, totalUsage);
    } else if (requestId) {
      await deps.usageStore.recordCost(requestId, { state: 'unresolved' });
    }
  // eslint-disable-next-line no-restricted-syntax -- intentional: best-effort per spec "gives up quietly" — must never surface a user-visible failure
  } catch {
    // best-effort — resolution must never fail anything user-visible
  }
}

/**
 * Tracks in-flight `resolveRequestUsage` calls so drain (chain-11) can give them a bounded final
 * window before shutdown instead of dropping them. Callers wrap every detached resolve call:
 * `tracker.track(resolveRequestUsage(...))`.
 */
export class ResolveTracker {
  private readonly inFlight = new Set<Promise<unknown>>();

  /** Registers `promise` and returns it unchanged, so call sites can wrap in place. */
  track<T>(promise: Promise<T>): Promise<T> {
    this.inFlight.add(promise);
    const untrack = () => this.inFlight.delete(promise);
    promise.then(untrack, untrack);
    return promise;
  }

  /** Number of resolutions currently in flight. */
  get pendingCount(): number {
    return this.inFlight.size;
  }

  /** Waits for every currently tracked promise to settle, or `timeoutMs` to elapse, whichever
   *  comes first. Never rejects — every tracked promise already resolves (never throws, per
   *  `resolveRequestUsage`'s contract above). */
  async drain(timeoutMs: number): Promise<void> {
    if (this.inFlight.size === 0) return;
    const settled = Promise.allSettled([...this.inFlight]);
    await Promise.race([settled, sleep(timeoutMs)]);
  }
}
