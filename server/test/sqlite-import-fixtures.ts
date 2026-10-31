/**
 * A SQLite data directory for the `import-sqlite` tests, written by the real `NodeSqlite*` stores
 * (never hand-written rows), plus what those stores themselves return for it. Used by the Node
 * suite (`import-sqlite.suite.ts`) and the Firestore emulator entry (`firestore-import.ts`).
 */
import path from 'node:path';
import { NodeSqliteReportStore, type ReportRow } from '../src/reports/store';
import { NodeSqliteUsageStore, type DeviceUsageRecords } from '../src/usage-store';
import { NodeSqliteWaitlistStore, type WaitlistRow } from '../src/waitlist/store';

const DAY_MS = 86_400_000;

/** 2026-10-07T12:00Z: the fixture's "today". */
export const IMPORT_T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
export const IMPORT_TODAY = '2026-10-07';
export const IMPORT_YESTERDAY = '2026-10-06';
/** A ledger day 100 days back: outside a 90-day ledger retention. */
export const IMPORT_OLD_DAY = '2026-06-29';

export const DEVICE_A = 'dev-a';
/** A device id a Firestore document id cannot hold as it is. */
export const DEVICE_UNSAFE = 'b/../dev';
export const CHANGED_EMAIL = 'early@example.com';

/** What the SQLite stores returned for the records they wrote. */
export interface SqliteFixtureViews {
  waitlist: WaitlistRow[];
  reportsByDevice: Record<string, ReportRow[]>;
  usageByDevice: Record<string, DeviceUsageRecords>;
}

/** Writes `waitlist.db` with two signups, one of them answered again a day later. */
export async function writeWaitlistFixture(dataDir: string): Promise<WaitlistRow[]> {
  const waitlist = new NodeSqliteWaitlistStore(path.join(dataDir, 'waitlist.db'), { fingerprintKey: 'import-fixture-fingerprint-key-0123456789' });
  try {
    await waitlist.upsert({ email: ' Early@Example.com', platform: 'android', updatesOptIn: true, noticeId: 'notice-1', now: IMPORT_T0 - 3 * DAY_MS });
    await waitlist.upsert({ email: 'late@example.com', platform: 'ios', updatesOptIn: false, noticeId: 'notice-1', now: IMPORT_T0 - 2 * DAY_MS });
    await waitlist.upsert({ email: CHANGED_EMAIL, platform: 'other', updatesOptIn: false, noticeId: 'notice-2', now: IMPORT_T0 - DAY_MS });
    return await waitlist.export();
  } finally {
    await waitlist.close();
  }
}

/** Writes `reports.db` with one report carrying every optional text and one carrying none. */
export async function writeReportsFixture(dataDir: string): Promise<Record<string, ReportRow[]>> {
  const reports = new NodeSqliteReportStore(path.join(dataDir, 'reports.db'));
  try {
    await reports.insert({ deviceId: DEVICE_A, reason: 'broken', note: 'it froze', appName: 'Timer', prompt: 'a timer', source: 'export {}', now: IMPORT_T0 - DAY_MS });
    await reports.insert({ deviceId: DEVICE_UNSAFE, reason: 'other', now: IMPORT_T0 });
    return { [DEVICE_A]: await reports.listByDevice(DEVICE_A), [DEVICE_UNSAFE]: await reports.listByDevice(DEVICE_UNSAFE) };
  } finally {
    await reports.close();
  }
}

/**
 * Writes `usage.db`: today, `DEVICE_A` has one settled and cost-resolved `generate` and one refunded
 * `generate`, `DEVICE_UNSAFE` one `clarify` with pending cost ids; yesterday `DEVICE_A` has one
 * `rewrite`; and one `generate` sits on `IMPORT_OLD_DAY`. Both devices have lifetime totals.
 */
export async function writeUsageFixture(dataDir: string): Promise<Record<string, DeviceUsageRecords>> {
  const usage = new NodeSqliteUsageStore(path.join(dataDir, 'usage.db'), { now: () => IMPORT_T0, usageIdleDays: 365 });
  try {
    const admit = async (requestId: string, deviceId: string, kind: 'generate' | 'clarify' | 'rewrite', now: number): Promise<void> => {
      const result = await usage.admit({ requestId, deviceId, kind, now, deviceLimit: 10 });
      if (!result.ok) throw new Error(`fixture admit ${requestId} was refused`);
    };
    await admit('req-old', DEVICE_A, 'generate', IMPORT_T0 - 100 * DAY_MS);
    await admit('req-yesterday', DEVICE_A, 'rewrite', IMPORT_T0 - DAY_MS);
    await usage.settle('req-yesterday', { outcome: 'failed', failureReason: 'model_failure', now: IMPORT_T0 - DAY_MS + 500 });
    await admit('req-delivered', DEVICE_A, 'generate', IMPORT_T0);
    await usage.settle('req-delivered', { outcome: 'delivered', usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 }, now: IMPORT_T0 + 900 });
    await usage.recordCost('req-delivered', { state: 'resolved', costUsd: 0.0125 });
    await admit('req-refunded', DEVICE_A, 'generate', IMPORT_T0 + 1000);
    await usage.refund('req-refunded');
    await admit('req-pending', DEVICE_UNSAFE, 'clarify', IMPORT_T0 + 2000);
    await usage.recordCost('req-pending', { state: 'pending', generationIds: ['gen-1', 'gen-2'] });
    await usage.credit(DEVICE_A, { promptTokens: 120, completionTokens: 30, totalTokens: 150 });
    await usage.credit(DEVICE_UNSAFE, { promptTokens: 7, completionTokens: 2, totalTokens: 9 });
    return { [DEVICE_A]: await usage.deviceRecords(DEVICE_A), [DEVICE_UNSAFE]: await usage.deviceRecords(DEVICE_UNSAFE) };
  } finally {
    await usage.close();
  }
}

/** Writes all three files into `dataDir`. */
export async function writeSqliteFixture(dataDir: string): Promise<SqliteFixtureViews> {
  return {
    waitlist: await writeWaitlistFixture(dataDir),
    reportsByDevice: await writeReportsFixture(dataDir),
    usageByDevice: await writeUsageFixture(dataDir),
  };
}
