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
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { check, eq, section } from './harness';
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
    await store.admit({ deviceId, kind: 'generate', now, deviceLimit });
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
    const refusal = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 15 });
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
    const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'clarify', now: LAST_INSTANT_OF_DAY, deviceLimit: 1 });
    check('admitted just before midnight', admitted.ok === true);
    const refused = await store.admit({ deviceId: DEVICE_A, kind: 'clarify', now: LAST_INSTANT_OF_DAY, deviceLimit: 1 });
    check('a second request the same instant refuses', refused.ok === false);
    const nextDay = await store.admit({ deviceId: DEVICE_A, kind: 'clarify', now: FIRST_INSTANT_NEXT_DAY, deviceLimit: 1 });
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
    await store.admit({ deviceId: DEVICE_A, kind: 'generate', now, deviceLimit: 15, globalLimit: 2 });
    await store.admit({ deviceId: DEVICE_B, kind: 'generate', now, deviceLimit: 15, globalLimit: 2 });
    const refusal = await store.admit({ deviceId: DEVICE_C, kind: 'generate', now, deviceLimit: 15, globalLimit: 2 });
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
    await store.admit({ deviceId: DEVICE_A, kind: 'report', now, deviceLimit: 1, globalLimit: 1 });
    const refusal = await store.admit({ deviceId: DEVICE_A, kind: 'report', now, deviceLimit: 1, globalLimit: 1 });
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
      store.admit({ deviceId: DEVICE_A, kind: 'generate', now, deviceLimit: 1 }),
      store.admit({ deviceId: DEVICE_A, kind: 'generate', now, deviceLimit: 1 }),
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
      store.admit({ deviceId: DEVICE_A, kind: 'generate', now, deviceLimit: 15, globalLimit: 1 }),
      store.admit({ deviceId: DEVICE_B, kind: 'generate', now, deviceLimit: 15, globalLimit: 1 }),
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
      store.admit({ deviceId: DEVICE_A, kind: 'rewrite', now, deviceLimit: 1 }),
      store.admit({ deviceId: DEVICE_A, kind: 'rewrite', now, deviceLimit: 1 }),
    ]);
    eq('InMemoryUsageStore: exactly one concurrent admit succeeds', [r1, r2].filter((r) => r.ok).length, 1);
  }
}

async function testDurabilityAcrossReopen(): Promise<void> {
  section('Usage ledger — durability across reopen');

  const dbPath = tmpDbPath('durability');
  try {
    const store1 = new NodeSqliteUsageStore(dbPath);
    const admitted = await store1.admit({ deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 1 });
    check('first instance admits the one allowed unit', admitted.ok === true);
    store1.close();

    const store2 = new NodeSqliteUsageStore(dbPath);
    const refused = await store2.admit({ deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 1 });
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
  const first = await store.admit({ deviceId: DEVICE_A, kind: 'clarify', now, deviceLimit: 1 });
  check('first admit succeeds', first.ok === true);
  if (first.ok) {
    await store.refund(first.requestId);
    await store.refund(first.requestId); // idempotent: a repeated refund is a no-op
    const second = await store.admit({ deviceId: DEVICE_A, kind: 'clarify', now, deviceLimit: 1 });
    check('after refund, the unit is available again', second.ok === true);
  }
  // Refunding an unknown id never throws.
  await store.refund('does-not-exist');
  store.close();
}

async function testSettleAndRecordCostIdempotent(): Promise<void> {
  section('Usage ledger — settle and recordCost are idempotent (apply exactly once per request id)');

  const dbPath = tmpDbPath('idempotent');
  try {
    const store = new NodeSqliteUsageStore(dbPath);
    const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 15 });
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
  const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: LAST_INSTANT_OF_DAY, deviceLimit: 1 });
  check('admitted just before midnight', admitted.ok === true);
  if (admitted.ok) {
    // Settle runs AFTER the rollover — the row must still belong to the admission day, so the
    // NEXT day's admission for the same device is unaffected by this request's settlement.
    await store.settle(admitted.requestId, { outcome: 'delivered', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
    const nextDay = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: FIRST_INSTANT_NEXT_DAY, deviceLimit: 1 });
    check('the next UTC day still has its own fresh unit', nextDay.ok === true);
  }
  store.close();
}

async function testNoContent(): Promise<void> {
  section('Usage ledger — the ledger holds no content (spec "The ledger holds no content")');

  // Structural guard: the requests table has EXACTLY the documented columns (design D7) — no
  // prompt/source/bundle/manifest/schema column exists for any future write path to target.
  {
    const dbPath = tmpDbPath('schema');
    try {
      const store = new NodeSqliteUsageStore(dbPath);
      await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 15 });
      store.close();

      const raw = new DatabaseSync(dbPath);
      const columns = (raw.prepare('PRAGMA table_info(requests)').all() as { name: string }[]).map((c) => c.name);
      raw.close();

      eq('requests table schema: exact columns', columns.sort((a, b) => a.localeCompare(b)), [
        'completion_tokens',
        'cost_state',
        'cost_usd',
        'device_id',
        'ended_at',
        'id',
        'kind',
        'outcome',
        'prompt_tokens',
        'refunded',
        'started_at',
        'utc_day',
      ].sort((a, b) => a.localeCompare(b)));
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  }

  // Marker scan: a distinctive string that is NEVER passed to admit/settle/recordCost/credit does
  // not appear anywhere in the ledger database file — the closed column set above means the only
  // way content could leak in is a caller mistakenly passing it as deviceId, which this store
  // treats as an opaque id (no other table derives text from it).
  {
    const dbPath = tmpDbPath('marker');
    const neverPassedMarker = 'PROMPT_CONTENT_THAT_MUST_NEVER_APPEAR_IN_THE_LEDGER';
    try {
      const store = new NodeSqliteUsageStore(dbPath);
      const admitted = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: AT_22_00_UTC, deviceLimit: 15 });
      check('admit succeeds', admitted.ok === true);
      if (admitted.ok) {
        await store.settle(admitted.requestId, { outcome: 'delivered', usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 } });
        await store.recordCost(admitted.requestId, { state: 'resolved', costUsd: 0.01 });
      }
      store.close();

      const bytes = fs.readFileSync(dbPath);
      check('a never-passed marker never appears in the ledger file bytes', !bytes.includes(neverPassedMarker));
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  }
}

async function testRetentionPurge(): Promise<void> {
  section('Usage ledger — retention purge');

  const store = new NodeSqliteUsageStore(':memory:');
  const oldDay = Date.UTC(2025, 0, 1, 12, 0, 0, 0);
  const recentDay = Date.UTC(2026, 0, 15, 12, 0, 0, 0);
  await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: oldDay, deviceLimit: 15 });
  await store.admit({ deviceId: DEVICE_B, kind: 'generate', now: recentDay, deviceLimit: 15 });

  const deleted = await store.purgeLedger('2025-06-01');
  eq('purgeLedger deletes only rows strictly before the cutoff', deleted, 1);

  // The purged day's allowance is now fully available again (its row is gone), while the
  // recent row still counts toward the recent day.
  const reAdmitOld = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: oldDay, deviceLimit: 1 });
  check('the purged day has no surviving rows', reAdmitOld.ok === true);
  const stillBlockedRecent = await store.admit({ deviceId: DEVICE_B, kind: 'generate', now: recentDay, deviceLimit: 1 });
  check('the recent day still has its row', stillBlockedRecent.ok === false);
  store.close();
}

async function testSummary(): Promise<void> {
  section('Usage ledger — summary (operator readback contract)');

  const store = new NodeSqliteUsageStore(':memory:');
  const day1 = Date.UTC(2026, 0, 14, 10, 0, 0, 0);
  const day2 = Date.UTC(2026, 0, 15, 10, 0, 0, 0);

  const genA = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: day1, deviceLimit: 15 });
  const genB = await store.admit({ deviceId: DEVICE_B, kind: 'generate', now: day2, deviceLimit: 15 });
  const genC = await store.admit({ deviceId: DEVICE_A, kind: 'generate', now: day2, deviceLimit: 15 });
  const clarifyA = await store.admit({ deviceId: DEVICE_A, kind: 'clarify', now: day2, deviceLimit: 60 });

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

export async function runLedgerTests(): Promise<void> {
  await testDailyLimitAndRetryAfter();
  await testGlobalCeilings();
  await testAtomicLastUnit();
  await testDurabilityAcrossReopen();
  await testRefund();
  await testSettleAndRecordCostIdempotent();
  await testSettlesAgainstAdmissionDay();
  await testNoContent();
  await testRetentionPurge();
  await testSummary();
}
