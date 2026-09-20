/**
 * server/src/usage/resolve.ts — the one post-request cost/reconciliation resolver (design D7,
 * generalising the old `reconcileAbortedUsage`; specs/generation-pipeline "Aborted runs reconcile
 * their authoritative usage", specs/server-admission-control "The usage store keeps a
 * content-free request ledger with resolved cost").
 *
 * Runs AFTER a request has already ended (delivered, failed, expired or aborted): it fetches the
 * provider's authoritative generation-stats data for every recorded generation id (the policy
 * call, the unary call, or every pipeline call), sums the cost onto the request's ledger row via
 * `UsageStore.recordCost`, and credits tokens only for calls whose in-stream usage was not
 * already credited. Ownership can cover the whole request or individual provider ids. It is
 * meant to be called detached from the response (never awaited by a route), so callers track it
 * through `ResolveTracker` and drain gives it one final window before shutdown.
 *
 * NEVER throws: a transport failure is indistinguishable from "not yet resolved" and is retried
 * (or, on budget exhaustion, recorded as `'unresolved'` — spec "Unresolvable cost is explicit":
 * "no cost is invented, and no client-visible error occurs"). A request whose ids only PARTLY
 * resolve is `'unresolved'` too: its cost is real but incomplete, and recording an incomplete sum
 * as resolved understates what a generation costs. An `'unresolved'` verdict is not the end of the
 * story: the row keeps the generation ids it was summed from, and `runCostResolutionSweep` below
 * re-runs the same resolution on a timer until the provider does answer.
 */
import type { Usage } from '@whim/contract';
import type { UsageStore } from '../usage-store';
import { log } from '../logger';

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

/**
 * How many of one request's generation ids are resolved at the same time. The ids share one
 * deadline, so they must overlap (see `sumGenerationStats`) — but a pipeline run can record a
 * dozen model calls, and one unbounded burst per finishing request means the provider's stats
 * endpoint sees requests × ids sockets at once, which is exactly how a rate limit turns every id
 * into an unresolved one. Four keeps a typical run's ids overlapping while bounding the burst.
 */
export const MAX_CONCURRENT_ID_RESOLUTIONS = 4;

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

/**
 * Sums resolved usage and cost across every id in `generationIds`, under one shared `deadline`.
 * `uncreditedUsage` excludes the supplied credited ids and stays absent when none of the
 * uncredited ids resolve. Cost and `totalUsage` still include every resolved id.
 *
 * The ids are resolved CONCURRENTLY, because the deadline is shared: resolved one after another, a
 * single slow id spends the whole budget and every id behind it is never even attempted, so what
 * the sum contains depends on provider-response order rather than on what was resolvable. The
 * concurrency is capped at `MAX_CONCURRENT_ID_RESOLUTIONS` — with the shared deadline this still
 * queues every id within the shared budget, while a request with many model calls can no longer
 * open one socket per id at once. With more ids than the cap and a slow provider, the deadline can
 * still expire before the ids queued last are ever attempted — which is exactly why the sweep
 * below exists, to give them another pass later.
 *
 * Two flags, deliberately distinct:
 *  - `foundAny` — at least one id resolved. A best-effort partial sum, authoritative only for the
 *    ids it covers.
 *  - `resolvedAll` — EVERY id resolved, so the sum is the complete cost of the request. Only this
 *    one may be recorded as a resolved ledger cost; a partial sum recorded as `resolved` would
 *    quietly under-report what a generation costs.
 */
export async function sumGenerationStats(
  generationIds: readonly string[],
  deadline: number,
  bounds: ResolveBounds,
  transport: UsageAndCostTransport,
  creditedGenerationIds?: ReadonlySet<string>,
): Promise<{ totalUsage: Usage; uncreditedUsage?: Usage; totalCostUsd: number; foundAny: boolean; resolvedAll: boolean }> {
  // A fixed pool of workers pulling from one cursor — the smallest semaphore there is, and no new
  // dependency. `resolveOneId` never rejects (it treats a transport failure as unresolved) and
  // stops itself at the shared deadline, so the per-id `catch` is belt-and-braces: one unexpected
  // rejection cannot discard every other id's result, and cannot wedge a worker.
  const resolved = new Array<GenerationStats | null>(generationIds.length).fill(null);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= generationIds.length) return;
      resolved[index] = await resolveOneId(generationIds[index], deadline, bounds, transport).catch(() => null);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_ID_RESOLUTIONS, generationIds.length) }, () => worker()),
  );

  let totalUsage = ZERO_USAGE;
  let uncreditedUsage: Usage | undefined;
  let totalCostUsd = 0;
  let foundAny = false;
  let resolvedAll = true;
  for (const [index, stats] of resolved.entries()) {
    if (!stats) {
      resolvedAll = false;
      continue;
    }
    totalUsage = sumUsage(totalUsage, stats.usage);
    if (!creditedGenerationIds?.has(generationIds[index])) {
      uncreditedUsage = sumUsage(uncreditedUsage ?? ZERO_USAGE, stats.usage);
    }
    totalCostUsd += stats.totalCostUsd;
    foundAny = true;
  }
  return { totalUsage, uncreditedUsage, totalCostUsd, foundAny, resolvedAll };
}

/**
 * Resolves cost (and, when not already credited, tokens) for one request. `requestId` identifies
 * the ledger row `recordCost` writes to — pass `''` when there is no ledger row to update (the
 * legacy `reconcileAbortedUsage` wrapper below), which is a guaranteed no-op update, never an
 * error. `creditOwned` is `true` when the run already credited its tokens in-stream (a normal
 * `usage` event), so only cost is recorded here — spec "Cost resolution SHALL NOT credit tokens
 * for a run whose `usage` event was already credited, so no run's tokens are ever counted twice."
 * A set instead identifies the individually credited provider calls, for a request whose retry
 * failed after an earlier attempt credited usage. All ids still contribute to the request cost.
 *
 * Never throws or rejects — this runs detached from any response and must never surface a
 * client-visible failure.
 */
export async function resolveRequestUsage(
  requestId: string,
  deviceId: string,
  generationIds: readonly string[],
  creditOwned: boolean | ReadonlySet<string>,
  deps: ResolveDeps,
): Promise<void> {
  try {
    if (generationIds.length === 0) {
      if (requestId) await deps.usageStore.recordCost(requestId, { state: 'resolved', costUsd: 0 });
      return;
    }
    const bounds = { ...DEFAULT_RESOLVE_BOUNDS, ...deps.bounds };
    // Register the ids BEFORE the attempts, while the row is still `pending`: it is what lets the
    // sweep below pick the row up if this process dies mid-resolution (a drain that outran its
    // final window, a crash), and it costs one write on a row nothing else touches.
    if (requestId) await deps.usageStore.recordCost(requestId, { state: 'pending', generationIds });
    const deadline = Date.now() + bounds.totalBudgetMs;
    const { uncreditedUsage, totalCostUsd, resolvedAll } = await sumGenerationStats(
      generationIds,
      deadline,
      bounds,
      deps.transport,
      typeof creditOwned === 'boolean' ? undefined : creditOwned,
    );
    // Cost and tokens are stamped by different rules, on purpose. COST is all-or-nothing: the row's
    // `resolved` cost is what the operator reads as "what a generation costs" when sizing the
    // credit limit, and a partial sum stamped `resolved` is a confidently wrong, low-biased number
    // — worse than an honest `unresolved`, and `CostState` has no third value to hedge with. TOKENS
    // are an accumulating best-effort meter that nothing treats as authoritative, so the ids that
    // did resolve are still credited: those tokens were really spent, and crediting zero for them
    // under-counts the device strictly harder.
    if (requestId) {
      await deps.usageStore.recordCost(
        requestId,
        resolvedAll ? { state: 'resolved', costUsd: totalCostUsd } : { state: 'unresolved', generationIds },
      );
    }
    if (uncreditedUsage && creditOwned !== true) await deps.usageStore.credit(deviceId, uncreditedUsage);
  // eslint-disable-next-line no-restricted-syntax -- intentional: best-effort per spec "gives up quietly" — must never surface a user-visible failure
  } catch {
    // best-effort — resolution must never fail anything user-visible
  }
}

/** At most this many ledger rows per sweep pass — a bound on both the provider traffic one pass
 *  can generate and how long a pass can hold the process busy. */
export const DEFAULT_SWEEP_LIMIT = 50;
/** How long after a request ENDED a still-`'pending'` cost row is treated as abandoned by its
 *  resolver (a crash, or a drain that outran its final window) rather than as one in progress. */
export const DEFAULT_STALE_PENDING_MS = 120_000;
/** How long after a request ENDED its cost row stays a sweep candidate at all. Without a cut-off,
 *  a row whose provider generation id the provider will never index (permanently unresolvable)
 *  stays the oldest row forever, so it is selected by every pass ahead of every newer, genuinely
 *  resolvable row — starving them and burning a provider stats call for nothing every pass. A row
 *  older than this is left `'unresolved'` and is never re-attempted again. */
export const DEFAULT_SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const sweepLog = log.child({ scope: 'cost-sweep' });

export interface CostSweepDeps {
  usageStore: UsageStore;
  transport: UsageAndCostTransport;
  /** Injected clock; the `'pending'` staleness cut-off is measured from it. */
  now: () => number;
  bounds?: Partial<ResolveBounds>;
  /** True while the process is draining. The sweep is discretionary background work: a drain has a
   *  bounded window for the resolutions already in flight, and starting new ones inside it would
   *  compete with exactly that. */
  isDraining?: () => boolean;
  limit?: number;
  stalePendingAfterMs?: number;
  /** Defaults to `DEFAULT_SWEEP_MAX_AGE_MS`. */
  maxAgeMs?: number;
}

export interface CostSweepOutcome {
  /** The pass took no work because the process is draining. */
  skipped: boolean;
  examined: number;
  /** Rows whose cost resolved on this pass (`'unresolved'`/`'pending'` upgraded to `'resolved'`). */
  resolved: number;
  /** Rows still unresolved after this pass — retried again at the next one. */
  unresolved: number;
}

/**
 * One bounded re-resolution pass over the ledger's unfinished cost rows.
 *
 * The in-request resolver gives up after a few seconds, but OpenRouter's stats endpoint routinely
 * answers minutes later, and before this the row was terminal: the cost was lost for good and the
 * operator's per-generation numbers read low. Each pass takes the oldest rows that still carry
 * provider generation ids and re-runs the SAME shared-deadline resolution; a row that resolves is
 * upgraded, a row that does not stays `'unresolved'` and is simply retried by the next pass — so
 * retry pressure on the provider is the sweep's cadence, never a tight loop.
 *
 * It resolves COST only and never credits tokens: the first pass already credited the tokens of
 * every id that resolved for it, and a device's token meter has no way to tell a re-credit from
 * new spend, so crediting here would inflate it on every pass forever. Cost has no such hazard —
 * it is written, not accumulated.
 *
 * Rows are handled one at a time (each one's own ids still overlap, capped as everywhere else), so
 * a pass's provider traffic is bounded by `MAX_CONCURRENT_ID_RESOLUTIONS`, not by `limit`.
 * Never throws: it is background work, called from a timer with no one to report to but the log.
 */
export async function runCostResolutionSweep(deps: CostSweepDeps): Promise<CostSweepOutcome> {
  const outcome: CostSweepOutcome = { skipped: false, examined: 0, resolved: 0, unresolved: 0 };
  if (deps.isDraining?.()) return { ...outcome, skipped: true };

  const bounds = { ...DEFAULT_RESOLVE_BOUNDS, ...deps.bounds };
  try {
    const candidates = await deps.usageStore.listUnresolvedCostRows({
      now: deps.now(),
      stalePendingAfterMs: deps.stalePendingAfterMs ?? DEFAULT_STALE_PENDING_MS,
      maxAgeMs: deps.maxAgeMs ?? DEFAULT_SWEEP_MAX_AGE_MS,
      limit: deps.limit ?? DEFAULT_SWEEP_LIMIT,
    });
    for (const candidate of candidates) {
      // A drain that begins mid-pass stops the pass where it is; the rows it did not reach are
      // still `'unresolved'`, so the next process's first sweep finds them unchanged.
      if (deps.isDraining?.()) break;
      outcome.examined++;
      const { totalCostUsd, resolvedAll } = await sumGenerationStats(
        candidate.generationIds,
        Date.now() + bounds.totalBudgetMs,
        bounds,
        deps.transport,
      );
      if (resolvedAll) {
        await deps.usageStore.recordCost(candidate.requestId, { state: 'resolved', costUsd: totalCostUsd });
        outcome.resolved++;
      } else {
        await deps.usageStore.recordCost(candidate.requestId, {
          state: 'unresolved',
          generationIds: candidate.generationIds,
        });
        outcome.unresolved++;
      }
    }
    if (outcome.examined > 0) {
      sweepLog.info(
        { examined: outcome.examined, resolved: outcome.resolved, unresolved: outcome.unresolved },
        'cost resolution sweep',
      );
    }
  } catch (err) {
    sweepLog.warn({ detail: err instanceof Error ? err.message : String(err), ...outcome }, 'cost resolution sweep failed');
  }
  return outcome;
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
