/**
 * The beta waitlist's store, flood brake and operator command (beta-waitlist tasks 1.3, 2.2, 3.1;
 * waitlist-hardening task 4.4; spec "One row per person", "Abuse limits", "Retention and operator
 * access", and the operator half of "News emails need express consent" and "Removed addresses stay
 * removed"). The store cases run
 * against both implementations; the command runs against a real `waitlist.db` in a temp data dir,
 * both through `waitlistMain` and as the `node server/waitlist.mjs` process an operator types.
 */
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { caught, check, eq, section } from './harness';
import {
  InMemoryWaitlistStore,
  NodeSqliteWaitlistStore,
  WAITLIST_RETENTION_DAYS,
  WRITTEN_REQUEST_NOTICE_ID,
  type WaitlistPlatform,
  type WaitlistStore,
} from '../src/waitlist/store';
import { createSignupLimiter } from '../src/waitlist/limiter';
import { runWaitlistCli, waitlistMain } from '../src/waitlist/cli';
import { DEV_WAITLIST_FINGERPRINT_KEY } from '../src/config';

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

async function eachStore(label: string, body: (subject: StoreUnderTest) => Promise<void>): Promise<void> {
  await body({ label: `${label} (in-memory)`, store: new InMemoryWaitlistStore() });
  const dir = tempDir(label);
  const store = new NodeSqliteWaitlistStore(path.join(dir, 'waitlist.db'), { fingerprintKey: FINGERPRINT_KEY });
  try {
    await body({ label: `${label} (sqlite)`, store });
  } finally {
    await store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A test key for the SQLite stores' removal fingerprints. */
const FINGERPRINT_KEY = 'waitlist-suite-fingerprint-key-0123456789';

/** A signup with the news box ticked, or not (`withoutNews`). */
function signup(email: string, platform: WaitlistPlatform, now: number, withoutNews = false): Parameters<WaitlistStore['upsert']>[0] {
  return { email, platform, updatesOptIn: !withoutNews, noticeId: 'beta-1', now };
}

async function storeTests(): Promise<void> {
  section('Waitlist store: one row per person, normalized');

  await eachStore('round trip', async ({ label, store }) => {
    eq(`${label}: a first signup is stored`, await store.upsert(signup('  Person@Example.COM ', 'android', T0)), 'stored');
    eq(`${label}: it reads back normalized, with every column`, await store.export(), [
      { email: 'person@example.com', platform: 'android', updatesOptIn: true, updatesConsentAt: T0, updatesConsentNoticeId: 'beta-1', updatesWithdrawnAt: null, noticeId: 'beta-1', createdAt: T0, updatedAt: T0 },
    ]);
  });

  await eachStore('repeat signup', async ({ label, store }) => {
    await store.upsert(signup('A@Example.com ', 'ios', T0));
    const later = T0 + 3 * DAY_MS;
    eq(`${label}: the same person in another casing updates`, await store.upsert({ ...signup('a@example.com', 'android', later, true), noticeId: 'beta-2' }), 'updated');
    eq(`${label}: one row, the new answers and notice, the first signup's created_at`, await store.export(), [
      { email: 'a@example.com', platform: 'android', updatesOptIn: false, updatesConsentAt: T0, updatesConsentNoticeId: 'beta-1', updatesWithdrawnAt: later, noticeId: 'beta-2', createdAt: T0, updatedAt: later },
    ]);
  });

  section('Waitlist store: export filters');

  await eachStore('filters', async ({ label, store }) => {
    await store.upsert(signup('ios-ok@example.com', 'ios', T0));
    await store.upsert(signup('android-ok@example.com', 'android', T0 + 1));
    await store.upsert(signup('android-out@example.com', 'android', T0 + 2, true));
    await store.upsert(signup('other-out@example.com', 'other', T0 + 3, true));
    const emails = async (filter?: Parameters<WaitlistStore['export']>[0]): Promise<string[]> => (await store.export(filter)).map((row) => row.email);
    eq(`${label}: no filter lists everyone, oldest signup first`, await emails(), [
      'ios-ok@example.com',
      'android-ok@example.com',
      'android-out@example.com',
      'other-out@example.com',
    ]);
    eq(`${label}: --platform android lists exactly the Android rows`, await emails({ platform: 'android' }), ['android-ok@example.com', 'android-out@example.com']);
    eq(`${label}: updates-ok drops everyone who opted out`, await emails({ updatesOk: true }), ['ios-ok@example.com', 'android-ok@example.com']);
    eq(`${label}: both filters together`, await emails({ platform: 'android', updatesOk: true }), ['android-ok@example.com']);
  });

  section('Waitlist store: removal in any casing');

  await eachStore('removal', async ({ label, store }) => {
    await store.upsert(signup('leave@example.com', 'ios', T0));
    await store.upsert(signup('stay@example.com', 'ios', T0));
    check(`${label}: removing in another casing finds the row`, await store.remove('  LEAVE@Example.com', T0));
    eq(`${label}: a later export omits it and keeps the rest`, (await store.export()).map((row) => row.email), ['stay@example.com']);
    check(`${label}: removing again finds nothing`, !(await store.remove('leave@example.com', T0)));
  });

  section(`Waitlist store: rows go ${WAITLIST_RETENTION_DAYS} days after updated_at`);

  await eachStore('purge', async ({ label, store }) => {
    const now = T0 + 1000 * DAY_MS;
    const cutoff = now - WAITLIST_RETENTION_DAYS * DAY_MS;
    await store.upsert(signup('at-cutoff@example.com', 'ios', cutoff));
    await store.upsert(signup('past-cutoff@example.com', 'ios', cutoff - 1));
    // Signed up long before the cutoff, answered again after it: updated_at, not created_at, counts.
    await store.upsert(signup('renewed@example.com', 'android', cutoff - 200 * DAY_MS));
    await store.upsert(signup('renewed@example.com', 'android', cutoff + DAY_MS));
    eq(`${label}: the purge deletes exactly the row older than the cutoff`, await store.purge(now), { rows: 1, fingerprints: 0 });
    eq(`${label}: the row at the cutoff and the renewed row remain`, (await store.export()).map((row) => row.email).sort((a, b) => a.localeCompare(b)), [
      'at-cutoff@example.com',
      'renewed@example.com',
    ]);
  });

  section('Waitlist store: its own file, durable');

  const dir = tempDir('durable');
  try {
    const file = path.join(dir, 'waitlist.db');
    const first = new NodeSqliteWaitlistStore(file, { fingerprintKey: FINGERPRINT_KEY });
    await first.upsert(signup('kept@example.com', 'other', T0, true));
    await first.close();
    const reopened = new NodeSqliteWaitlistStore(file, { fingerprintKey: FINGERPRINT_KEY });
    eq('a row survives closing and reopening the file', (await reopened.export()).map((row) => [row.email, row.updatesOptIn]), [['kept@example.com', false]]);
    await reopened.close();
    const raw = new DatabaseSync(file);
    eq('the file is in WAL mode', (raw.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
    raw.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  section('Waitlist store: a failing operation rejects, never throws');

  const failDir = tempDir('rejects');
  try {
    const closed = new NodeSqliteWaitlistStore(path.join(failDir, 'waitlist.db'), { fingerprintKey: FINGERPRINT_KEY });
    await closed.close();
    let pending: Promise<unknown> | undefined;
    const syncThrow = await caught(() => {
      pending = closed.upsert(signup('late@example.com', 'ios', T0));
    });
    eq('upsert on a closed SQLite store does not throw synchronously', syncThrow, undefined);
    check('it returns a promise', pending instanceof Promise);
    check('that promise rejects', (await caught(() => pending as Promise<unknown> as Promise<void>)) !== undefined);
  } finally {
    fs.rmSync(failDir, { recursive: true, force: true });
  }

  const memory = new InMemoryWaitlistStore();
  await memory.upsert(signup('row@example.com', 'ios', T0));
  for (const [label, run] of [
    ['purge with a BigInt clock', () => memory.purge(1n as never)],
    ['export with a null filter', () => memory.export(null as never)],
  ] as const) {
    let pending: Promise<unknown> | undefined;
    const syncThrow = await caught(() => {
      pending = run();
    });
    eq(`in-memory ${label} does not throw synchronously`, syncThrow, undefined);
    check(`in-memory ${label} returns a rejected promise`, (await caught(() => pending as Promise<unknown> as Promise<void>)) !== undefined);
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

/** The cells of one CSV line, unquoted as a spreadsheet reads them. */
function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted && char === '"' && line[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function firstCell(line: string): string {
  return csvCells(line)[0] ?? '';
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

async function exportedEmails(store: WaitlistStore, ...options: string[]): Promise<string[]> {
  return csvRows((await runWaitlistCli(['export', ...options], store)).stdout).slice(1).map(firstCell);
}

async function exportCommandTests(): Promise<void> {
  section('Waitlist command: export');

  const store = new InMemoryWaitlistStore();
  await store.upsert(signup('droid@example.com', 'android', T0));
  await store.upsert(signup('apple@example.com', 'ios', T0 + 1));
  await store.upsert(signup('quiet-droid@example.com', 'android', T0 + 2, true));

  const android = await runWaitlistCli(['export', '--platform', 'android'], store);
  eq('export --platform android exits 0', android.exitCode, 0);
  eq('  ... printing the spec\'s header and exactly the Android rows, consent time empty when there is none', csvRows(android.stdout), [
    'email,platform,updates_opt_in,updates_consent_at,notice_id,created_at,updated_at',
    `droid@example.com,android,true,${iso(T0)},beta-1,${iso(T0)},${iso(T0)}`,
    `quiet-droid@example.com,android,false,,beta-1,${iso(T0 + 2)},${iso(T0 + 2)}`,
  ]);
  eq('export --updates-ok lists exactly the rows with news consent', await exportedEmails(store, '--updates-ok'), ['droid@example.com', 'apple@example.com']);

  section('Waitlist command: a withdrawal is sticky, and only `updates on` restores consent');

  await store.upsert(signup('changed-mind@example.com', 'ios', T0 + 3));
  await store.upsert(signup('changed-mind@example.com', 'ios', T0 + 4, true));
  check('a re-signup with the box unticked drops out of --updates-ok', !(await exportedEmails(store, '--updates-ok')).includes('changed-mind@example.com'));
  await store.upsert(signup('changed-mind@example.com', 'ios', T0 + 5));
  check('  ... and a later ticked re-signup does not bring it back', !(await exportedEmails(store, '--updates-ok')).includes('changed-mind@example.com'));
  const on = await runWaitlistCli(['updates', 'Changed-Mind@Example.com', 'on'], store, () => T0 + 6);
  eq('updates <email> on exits 0, saying so', [on.exitCode, on.stdout], [0, 'news consent on for changed-mind@example.com\n']);
  const restored = (await store.export()).find((row) => row.email === 'changed-mind@example.com');
  eq('  ... recording consent now under written-request, the withdrawal cleared', [restored?.updatesOptIn, restored?.updatesConsentAt, restored?.updatesConsentNoticeId, restored?.updatesWithdrawnAt], [
    true,
    T0 + 6,
    WRITTEN_REQUEST_NOTICE_ID,
    null,
  ]);
  check('  ... so --updates-ok lists it again', (await exportedEmails(store, '--updates-ok')).includes('changed-mind@example.com'));
  const off = await runWaitlistCli(['updates', 'droid@example.com', 'off'], store, () => T0 + 7);
  eq('updates <email> off exits 0', off.exitCode, 0);
  check('  ... and --updates-ok no longer lists it', !(await exportedEmails(store, '--updates-ok')).includes('droid@example.com'));
  const nobody = await runWaitlistCli(['updates', 'nobody@example.com', 'on'], store);
  check('updates for an address not on the list exits 1, saying so on stderr', nobody.exitCode === 1 && nobody.stderr.includes('not on the list'), JSON.stringify(nobody));

  section('Waitlist command: no cell reaches a spreadsheet as a formula');

  // [what, email, notice id, the column holding the formula, its value]
  const formulaRows: ReadonlyArray<readonly [string, string, string, number, string]> = [
    ...['=', '+', '-', '@', '|', '%'].map((lead): readonly [string, string, string, number, string] => {
      const email = `${lead}hyperlink(1)@example.com`;
      return [`an email starting with ${lead}`, email, 'beta-1', 0, email];
    }),
    ['a notice id starting with a tab', 'tab@example.com', '\t=1+1', 4, '\t=1+1'],
    ['a notice id starting with a carriage return', 'cr@example.com', '\r=1+1', 4, '\r=1+1'],
  ];
  for (const [what, email, noticeId, column, value] of formulaRows) {
    const direct = new InMemoryWaitlistStore();
    await direct.upsert({ ...signup(email, 'ios', T0), noticeId });
    const [, line = ''] = csvRows((await runWaitlistCli(['export'], direct)).stdout);
    eq(`${what}, written straight to the store: the exported cell is that value behind a leading '`, csvCells(line)[column], `'${value}`);
  }
}

async function removalCommandTests(): Promise<void> {
  section('Waitlist command: remove keeps the fingerprint; restore lifts it');

  const store = new InMemoryWaitlistStore();
  await store.upsert(signup('apple@example.com', 'ios', T0));
  await store.upsert(signup('stay@example.com', 'ios', T0 + 1));

  const removed = await runWaitlistCli(['remove', 'Apple@EXAMPLE.com'], store, () => T0 + 2);
  eq('remove in another casing exits 0, saying the row was removed and the fingerprint kept', [removed.exitCode, removed.stdout], [
    0,
    'removed apple@example.com; its fingerprint is kept, so it cannot sign up again\n',
  ]);
  eq('  ... a later export omits that person', await exportedEmails(store), ['stay@example.com']);
  eq('  ... and a later signup of that address stores nothing', [await store.upsert(signup('APPLE@example.com', 'android', T0 + 3)), await exportedEmails(store)], ['suppressed', ['stay@example.com']]);

  const before = await runWaitlistCli(['remove', 'never@example.com'], store, () => T0 + 4);
  eq('removing an address not on the list exits 0, saying no row existed', [before.exitCode, before.stdout], [
    0,
    'never@example.com was not on the list; its fingerprint is kept, so it cannot sign up again\n',
  ]);
  eq('  ... and that address can no longer sign up', await store.upsert(signup('never@example.com', 'ios', T0 + 5)), 'suppressed');

  const restore = await runWaitlistCli(['restore', 'Apple@Example.com'], store);
  eq('restore exits 0, saying the address can sign up again', [restore.exitCode, restore.stdout], [0, 'restored apple@example.com: it can sign up again\n']);
  eq('  ... and a later signup is stored', await store.upsert(signup('apple@example.com', 'ios', T0 + 6)), 'stored');
  const again = await runWaitlistCli(['restore', 'apple@example.com'], store);
  check('restoring an address with no fingerprint exits 1, saying so on stderr', again.exitCode === 1 && again.stderr.includes('no removal fingerprint'), JSON.stringify(again));

  for (const argv of [
    [],
    ['list'],
    ['export', '--platform', 'windows'],
    ['export', '--platform'],
    ['export', '--all'],
    ['remove'],
    ['remove', 'a@example.com', 'b@example.com'],
    ['updates', 'a@example.com'],
    ['updates', 'a@example.com', 'yes'],
    ['updates', 'a@example.com', 'on', 'extra'],
    ['restore'],
    ['restore', 'a@example.com', 'b@example.com'],
  ]) {
    const result = await runWaitlistCli(argv, store);
    check(`${JSON.stringify(argv)} is a usage error: exit 2, usage on stderr, nothing on stdout`, result.exitCode === 2 && result.stderr.includes('usage:') && result.stdout === '', JSON.stringify(result));
  }
}

async function processCommandTests(): Promise<void> {
  section('Waitlist command: against waitlist.db in WHIM_DATA_DIR');

  const dir = tempDir('cli');
  try {
    const file = path.join(dir, 'waitlist.db');
    const seeded = new NodeSqliteWaitlistStore(file, { fingerprintKey: FINGERPRINT_KEY });
    await seeded.upsert(signup('droid@example.com', 'android', T0));
    await seeded.upsert(signup('apple@example.com', 'ios', T0 + 1));
    await seeded.close();
    const env = { WHIM_DATA_DIR: dir, WHIM_WAITLIST_FINGERPRINT_KEY: '', WHIM_STORE_BACKEND: 'sqlite' };

    eq('waitlistMain exports the Android rows from the file', csvRows((await waitlistMain(['export', '--platform', 'android'], env)).stdout).slice(1).map(firstCell), ['droid@example.com']);

    const runner = path.join(process.cwd(), 'server', 'waitlist.mjs');
    const run = (args: readonly string[], extraEnv: Readonly<Record<string, string>> = {}) =>
      spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...env, ...extraEnv } });
    const exported = run(['export']);
    eq('node server/waitlist.mjs export exits 0', exported.status, 0);
    eq('  ... listing both rows', csvRows(exported.stdout).slice(1).map(firstCell), ['droid@example.com', 'apple@example.com']);
    const removedByProcess = run(['remove', 'DROID@example.com']);
    eq('node server/waitlist.mjs remove exits 0', removedByProcess.status, 0);
    eq('  ... and the file no longer holds that person', csvRows(run(['export']).stdout).slice(1).map(firstCell), ['apple@example.com']);
    const reopened = new NodeSqliteWaitlistStore(file, { fingerprintKey: DEV_WAITLIST_FINGERPRINT_KEY });
    try {
      eq('  ... and keeps its fingerprint in the file: a signup under the same key is suppressed', await reopened.upsert(signup('droid@example.com', 'android', T0 + 2)), 'suppressed');
    } finally {
      await reopened.close();
    }
    eq('node server/waitlist.mjs restore exits 0', run(['restore', 'droid@example.com']).status, 0);
    const afterRestore = new NodeSqliteWaitlistStore(file, { fingerprintKey: DEV_WAITLIST_FINGERPRINT_KEY });
    try {
      eq('  ... and the address can sign up again', await afterRestore.upsert(signup('droid@example.com', 'android', T0 + 3)), 'stored');
    } finally {
      await afterRestore.close();
    }
    eq('a usage error from the process exits 2', run(['purge']).status, 2);

    section('Waitlist command: on the firestore backend, refuses clearly without the fingerprint key');

    const unkeyed = await waitlistMain(['export'], { ...env, WHIM_STORE_BACKEND: 'firestore' });
    check('waitlistMain exits 1 naming WHIM_WAITLIST_FINGERPRINT_KEY, printing nothing on stdout', unkeyed.exitCode === 1 && unkeyed.stderr.includes('WHIM_WAITLIST_FINGERPRINT_KEY') && unkeyed.stdout === '', JSON.stringify(unkeyed));
    const shortKey = 'short-waitlist-secret';
    const short = await waitlistMain(['export'], { ...env, WHIM_STORE_BACKEND: 'firestore', WHIM_WAITLIST_FINGERPRINT_KEY: shortKey });
    check('a too-short key exits 1 naming the variable, never echoing the value', short.exitCode === 1 && short.stderr.includes('WHIM_WAITLIST_FINGERPRINT_KEY') && !short.stderr.includes(shortKey), JSON.stringify(short));
    const refused = run(['remove', 'apple@example.com'], { WHIM_STORE_BACKEND: 'firestore' });
    check('node server/waitlist.mjs exits 1 with one line naming the variable, no stack trace', refused.status === 1 && refused.stderr.includes('WHIM_WAITLIST_FINGERPRINT_KEY') && !refused.stderr.includes('    at '), JSON.stringify({ status: refused.status, stderr: refused.stderr }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function commandTests(): Promise<void> {
  await exportCommandTests();
  await removalCommandTests();
  await processCommandTests();
}

export async function runWaitlistTests(): Promise<void> {
  await storeTests();
  limiterTests();
  await commandTests();
}
