/**
 * Usage cost and reconciliation resolver acceptance (public-generation-server chain-2).
 * Scaffolded here by chain-1 (task 2.5, pre-registered in acceptance.ts); chain-2 fills it in —
 * this module is chain-2's alone to edit.
 *
 * Covers specs/server-admission-control "The usage store keeps a content-free request ledger
 * with resolved cost" and specs/generation-pipeline "Aborted runs reconcile their authoritative
 * usage" at the `resolveRequestUsage`/`ResolveTracker` layer (design D7). Route-level wiring
 * (capturing generation ids, choosing `creditOwned`) belongs to chain-9/10's suites.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Usage } from '@whim/contract';
import { check, eq, section } from './harness';
import { NodeSqliteUsageStore, InMemoryUsageStore, type UsageStore } from '../src/usage-store';
import {
  DEFAULT_SWEEP_LIMIT,
  DEFAULT_SWEEP_MAX_AGE_MS,
  MAX_CONCURRENT_ID_RESOLUTIONS,
  resolveRequestUsage,
  ResolveTracker,
  runCostResolutionSweep,
  type GenerationStats,
  type UsageAndCostTransport,
} from '../src/usage/resolve';

const DEVICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function usage(promptTokens: number, completionTokens: number): Usage {
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

/** A scripted transport keyed by generation id. `hang` ids never resolve their promise — used to
 *  prove the per-attempt timeout cuts off a stalled provider call. */
function scriptedTransport(byId: Map<string, GenerationStats | 'hang'>): UsageAndCostTransport {
  return {
    fetchStats(generationId: string): Promise<GenerationStats | null> {
      const entry = byId.get(generationId);
      if (entry === 'hang') return new Promise(() => {}); // never resolves — cut off by the resolver's own race
      return Promise.resolve(entry ?? null);
    },
  };
}

/** Wraps a `UsageStore` to count `credit()` calls, so "credited exactly once" is a real call-count
 *  assertion rather than an inference from the resulting total. Delegates every other method
 *  explicitly — `inner` is a class instance, so `{...inner}` would silently drop its prototype
 *  methods (a real bug this suite caught: a spread-based wrapper made `recordCost` undefined,
 *  which `resolveRequestUsage`'s best-effort catch then swallowed with no visible failure). */
function countingCreditStore(inner: UsageStore): { store: UsageStore; creditCalls: number[] } {
  const creditCalls: number[] = [];
  const store: UsageStore = {
    async credit(deviceId: string, u: Usage): Promise<void> {
      creditCalls.push(u.totalTokens);
      await inner.credit(deviceId, u);
    },
    read: (deviceId) => inner.read(deviceId),
    admit: (params) => inner.admit(params),
    refund: (requestId) => inner.refund(requestId),
    settle: (requestId, params) => inner.settle(requestId, params),
    recordCost: (requestId, params) => inner.recordCost(requestId, params),
    listUnresolvedCostRows: (query) => inner.listUnresolvedCostRows(query),
    summary: (params) => inner.summary(params),
    purgeLedger: (beforeUtcDay) => inner.purgeLedger(beforeUtcDay),
  };
  return { store, creditCalls };
}

/** Races `promise` against a ref'd safety timeout so a regression that makes the resolver hang
 *  forever fails this ONE test instead of freezing the whole suite. */
async function withSafetyTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function testSummedCostCreditOwned(): Promise<void> {
  section('Resolver — a delivered run\'s cost is summed; tokens already credited are not re-credited');

  const store = new NodeSqliteUsageStore(':memory:');
  const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: Date.now(), deviceLimit: 15 });
  if (!admitted.ok) throw new Error('setup: admit should succeed');
  await store.settle(admitted.requestId, { outcome: 'delivered' });

  // The normal path already credited tokens through the in-stream `usage` event.
  await store.credit(DEVICE_A, usage(100, 50));
  const { store: counted, creditCalls } = countingCreditStore(store);

  const transport = scriptedTransport(new Map([
    ['gen-1', { usage: usage(10, 5), totalCostUsd: 0.012 }],
    ['gen-2', { usage: usage(20, 10), totalCostUsd: 0.030 }],
    ['gen-3', { usage: usage(1, 1), totalCostUsd: 0.004 }],
  ]));

  await resolveRequestUsage(admitted.requestId, DEVICE_A, ['gen-1', 'gen-2', 'gen-3'], true, {
    transport,
    usageStore: counted,
  });

  eq('creditOwned=true: resolveRequestUsage never calls credit again', creditCalls.length, 0);
  const totals = await store.read(DEVICE_A);
  eq('the device total is exactly the one in-stream credit, untouched by resolution', totals.totalTokens, 150);

  const summary = await store.summary({ days: 1, now: Date.now() });
  check('the summed cost (0.012+0.030+0.004) was recorded on the ledger row', closeEnough(summary.generationStats.maxCostUsd, 0.046));
  eq('the resolved row is not counted as unresolved', summary.generationStats.unresolvedCount, 0);
  store.close();
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

async function testCancelledRunCostAndSingleCredit(): Promise<void> {
  section('Resolver — a cancelled run gets its cost and a single token credit');

  const store = new NodeSqliteUsageStore(':memory:');
  const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: Date.now(), deviceLimit: 15 });
  if (!admitted.ok) throw new Error('setup: admit should succeed');
  await store.settle(admitted.requestId, { outcome: 'aborted' });

  const { store: counted, creditCalls } = countingCreditStore(store);
  const transport = scriptedTransport(new Map([
    ['gen-1', { usage: usage(30, 10), totalCostUsd: 0.02 }],
    ['gen-2', { usage: usage(5, 2), totalCostUsd: 0.01 }],
  ]));

  await resolveRequestUsage(admitted.requestId, DEVICE_A, ['gen-1', 'gen-2'], false, {
    transport,
    usageStore: counted,
  });

  eq('an aborted run (creditOwned=false) is credited exactly once', creditCalls.length, 1);
  const totals = await store.read(DEVICE_A);
  eq('the credited total is the sum of both resolved ids', totals.totalTokens, 47);
  store.close();
}

async function testUnresolvableCostIsExplicit(): Promise<void> {
  section('Resolver — unresolvable cost is explicit, never invented, never a thrown error');

  const store = new NodeSqliteUsageStore(':memory:');
  const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: Date.now(), deviceLimit: 15 });
  if (!admitted.ok) throw new Error('setup: admit should succeed');
  await store.settle(admitted.requestId, { outcome: 'failed' });

  // Nothing in this map ever resolves — every id stays unmapped, so the transport returns null.
  const transport = scriptedTransport(new Map());
  const before = await store.read(DEVICE_A);

  let threw = false;
  try {
    await withSafetyTimeout(
      resolveRequestUsage(admitted.requestId, DEVICE_A, ['never-resolves'], false, {
        transport,
        usageStore: store,
        bounds: { maxAttempts: 1, totalBudgetMs: 50, retryDelayMs: 0, perAttemptTimeoutMs: 25 },
      }),
      2000,
      'resolveRequestUsage (unresolvable)',
    );
  // eslint-disable-next-line no-restricted-syntax -- intentional: the flag flip below is the assertion that this never throws, per spec "no client-visible error occurs"
  } catch {
    threw = true;
  }
  check('resolveRequestUsage never throws, even when nothing resolves', threw === false);

  // ':memory:' can't be reopened from a second connection, so read back through the store's own
  // summary instead of a raw connection.
  const summary = await store.summary({ days: 1, now: Date.now() });
  eq('unresolved cost is counted, not invented', summary.generationStats.unresolvedCount, 1);

  const after = await store.read(DEVICE_A);
  eq('no tokens were credited for an unresolvable id', after.totalTokens, before.totalTokens);
  store.close();
}

/**
 * A pipeline request records several generation ids and resolves them under ONE shared deadline.
 * If one id stalls, the row must not be stamped `resolved` with whatever the others summed to: the
 * operator reads that number as the cost of a generation. It must also not lose the fast ids to the
 * stalled one — they are resolved concurrently, so a stall costs their result only if the WHOLE
 * budget elapses.
 */
async function testPartialResolutionIsNotStampedResolved(): Promise<void> {
  section('Resolver — a partial resolution is never stamped resolved with a partial cost');

  const store = new NodeSqliteUsageStore(':memory:');
  const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: Date.now(), deviceLimit: 15 });
  if (!admitted.ok) throw new Error('setup: admit should succeed');
  await store.settle(admitted.requestId, { outcome: 'aborted' });

  const attempted = new Set<string>();
  const fast = new Map<string, GenerationStats>([
    ['gen-2', { usage: usage(10, 5), totalCostUsd: 0.02 }],
    ['gen-3', { usage: usage(10, 5), totalCostUsd: 0.02 }],
    ['gen-4', { usage: usage(10, 5), totalCostUsd: 0.02 }],
    ['gen-5', { usage: usage(10, 5), totalCostUsd: 0.02 }],
  ]);
  const transport: UsageAndCostTransport = {
    fetchStats(generationId: string): Promise<GenerationStats | null> {
      attempted.add(generationId);
      // The provider has not yet published stats for the first id and never will inside the budget.
      if (generationId === 'gen-slow') return new Promise(() => {});
      return Promise.resolve(fast.get(generationId) ?? null);
    },
  };

  const { store: counted, creditCalls } = countingCreditStore(store);
  await withSafetyTimeout(
    resolveRequestUsage(admitted.requestId, DEVICE_A, ['gen-slow', 'gen-2', 'gen-3', 'gen-4', 'gen-5'], false, {
      transport,
      usageStore: counted,
      // The stalled id retries until the SHARED budget is gone: resolved sequentially it would
      // leave nothing for the ids behind it, which is the starvation this asserts against.
      bounds: { maxAttempts: 5, totalBudgetMs: 300, retryDelayMs: 10, perAttemptTimeoutMs: 100 },
    }),
    3000,
    'resolveRequestUsage (partial)',
  );

  // Concurrency: a stalled first id must not starve the ids behind it.
  eq('every id is attempted, not just the ones ahead of the stalled one', attempted.size, 5);

  const summary = await store.summary({ days: 1, now: Date.now() });
  eq('a partially-resolved row is counted as unresolved', summary.generationStats.unresolvedCount, 1);
  eq('no partial cost is recorded on the row', summary.generationStats.maxCostUsd, 0);

  // Tokens are a best-effort meter, not an authoritative stamp: what did resolve is still credited.
  eq('the tokens that did resolve are still credited exactly once', creditCalls.length, 1);
  eq('the credited total is the sum of the four resolved ids', (await store.read(DEVICE_A)).totalTokens, 60);
  store.close();
}

async function testHangingAttemptCutOffByTimeout(): Promise<void> {
  section('Resolver — a hanging attempt is cut off by its per-attempt timeout, not left to hang forever');

  const store = new InMemoryUsageStore();
  const transport = scriptedTransport(new Map([['stalled-id', 'hang']]));

  const startedAt = Date.now();
  await withSafetyTimeout(
    resolveRequestUsage('', DEVICE_A, ['stalled-id'], true, {
      transport,
      usageStore: store,
      bounds: { maxAttempts: 1, totalBudgetMs: 300, retryDelayMs: 0, perAttemptTimeoutMs: 50 },
    }),
    3000,
    'resolveRequestUsage (hanging transport)',
  );
  const elapsedMs = Date.now() - startedAt;

  check('a transport that never resolves does not hang the resolver past its bounds', elapsedMs < 2000, `took ${elapsedMs}ms`);
}

async function testResolveTracker(): Promise<void> {
  section('Resolver — ResolveTracker is drainable');

  const tracker = new ResolveTracker();
  let releaseSlow: () => void = () => {};
  const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });

  eq('nothing tracked yet', tracker.pendingCount, 0);
  const tracked = tracker.track(slow);
  eq('one in-flight resolution', tracker.pendingCount, 1);

  // drain() bounded by a timeout shorter than the in-flight promise returns without hanging.
  await withSafetyTimeout(tracker.drain(20), 2000, 'tracker.drain (bounded)');
  check('drain returns even while a promise is still pending', tracker.pendingCount === 1);

  releaseSlow();
  await tracked;
  await withSafetyTimeout(tracker.drain(1000), 2000, 'tracker.drain (settled)');
  eq('drain untracks a settled promise', tracker.pendingCount, 0);
}

async function testEmptyGenerationIds(): Promise<void> {
  section('Resolver — no generation ids persists zero cost without transport calls or token credit');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-empty-ids-'));
  const dbPath = path.join(dir, 'usage.db');
  const store = new NodeSqliteUsageStore(dbPath);
  try {
    const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'report', now: Date.now(), deviceLimit: 300 });
    if (!admitted.ok) throw new Error('setup: admit should succeed');
    await store.settle(admitted.requestId, { outcome: 'ok' });
    await store.credit(DEVICE_A, usage(3, 4));
    const before = await store.read(DEVICE_A);
    const { store: counted, creditCalls } = countingCreditStore(store);

    let calls = 0;
    const transport: UsageAndCostTransport = {
      fetchStats() {
        calls++;
        return Promise.resolve(null);
      },
    };
    await resolveRequestUsage(admitted.requestId, DEVICE_A, [], false, { transport, usageStore: counted });
    eq('the transport is never called for an empty id list', calls, 0);
    eq('an empty id list makes no token credit call', creditCalls, []);
    eq('the existing device usage is unchanged', await store.read(DEVICE_A), before);

    const reader = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = reader.prepare('SELECT cost_state, cost_usd FROM requests WHERE id = ?').get(admitted.requestId);
      eq('the report row persists resolved zero cost', { ...row }, { cost_state: 'resolved', cost_usd: 0 });
    } finally {
      reader.close();
    }
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Bounds every sweep test's resolution so a pass is milliseconds, not the 5-second default. */
const SWEEP_BOUNDS = { maxAttempts: 2, totalBudgetMs: 200, retryDelayMs: 1, perAttemptTimeoutMs: 50 };

/** Admits a generate row, settles it, and runs the in-request resolver against `transport` — the
 *  setup every sweep test starts from: a row the first pass could not cost. */
async function admitAndResolve(
  store: UsageStore,
  generationIds: readonly string[],
  transport: UsageAndCostTransport,
  now: number,
): Promise<string> {
  const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now, deviceLimit: 15 });
  if (!admitted.ok) throw new Error('setup: admit should succeed');
  await store.settle(admitted.requestId, { outcome: 'delivered', now });
  await resolveRequestUsage(admitted.requestId, DEVICE_A, generationIds, true, {
    transport,
    usageStore: store,
    bounds: SWEEP_BOUNDS,
  });
  return admitted.requestId;
}

/**
 * The point of the sweep: a cost the in-request attempts gave up on is picked up later, once the
 * provider's stats endpoint has caught up. And a cost that still does not resolve stays honest —
 * it is neither invented nor lost, and it is retried only as often as the sweep runs.
 */
async function testSweepResolvesWhatTheRequestCouldNot(): Promise<void> {
  section('Resolver — the sweep re-resolves a cost the in-request attempts gave up on');

  const store = new InMemoryUsageStore();
  const now = Date.UTC(2026, 0, 15, 12, 0, 0, 0);
  const stats = new Map<string, GenerationStats | 'hang'>();

  // Nothing resolves yet: the request's own attempts run out and stamp the row 'unresolved'.
  const lateId = await admitAndResolve(store, ['gen-late'], scriptedTransport(stats), now);
  const neverId = await admitAndResolve(store, ['gen-never'], scriptedTransport(stats), now + 1000);
  const before = await store.summary({ days: 1, now });
  eq('both rows start unresolved', before.generationStats.unresolvedCount, 2);

  // The provider catches up on one of them.
  stats.set('gen-late', { usage: usage(4, 6), totalCostUsd: 0.075 });
  let calls = 0;
  const counting: UsageAndCostTransport = {
    fetchStats(id: string, signal: AbortSignal): Promise<GenerationStats | null> {
      calls++;
      return scriptedTransport(stats).fetchStats(id, signal);
    },
  };

  const first = await runCostResolutionSweep({ usageStore: store, transport: counting, now: () => now, bounds: SWEEP_BOUNDS });
  eq('the sweep examined both unfinished rows', first.examined, 2);
  eq('one row resolved', first.resolved, 1);
  eq('the other stays unresolved', first.unresolved, 1);

  const after = await store.summary({ days: 1, now });
  eq('only the still-unknown row is counted unresolved now', after.generationStats.unresolvedCount, 1);
  check('the late cost landed on the ledger', closeEnough(after.days[0]!.costUsdByKind.generate ?? 0, 0.075), JSON.stringify(after.days[0]));

  // The resolved row is never offered again, and the unresolved one is retried by the NEXT pass —
  // never inside this one, so the provider sees the sweep's cadence and nothing tighter.
  const callsAfterFirst = calls;
  check('one pass costs at most maxAttempts per id', callsAfterFirst <= SWEEP_BOUNDS.maxAttempts * 2, `${callsAfterFirst} calls`);
  const second = await runCostResolutionSweep({ usageStore: store, transport: counting, now: () => now, bounds: SWEEP_BOUNDS });
  eq('the second pass sees only the row that never resolved', second.examined, 1);
  eq('and it is still unresolved', second.unresolved, 1);
  check('the retry happened on the pass, not in a loop', calls - callsAfterFirst <= SWEEP_BOUNDS.maxAttempts, `${calls - callsAfterFirst} calls`);

  const candidates = await store.listUnresolvedCostRows({ now, stalePendingAfterMs: 120_000, maxAgeMs: 24 * 60 * 60 * 1000, limit: 50 });
  eq('the row that resolved is gone from the candidate set', candidates.map((c) => c.requestId), [neverId]);
  eq('the resolved row keeps its cost', (await store.summary({ days: 1, now })).generationStats.unresolvedCount, 1);
  check('the resolved row is the one the provider answered for', lateId !== neverId);
}

/**
 * The sweep is discretionary background work, and a drain has a bounded final window for the
 * resolutions already in flight. Starting new ones inside it would compete with exactly that, so a
 * draining process's sweep takes no work at all — it does not even look for candidates.
 */
async function testSweepStandsDownWhileDraining(): Promise<void> {
  section('Resolver — the sweep takes no work while the process is draining');

  const now = Date.UTC(2026, 0, 15, 12, 0, 0, 0);
  const store = new InMemoryUsageStore();
  let transportCalls = 0;
  const transport: UsageAndCostTransport = {
    fetchStats(): Promise<GenerationStats | null> {
      transportCalls++;
      return Promise.resolve(null);
    },
  };
  await admitAndResolve(store, ['gen-drain'], transport, now);
  const callsBefore = transportCalls;

  let listCalls = 0;
  const watched: UsageStore = {
    credit: (deviceId, u) => store.credit(deviceId, u),
    read: (deviceId) => store.read(deviceId),
    admit: (params) => store.admit(params),
    refund: (requestId) => store.refund(requestId),
    settle: (requestId, params) => store.settle(requestId, params),
    recordCost: (requestId, params) => store.recordCost(requestId, params),
    listUnresolvedCostRows: (query) => {
      listCalls++;
      return store.listUnresolvedCostRows(query);
    },
    summary: (params) => store.summary(params),
    purgeLedger: (beforeUtcDay) => store.purgeLedger(beforeUtcDay),
  };

  const draining = await runCostResolutionSweep({
    usageStore: watched,
    transport,
    now: () => now,
    bounds: SWEEP_BOUNDS,
    isDraining: () => true,
  });
  check('the pass reports itself skipped', draining.skipped);
  eq('no rows were examined', draining.examined, 0);
  eq('the ledger was never queried', listCalls, 0);
  eq('the provider was never called', transportCalls, callsBefore);

  // The same sweep, not draining, does the work — so the assertion above is about the drain guard
  // and not about there being nothing to sweep.
  const running = await runCostResolutionSweep({
    usageStore: watched,
    transport,
    now: () => now,
    bounds: SWEEP_BOUNDS,
    isDraining: () => false,
  });
  check('the identical pass outside a drain does look', !running.skipped && running.examined === 1, JSON.stringify(running));
}

/**
 * Without a give-up rule, `DEFAULT_SWEEP_LIMIT` permanently-dead rows (ids the provider will never
 * index) are always the oldest and fill every pass's candidate set, so a newer row that genuinely
 * could resolve is never even examined. `maxAgeMs` excludes the dead rows once they are old enough,
 * so the newer row is picked up in the very next pass.
 */
async function testSweepMaxAgePreventsStarvation(): Promise<void> {
  section('Resolver — dead rows past maxAgeMs do not starve a newer resolvable row (spec "An unresolved row SHALL NOT be terminal")');

  const store = new InMemoryUsageStore();
  const now = Date.UTC(2026, 0, 15, 12, 0, 0, 0);

  for (let i = 0; i < DEFAULT_SWEEP_LIMIT; i++) {
    const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: now - 25 * 60 * 60 * 1000 - i, deviceLimit: 1000 });
    if (!admitted.ok) throw new Error('setup: admit should succeed');
    await store.settle(admitted.requestId, { outcome: 'delivered', now: now - 25 * 60 * 60 * 1000 - i });
    await store.recordCost(admitted.requestId, { state: 'unresolved', generationIds: [`gen-dead-${i}`] });
  }
  const fresh = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: now - 60 * 60 * 1000, deviceLimit: 1000 });
  if (!fresh.ok) throw new Error('setup: admit should succeed');
  await store.settle(fresh.requestId, { outcome: 'delivered', now: now - 60 * 60 * 1000 });
  await store.recordCost(fresh.requestId, { state: 'unresolved', generationIds: ['gen-fresh'] });

  const transport: UsageAndCostTransport = {
    fetchStats(id: string): Promise<GenerationStats | null> {
      if (id === 'gen-fresh') return Promise.resolve({ usage: usage(1, 1), totalCostUsd: 0.01 });
      return Promise.resolve(null); // the dead ids: the provider will never index them
    },
  };

  const outcome = await runCostResolutionSweep({
    usageStore: store,
    transport,
    now: () => now,
    bounds: SWEEP_BOUNDS,
    maxAgeMs: DEFAULT_SWEEP_MAX_AGE_MS,
  });
  eq('only the fresh row was examined; the dead rows never crowded it out', outcome.examined, 1);
  eq('and it resolved in this single pass', outcome.resolved, 1);

  const stillUnresolved = await store.summary({ days: 2, now });
  eq(
    'every dead row is still unresolved (left as-is, not retried)',
    stillUnresolved.generationStats.unresolvedCount,
    DEFAULT_SWEEP_LIMIT,
  );
}

/**
 * One request's ids share a deadline, so they overlap — but a pipeline run records many model
 * calls, and one unbounded burst per finishing request is how a provider rate limit turns every id
 * into an unresolved one. The fan-out is capped, and the cap still lets every id be attempted.
 */
async function testFanOutIsBounded(): Promise<void> {
  section('Resolver — per-request id resolution is capped at MAX_CONCURRENT_ID_RESOLUTIONS');

  const ids = Array.from({ length: 10 }, (_, i) => `gen-${i}`);
  const attempted = new Set<string>();
  let inFlight = 0;
  let peak = 0;
  const transport: UsageAndCostTransport = {
    async fetchStats(id: string): Promise<GenerationStats | null> {
      attempted.add(id);
      inFlight++;
      peak = Math.max(peak, inFlight);
      // A real transport is a network call: it yields, so the pool refills from the queue.
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { usage: usage(1, 1), totalCostUsd: 0.001 };
    },
  };

  const store = new InMemoryUsageStore();
  const now = Date.UTC(2026, 0, 15, 12, 0, 0, 0);
  const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now, deviceLimit: 15 });
  if (!admitted.ok) throw new Error('setup: admit should succeed');
  await resolveRequestUsage(admitted.requestId, DEVICE_A, ids, true, {
    transport,
    usageStore: store,
    bounds: { maxAttempts: 1, totalBudgetMs: 4000, retryDelayMs: 0, perAttemptTimeoutMs: 2000 },
  });

  check(`at most ${MAX_CONCURRENT_ID_RESOLUTIONS} transport calls were ever in flight`, peak <= MAX_CONCURRENT_ID_RESOLUTIONS, `peak ${peak}`);
  check('the cap was actually reached (the ids really did overlap)', peak === MAX_CONCURRENT_ID_RESOLUTIONS, `peak ${peak}`);
  eq('every id was still attempted within the shared budget', attempted.size, ids.length);
  const summary = await store.summary({ days: 1, now });
  eq('so the whole request resolved', summary.generationStats.unresolvedCount, 0);
  check('with the sum of every id', closeEnough(summary.days[0]!.costUsdByKind.generate ?? 0, 0.01), JSON.stringify(summary.days[0]));
}

export async function runResolverTests(): Promise<void> {
  await testSummedCostCreditOwned();
  await testCancelledRunCostAndSingleCredit();
  await testUnresolvableCostIsExplicit();
  await testPartialResolutionIsNotStampedResolved();
  await testHangingAttemptCutOffByTimeout();
  await testResolveTracker();
  await testEmptyGenerationIds();
  await testSweepResolvesWhatTheRequestCouldNot();
  await testSweepStandsDownWhileDraining();
  await testSweepMaxAgePreventsStarvation();
  await testFanOutIsBounded();
}
