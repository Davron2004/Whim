/**
 * Device records acceptance (legal-surface-v2 chain-2, design D9). Covers specs/device-records
 * "Every server record keyed by a phone ID has a keep-period" (the lifetime row's last-credited day,
 * its migration against a database the pre-change store wrote, and the idle purge in the usage
 * purge schedule) and "The operator can export and delete one phone ID's records" (the
 * `whim-admin device` subcommands over the real stores). The keep-period caps are in config.suite.ts
 * and deploy-config.suite.ts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { check, eq, section } from './harness';
import { TIMED_OUT, within } from './route-doubles';
import { loadServerConfig } from '../src/config';
import { runAdminCli, type AdminCliDeps, type DeviceDeletion, type DeviceExport } from '../src/admin/cli';
import { InMemoryReportStore, NodeSqliteReportStore, type ReportRecordKeeping, type ReportStore } from '../src/reports/store';
import {
  InMemoryUsageStore,
  NodeSqliteUsageStore,
  scheduleUsagePurge,
  type UsageRecordKeeping,
  type UsageStore,
  type UsageStoreOptions,
} from '../src/usage-store';

const DAY_MS = 86_400_000;
/** Tonight's deploy: the day the migration runs on the production database. */
const RUN_AT = Date.UTC(2026, 8, 24, 20, 0, 0, 0);
const RUN_DAY = '2026-09-24';
const DEVICE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const OTHER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const UNKNOWN = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
/** A device the pre-change fixture credited (usage-db-before-last-credited-day.sql). */
const FIXTURE_DEVICE = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';

type Keeper = UsageStore & UsageRecordKeeping;
type Row = Record<string, unknown>;

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function tmpDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `whim-device-records-${label}-`));
}

/** Both store implementations on one clock: the parity every scenario runs against. */
function stores(options: UsageStoreOptions): Array<[string, Keeper & { close?: () => void }]> {
  return [
    ['in-memory', new InMemoryUsageStore(options)],
    ['sqlite', new NodeSqliteUsageStore(':memory:', options)],
  ];
}

/** Every schema statement and every row of a usage database, read raw (as plain objects: node:sqlite
 *  rows have a null prototype). */
function snapshot(dbPath: string): { schema: Row[]; usageColumns: Row[]; usage: Row[]; requests: Row[] } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = (sql: string): Row[] => (db.prepare(sql).all() as Row[]).map((row) => ({ ...row }));
  try {
    return {
      schema: rows('SELECT type, name, sql FROM sqlite_master ORDER BY name'),
      usageColumns: rows('PRAGMA table_info(usage)'),
      usage: rows('SELECT * FROM usage ORDER BY device_id'),
      requests: rows('SELECT * FROM requests ORDER BY id'),
    };
  } finally {
    db.close();
  }
}

function withoutDay(rows: readonly Row[]): Row[] {
  return rows.map(({ last_credited_day: _day, ...rest }) => rest);
}

/** The pre-change database: its schema statements and rows, replayed into a WAL file at `dbPath`
 *  as that store opened it. */
function writePreChangeDatabase(dbPath: string): void {
  const preChange = new DatabaseSync(dbPath);
  preChange.exec('PRAGMA journal_mode = WAL');
  preChange.exec(fs.readFileSync(path.join(process.cwd(), 'server/test/fixtures/usage-db-before-last-credited-day.sql'), 'utf8'));
  preChange.close();
}

/** Version 1's published rule for usage records made before this change: deleted within 90 days. */
const PRE_CHANGE_KEEP_DAYS = 90;

async function testMigrationOnPreChangeDatabase(): Promise<void> {
  section('spec: the migration is safe to rerun on a database the pre-change store wrote');

  const { usageIdleDays } = loadServerConfig({});
  /** The day a backfilled row gets on a start at `at`: the one the idle purge deletes it 90 days after. */
  const backfilledDay = (at: number): string => dayOf(at - (usageIdleDays - PRE_CHANGE_KEEP_DAYS) * DAY_MS);
  const dir = tmpDir('migration');
  const dbPath = path.join(dir, 'usage.db');
  try {
    writePreChangeDatabase(dbPath);
    const before = snapshot(dbPath);
    check('setup: the fixture has lifetime rows and ledger rows, and no last_credited_day', before.usage.length === 3 && before.requests.length === 6 && before.usageColumns.every((c) => c.name !== 'last_credited_day'), JSON.stringify(before.usageColumns));
    check('setup: the default idle period is longer than the pre-change rule', usageIdleDays > PRE_CHANGE_KEEP_DAYS, String(usageIdleDays));

    let refused: unknown;
    try {
      new NodeSqliteUsageStore(dbPath, { now: () => RUN_AT }).close();
    } catch (err) {
      refused = err;
    }
    check('a start that doesn\'t say its idle period refuses to date the pre-change rows', refused instanceof Error && refused.message.includes('usageIdleDays'), String(refused));
    eq('  ... and leaves the database exactly as it was', snapshot(dbPath), before);

    const first = new NodeSqliteUsageStore(dbPath, { now: () => RUN_AT, usageIdleDays });
    first.close();
    const migrated = snapshot(dbPath);
    eq('first start: the column is added once, after the existing columns, which are unchanged', migrated.usageColumns.map((c) => c.name), [...before.usageColumns.map((c) => c.name), 'last_credited_day']);
    eq('  ... every existing column keeps its type, NOT NULL, default and key', migrated.usageColumns.slice(0, before.usageColumns.length), before.usageColumns);
    eq(
      `  ... every pre-existing row is dated ${usageIdleDays - PRE_CHANGE_KEEP_DAYS} days back, so the idle purge deletes it ${PRE_CHANGE_KEEP_DAYS} days after the run`,
      migrated.usage.map((r) => r.last_credited_day),
      before.usage.map(() => backfilledDay(RUN_AT)),
    );
    eq('  ... no lifetime total changed', withoutDay(migrated.usage), before.usage);
    eq('  ... the ledger is untouched', migrated.requests, before.requests);

    // A second boot, days later: nothing changes, and the backfilled day does NOT move to the
    // second boot's day (moving it would keep an idle phone's totals forever).
    const second = new NodeSqliteUsageStore(dbPath, { now: () => RUN_AT + 3 * DAY_MS, usageIdleDays });
    eq('second start: the lifetime totals still read back as before', await second.read(FIXTURE_DEVICE), { promptTokens: 2000, completionTokens: 4000, totalTokens: 6000 });
    second.close();
    eq('  ... the database is byte-for-byte what the first start left: schema, lifetime rows, ledger', snapshot(dbPath), migrated);

    // A pre-change build credits a new phone after a rollback: its insert names only the old
    // columns. The next start dates that row the same way and leaves every other row alone.
    const rolledBack = new DatabaseSync(dbPath);
    rolledBack.prepare('INSERT INTO usage (device_id, prompt_tokens, completion_tokens, total_tokens) VALUES (?, 1, 2, 3)').run(DEVICE);
    rolledBack.close();
    const third = new NodeSqliteUsageStore(dbPath, { now: () => RUN_AT + 5 * DAY_MS, usageIdleDays });
    const afterRollback = await third.deviceRecords(DEVICE);
    const kept = await third.deviceRecords(FIXTURE_DEVICE);
    third.close();
    eq('after a rollback: a row a pre-change build wrote is dated from the next start', afterRollback.usage?.lastCreditedDay, backfilledDay(RUN_AT + 5 * DAY_MS));
    eq('  ... and a migrated row keeps its own day', kept.usage?.lastCreditedDay, backfilledDay(RUN_AT));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function testPreChangeTotalsFollowTheOldRule(): Promise<void> {
  section('spec: pre-change totals go within 90 days of the migration unless the phone comes back');

  const { usageIdleDays } = loadServerConfig({});
  const dir = tmpDir('pre-change-purge');
  const dbPath = path.join(dir, 'usage.db');
  const RETURNING = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
  let clock = RUN_AT;
  try {
    writePreChangeDatabase(dbPath);
    const store = new NodeSqliteUsageStore(dbPath, { now: () => clock, usageIdleDays });
    clock = RUN_AT + 10 * DAY_MS;
    await store.credit(RETURNING, { promptTokens: 1, completionTokens: 1, totalTokens: 2 });
    const purgeOn = async (day: number): Promise<number> => store.purgeIdleUsage(dayOf(RUN_AT + day * DAY_MS - usageIdleDays * DAY_MS));
    eq(`${PRE_CHANGE_KEEP_DAYS} days after the migration, the idle purge still keeps every pre-change row`, await purgeOn(PRE_CHANGE_KEEP_DAYS), 0);
    eq(`${PRE_CHANGE_KEEP_DAYS + 1} days after, it deletes the two phones that never came back`, await purgeOn(PRE_CHANGE_KEEP_DAYS + 1), 2);
    eq('  ... gone: a phone that never came back', (await store.deviceRecords(FIXTURE_DEVICE)).usage, null);
    eq('  ... kept: a phone that came back, with its pre-change totals added to', await store.read(RETURNING), { promptTokens: 52, completionTokens: 8, totalTokens: 60 });
    store.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const shortDir = tmpDir('short-idle');
  const shortPath = path.join(shortDir, 'usage.db');
  try {
    writePreChangeDatabase(shortPath);
    const store = new NodeSqliteUsageStore(shortPath, { now: () => RUN_AT, usageIdleDays: 30 });
    eq('an idle period shorter than 90 days dates pre-change rows on the run day, never a future day', (await store.deviceRecords(FIXTURE_DEVICE)).usage?.lastCreditedDay, RUN_DAY);
    store.close();
  } finally {
    fs.rmSync(shortDir, { recursive: true, force: true });
  }
}

async function testCreditStampsTheDay(): Promise<void> {
  section('spec: every credit records the UTC day it landed on');

  let now = RUN_AT - 40 * DAY_MS;
  for (const [label, store] of stores({ now: () => now })) {
    now = RUN_AT - 40 * DAY_MS;
    await store.credit(DEVICE, { promptTokens: 10, completionTokens: 20, totalTokens: 30 });
    eq(`${label}: the first credit stamps its day`, (await store.deviceRecords(DEVICE)).usage?.lastCreditedDay, dayOf(now));
    now = RUN_AT;
    await store.credit(DEVICE, { promptTokens: 1, completionTokens: 2, totalTokens: 3 });
    eq(`${label}: a later credit moves the day and adds to the totals`, (await store.deviceRecords(DEVICE)).usage, {
      deviceId: DEVICE,
      promptTokens: 11,
      completionTokens: 22,
      totalTokens: 33,
      lastCreditedDay: RUN_DAY,
    });
    store.close?.();
  }
}

/** Resolves with each purge run as it settles. */
function tickWaiter(): { onTick: () => void; next: () => Promise<void> } {
  let resolveNext: () => void = () => {};
  let waiting = new Promise<void>((resolve) => {
    resolveNext = resolve;
  });
  return {
    onTick: () => {
      resolveNext();
      waiting = new Promise((resolve) => {
        resolveNext = resolve;
      });
    },
    next: () => waiting,
  };
}

async function testIdlePurge(): Promise<void> {
  section('spec: the purge deletes a lifetime row idle past the default period and keeps an active one');

  const config = loadServerConfig({});
  const idle = '11111111-1111-4111-8111-111111111111';
  const edge = '22222222-2222-4222-8222-222222222222';
  let clock = RUN_AT;
  for (const [label, store] of stores({ now: () => clock })) {
    // Idle: credited once, 366 days before the purge runs.
    clock = RUN_AT - 366 * DAY_MS;
    await store.credit(idle, { promptTokens: 5, completionTokens: 5, totalTokens: 10 });
    // Active: first credited 400 days back, credited again yesterday. Purging by the day a row was
    // created instead of the day it was last credited would delete it.
    clock = RUN_AT - 400 * DAY_MS;
    await store.credit(DEVICE, { promptTokens: 100, completionTokens: 50, totalTokens: 150 });
    clock = RUN_AT - DAY_MS;
    await store.credit(DEVICE, { promptTokens: 1, completionTokens: 1, totalTokens: 2 });
    // At the edge: last credited exactly 365 days back, still inside the window.
    clock = RUN_AT - 365 * DAY_MS;
    await store.credit(edge, { promptTokens: 7, completionTokens: 0, totalTokens: 7 });
    // The same schedule purges the ledger by its own retention.
    const stale = await store.admit({ requestId: `${label}-stale`, deviceId: DEVICE, kind: 'generate', now: RUN_AT - (config.ledgerRetentionDays + 1) * DAY_MS, deviceLimit: 15 });
    const fresh = await store.admit({ requestId: `${label}-fresh`, deviceId: DEVICE, kind: 'generate', now: RUN_AT - DAY_MS, deviceLimit: 15 });
    check(`setup (${label}): both ledger rows admitted`, stale.ok && fresh.ok);

    clock = RUN_AT;
    const ticks = tickWaiter();
    const bootRun = ticks.next();
    const schedule = scheduleUsagePurge(store, {
      ledgerRetentionDays: config.ledgerRetentionDays,
      usageIdleDays: config.usageIdleDays,
      now: () => clock,
      intervalMs: 3_600_000,
      onTick: ticks.onTick,
    });
    const settled = await within(bootRun, 2000);
    schedule.stop();
    check(`${label}: the boot run settled`, settled !== TIMED_OUT);

    eq(`${label}: a row last credited 366 days ago is gone`, (await store.deviceRecords(idle)).usage, null);
    eq(`${label}: a row credited yesterday keeps its running totals`, await store.read(DEVICE), { promptTokens: 101, completionTokens: 51, totalTokens: 152 });
    eq(`${label}: a row last credited exactly 365 days ago is kept`, (await store.read(edge)).totalTokens, 7);
    eq(`${label}: the ledger keeps the fresh row and drops the one past its retention`, (await store.deviceRecords(DEVICE)).ledger.map((r) => r.id), [`${label}-fresh`]);
    store.close?.();
  }
}

async function testPurgeFailureIsReported(): Promise<void> {
  section('A failed idle purge is reported, and the ledger purge still runs');

  const inner = new InMemoryUsageStore({ now: () => RUN_AT });
  const errors: string[] = [];
  let ledgerCutoff = '';
  const ticks = tickWaiter();
  const bootRun = ticks.next();
  const schedule = scheduleUsagePurge(
    {
      purgeLedger: (beforeUtcDay) => {
        ledgerCutoff = beforeUtcDay;
        return inner.purgeLedger(beforeUtcDay);
      },
      purgeIdleUsage: () => Promise.reject(new Error('usage.db is locked')),
    },
    { ledgerRetentionDays: 90, usageIdleDays: 365, now: () => RUN_AT, onError: (message) => errors.push(message), onTick: ticks.onTick },
  );
  const settled = await within(bootRun, 2000);
  schedule.stop();
  check('the run still settles', settled !== TIMED_OUT);
  eq('the failure is reported by name', errors, ['idle usage purge failed']);
  eq('the ledger purge ran with its own cut-off', ledgerCutoff, dayOf(RUN_AT - 90 * DAY_MS));
}

// ---------------------------------------------------------------------------------------------
// whim-admin device export / delete

interface Seeded {
  deps: AdminCliDeps;
  reportIds: string[];
  requestIds: string[];
  close(): void;
}

async function seed(label: string, reportStore: ReportStore & ReportRecordKeeping, usageStore: Keeper, close: () => void): Promise<Seeded> {
  const reportIds = [
    await reportStore.insert({ deviceId: DEVICE, reason: 'offensive', note: 'rude', appName: 'Joke Box', prompt: 'jokes', source: 'export default 1', now: RUN_AT - 2 * DAY_MS }),
    await reportStore.insert({ deviceId: DEVICE, reason: 'broken', now: RUN_AT - DAY_MS }),
  ];
  await reportStore.insert({ deviceId: OTHER, reason: 'other', note: 'someone else', now: RUN_AT - DAY_MS });

  const requestIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const requestId = `${label}-device-${i}`;
    const admitted = await usageStore.admit({ requestId, deviceId: DEVICE, kind: i === 4 ? 'report' : 'generate', now: RUN_AT - i * 60_000, deviceLimit: 15 });
    if (!admitted.ok) throw new Error('setup: admit refused');
    requestIds.push(requestId);
  }
  await usageStore.settle(requestIds[0]!, { outcome: 'delivered', usage: { promptTokens: 9, completionTokens: 8, totalTokens: 17 }, now: RUN_AT + 1000 });
  await usageStore.recordCost(requestIds[0]!, { state: 'unresolved', generationIds: ['gen-1', 'gen-2'] });
  for (const requestId of [`${label}-other-0`, `${label}-other-1`]) {
    await usageStore.admit({ requestId, deviceId: OTHER, kind: 'clarify', now: RUN_AT, deviceLimit: 60 });
  }
  await usageStore.credit(DEVICE, { promptTokens: 9, completionTokens: 8, totalTokens: 17 });
  await usageStore.credit(OTHER, { promptTokens: 1, completionTokens: 1, totalTokens: 2 });

  return { deps: { reportStore, usageStore, now: () => RUN_AT, reportRetentionDays: 90 }, reportIds, requestIds, close };
}

function seededStores(): Array<[string, () => Promise<Seeded>]> {
  return [
    ['in-memory', () => seed('mem', new InMemoryReportStore(), new InMemoryUsageStore({ now: () => RUN_AT }), () => {})],
    [
      'sqlite',
      () => {
        const reports = new NodeSqliteReportStore(':memory:');
        const usage = new NodeSqliteUsageStore(':memory:', { now: () => RUN_AT });
        return seed('sql', reports, usage, () => {
          reports.close();
          usage.close();
        });
      },
    ],
  ];
}

async function run(deps: AdminCliDeps, argv: string[]): Promise<{ exitCode: number; json: unknown }> {
  const result = await runAdminCli(argv, deps);
  let json: unknown;
  try {
    json = JSON.parse(result.output) as unknown;
  } catch (err) {
    json = { unparsed: result.output, detail: String(err) };
  }
  return { exitCode: result.exitCode, json };
}

async function testDeviceExportAndDelete(): Promise<void> {
  for (const [label, make] of seededStores()) {
    section(`spec (${label}): device export finds exactly one phone's records; delete removes them and is idempotent`);
    const { deps, reportIds, requestIds, close } = await make();

    const exported = await run(deps, ['device', 'export', DEVICE]);
    const body = exported.json as DeviceExport;
    eq('export exits 0', exported.exitCode, 0);
    eq('  ... for that device id', body.deviceId, DEVICE);
    eq('  ... holding exactly its two reports, oldest first', body.reports.map((r) => r.reportId), reportIds);
    eq('  ... with every stored field', body.reports[0], {
      reportId: reportIds[0],
      receivedAt: RUN_AT - 2 * DAY_MS,
      deviceId: DEVICE,
      reason: 'offensive',
      note: 'rude',
      appName: 'Joke Box',
      prompt: 'jokes',
      source: 'export default 1',
    });
    eq('  ... exactly its five ledger rows', body.ledger.map((r) => r.id).sort((a, b) => a.localeCompare(b)), [...requestIds].sort((a, b) => a.localeCompare(b)));
    const settled = body.ledger.find((r) => r.id === requestIds[0]);
    eq('  ... each with every column, provider generation ids included', [settled?.deviceId, settled?.outcome, settled?.promptTokens, settled?.costState, settled?.generationIds], [DEVICE, 'delivered', 9, 'unresolved', ['gen-1', 'gen-2']]);
    eq('  ... and its usage row', body.usage, { deviceId: DEVICE, promptTokens: 9, completionTokens: 8, totalTokens: 17, lastCreditedDay: RUN_DAY });
    const otherBefore = await run(deps, ['device', 'export', OTHER]);
    const other = otherBefore.json as DeviceExport;
    check('  (setup: another phone has a report, two ledger rows and a usage row)', other.reports.length === 1 && other.ledger.length === 2 && other.usage !== null);

    const firstDelete = await run(deps, ['device', 'delete', DEVICE]);
    eq('the first delete exits 0 and reports 2, 5 and 1 removed', [firstDelete.exitCode, firstDelete.json], [0, { deviceId: DEVICE, removed: { reports: 2, ledger: 5, usage: 1 } } satisfies DeviceDeletion]);
    eq('  ... a following export is empty', (await run(deps, ['device', 'export', DEVICE])).json, { deviceId: DEVICE, reports: [], ledger: [], usage: null } satisfies DeviceExport);
    eq('  ... and the other phone\'s records are untouched', await run(deps, ['device', 'export', OTHER]), otherBefore);
    eq('the second delete reports zero of each', (await run(deps, ['device', 'delete', DEVICE])).json, { deviceId: DEVICE, removed: { reports: 0, ledger: 0, usage: 0 } } satisfies DeviceDeletion);

    eq('an unknown id exports empty, exit 0', await run(deps, ['device', 'export', UNKNOWN]), { exitCode: 0, json: { deviceId: UNKNOWN, reports: [], ledger: [], usage: null } });
    eq('an unknown id deletes nothing, exit 0', await run(deps, ['device', 'delete', UNKNOWN]), { exitCode: 0, json: { deviceId: UNKNOWN, removed: { reports: 0, ledger: 0, usage: 0 } } });
    eq('device export without an id is a usage error', (await runAdminCli(['device', 'export'], deps)).exitCode, 1);
    eq('device delete without an id is a usage error', (await runAdminCli(['device', 'delete'], deps)).exitCode, 1);
    close();
  }
}

export async function runDeviceRecordsTests(): Promise<void> {
  await testMigrationOnPreChangeDatabase();
  await testPreChangeTotalsFollowTheOldRule();
  await testCreditStampsTheDay();
  await testIdlePurge();
  await testPurgeFailureIsReported();
  await testDeviceExportAndDelete();
}
