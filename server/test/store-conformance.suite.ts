/**
 * The server-store conformance suite (durable-server-stores D5; specs/server-storage-backends
 * "Every backend honours the same store contracts", "Admission is atomic on every backend",
 * "Retention purges run identically on every backend").
 *
 * `STORE_CONFORMANCE_CASES` is the contract every backend's `UsageStore`, `UsageRecordKeeping`,
 * `ReportStore`, `ReportRecordKeeping` and `WaitlistStore` must honour. `runStoreConformance` runs
 * them against one `StoreBackendFactory`: each case gets freshly opened, empty stores, runs under
 * a ref'd timeout, and is closed after. `npm run server:test` runs it against the in-memory and
 * SQLite backends; the Firestore entry (`server/test/firestore.run.mjs`) runs the same cases
 * against the emulator. Cases assert observable behaviour only, never a backend's mechanism.
 */
import nodeAssert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check, section } from './harness';
import { loadServerConfig } from '../src/config';
import { openStores, openFirestoreStores, type OpenedStores, type StoreConfig } from '../src/stores';
import { InMemoryUsageStore, type AdmitParams, type AdmitResult, type FailureReason, type LedgerRow } from '../src/usage-store';
import { InMemoryReportStore, type InsertReportParams } from '../src/reports/store';
import { InMemoryWaitlistStore, WAITLIST_RETENTION_DAYS, type WaitlistPlatform, type WaitlistSignup } from '../src/waitlist/store';

/** The clock a case drives. The usage store reads it (through the factory) for `credit`'s day. */
export interface ConformanceClock {
  now: number;
}

/** Opens one backend's stores for one case. */
export interface StoreBackendFactory {
  /** Prefixes every case name in the report, e.g. `sqlite`. */
  readonly label: string;
  /** Fresh stores holding no record any earlier `open` wrote. `now` is the usage store's injected
   *  clock (`UsageStoreOptions.now`). */
  open(now: () => number): Promise<OpenedStores>;
}

export interface StoreConformanceCase {
  readonly name: string;
  /** Rejects (an `AssertionError` or a store error) when the backend breaks the contract. */
  run(stores: OpenedStores, clock: ConformanceClock): Promise<void>;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** Noon UTC, so `retryAfterSec` on this day is exactly 12 hours. */
const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
const NEXT_MIDNIGHT = Date.UTC(2026, 9, 8);
const CASE_TIMEOUT_MS = 20_000;

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function admitParams(requestId: string, deviceId: string, extra: Partial<AdmitParams> = {}): AdmitParams {
  return { requestId, deviceId, kind: 'generate', now: T0, deviceLimit: 100, ...extra };
}

function admittedCount(results: readonly AdmitResult[]): number {
  return results.filter((result) => result.ok).length;
}

async function ledgerRow(stores: OpenedStores, deviceId: string, id: string): Promise<LedgerRow> {
  const row = (await stores.usage.deviceRecords(deviceId)).ledger.find((r) => r.id === id);
  nodeAssert.ok(row, `ledger row ${id} of ${deviceId} exists`);
  return row;
}

async function ledgerIds(stores: OpenedStores, deviceId: string): Promise<string[]> {
  return (await stores.usage.deviceRecords(deviceId)).ledger.map((row) => row.id);
}

function report(deviceId: string, now: number, extra: Partial<InsertReportParams> = {}): InsertReportParams {
  return { deviceId, reason: 'broken', now, ...extra };
}

function signup(email: string, platform: WaitlistPlatform, now: number, updatesOptOut = false): WaitlistSignup {
  return { email, platform, updatesOptOut, noticeId: 'notice-1', now };
}

const admissionLimits: StoreConformanceCase = {
  name: 'admission checks the device limit, then the global limit, per kind and UTC day',
  async run(stores) {
    const { usage } = stores;
    const limits = { deviceLimit: 2, globalLimit: 3 };
    const twelveHours = 12 * 3600;
    nodeAssert.deepStrictEqual(await usage.admit(admitParams('a1', 'dev-a', limits)), { ok: true, requestId: 'a1' });
    nodeAssert.deepStrictEqual(await usage.admit(admitParams('a2', 'dev-a', limits)), { ok: true, requestId: 'a2' });
    nodeAssert.deepStrictEqual(await usage.admit(admitParams('a3', 'dev-a', limits)), { ok: false, reason: 'device', retryAfterSec: twelveHours });
    nodeAssert.deepStrictEqual(await usage.admit(admitParams('b1', 'dev-b', limits)), { ok: true, requestId: 'b1' });
    nodeAssert.deepStrictEqual(await usage.admit(admitParams('b2', 'dev-b', limits)), { ok: false, reason: 'global', retryAfterSec: twelveHours });
    nodeAssert.deepStrictEqual(await usage.admit(admitParams('a4', 'dev-a', limits)), { ok: false, reason: 'device', retryAfterSec: twelveHours }, 'over both limits refuses as device');
    nodeAssert.deepStrictEqual(await ledgerIds(stores, 'dev-a'), ['a1', 'a2'], 'a refusal records nothing');

    const query = { deviceId: 'dev-c', kind: 'generate' as const, now: T0, deviceLimit: 2 };
    nodeAssert.deepStrictEqual(await usage.unitAvailable({ ...query, globalLimit: 3 }), { ok: false, reason: 'global', retryAfterSec: twelveHours });
    nodeAssert.deepStrictEqual(await usage.unitAvailable({ ...query, globalLimit: 4 }), { ok: true });
    nodeAssert.deepStrictEqual(await usage.unitAvailable({ ...query, deviceId: 'dev-a', globalLimit: 4 }), { ok: false, reason: 'device', retryAfterSec: twelveHours });
    // unitAvailable wrote nothing: a global limit of 4 still has exactly one unit.
    nodeAssert.deepStrictEqual(await usage.admit(admitParams('c1', 'dev-c', { ...limits, globalLimit: 4 })), { ok: true, requestId: 'c1' });
    nodeAssert.strictEqual((await usage.admit(admitParams('c2', 'dev-c', { ...limits, globalLimit: 4 }))).ok, false);

    // Each kind counts on its own; clarify and rewrite share one global ceiling through globalKinds.
    const unary = { deviceLimit: 5, globalLimit: 2, globalKinds: ['clarify', 'rewrite'] as const };
    nodeAssert.strictEqual((await usage.admit(admitParams('k1', 'dev-a', { ...unary, kind: 'clarify' }))).ok, true, 'generate units do not count toward clarify');
    nodeAssert.strictEqual((await usage.admit(admitParams('k2', 'dev-b', { ...unary, kind: 'rewrite' }))).ok, true);
    nodeAssert.deepStrictEqual(await usage.admit(admitParams('k3', 'dev-c', { ...unary, kind: 'clarify' })), { ok: false, reason: 'global', retryAfterSec: twelveHours });
    nodeAssert.strictEqual((await usage.admit(admitParams('k4', 'dev-c', { kind: 'clarify', deviceLimit: 5, globalLimit: 2 }))).ok, true, 'globalKinds defaults to the admitted kind alone');

    nodeAssert.deepStrictEqual(await usage.admit(admitParams('a5', 'dev-a', { ...limits, now: NEXT_MIDNIGHT - 200 })), { ok: false, reason: 'device', retryAfterSec: 1 }, 'retryAfterSec is at least 1');
    nodeAssert.deepStrictEqual(await usage.admit(admitParams('a6', 'dev-a', { ...limits, now: NEXT_MIDNIGHT })), { ok: true, requestId: 'a6' }, 'the next UTC day starts empty');
  },
};

const admissionRace: StoreConformanceCase = {
  name: 'concurrent admissions for the last unit admit exactly one',
  async run({ usage }) {
    const device = { deviceLimit: 3, globalLimit: 1000 };
    await usage.admit(admitParams('d1', 'dev-race', device));
    await usage.admit(admitParams('d2', 'dev-race', device));
    const deviceRace = await Promise.all(Array.from({ length: 10 }, (_, i) => usage.admit(admitParams(`dr${i}`, 'dev-race', device))));
    nodeAssert.strictEqual(admittedCount(deviceRace), 1, 'exactly one admission takes the last device unit');
    nodeAssert.ok(deviceRace.every((result) => result.ok || result.reason === 'device'), 'the others are refused as device');

    const global = { deviceLimit: 10, globalLimit: 5, kind: 'report' as const };
    for (let i = 0; i < 4; i++) await usage.admit(admitParams(`g${i}`, `dev-g${i}`, global));
    const globalRace = await Promise.all(Array.from({ length: 8 }, (_, i) => usage.admit(admitParams(`gr${i}`, `dev-gr${i}`, global))));
    nodeAssert.strictEqual(admittedCount(globalRace), 1, 'exactly one admission takes the last global unit');
    nodeAssert.ok(globalRace.every((result) => result.ok || result.reason === 'global'), 'the others are refused as global');
  },
};

const reusedRequestId: StoreConformanceCase = {
  name: 'a reused request id is rejected and consumes no unit',
  async run(stores) {
    const { usage } = stores;
    const device = { deviceLimit: 2 };
    nodeAssert.strictEqual((await usage.admit(admitParams('dup', 'dev-a', device))).ok, true);
    await nodeAssert.rejects(usage.admit(admitParams('dup', 'dev-a', device)));
    nodeAssert.strictEqual((await usage.admit(admitParams('other', 'dev-a', device))).ok, true, 'the rejected reuse left the second device unit free');
    nodeAssert.strictEqual((await usage.admit(admitParams('third', 'dev-a', device))).ok, false);
    nodeAssert.deepStrictEqual((await ledgerIds(stores, 'dev-a')).sort((a, b) => a.localeCompare(b)), ['dup', 'other']);

    const global = { deviceLimit: 10, globalLimit: 2, kind: 'rewrite' as const };
    nodeAssert.strictEqual((await usage.admit(admitParams('gdup', 'dev-x', global))).ok, true);
    await nodeAssert.rejects(usage.admit(admitParams('gdup', 'dev-y', global)));
    nodeAssert.strictEqual((await usage.admit(admitParams('gother', 'dev-z', global))).ok, true, 'the rejected reuse left the second global unit free');
    nodeAssert.deepStrictEqual(await usage.admit(admitParams('gthird', 'dev-w', global)), { ok: false, reason: 'global', retryAfterSec: 12 * 3600 });
    nodeAssert.deepStrictEqual(await ledgerIds(stores, 'dev-y'), [], 'the reuse wrote no row under the other device');
  },
};

const refundOnce: StoreConformanceCase = {
  name: 'a refund frees its unit exactly once',
  async run(stores) {
    const { usage } = stores;
    const device = { deviceLimit: 2 };
    await usage.admit(admitParams('r1', 'dev-a', device));
    await usage.admit(admitParams('r2', 'dev-a', device));
    await usage.refund('r1');
    await usage.refund('r1');
    await usage.refund('never-admitted');
    nodeAssert.strictEqual((await usage.admit(admitParams('r3', 'dev-a', device))).ok, true, 'the refund freed one device unit');
    nodeAssert.strictEqual((await usage.admit(admitParams('r4', 'dev-a', device))).ok, false, 'the second refund freed nothing more');
    nodeAssert.deepStrictEqual(
      (await usage.deviceRecords('dev-a')).ledger.map((row) => [row.id, row.refunded]).sort(([a], [b]) => String(a).localeCompare(String(b))),
      [['r1', true], ['r2', false], ['r3', false]],
    );

    const global = { deviceLimit: 10, globalLimit: 2, kind: 'clarify' as const };
    await usage.admit(admitParams('q1', 'dev-p', global));
    await usage.admit(admitParams('q2', 'dev-q', global));
    await usage.refund('q1');
    await usage.refund('q1');
    nodeAssert.strictEqual((await usage.admit(admitParams('q3', 'dev-r', global))).ok, true, 'the refund freed one global unit');
    nodeAssert.deepStrictEqual(await usage.admit(admitParams('q4', 'dev-s', global)), { ok: false, reason: 'global', retryAfterSec: 12 * 3600 });
  },
};

const settleFirstWins: StoreConformanceCase = {
  name: 'settlement keeps the first outcome and the admission UTC day',
  async run(stores) {
    const { usage } = stores;
    const admittedAt = NEXT_MIDNIGHT - 1000;
    await usage.admit(admitParams('s1', 'dev-a', { now: admittedAt, deviceLimit: 1 }));
    await usage.settle('s1', { outcome: 'failed', failureReason: 'model_failure', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 }, now: NEXT_MIDNIGHT + 5000 });
    await usage.settle('s1', { outcome: 'delivered', usage: { promptTokens: 9, completionTokens: 9, totalTokens: 18 }, now: NEXT_MIDNIGHT + 9000 });
    const row = await ledgerRow(stores, 'dev-a', 's1');
    nodeAssert.deepStrictEqual(
      [row.utcDay, row.endedAt, row.outcome, row.failureReason, row.promptTokens, row.completionTokens],
      [utcDay(admittedAt), NEXT_MIDNIGHT + 5000, 'failed', 'model_failure', 1, 2],
    );
    const query = { deviceId: 'dev-a', kind: 'generate' as const, deviceLimit: 1 };
    nodeAssert.strictEqual((await usage.unitAvailable({ ...query, now: admittedAt })).ok, false, 'the unit still counts on its admission day');
    nodeAssert.strictEqual((await usage.unitAvailable({ ...query, now: NEXT_MIDNIGHT + 10_000 })).ok, true, 'and not on the day it settled');

    await usage.admit(admitParams('s2', 'dev-a'));
    await nodeAssert.rejects(usage.settle('s2', { outcome: 'failed', failureReason: 'free text' as FailureReason, now: T0 }));
    await nodeAssert.rejects(usage.settle('s2', { outcome: 'delivered', failureReason: 'model_failure', now: T0 }));
    const untouched = await ledgerRow(stores, 'dev-a', 's2');
    nodeAssert.deepStrictEqual([untouched.endedAt, untouched.outcome, untouched.failureReason], [null, null, null], 'a rejected settle writes nothing');
    await usage.settle('s2', { outcome: 'refused', failureReason: 'daily_limit', now: T0 + 1 });
    nodeAssert.deepStrictEqual([(await ledgerRow(stores, 'dev-a', 's2')).outcome, (await ledgerRow(stores, 'dev-a', 's2')).failureReason], ['refused', 'daily_limit']);
    await usage.settle('never-admitted', { outcome: 'ok', now: T0 });
  },
};

const costStates: StoreConformanceCase = {
  name: 'recordCost: pending accepts anything, unresolved only upgrades, resolved is final',
  async run(stores) {
    const { usage } = stores;
    const cost = async (id: string): Promise<[string, number | null, readonly string[] | null]> => {
      const row = await ledgerRow(stores, 'dev-a', id);
      return [row.costState, row.costUsd, row.generationIds];
    };
    await usage.admit(admitParams('c1', 'dev-a'));
    nodeAssert.deepStrictEqual(await cost('c1'), ['pending', null, null]);
    await usage.recordCost('c1', { state: 'pending', generationIds: ['g1', 'g2'] });
    nodeAssert.deepStrictEqual(await cost('c1'), ['pending', null, ['g1', 'g2']], 'pending registers ids');
    await usage.recordCost('c1', { state: 'unresolved' });
    nodeAssert.deepStrictEqual(await cost('c1'), ['unresolved', null, ['g1', 'g2']], 'pending to unresolved keeps the ids');
    await usage.recordCost('c1', { state: 'unresolved', costUsd: 5, generationIds: ['zz'] });
    nodeAssert.deepStrictEqual(await cost('c1'), ['unresolved', null, ['g1', 'g2']], 'unresolved to unresolved changes nothing');
    await usage.recordCost('c1', { state: 'resolved', costUsd: 0.25 });
    nodeAssert.deepStrictEqual(await cost('c1'), ['resolved', 0.25, null], 'unresolved upgrades to resolved and drops the ids');
    for (const state of ['resolved', 'unresolved', 'pending'] as const) {
      await usage.recordCost('c1', { state, costUsd: 9, generationIds: ['late'] });
    }
    nodeAssert.deepStrictEqual(await cost('c1'), ['resolved', 0.25, null], 'resolved is final');

    await usage.admit(admitParams('c2', 'dev-a'));
    await usage.recordCost('c2', { state: 'resolved', costUsd: 0.1, generationIds: ['x'] });
    nodeAssert.deepStrictEqual(await cost('c2'), ['resolved', 0.1, null], 'pending resolves directly');
    await usage.recordCost('never-admitted', { state: 'resolved', costUsd: 1 });
  },
};

const costSweepCandidates: StoreConformanceCase = {
  name: 'the cost sweep lists unresolved and stale pending rows with ids, oldest first',
  async run({ usage }) {
    const now = T0 + 10 * HOUR_MS;
    const row = async (id: string, startedAt: number, endedAt: number | undefined, state: 'pending' | 'unresolved' | 'resolved', ids?: string[]): Promise<void> => {
      await usage.admit(admitParams(id, 'dev-a', { now: startedAt }));
      if (endedAt !== undefined) await usage.settle(id, { outcome: 'delivered', now: endedAt });
      await usage.recordCost(id, { state, costUsd: state === 'resolved' ? 1 : undefined, generationIds: ids });
    };
    await row('late-unresolved', T0 + 5 * 60_000, T0 + 3 * HOUR_MS, 'unresolved', ['f']);
    await row('unresolved', T0, T0 + HOUR_MS, 'unresolved', ['a']);
    await row('stale-pending', T0 + 60_000, T0 + 2 * HOUR_MS, 'pending', ['b']);
    await row('fresh-pending', T0 + 2 * 60_000, now - 10 * 60_000, 'pending', ['c']);
    await row('no-ids', T0 + 3 * 60_000, T0 + HOUR_MS, 'unresolved');
    await row('too-old', T0 - 3 * DAY_MS, T0 - 3 * DAY_MS + HOUR_MS, 'unresolved', ['d']);
    await row('never-ended', T0 + 4 * 60_000, undefined, 'unresolved', ['e']);
    await row('resolved', T0 + 6 * 60_000, T0 + HOUR_MS, 'resolved', ['g']);
    const query = { now, stalePendingAfterMs: HOUR_MS, maxAgeMs: 2 * DAY_MS, limit: 10 };
    nodeAssert.deepStrictEqual(await usage.listUnresolvedCostRows(query), [
      { requestId: 'unresolved', generationIds: ['a'] },
      { requestId: 'stale-pending', generationIds: ['b'] },
      { requestId: 'late-unresolved', generationIds: ['f'] },
    ]);
    nodeAssert.deepStrictEqual((await usage.listUnresolvedCostRows({ ...query, limit: 2 })).map((c) => c.requestId), ['unresolved', 'stale-pending']);
  },
};

const summary: StoreConformanceCase = {
  name: 'summary counts, costs and failure reasons over the trailing UTC days',
  async run({ usage }) {
    const yesterday = T0 - DAY_MS;
    const admit = async (id: string, deviceId: string, now: number, kind: AdmitParams['kind'] = 'generate'): Promise<void> => {
      await usage.admit(admitParams(id, deviceId, { now, kind }));
    };
    await admit('y1', 'dev-c', yesterday);
    await usage.recordCost('y1', { state: 'resolved', costUsd: 1 });
    await admit('g1', 'dev-a', T0);
    await usage.recordCost('g1', { state: 'resolved', costUsd: 0.5 });
    await admit('g2', 'dev-b', T0);
    await usage.recordCost('g2', { state: 'resolved', costUsd: 0.25 });
    await admit('g3', 'dev-b', T0);
    await usage.settle('g3', { outcome: 'failed', failureReason: 'model_failure', now: T0 });
    await usage.recordCost('g3', { state: 'unresolved', generationIds: ['x'] });
    await admit('g4', 'dev-a', T0);
    await usage.refund('g4');
    await admit('c1', 'dev-a', T0, 'clarify');
    await usage.recordCost('c1', { state: 'resolved', costUsd: 0.125 });
    await admit('old', 'dev-d', T0 - 5 * DAY_MS);
    await usage.recordCost('old', { state: 'resolved', costUsd: 7 });

    nodeAssert.deepStrictEqual(await usage.summary({ days: 2, top: 2, now: T0 }), {
      days: [
        { utcDay: utcDay(yesterday), countByKind: { generate: 1 }, costUsdByKind: { generate: 1 } },
        { utcDay: utcDay(T0), countByKind: { generate: 3, clarify: 1 }, costUsdByKind: { generate: 0.75, clarify: 0.125 } },
      ],
      topDevicesByCost: [
        { deviceId: 'dev-c', costUsd: 1 },
        { deviceId: 'dev-a', costUsd: 0.625 },
      ],
      generationStats: { count: 5, meanCostUsd: 1.75 / 3, medianCostUsd: 0.5, p95CostUsd: 1, maxCostUsd: 1, unresolvedCount: 1 },
      failureReasonCounts: { model_failure: 1 },
    });
  },
};

const creditIncrements: StoreConformanceCase = {
  name: 'credit increments the lifetime totals and stamps the day it ran',
  async run({ usage }, clock) {
    nodeAssert.deepStrictEqual(await usage.read('nobody'), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    clock.now = T0;
    await usage.credit('dev-a', { promptTokens: 1, completionTokens: 2, totalTokens: 3 });
    clock.now = T0 + 2 * DAY_MS;
    await usage.credit('dev-a', { promptTokens: 10, completionTokens: 20, totalTokens: 30 });
    nodeAssert.deepStrictEqual(await usage.read('dev-a'), { promptTokens: 11, completionTokens: 22, totalTokens: 33 });
    nodeAssert.deepStrictEqual((await usage.deviceRecords('dev-a')).usage, {
      deviceId: 'dev-a',
      promptTokens: 11,
      completionTokens: 22,
      totalTokens: 33,
      lastCreditedDay: utcDay(T0 + 2 * DAY_MS),
    });
    await Promise.all(Array.from({ length: 5 }, () => usage.credit('dev-b', { promptTokens: 1, completionTokens: 1, totalTokens: 2 })));
    nodeAssert.deepStrictEqual(await usage.read('dev-b'), { promptTokens: 5, completionTokens: 5, totalTokens: 10 }, 'concurrent credits all land');
  },
};

const reportListing: StoreConformanceCase = {
  name: 'reports list newest first, by window and limit, and read back whole',
  async run({ reports }) {
    const bare = await reports.insert(report('dev-a', T0));
    const full = await reports.insert(report('dev-a', T0 + 1000, { reason: 'harmful', note: 'n', appName: 'App', prompt: 'héllo', source: 'abc' }));
    const newest = await reports.insert(report('dev-b', T0 + 2000));
    nodeAssert.deepStrictEqual(await reports.get(bare), {
      reportId: bare, receivedAt: T0, deviceId: 'dev-a', reason: 'broken', note: '', appName: '', prompt: '', source: '',
    }, 'an unsent optional field reads back as an empty string');
    nodeAssert.strictEqual(await reports.get('missing'), undefined);
    const now = T0 + 2000;
    nodeAssert.deepStrictEqual((await reports.list({ now })).map((item) => item.reportId), [newest, full, bare]);
    nodeAssert.deepStrictEqual((await reports.list({ now, limit: 2 }))[1], {
      reportId: full, receivedAt: T0 + 1000, reason: 'harmful', appName: 'App', note: 'n', promptBytes: 6, sourceBytes: 3,
    }, 'a list item carries byte sizes, never the text');
    nodeAssert.strictEqual((await reports.list({ now, limit: 2 })).length, 2);

    const edge = await reports.insert(report('dev-c', now - 5 * DAY_MS));
    await reports.insert(report('dev-c', now - 5 * DAY_MS - 1));
    nodeAssert.deepStrictEqual((await reports.list({ now, sinceDays: 5 })).map((item) => item.reportId), [newest, full, bare, edge], 'the window includes its cutoff');

    for (let i = 0; i < 50; i++) await reports.insert(report('dev-bulk', T0 - HOUR_MS - i));
    nodeAssert.strictEqual((await reports.list({ now })).length, 50, 'the default limit is 50');
  },
};

const waitlistRows: StoreConformanceCase = {
  name: 'the waitlist keeps one row per normalized email, oldest first, removable in any casing',
  async run({ waitlist }) {
    nodeAssert.strictEqual(await waitlist.upsert(signup('  Person@Example.COM ', 'android', T0)), 'stored');
    nodeAssert.strictEqual(await waitlist.upsert({ ...signup('person@example.com', 'ios', T0 + DAY_MS, true), noticeId: 'notice-2' }), 'updated');
    nodeAssert.deepStrictEqual(await waitlist.export(), [
      { email: 'person@example.com', platform: 'ios', updatesOptOut: true, noticeId: 'notice-2', createdAt: T0, updatedAt: T0 + DAY_MS },
    ]);

    await waitlist.upsert(signup('zed@example.com', 'android', T0 - 2));
    await waitlist.upsert(signup('bea@example.com', 'android', T0 - 1));
    await waitlist.upsert(signup('amy@example.com', 'android', T0 - 1));
    await waitlist.upsert(signup('out@example.com', 'other', T0 + 5, true));
    const emails = async (filter?: Parameters<OpenedStores['waitlist']['export']>[0]): Promise<string[]> => (await waitlist.export(filter)).map((row) => row.email);
    nodeAssert.deepStrictEqual(await emails(), ['zed@example.com', 'amy@example.com', 'bea@example.com', 'person@example.com', 'out@example.com'], 'oldest signup first, ties by email');
    nodeAssert.deepStrictEqual(await emails({ platform: 'android' }), ['zed@example.com', 'amy@example.com', 'bea@example.com']);
    nodeAssert.deepStrictEqual(await emails({ updatesOk: true }), ['zed@example.com', 'amy@example.com', 'bea@example.com']);

    nodeAssert.strictEqual(await waitlist.remove('  AMY@example.com'), true);
    nodeAssert.strictEqual(await waitlist.remove('amy@example.com'), false);
    nodeAssert.deepStrictEqual(await emails({ platform: 'android' }), ['zed@example.com', 'bea@example.com']);
  },
};

const deviceRecords: StoreConformanceCase = {
  name: 'device export and delete cover every record keyed by one device id',
  async run({ usage, reports }) {
    await usage.admit(admitParams('later', 'dev-a', { now: T0 + 5 }));
    await usage.admit(admitParams('earlier', 'dev-a', { now: T0 }));
    await usage.admit(admitParams('theirs', 'dev-b'));
    await usage.credit('dev-a', { promptTokens: 1, completionTokens: 1, totalTokens: 2 });
    await usage.credit('dev-b', { promptTokens: 4, completionTokens: 4, totalTokens: 8 });
    const exported = await usage.deviceRecords('dev-a');
    nodeAssert.deepStrictEqual(exported.ledger.map((row) => row.id), ['earlier', 'later'], 'ledger rows oldest first');
    nodeAssert.deepStrictEqual([exported.usage?.deviceId, exported.usage?.totalTokens], ['dev-a', 2]);
    nodeAssert.deepStrictEqual(await usage.deviceRecords('nobody'), { ledger: [], usage: null });

    nodeAssert.deepStrictEqual(await usage.deleteDeviceRecords('dev-a'), { ledger: 2, usage: 1 });
    nodeAssert.deepStrictEqual(await usage.deviceRecords('dev-a'), { ledger: [], usage: null });
    nodeAssert.deepStrictEqual(await usage.read('dev-a'), { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    nodeAssert.deepStrictEqual(await usage.deleteDeviceRecords('dev-a'), { ledger: 0, usage: 0 });
    const kept = await usage.deviceRecords('dev-b');
    nodeAssert.deepStrictEqual([kept.ledger.map((row) => row.id), kept.usage?.totalTokens], [['theirs'], 8], 'another device is untouched');

    const second = await reports.insert(report('dev-a', T0 + 5));
    const first = await reports.insert(report('dev-a', T0));
    const other = await reports.insert(report('dev-b', T0));
    nodeAssert.deepStrictEqual((await reports.listByDevice('dev-a')).map((row) => row.reportId), [first, second], 'reports oldest first');
    nodeAssert.strictEqual(await reports.deleteByDevice('dev-a'), 2);
    nodeAssert.deepStrictEqual(await reports.listByDevice('dev-a'), []);
    nodeAssert.deepStrictEqual((await reports.listByDevice('dev-b')).map((row) => row.reportId), [other]);
    nodeAssert.strictEqual(await reports.deleteByDevice('nobody'), 0);
  },
};

const retention: StoreConformanceCase = {
  name: 'each retention purge deletes strictly before its cutoff, admission counts with their day',
  async run(stores, clock) {
    const { usage, reports, waitlist } = stores;
    const cutoffMs = T0;
    await reports.insert(report('dev-a', cutoffMs - 1));
    const atCutoff = await reports.insert(report('dev-a', cutoffMs));
    const after = await reports.insert(report('dev-a', cutoffMs + 1));
    nodeAssert.strictEqual(await reports.purgeOlderThan(cutoffMs), 1);
    nodeAssert.deepStrictEqual((await reports.listByDevice('dev-a')).map((row) => row.reportId), [atCutoff, after]);

    const dayBefore = T0 - DAY_MS;
    await usage.admit(admitParams('old', 'dev-a', { now: dayBefore, deviceLimit: 1, globalLimit: 1 }));
    await usage.admit(admitParams('kept', 'dev-a', { now: T0 }));
    await usage.admit(admitParams('newer', 'dev-a', { now: T0 + DAY_MS }));
    nodeAssert.strictEqual((await usage.admit(admitParams('refused', 'dev-a', { now: dayBefore, deviceLimit: 1, globalLimit: 1 }))).ok, false);
    nodeAssert.strictEqual(await usage.purgeLedger(utcDay(T0)), 1);
    nodeAssert.deepStrictEqual(await ledgerIds(stores, 'dev-a'), ['kept', 'newer']);
    nodeAssert.strictEqual(
      (await usage.admit(admitParams('readmitted', 'dev-a', { now: dayBefore, deviceLimit: 1, globalLimit: 1 }))).ok,
      true,
      'the purged day no longer counts toward either limit',
    );

    for (const [deviceId, at] of [['idle', dayBefore], ['edge', T0], ['active', T0 + DAY_MS]] as const) {
      clock.now = at;
      await usage.credit(deviceId, { promptTokens: 1, completionTokens: 1, totalTokens: 2 });
    }
    nodeAssert.strictEqual(await usage.purgeIdleUsage(utcDay(T0)), 1);
    nodeAssert.deepStrictEqual(
      await Promise.all(['idle', 'edge', 'active'].map(async (id) => (await usage.read(id)).totalTokens)),
      [0, 2, 2],
    );

    const now = T0 + 1000 * DAY_MS;
    await waitlist.upsert(signup('expired@example.com', 'ios', now - (WAITLIST_RETENTION_DAYS + 1) * DAY_MS));
    await waitlist.upsert(signup('at-cutoff@example.com', 'ios', now - WAITLIST_RETENTION_DAYS * DAY_MS));
    await waitlist.upsert(signup('recent@example.com', 'ios', now - (WAITLIST_RETENTION_DAYS - 1) * DAY_MS));
    await waitlist.upsert(signup('renewed@example.com', 'ios', now - 900 * DAY_MS));
    await waitlist.upsert(signup('renewed@example.com', 'ios', now - DAY_MS));
    nodeAssert.strictEqual(await waitlist.purge(now), 1);
    nodeAssert.deepStrictEqual((await waitlist.export()).map((row) => row.email), ['renewed@example.com', 'at-cutoff@example.com', 'recent@example.com']);
  },
};

/** Every case the spec's conformance requirement lists, in run order. */
export const STORE_CONFORMANCE_CASES: readonly StoreConformanceCase[] = [
  admissionLimits,
  admissionRace,
  reusedRequestId,
  refundOnce,
  settleFirstWins,
  costStates,
  costSweepCandidates,
  summary,
  creditIncrements,
  reportListing,
  waitlistRows,
  deviceRecords,
  retention,
];

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Runs one case on fresh stores; the failure message, or `undefined` when it passed. */
export async function runConformanceCase(factory: StoreBackendFactory, testCase: StoreConformanceCase, timeoutMs = CASE_TIMEOUT_MS): Promise<string | undefined> {
  const clock: ConformanceClock = { now: T0 };
  let stores: OpenedStores;
  try {
    stores = await factory.open(() => clock.now);
  } catch (err) {
    return `could not open the stores: ${messageOf(err)}`;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(`timed out after ${timeoutMs} ms`), timeoutMs);
  });
  try {
    return await Promise.race([testCase.run(stores, clock).then(() => undefined, messageOf), timedOut]);
  } finally {
    clearTimeout(timer);
    await stores.close().catch((err: unknown) => {
      check(`${factory.label}: ${testCase.name}: the stores close`, false, messageOf(err));
    });
  }
}

/** Runs `cases` (every case by default) against `factory`, one harness check per case. */
export async function runStoreConformance(factory: StoreBackendFactory, cases: readonly StoreConformanceCase[] = STORE_CONFORMANCE_CASES): Promise<void> {
  for (const testCase of cases) {
    const failure = await runConformanceCase(factory, testCase);
    check(`${factory.label}: ${testCase.name}`, failure === undefined, failure);
  }
}

const inMemoryBackend: StoreBackendFactory = {
  label: 'in-memory',
  async open(now) {
    const usage = new InMemoryUsageStore({ now });
    const reports = new InMemoryReportStore();
    const waitlist = new InMemoryWaitlistStore();
    return { usage, reports, waitlist, close: async () => {} };
  },
};

/** The production SQLite backend, opened through `openStores` on a fresh data directory per case. */
function sqliteBackend(): StoreBackendFactory {
  return {
    label: 'sqlite',
    async open(now) {
      const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-store-conformance-'));
      const stores = await openStores({ ...sqliteConfig(dataDir), now });
      return {
        ...stores,
        close: async () => {
          try {
            await stores.close();
          } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
          }
        },
      };
    },
  };
}

function sqliteConfig(dataDir: string): StoreConfig {
  const config = loadServerConfig({ WHIM_DATA_DIR: dataDir });
  return { ...config, storeBackend: 'sqlite' };
}

/** A backend whose admission ignores the device limit — the negative control that proves the
 *  admission cases can fail. */
function deviceLimitSkippingBackend(inner: StoreBackendFactory): StoreBackendFactory {
  return {
    label: `${inner.label} without the device limit`,
    async open(now) {
      const stores = await inner.open(now);
      const usage = new Proxy(stores.usage, {
        get(target, property) {
          if (property === 'admit') return (params: AdmitParams) => target.admit({ ...params, deviceLimit: Number.MAX_SAFE_INTEGER });
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      return { ...stores, usage, close: () => stores.close() };
    },
  };
}

async function negativeControlTests(): Promise<void> {
  section('Store conformance: a backend that breaks the contract fails it');

  const broken = deviceLimitSkippingBackend(inMemoryBackend);
  for (const testCase of [admissionLimits, admissionRace, reusedRequestId, refundOnce]) {
    const failure = await runConformanceCase(broken, testCase);
    check(`${broken.label}: "${testCase.name}" fails`, failure !== undefined);
  }
  check(`${broken.label}: an unrelated case still passes`, (await runConformanceCase(broken, waitlistRows)) === undefined);
}

async function factoryTests(): Promise<void> {
  section('openStores: one factory for every store (durable-server-stores D1)');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-open-stores-'));
  try {
    const first = await openStores(sqliteConfig(dataDir));
    await first.waitlist.upsert(signup('kept@example.com', 'ios', T0));
    await first.reports.insert(report('dev-a', T0));
    await first.usage.credit('dev-a', { promptTokens: 1, completionTokens: 1, totalTokens: 2 });
    await first.close();
    check(
      'sqlite: the three stores are node:sqlite files under WHIM_DATA_DIR',
      ['usage.db', 'reports.db', 'waitlist.db'].every((file) => fs.existsSync(path.join(dataDir, file))),
      fs.readdirSync(dataDir).join(', '),
    );
    const reopened = await openStores(sqliteConfig(dataDir));
    check(
      '  ... and what one open wrote, the next reads back',
      (await reopened.waitlist.export()).length === 1 && (await reopened.reports.listByDevice('dev-a')).length === 1 && (await reopened.usage.read('dev-a')).totalTokens === 2,
    );
    await reopened.close();
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  const firestoreConfig: StoreConfig = { ...sqliteConfig(os.tmpdir()), storeBackend: 'firestore', firestoreDatabase: 'whim-test' };
  const injected = await inMemoryBackend.open(Date.now);
  let seen: StoreConfig | undefined;
  const opened = await openStores(firestoreConfig, {
    openFirestore: async (config) => {
      seen = config;
      return injected;
    },
  });
  check('firestore: the injected opener receives the config and its stores are returned', seen?.firestoreDatabase === 'whim-test' && opened === injected);
  const refusal = await openStores(firestoreConfig).then(() => undefined, messageOf);
  check('firestore: the default opener rejects, naming the backend', refusal?.includes('firestore') === true, refusal);
  check('  ... the same opener `openFirestoreStores` exports', (await openFirestoreStores(firestoreConfig).then(() => undefined, messageOf)) === refusal);
}

export async function runStoreConformanceTests(): Promise<void> {
  section('Store conformance: in-memory');
  await runStoreConformance(inMemoryBackend);
  section('Store conformance: sqlite (through openStores)');
  await runStoreConformance(sqliteBackend());
  await negativeControlTests();
  await factoryTests();
}
