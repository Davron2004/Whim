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
import type { Usage } from '@whim/contract';
import { check, eq, section } from './harness';
import { NodeSqliteUsageStore, InMemoryUsageStore, type UsageStore } from '../src/usage-store';
import {
  resolveRequestUsage,
  ResolveTracker,
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

async function testNoDoubleCounting(): Promise<void> {
  section('Resolver — no double counting: a normally-completed run\'s post-run lookup records cost without re-crediting');

  const store = new NodeSqliteUsageStore(':memory:');
  const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: Date.now(), deviceLimit: 15 });
  if (!admitted.ok) throw new Error('setup: admit should succeed');
  await store.settle(admitted.requestId, { outcome: 'delivered' });
  await store.credit(DEVICE_A, usage(40, 10)); // the normal `usage`-event credit

  const { store: counted, creditCalls } = countingCreditStore(store);
  const transport = scriptedTransport(new Map([
    ['gen-only', { usage: usage(40, 10), totalCostUsd: 0.02 }],
  ]));

  await resolveRequestUsage(admitted.requestId, DEVICE_A, ['gen-only'], true, { transport, usageStore: counted });

  eq('a completed run credited by the normal path is never credited again', creditCalls.length, 0);
  store.close();
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
  section('Resolver — no generation ids resolves as zero cost with no transport calls');

  const store = new NodeSqliteUsageStore(':memory:');
  const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'report', now: Date.now(), deviceLimit: 300 });
  if (!admitted.ok) throw new Error('setup: admit should succeed');
  await store.settle(admitted.requestId, { outcome: 'ok' });

  let calls = 0;
  const transport: UsageAndCostTransport = {
    fetchStats() {
      calls++;
      return Promise.resolve(null);
    },
  };
  await resolveRequestUsage(admitted.requestId, DEVICE_A, [], false, { transport, usageStore: store });
  eq('the transport is never called for an empty id list', calls, 0);
  const summary = await store.summary({ days: 1, now: Date.now() });
  eq('the row resolves to zero cost, not unresolved', summary.generationStats.unresolvedCount, 0);
  store.close();
}

export async function runResolverTests(): Promise<void> {
  await testSummedCostCreditOwned();
  await testCancelledRunCostAndSingleCredit();
  await testUnresolvableCostIsExplicit();
  await testHangingAttemptCutOffByTimeout();
  await testNoDoubleCounting();
  await testResolveTracker();
  await testEmptyGenerationIds();
}
