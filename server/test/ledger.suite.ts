/**
 * Usage ledger acceptance (public-generation-server chain-2). Scaffolded here by chain-1
 * (task 2.5, pre-registered in acceptance.ts); chain-2 fills it in — this module is
 * chain-2's alone to edit.
 *
 * Covers specs/server-admission-control "Per-device daily limits reset at UTC midnight",
 * "Global daily ceilings bound total spend" and "The usage store keeps a content-free request
 * ledger with resolved cost" at the `UsageStore` layer (design D7). Route-level ordering and the
 * full-app content-free data-directory scan belong to chain-9/10's suites.
 */
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { caught, check, eq, section } from './harness';
import { InMemoryUsageStore, NodeSqliteUsageStore, type AdmitResult, type UsageStore } from '../src/usage-store';

const DEVICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEVICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEVICE_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** 22:00:00.000 UTC on an arbitrary fixed day. */
const AT_22_00_UTC = Date.UTC(2026, 0, 15, 22, 0, 0, 0);
/** The last instant of that same UTC day. */
const LAST_INSTANT_OF_DAY = Date.UTC(2026, 0, 15, 23, 59, 59, 999);
/** The first instant of the next UTC day. */
const FIRST_INSTANT_NEXT_DAY = Date.UTC(2026, 0, 16, 0, 0, 0, 0);

function tmpDbPath(label: string): string {
  return path.join(os.tmpdir(), `whim-ledger-test-${label}-${process.pid}-${Date.now()}.db`);
}

async function admitNTimes(
  store: UsageStore,
  deviceId: string,
  n: number,
  now: number,
  deviceLimit: number,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    await store.admit({ requestId: randomUUID(), deviceId, kind: 'generate', now, deviceLimit });
  }
}

function closeEnough(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

async function testDailyLimitAndRetryAfter(): Promise<void> {
  section('Usage ledger — daily limits and Retry-After (spec "Per-device daily limits reset at UTC midnight")');

  // Retry-After at 22:00:00 UTC with a 15/day limit already exhausted → exactly 7200
  {
    const store = new NodeSqliteUsageStore(':memory:');
    await admitNTimes(store, DEVICE_A, 15, AT_22_00_UTC, 15);
    const refusal = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 15 });
    check('16th admit at 22:00 UTC refuses', refusal.ok === false);
    if (!refusal.ok) {
      eq('refusal reason', refusal.reason, 'device');
      eq('Retry-After at 22:00:00 UTC == 7200', refusal.retryAfterSec, 7200);
    }
    store.close();
  }

  // The day rolls over: a device exhausted at 23:59:59.999 is admitted again at 00:00:00.000
  {
    const store = new NodeSqliteUsageStore(':memory:');
    const admitted = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'clarify', now: LAST_INSTANT_OF_DAY, deviceLimit: 1 });
    check('admitted just before midnight', admitted.ok === true);
    const refused = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'clarify', now: LAST_INSTANT_OF_DAY, deviceLimit: 1 });
    check('a second request the same instant refuses', refused.ok === false);
    const nextDay = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'clarify', now: FIRST_INSTANT_NEXT_DAY, deviceLimit: 1 });
    check('the very next millisecond, on the new UTC day, is admitted', nextDay.ok === true);
    store.close();
  }
}

async function testGlobalCeilings(): Promise<void> {
  section('Usage ledger — global daily ceilings (spec "Global daily ceilings bound total spend")');

  // Global ceiling closes the day for everyone, even a device with unused allowance
  {
    const store = new NodeSqliteUsageStore(':memory:');
    const now = AT_22_00_UTC;
    await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now, deviceLimit: 15, globalLimit: 2 });
    await store.admit({ requestId: randomUUID(), deviceId: DEVICE_B, kind: 'generate', now, deviceLimit: 15, globalLimit: 2 });
    const refusal = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_C, kind: 'generate', now, deviceLimit: 15, globalLimit: 2 });
    check('third device refused once the global ceiling is reached', refusal.ok === false);
    if (!refusal.ok) {
      eq('global refusal reason', refusal.reason, 'global');
      eq('global refusal Retry-After matches the device-limit formula', refusal.retryAfterSec, 7200);
    }
    store.close();
  }

  // Device-over-global precedence: when both are exhausted, 'device' wins
  {
    const store = new NodeSqliteUsageStore(':memory:');
    const now = AT_22_00_UTC;
    await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'report', now, deviceLimit: 1, globalLimit: 1 });
    const refusal = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'report', now, deviceLimit: 1, globalLimit: 1 });
    check('both limits exhausted at once', refusal.ok === false);
    if (!refusal.ok) eq('device limit wins over the global ceiling', refusal.reason, 'device');
    store.close();
  }
}

async function testAtomicLastUnit(): Promise<void> {
  section('Usage ledger — the atomic last unit cannot be taken twice (concurrent admits)');

  // The device's last unit: two admits racing for deviceLimit=1, run without ever awaiting the
  // first before starting the second (Promise.all over two synchronous-bodied calls) — a
  // deterministic interleaving proof, not a timing loop.
  {
    const store = new NodeSqliteUsageStore(':memory:');
    const now = AT_22_00_UTC;
    const [r1, r2]: AdmitResult[] = await Promise.all([
      store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now, deviceLimit: 1 }),
      store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now, deviceLimit: 1 }),
    ]);
    const oks = [r1, r2].filter((r) => r.ok);
    const refusals = [r1, r2].filter((r) => !r.ok);
    eq('exactly one concurrent admit for the last device unit succeeds', oks.length, 1);
    eq('exactly one is refused', refusals.length, 1);
    const refusal = refusals[0];
    check('the refusal names the device reason', refusal !== undefined && !refusal.ok && refusal.reason === 'device');
    store.close();
  }

  // The global last unit: two DIFFERENT devices racing for globalLimit=1
  {
    const store = new NodeSqliteUsageStore(':memory:');
    const now = AT_22_00_UTC;
    const [r1, r2]: AdmitResult[] = await Promise.all([
      store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now, deviceLimit: 15, globalLimit: 1 }),
      store.admit({ requestId: randomUUID(), deviceId: DEVICE_B, kind: 'generate', now, deviceLimit: 15, globalLimit: 1 }),
    ]);
    const oks = [r1, r2].filter((r) => r.ok);
    eq('exactly one concurrent admit for the last global unit succeeds', oks.length, 1);
    store.close();
  }

  // The same proof against InMemoryUsageStore, since it mirrors the contract for tests.
  {
    const store = new InMemoryUsageStore();
    const now = AT_22_00_UTC;
    const [r1, r2]: AdmitResult[] = await Promise.all([
      store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'rewrite', now, deviceLimit: 1 }),
      store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'rewrite', now, deviceLimit: 1 }),
    ]);
    eq('InMemoryUsageStore: exactly one concurrent admit succeeds', [r1, r2].filter((r) => r.ok).length, 1);
  }
}

async function testDurabilityAcrossReopen(): Promise<void> {
  section('Usage ledger — durability across reopen');

  const dbPath = tmpDbPath('durability');
  try {
    const store1 = new NodeSqliteUsageStore(dbPath);
    const admitted = await store1.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 1 });
    check('first instance admits the one allowed unit', admitted.ok === true);
    store1.close();

    const store2 = new NodeSqliteUsageStore(dbPath);
    const refused = await store2.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 1 });
    check('reopened instance still refuses — the count survived a restart', refused.ok === false);
    store2.close();
  } finally {
    fs.rmSync(dbPath, { force: true });
  }
}

async function testRefund(): Promise<void> {
  section('Usage ledger — refund (spec "An unavailable policy check refunds the unit")');

  // A refunded unit does not count toward the daily limit, and is idempotent.
  const store = new NodeSqliteUsageStore(':memory:');
  const now = AT_22_00_UTC;
  const first = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'clarify', now, deviceLimit: 1 });
  check('first admit succeeds', first.ok === true);
  if (first.ok) {
    await store.refund(first.requestId);
    await store.refund(first.requestId); // idempotent: a repeated refund is a no-op
    const second = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'clarify', now, deviceLimit: 1 });
    check('after refund, the unit is available again', second.ok === true);
  }
  // Refunding an unknown id never throws.
  await store.refund('does-not-exist');
  store.close();
}

/** Request-envelope D6: the store never mints an id — the row is keyed by the one the request
 *  carries, observed through the store's own id-addressed API rather than a returned value. */
async function testRowKeyedByCallerId(): Promise<void> {
  section("Usage ledger — admit keys the row by the caller's request id (request-envelope D6)");

  const stores: Array<[string, UsageStore]> = [
    ['in-memory', new InMemoryUsageStore()],
    ['sqlite', new NodeSqliteUsageStore(':memory:')],
  ];
  for (const [label, store] of stores) {
    const requestId = randomUUID();
    const admitted = await store.admit({ requestId, deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 1 });
    eq(`${label}: admit answers with the caller's id`, admitted.ok ? admitted.requestId : undefined, requestId);
    await store.refund(requestId);
    const next = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 1 });
    check(`${label}: refunding by the caller's id frees the only unit, so the row carries that id`, next.ok);
  }
}

async function testDuplicateIdRejected(): Promise<void> {
  section('Usage ledger — admit rejects a request id already in the ledger, in both stores');

  const refusals: Array<[string, unknown]> = [];
  for (const [label, store] of [['in-memory', new InMemoryUsageStore()], ['sqlite', new NodeSqliteUsageStore(':memory:')]] as Array<[string, UsageStore]>) {
    const requestId = randomUUID();
    await store.admit({ requestId, deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 1 });
    const duplicate = await caught(() => store.admit({ requestId, deviceId: DEVICE_B, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 5 }).then(() => undefined));
    check(`${label}: a second admit with the same request id rejects`, duplicate instanceof Error, String(duplicate));
    refusals.push([label, duplicate instanceof Error ? duplicate.message : duplicate]);
    const nextForA = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 1 });
    eq(`${label}: the first row still counts against its own device`, nextForA.ok ? 'admitted' : nextForA.reason, 'device');
  }
  eq('both stores reject with the same message', refusals[0]?.[1], refusals[1]?.[1]);
}

async function testSettleAndRecordCostIdempotent(): Promise<void> {
  section('Usage ledger — settle and recordCost are idempotent (apply exactly once per request id)');

  const dbPath = tmpDbPath('idempotent');
  try {
    const store = new NodeSqliteUsageStore(dbPath);
    const admitted = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 15 });
    check('admit succeeds', admitted.ok === true);
    if (!admitted.ok) {
      store.close();
      return;
    }
    const { requestId } = admitted;
    await store.settle(requestId, { outcome: 'delivered', usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } });
    // A second settle with a DIFFERENT outcome/usage must be a no-op — the row keeps its first outcome.
    await store.settle(requestId, { outcome: 'failed', usage: { promptTokens: 999, completionTokens: 999, totalTokens: 1998 } });

    await store.recordCost(requestId, { state: 'resolved', costUsd: 0.05 });
    // A second recordCost with a different cost must also be a no-op.
    await store.recordCost(requestId, { state: 'resolved', costUsd: 99 });
    store.close();

    const raw = new DatabaseSync(dbPath);
    const row = raw.prepare(
      'SELECT outcome, prompt_tokens, completion_tokens, cost_usd, cost_state FROM requests WHERE id = ?'
    ).get(requestId) as { outcome: string; prompt_tokens: number; completion_tokens: number; cost_usd: number; cost_state: string };
    raw.close();

    eq('settle applied exactly once: outcome is the FIRST value', row.outcome, 'delivered');
    eq('settle applied exactly once: prompt_tokens is the FIRST value', row.prompt_tokens, 10);
    eq('settle applied exactly once: completion_tokens is the FIRST value', row.completion_tokens, 20);
    eq('recordCost applied exactly once: cost_usd is the FIRST value', row.cost_usd, 0.05);
    eq('recordCost applied exactly once: cost_state stays resolved', row.cost_state, 'resolved');
  } finally {
    fs.rmSync(dbPath, { force: true });
  }
}

async function testSettlesAgainstAdmissionDay(): Promise<void> {
  section('Usage ledger — a request admitted before midnight settles against its admission day');

  const store = new NodeSqliteUsageStore(':memory:');
  const admitted = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: LAST_INSTANT_OF_DAY, deviceLimit: 1 });
  check('admitted just before midnight', admitted.ok === true);
  if (admitted.ok) {
    // Settle runs AFTER the rollover — the row must still belong to the admission day, so the
    // NEXT day's admission for the same device is unaffected by this request's settlement.
    await store.settle(admitted.requestId, { outcome: 'delivered', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
    const nextDay = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: FIRST_INSTANT_NEXT_DAY, deviceLimit: 1 });
    check('the next UTC day still has its own fresh unit', nextDay.ok === true);
  }
  store.close();
}

async function testRetentionPurge(): Promise<void> {
  section('Usage ledger — retention purge');

  const store = new NodeSqliteUsageStore(':memory:');
  const oldDay = Date.UTC(2025, 0, 1, 12, 0, 0, 0);
  const recentDay = Date.UTC(2026, 0, 15, 12, 0, 0, 0);
  await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: oldDay, deviceLimit: 15 });
  await store.admit({ requestId: randomUUID(), deviceId: DEVICE_B, kind: 'generate', now: recentDay, deviceLimit: 15 });

  const deleted = await store.purgeLedger('2025-06-01');
  eq('purgeLedger deletes only rows strictly before the cutoff', deleted, 1);

  // The purged day's allowance is now fully available again (its row is gone), while the
  // recent row still counts toward the recent day.
  const reAdmitOld = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: oldDay, deviceLimit: 1 });
  check('the purged day has no surviving rows', reAdmitOld.ok === true);
  const stillBlockedRecent = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_B, kind: 'generate', now: recentDay, deviceLimit: 1 });
  check('the recent day still has its row', stillBlockedRecent.ok === false);
  store.close();
}

async function testSummary(): Promise<void> {
  section('Usage ledger — summary (operator readback contract)');

  const store = new NodeSqliteUsageStore(':memory:');
  const day1 = Date.UTC(2026, 0, 14, 10, 0, 0, 0);
  const day2 = Date.UTC(2026, 0, 15, 10, 0, 0, 0);

  const genA = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: day1, deviceLimit: 15 });
  const genB = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_B, kind: 'generate', now: day2, deviceLimit: 15 });
  const genC = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: day2, deviceLimit: 15 });
  const clarifyA = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'clarify', now: day2, deviceLimit: 60 });

  if (genA.ok) await store.settle(genA.requestId, { outcome: 'delivered' });
  if (genB.ok) await store.settle(genB.requestId, { outcome: 'delivered' });
  if (genC.ok) await store.settle(genC.requestId, { outcome: 'unavailable' });
  if (clarifyA.ok) await store.settle(clarifyA.requestId, { outcome: 'delivered' });

  if (genA.ok) await store.recordCost(genA.requestId, { state: 'resolved', costUsd: 0.10 });
  if (genB.ok) await store.recordCost(genB.requestId, { state: 'resolved', costUsd: 0.30 });
  if (genC.ok) await store.recordCost(genC.requestId, { state: 'unresolved' });
  if (clarifyA.ok) await store.recordCost(clarifyA.requestId, { state: 'resolved', costUsd: 0.01 });

  const summary = await store.summary({ days: 2, top: 5, now: day2 });

  eq('summary covers exactly the requested trailing days', summary.days.map((d) => d.utcDay), ['2026-01-14', '2026-01-15']);
  eq('day1 generate count', summary.days[0]!.countByKind.generate, 1);
  eq('day2 generate count', summary.days[1]!.countByKind.generate, 2);
  eq('day2 clarify count', summary.days[1]!.countByKind.clarify, 1);
  eq('day1 generate cost', summary.days[0]!.costUsdByKind.generate, 0.10);
  eq('day2 generate cost sums only resolved rows', summary.days[1]!.costUsdByKind.generate, 0.30);

  eq('top devices by cost, descending', summary.topDevicesByCost.map((d) => d.deviceId), [DEVICE_B, DEVICE_A]);

  eq('generation stats count includes the unresolved row', summary.generationStats.count, 3);
  eq('generation stats unresolved count', summary.generationStats.unresolvedCount, 1);
  check('generation stats max is the largest resolved cost', closeEnough(summary.generationStats.maxCostUsd, 0.30));
  store.close();
}

/** Reads one ledger row's cost columns straight out of SQLite, so an assertion is about the stored
 *  row rather than about what the store chose to hand back. */
function readCostRow(dbPath: string, requestId: string): { cost_state: string; cost_usd: number | null; generation_ids: string | null } {
  const raw = new DatabaseSync(dbPath);
  const row = raw.prepare('SELECT cost_state, cost_usd, generation_ids FROM requests WHERE id = ?').get(requestId) as {
    cost_state: string;
    cost_usd: number | null;
    generation_ids: string | null;
  };
  raw.close();
  return row;
}

/**
 * The provider's stats endpoint often answers minutes after the in-request attempts gave up, so an
 * `'unresolved'` cost is a "not yet", not a verdict: `recordCost` upgrades it to `'resolved'`. A
 * `'resolved'` cost stays final, and no repeat can undo it.
 */
async function testUnresolvedCostIsUpgradable(): Promise<void> {
  section('Usage ledger — an unresolved cost can still be resolved later (never terminal)');

  const dbPath = tmpDbPath('upgrade');
  try {
    const sqlite = new NodeSqliteUsageStore(dbPath);
    for (const store of [new InMemoryUsageStore(), sqlite] as UsageStore[]) {
      const label = store === sqlite ? 'sqlite' : 'in-memory';
      const late = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 15 });
      const final = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_B, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 15 });
      if (!late.ok || !final.ok) {
        check(`${label}: admit succeeds`, false);
        continue;
      }

      await store.recordCost(late.requestId, { state: 'unresolved', generationIds: ['gen-1'] });
      await store.recordCost(late.requestId, { state: 'resolved', costUsd: 0.42 });

      await store.recordCost(final.requestId, { state: 'resolved', costUsd: 0.07 });
      // A late 'unresolved' can never undo a real cost, and a repeat resolve keeps the first value.
      await store.recordCost(final.requestId, { state: 'unresolved', generationIds: ['gen-2'] });
      await store.recordCost(final.requestId, { state: 'resolved', costUsd: 99 });

      const summary = await store.summary({ days: 1, now: AT_22_00_UTC });
      eq(`${label}: the upgraded row is no longer counted as unresolved`, summary.generationStats.unresolvedCount, 0);
      check(
        `${label}: the upgraded row carries the late cost, the final one is untouched`,
        closeEnough(summary.days[0]!.costUsdByKind.generate ?? 0, 0.42 + 0.07),
        JSON.stringify(summary.days[0]!.costUsdByKind),
      );
      if (label === 'sqlite') {
        const upgraded = readCostRow(dbPath, late.requestId);
        eq('sqlite: the upgraded row stores the resolved state', upgraded.cost_state, 'resolved');
        check('sqlite: a resolved row keeps no generation ids', upgraded.generation_ids === null);
        eq('sqlite: a resolved cost is never overwritten', readCostRow(dbPath, final.requestId).cost_usd, 0.07);
      }
    }
    sqlite.close();
  } finally {
    fs.rmSync(dbPath, { force: true });
  }
}

/**
 * What the sweep is allowed to pick up: rows that still carry generation ids — `'unresolved'` ones,
 * and `'pending'` ones whose request ENDED long enough ago that no resolver is coming. A generation
 * still in flight (no `ended_at`) is never a candidate, however long it has been running, and a row
 * with no ids can never be re-resolved so it is never offered.
 */
async function testSweepCandidates(): Promise<void> {
  section('Usage ledger — the cost sweep sees only re-resolvable rows, oldest first');

  const sqlite = new NodeSqliteUsageStore(':memory:');
  for (const store of [new InMemoryUsageStore(), sqlite] as UsageStore[]) {
    const label = store === sqlite ? 'sqlite' : 'in-memory';
    const minute = 60_000;
    const admitAt = async (deviceId: string, now: number): Promise<string> => {
      const result = await store.admit({ requestId: randomUUID(), deviceId, kind: 'generate', now, deviceLimit: 15 });
      return result.ok ? result.requestId : '';
    };

    const oldest = await admitAt(DEVICE_A, AT_22_00_UTC);
    const newer = await admitAt(DEVICE_B, AT_22_00_UTC + minute);
    const stalePending = await admitAt(DEVICE_C, AT_22_00_UTC + 2 * minute);
    const runningNow = await admitAt(DEVICE_A, AT_22_00_UTC + 3 * minute);
    const noIds = await admitAt(DEVICE_B, AT_22_00_UTC + 4 * minute);

    // Ended before its cost was marked unresolved — matches production order (resolveRequestUsage
    // always runs after settle) and gives the row an `ended_at` to measure `maxAgeMs` from.
    await store.settle(oldest, { outcome: 'delivered', now: AT_22_00_UTC });
    await store.recordCost(oldest, { state: 'unresolved', generationIds: ['gen-oldest'] });
    await store.settle(newer, { outcome: 'delivered', now: AT_22_00_UTC + minute });
    await store.recordCost(newer, { state: 'unresolved', generationIds: ['gen-newer'] });
    // Registered its ids and ended, then died before recording a verdict.
    await store.recordCost(stalePending, { state: 'pending', generationIds: ['gen-stale'] });
    await store.settle(stalePending, { outcome: 'delivered', now: AT_22_00_UTC + 3 * minute });
    // Same, but the request is still open — its resolver has not run yet, and must not be raced.
    await store.recordCost(runningNow, { state: 'pending', generationIds: ['gen-running'] });
    await store.settle(noIds, { outcome: 'ok', now: AT_22_00_UTC });

    const now = AT_22_00_UTC + 10 * minute;
    const day = 24 * 60 * 60 * 1000;
    const candidates = await store.listUnresolvedCostRows({ now, stalePendingAfterMs: 2 * minute, maxAgeMs: day, limit: 50 });
    eq(
      `${label}: unresolved rows and abandoned pending ones, oldest first`,
      candidates.map((c) => c.requestId),
      [oldest, newer, stalePending],
    );
    eq(`${label}: a candidate carries its ids`, candidates[0], {
      requestId: oldest,
      generationIds: ['gen-oldest'],
    });
    eq(
      `${label}: the limit takes the oldest rows`,
      (await store.listUnresolvedCostRows({ now, stalePendingAfterMs: 2 * minute, maxAgeMs: day, limit: 1 })).map((c) => c.requestId),
      [oldest],
    );

    await store.recordCost(oldest, { state: 'resolved', costUsd: 0.5 });
    eq(
      `${label}: a resolved row stops being a candidate`,
      (await store.listUnresolvedCostRows({ now, stalePendingAfterMs: 2 * minute, maxAgeMs: day, limit: 50 })).map((c) => c.requestId),
      [newer, stalePending],
    );
  }
  sqlite.close();
}

/**
 * Without a give-up rule, a row whose provider generation id the provider will never index stays
 * the oldest forever and is selected by every pass ahead of newer, genuinely resolvable rows.
 * `maxAgeMs` excludes it once its request ended long enough ago, so it stops consuming candidate
 * slots — left as `'unresolved'`, never retried again.
 */
async function testSweepMaxAge(): Promise<void> {
  section('Usage ledger — a row past maxAgeMs stops being a sweep candidate (spec "An unresolved row SHALL NOT be terminal")');

  const hour = 60 * 60 * 1000;
  const sqlite = new NodeSqliteUsageStore(':memory:');
  for (const store of [new InMemoryUsageStore(), sqlite] as UsageStore[]) {
    const label = store === sqlite ? 'sqlite' : 'in-memory';
    const now = AT_22_00_UTC;

    const oldAdmit = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: now - 25 * hour, deviceLimit: 15 });
    const freshAdmit = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_B, kind: 'generate', now: now - 1 * hour, deviceLimit: 15 });
    if (!oldAdmit.ok || !freshAdmit.ok) throw new Error('setup: admit should succeed');

    await store.settle(oldAdmit.requestId, { outcome: 'delivered', now: now - 25 * hour });
    await store.recordCost(oldAdmit.requestId, { state: 'unresolved', generationIds: ['gen-dead'] });
    await store.settle(freshAdmit.requestId, { outcome: 'delivered', now: now - 1 * hour });
    await store.recordCost(freshAdmit.requestId, { state: 'unresolved', generationIds: ['gen-fresh'] });

    const candidates = await store.listUnresolvedCostRows({ now, stalePendingAfterMs: 2 * 60_000, maxAgeMs: 24 * hour, limit: 50 });
    eq(
      `${label}: a 25h-old unresolved row is not listed, a 1h-old one is`,
      candidates.map((c) => c.requestId),
      [freshAdmit.requestId],
    );
  }
  sqlite.close();
}

/**
 * A hand-planted `generation_ids = '[]'` row (never written by `recordCost`, which stores NULL
 * instead) must not consume a `LIMIT` slot ahead of a real candidate — the SQL predicate and the
 * JS-side length filter must agree.
 */
async function testSweepIgnoresPersistedEmptyIdsArray(): Promise<void> {
  section('Usage ledger — a persisted empty generation_ids array is never a sweep candidate');

  const dbPath = tmpDbPath('empty-ids');
  try {
    const store = new NodeSqliteUsageStore(dbPath);
    const now = AT_22_00_UTC;
    const admitted = await store.admit({ requestId: randomUUID(), deviceId: DEVICE_A, kind: 'generate', now: now - 60_000, deviceLimit: 15 });
    if (!admitted.ok) throw new Error('setup: admit should succeed');
    await store.settle(admitted.requestId, { outcome: 'delivered', now: now - 60_000 });

    const raw = new DatabaseSync(dbPath);
    raw.prepare(
      `UPDATE requests SET cost_state = 'unresolved', generation_ids = '[]' WHERE id = ?`,
    ).run(admitted.requestId);
    raw.close();

    const candidates = await store.listUnresolvedCostRows({ now, stalePendingAfterMs: 2 * 60_000, maxAgeMs: 24 * 60 * 60 * 1000, limit: 1 });
    eq('a planted empty-array row is never a candidate', candidates.length, 0);
    store.close();
  } finally {
    fs.rmSync(dbPath, { force: true });
  }
}

/**
 * The `generation_ids` column arrived after the ledger did, so opening a database written by the
 * previous version must migrate it in place rather than fail — and opening it twice must not try to
 * add the column again (`ALTER TABLE ADD COLUMN` has no `IF NOT EXISTS`).
 */
async function testGenerationIdsColumnMigration(): Promise<void> {
  section('Usage ledger — a pre-change database file gains generation_ids idempotently');

  const dbPath = tmpDbPath('migration');
  try {
    // The requests table exactly as it was before this change, with one row already in it.
    const seed = new DatabaseSync(dbPath);
    seed.exec(`
      CREATE TABLE requests (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        utc_day TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        outcome TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL,
        cost_state TEXT NOT NULL CHECK(cost_state IN ('pending','resolved','unresolved')),
        refunded INTEGER NOT NULL DEFAULT 0
      )
    `);
    seed.prepare(`
      INSERT INTO requests (id, device_id, kind, utc_day, started_at, ended_at, outcome, prompt_tokens, completion_tokens, cost_usd, cost_state, refunded)
      VALUES ('legacy-row', ?, 'generate', '2026-01-15', ?, ?, 'delivered', 1, 2, NULL, 'unresolved', 0)
    `).run(DEVICE_A, AT_22_00_UTC, AT_22_00_UTC);
    seed.close();

    const store = new NodeSqliteUsageStore(dbPath);
    const raw = new DatabaseSync(dbPath);
    const columns = (raw.prepare('PRAGMA table_info(requests)').all() as { name: string }[]).map((c) => c.name);
    raw.close();
    check('the legacy file gains generation_ids on open', columns.includes('generation_ids'), columns.join(', '));

    // The pre-change row survives, is not a sweep candidate (it has no ids to re-resolve), and its
    // cost can still be upgraded — the migration loses nothing.
    const candidates = await store.listUnresolvedCostRows({ now: AT_22_00_UTC + 600_000, stalePendingAfterMs: 120_000, maxAgeMs: 24 * 60 * 60 * 1000, limit: 50 });
    eq('a legacy row with no ids is not a sweep candidate', candidates.length, 0);
    await store.recordCost('legacy-row', { state: 'resolved', costUsd: 0.25 });
    eq('a legacy unresolved row can still be resolved', readCostRow(dbPath, 'legacy-row').cost_usd, 0.25);
    store.close();

    // Re-opening the migrated file must not attempt the ALTER a second time.
    const reopened = new NodeSqliteUsageStore(dbPath);
    const summary = await reopened.summary({ days: 1, now: AT_22_00_UTC });
    eq('re-opening a migrated file works and keeps the row', summary.generationStats.count, 1);
    reopened.close();
  } finally {
    fs.rmSync(dbPath, { force: true });
  }
}

/**
 * `globalKinds: []` means "the admitted kind", exactly as omitting it does. Read literally it would
 * render `kind IN ()` in SQLite — a syntax error — and in the in-memory store it would count across
 * nothing, so the ceiling would never bind. Neither is a state a caller can usefully ask for.
 */
async function testEmptyGlobalKinds(): Promise<void> {
  section('Usage ledger — an empty globalKinds counts the admitted kind');

  const sqlite = new NodeSqliteUsageStore(':memory:');
  for (const store of [new InMemoryUsageStore(), sqlite] as UsageStore[]) {
    const label = store === sqlite ? 'sqlite' : 'in-memory';
    const admit = (deviceId: string): Promise<AdmitResult> =>
      store.admit({ requestId: randomUUID(), deviceId, kind: 'clarify', now: AT_22_00_UTC, deviceLimit: 60, globalLimit: 2, globalKinds: [] });

    check(`${label}: first admit under the ceiling`, (await admit(DEVICE_A)).ok === true);
    check(`${label}: second admit under the ceiling`, (await admit(DEVICE_B)).ok === true);
    const third = await admit(DEVICE_C);
    check(`${label}: the ceiling still binds with an empty globalKinds`, third.ok === false);
    if (!third.ok) eq(`${label}: refused as a global ceiling`, third.reason, 'global');
  }
  sqlite.close();
}

export async function runLedgerTests(): Promise<void> {
  await testRowKeyedByCallerId();
  await testDuplicateIdRejected();
  await testDailyLimitAndRetryAfter();
  await testGlobalCeilings();
  await testAtomicLastUnit();
  await testDurabilityAcrossReopen();
  await testRefund();
  await testSettleAndRecordCostIdempotent();
  await testUnresolvedCostIsUpgradable();
  await testSweepCandidates();
  await testSweepMaxAge();
  await testSweepIgnoresPersistedEmptyIdsArray();
  await testGenerationIdsColumnMigration();
  await testEmptyGlobalKinds();
  await testSettlesAgainstAdmissionDay();
  await testRetentionPurge();
  await testSummary();
}
