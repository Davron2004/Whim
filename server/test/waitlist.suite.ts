/**
 * The beta waitlist's store, flood brake and operator command (beta-waitlist tasks 1.3, 2.2, 3.1;
 * spec "One row per person", "Abuse limits", "Retention and operator access"). The store cases run
 * against both implementations; the command runs against a real `waitlist.db` in a temp data dir,
 * both through `waitlistMain` and as the `node server/waitlist.mjs` process an operator types.
 */
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check, eq, section } from './harness';
import {
  InMemoryWaitlistStore,
  NodeSqliteWaitlistStore,
  WAITLIST_RETENTION_DAYS,
  type WaitlistPlatform,
  type WaitlistStore,
} from '../src/waitlist/store';
import { createSignupLimiter } from '../src/waitlist/limiter';
import { runWaitlistCli, waitlistMain } from '../src/waitlist/cli';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
const T0 = Date.UTC(2026, 8, 24, 18, 0, 0);

function tempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `whim-waitlist-${label}-`));
}

interface StoreUnderTest {
  readonly label: string;
  readonly store: WaitlistStore;
}

function eachStore(label: string, body: (subject: StoreUnderTest) => void): void {
  body({ label: `${label} (in-memory)`, store: new InMemoryWaitlistStore() });
  const dir = tempDir(label);
  const store = new NodeSqliteWaitlistStore(path.join(dir, 'waitlist.db'));
  try {
    body({ label: `${label} (sqlite)`, store });
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function signup(email: string, platform: WaitlistPlatform, now: number, updatesOptOut = false): Parameters<WaitlistStore['upsert']>[0] {
  return { email, platform, updatesOptOut, noticeId: 'beta-1', now };
}

function storeTests(): void {
  section('Waitlist store: one row per person, normalized');

  eachStore('round trip', ({ label, store }) => {
    eq(`${label}: a first signup is stored`, store.upsert(signup('  Person@Example.COM ', 'android', T0)), 'stored');
    eq(`${label}: it reads back normalized, with every column`, store.export(), [
      { email: 'person@example.com', platform: 'android', updatesOptOut: false, noticeId: 'beta-1', createdAt: T0, updatedAt: T0 },
    ]);
  });

  eachStore('repeat signup', ({ label, store }) => {
    store.upsert(signup('A@Example.com ', 'ios', T0));
    const later = T0 + 3 * DAY_MS;
    eq(`${label}: the same person in another casing updates`, store.upsert({ ...signup('a@example.com', 'android', later, true), noticeId: 'beta-2' }), 'updated');
    eq(`${label}: one row, the new answers and notice, the first signup's created_at`, store.export(), [
      { email: 'a@example.com', platform: 'android', updatesOptOut: true, noticeId: 'beta-2', createdAt: T0, updatedAt: later },
    ]);
  });

  section('Waitlist store: export filters');

  eachStore('filters', ({ label, store }) => {
    store.upsert(signup('ios-ok@example.com', 'ios', T0));
    store.upsert(signup('android-ok@example.com', 'android', T0 + 1));
    store.upsert(signup('android-out@example.com', 'android', T0 + 2, true));
    store.upsert(signup('other-out@example.com', 'other', T0 + 3, true));
    const emails = (filter?: Parameters<WaitlistStore['export']>[0]): string[] => store.export(filter).map((row) => row.email);
    eq(`${label}: no filter lists everyone, oldest signup first`, emails(), [
      'ios-ok@example.com',
      'android-ok@example.com',
      'android-out@example.com',
      'other-out@example.com',
    ]);
    eq(`${label}: --platform android lists exactly the Android rows`, emails({ platform: 'android' }), ['android-ok@example.com', 'android-out@example.com']);
    eq(`${label}: updates-ok drops everyone who opted out`, emails({ updatesOk: true }), ['ios-ok@example.com', 'android-ok@example.com']);
    eq(`${label}: both filters together`, emails({ platform: 'android', updatesOk: true }), ['android-ok@example.com']);
  });

  section('Waitlist store: removal in any casing');

  eachStore('removal', ({ label, store }) => {
    store.upsert(signup('leave@example.com', 'ios', T0));
    store.upsert(signup('stay@example.com', 'ios', T0));
    check(`${label}: removing in another casing finds the row`, store.remove('  LEAVE@Example.com'));
    eq(`${label}: a later export omits it and keeps the rest`, store.export().map((row) => row.email), ['stay@example.com']);
    check(`${label}: removing again finds nothing`, !store.remove('leave@example.com'));
  });

  section(`Waitlist store: rows go ${WAITLIST_RETENTION_DAYS} days after updated_at`);

  eachStore('purge', ({ label, store }) => {
    const now = T0 + 1000 * DAY_MS;
    const cutoff = now - WAITLIST_RETENTION_DAYS * DAY_MS;
    store.upsert(signup('at-cutoff@example.com', 'ios', cutoff));
    store.upsert(signup('past-cutoff@example.com', 'ios', cutoff - 1));
    // Signed up long before the cutoff, answered again after it: updated_at, not created_at, counts.
    store.upsert(signup('renewed@example.com', 'android', cutoff - 200 * DAY_MS));
    store.upsert(signup('renewed@example.com', 'android', cutoff + DAY_MS));
    eq(`${label}: the purge deletes exactly the row older than the cutoff`, store.purge(now), 1);
    eq(`${label}: the row at the cutoff and the renewed row remain`, store.export().map((row) => row.email).sort((a, b) => a.localeCompare(b)), [
      'at-cutoff@example.com',
      'renewed@example.com',
    ]);
  });

  section('Waitlist store: its own file, durable');

  const dir = tempDir('durable');
  try {
    const file = path.join(dir, 'waitlist.db');
    const first = new NodeSqliteWaitlistStore(file);
    first.upsert(signup('kept@example.com', 'other', T0, true));
    first.close();
    const reopened = new NodeSqliteWaitlistStore(file);
    eq('a row survives closing and reopening the file', reopened.export().map((row) => [row.email, row.updatesOptOut]), [['kept@example.com', true]]);
    reopened.close();
    const raw = new DatabaseSync(file);
    eq('the file is in WAL mode', (raw.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
    raw.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function limiterTests(): void {
  section('Signup limiter: a sliding hour per client, a UTC-day cap for everyone');

  {
    const limiter = createSignupLimiter({ perClientHour: 3, perDay: 100 });
    const a = '203.0.113.9';
    const admitted = [0, 30, 40].map((minute) => limiter.admit(a, T0 + minute * MINUTE_MS));
    eq('three signups inside the hour are admitted', admitted, [true, true, true]);
    check('a fourth inside the hour is refused', !limiter.admit(a, T0 + 50 * MINUTE_MS));
    check('another client address is still admitted', limiter.admit('198.51.100.4', T0 + 50 * MINUTE_MS));
    // Sliding, not a clock-hour bucket: at 61 minutes only the first signup has aged out.
    check('once the first signup is an hour old, one more is admitted', limiter.admit(a, T0 + 61 * MINUTE_MS));
    check('  ... and the next is refused again, the 30- and 40-minute ones still counting', !limiter.admit(a, T0 + 62 * MINUTE_MS));
  }

  {
    const limiter = createSignupLimiter({ perClientHour: 1, perDay: 2 });
    limiter.admit('a', T0);
    const refusals = [1, 2, 3].map((i) => limiter.admit('a', T0 + i));
    eq('a client over its hour is refused each time', refusals, [false, false, false]);
    check('  ... and those refusals never counted toward the day: a second client still fits under a cap of 2', limiter.admit('b', T0 + 4));
  }

  {
    const limiter = createSignupLimiter({ perClientHour: 10, perDay: 2 });
    check('the global cap admits up to its count across clients', limiter.admit('a', T0) && limiter.admit('b', T0));
    check('  ... then refuses a new client that same UTC day', !limiter.admit('c', T0 + HOUR_MS));
    const nextDay = Math.ceil(T0 / DAY_MS) * DAY_MS;
    check('  ... and admits again from the next UTC midnight', limiter.admit('c', nextDay));
  }

  {
    const limiter = createSignupLimiter({ perClientHour: 1, perDay: 100 });
    check('a request with no forwarded address is admitted once', limiter.admit(undefined, T0));
    check('  ... and every address-less request shares that one key', !limiter.admit(undefined, T0 + 1));
  }
}

function csvRows(stdout: string): string[] {
  return stdout.trimEnd().split('\n');
}

function commandTests(): void {
  section('Waitlist command: export and remove');

  const store = new InMemoryWaitlistStore();
  store.upsert(signup('droid@example.com', 'android', T0));
  store.upsert(signup('apple@example.com', 'ios', T0 + 1));
  store.upsert(signup('quiet-droid@example.com', 'android', T0 + 2, true));

  const android = runWaitlistCli(['export', '--platform', 'android'], store);
  eq('export --platform android exits 0', android.exitCode, 0);
  eq('  ... printing a header and exactly the Android rows', csvRows(android.stdout), [
    'email,platform,updates_opt_out,created_at,updated_at',
    `droid@example.com,android,false,${new Date(T0).toISOString()},${new Date(T0).toISOString()}`,
    `quiet-droid@example.com,android,true,${new Date(T0 + 2).toISOString()},${new Date(T0 + 2).toISOString()}`,
  ]);
  eq('export --updates-ok leaves out whoever opted out', csvRows(runWaitlistCli(['export', '--updates-ok'], store).stdout).slice(1).map((line) => line.split(',')[0]), [
    'droid@example.com',
    'apple@example.com',
  ]);

  const removed = runWaitlistCli(['remove', 'Apple@EXAMPLE.com'], store);
  eq('remove in another casing exits 0', removed.exitCode, 0);
  check('  ... and a later export omits that person', !runWaitlistCli(['export'], store).stdout.includes('apple@example.com'));
  const missing = runWaitlistCli(['remove', 'apple@example.com'], store);
  check('removing someone not on the list exits 1, saying so on stderr', missing.exitCode === 1 && missing.stderr.includes('not on the list'), missing.stderr);

  for (const argv of [[], ['list'], ['export', '--platform', 'windows'], ['export', '--platform'], ['export', '--all'], ['remove'], ['remove', 'a@example.com', 'b@example.com']]) {
    const result = runWaitlistCli(argv, store);
    check(`${JSON.stringify(argv)} is a usage error: exit 2, usage on stderr, nothing on stdout`, result.exitCode === 2 && result.stderr.includes('usage:') && result.stdout === '', JSON.stringify(result));
  }

  section('Waitlist command: against waitlist.db in WHIM_DATA_DIR');

  const dir = tempDir('cli');
  try {
    const seeded = new NodeSqliteWaitlistStore(path.join(dir, 'waitlist.db'));
    seeded.upsert(signup('droid@example.com', 'android', T0));
    seeded.upsert(signup('apple@example.com', 'ios', T0 + 1));
    seeded.close();
    const env = { WHIM_DATA_DIR: dir };

    eq('waitlistMain exports the Android rows from the file', csvRows(waitlistMain(['export', '--platform', 'android'], env).stdout).slice(1).map((line) => line.split(',')[0]), ['droid@example.com']);

    const runner = path.join(process.cwd(), 'server', 'waitlist.mjs');
    const run = (args: readonly string[]) => spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...env } });
    const exported = run(['export']);
    eq('node server/waitlist.mjs export exits 0', exported.status, 0);
    eq('  ... listing both rows', csvRows(exported.stdout).slice(1).map((line) => line.split(',')[0]), ['droid@example.com', 'apple@example.com']);
    const removedByProcess = run(['remove', 'DROID@example.com']);
    eq('node server/waitlist.mjs remove exits 0', removedByProcess.status, 0);
    eq('  ... and the file no longer holds that person', csvRows(run(['export']).stdout).slice(1).map((line) => line.split(',')[0]), ['apple@example.com']);
    eq('a usage error from the process exits 2', run(['purge']).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runWaitlistTests(): void {
  storeTests();
  limiterTests();
  commandTests();
}
