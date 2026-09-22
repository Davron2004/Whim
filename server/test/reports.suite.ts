/**
 * Report store acceptance (public-generation-server chain-5). Scaffolded here by chain-1
 * (task 2.5, pre-registered in acceptance.ts); chain-5 fills it in — this module is
 * chain-5's alone to edit.
 *
 * Covers specs/content-reports "Reports are the only stored user content, kept in their own
 * store" and "Reports expire after a retention period" at the `ReportStore` layer (design D10).
 * Route-level admission/logging scenarios belong to chain-9's `routes-unary.suite.ts`.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { check, eq, section } from './harness';
import { within } from './route-doubles';
import { InMemoryReportStore, NodeSqliteReportStore, schedulePurge, type ReportStore } from '../src/reports/store';

const DEVICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function tmpDbPath(label: string): string {
  return path.join(os.tmpdir(), `whim-reports-test-${label}-${process.pid}-${Date.now()}.db`);
}

async function testExactStoredFields(store: ReportStore, label: string): Promise<void> {
  const reportId = await store.insert({
    deviceId: DEVICE_A,
    reason: 'harmful',
    note: 'rude jokes',
    prompt: 'a joke generator',
    now: Date.UTC(2026, 0, 15, 12, 0, 0, 0),
  });
  const row = await store.get(reportId);
  check(`${label}: row exists after insert`, row !== undefined);
  if (row) {
    eq(`${label}: row holds exactly what was sent, plus empty source/appName`, row, {
      reportId,
      receivedAt: Date.UTC(2026, 0, 15, 12, 0, 0, 0),
      deviceId: DEVICE_A,
      reason: 'harmful',
      note: 'rude jokes',
      prompt: 'a joke generator',
      appName: '',
      source: '',
    });
  }
}

async function testStoredFields(): Promise<void> {
  section('Report store — a stored report holds exactly what was sent (spec scenario)');
  await testExactStoredFields(new InMemoryReportStore(), 'in-memory');
  const dbPath = tmpDbPath('fields');
  try {
    const store = new NodeSqliteReportStore(dbPath);
    await testExactStoredFields(store, 'sqlite');
    store.close();
  } finally {
    fs.rmSync(dbPath, { force: true });
  }
}

async function testRetentionPurge(): Promise<void> {
  section('Report store — retention (spec "An expired report is purged" / "Retention is configurable")');

  // Default retention: a report received 91 days ago is purged; yesterday's survives.
  {
    const store = new InMemoryReportStore();
    const now = Date.UTC(2026, 0, 15, 12, 0, 0, 0);
    const ninetyOneDaysAgo = now - 91 * 86_400_000;
    const yesterday = now - 1 * 86_400_000;
    const oldId = await store.insert({ deviceId: DEVICE_A, reason: 'broken', now: ninetyOneDaysAgo });
    const recentId = await store.insert({ deviceId: DEVICE_A, reason: 'broken', now: yesterday });

    const deleted = await store.purgeOlderThan(now - 90 * 86_400_000);
    eq('exactly the 91-day-old report is purged', deleted, 1);
    check('the 91-day-old report is gone', (await store.get(oldId)) === undefined);
    check('yesterday\'s report remains', (await store.get(recentId)) !== undefined);
  }

  // A purge reclaims storage (secure_delete=ON): the sqlite implementation's file no longer
  // carries the purged report's marker text after the purge.
  {
    const dbPath = tmpDbPath('reclaim');
    const marker = 'MARKER_THAT_MUST_NOT_LINGER_AFTER_PURGE';
    try {
      const store = new NodeSqliteReportStore(dbPath);
      const now = Date.UTC(2026, 0, 15, 12, 0, 0, 0);
      await store.insert({ deviceId: DEVICE_A, reason: 'other', note: marker, now: now - 91 * 86_400_000 });
      await store.purgeOlderThan(now - 90 * 86_400_000);
      store.close();

      const bytes = fs.readFileSync(dbPath);
      check('secure_delete reclaims the purged row — marker does not linger in the file', !bytes.includes(marker));
    } finally {
      fs.rmSync(dbPath, { force: true });
    }
  }
}

/** A promise per completed `schedulePurge` tick, resolved in `onTick` — lets a test await a
 *  specific run deterministically instead of guessing how long a purge takes with a fixed sleep. */
function tickWaiter(): { onTick: () => void; next: () => Promise<void> } {
  let resolveNext: () => void = () => {};
  let waiting = new Promise<void>((resolve) => { resolveNext = resolve; });
  return {
    onTick: () => {
      resolveNext();
      waiting = new Promise((resolve) => { resolveNext = resolve; });
    },
    next: () => waiting,
  };
}

async function testSchedulePurge(): Promise<void> {
  section('Report store — purge scheduling hook (design D10: "runs at boot and hourly")');

  const store = new InMemoryReportStore();
  const now = Date.UTC(2026, 0, 15, 12, 0, 0, 0);
  const oldId = await store.insert({ deviceId: DEVICE_A, reason: 'broken', now: now - 200 * 86_400_000 });

  const ticks = tickWaiter();
  const bootTick = ticks.next();
  const schedule = schedulePurge(store, { retentionDays: 90, now: () => now, intervalMs: 10, onTick: ticks.onTick });
  // The immediate (boot) run fires an async purge before schedulePurge returns; wait for it to
  // settle (bounded — a suite-wide timeout catches a hang) rather than guessing at a sleep.
  await within(bootTick, 2000);
  check('the old report is purged on the immediate (boot) run', (await store.get(oldId)) === undefined);

  // A report that only turns stale AFTER the boot run is still caught by the next scheduled tick
  // — proving the interval actually re-runs, not just the immediate call.
  const laterId = await store.insert({ deviceId: DEVICE_A, reason: 'broken', now: now - 200 * 86_400_000 });
  await within(ticks.next(), 2000);
  schedule.stop();
  check('a later scheduled tick also purges stale rows', (await store.get(laterId)) === undefined);
}

async function testListAndGet(): Promise<void> {
  section('Report store — list ordering, since/limit bounds, and content-free sizing');

  const store = new InMemoryReportStore();
  const now = Date.UTC(2026, 0, 15, 12, 0, 0, 0);
  await store.insert({ deviceId: DEVICE_A, reason: 'broken', now: now - 10 * 86_400_000, source: 'xx' });
  await store.insert({ deviceId: DEVICE_A, reason: 'offensive', now: now - 1 * 86_400_000, prompt: 'abcdé' });
  await store.insert({ deviceId: DEVICE_A, reason: 'other', now });

  const all = await store.list({ now, limit: 50 });
  eq('list returns newest first', all.map((r) => r.reason), ['other', 'offensive', 'broken']);
  check('list never carries prompt/source text', !('prompt' in all[0]!) && !('source' in all[0]!));

  const sinceOneDay = await store.list({ now, sinceDays: 1 });
  eq('sinceDays bounds the window', sinceOneDay.map((r) => r.reason), ['other', 'offensive']);

  const limited = await store.list({ now, limit: 1 });
  eq('limit bounds the row count', limited.length, 1);

  // 'abcdé' is 5 code points but 6 UTF-8 bytes (é is 2 bytes) — promptBytes counts bytes.
  const withMultibyte = all.find((r) => r.reason === 'offensive');
  eq('promptBytes counts UTF-8 bytes, not characters', withMultibyte?.promptBytes, 6);
}

export async function runReportsTests(): Promise<void> {
  await testStoredFields();
  await testRetentionPurge();
  await testSchedulePurge();
  await testListAndGet();
}
