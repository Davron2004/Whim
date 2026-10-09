/**
 * `whim-admin migrate-waitlist [--apply]` on the SQLite backend (waitlist-hardening D5;
 * specs/beta-waitlist "Existing rows move to the opt-in model without loss"). The legacy rows are
 * written by the opt-out-model code's own schema and upsert (`waitlist-legacy-fixtures.ts`), never
 * by hand; the expected opt-in rows are the spec's mapping (ruling 1), spelled out here rather than
 * taken from the mapping function under test. The same scenario runs on the Firestore emulator in
 * `firestore-import.ts`.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { check, eq, section } from './harness';
import { LEGACY_ROWS, LEGACY_SIGNUPS, LEGACY_T0, createLegacySqliteSchema, legacySqliteUpsert } from './waitlist-legacy-fixtures';
import { runMigrateWaitlist, type MigrateConfig } from '../src/admin/migrate-waitlist';
import { NodeSqliteWaitlistStore, WRITTEN_REQUEST_NOTICE_ID, readWaitlistFile, waitlistFingerprint, type WaitlistRow } from '../src/waitlist/store';

const KEY = 'migrate-suite-fingerprint-key-0123456789';
const DAY_MS = 86_400_000;

/** Every address the fixture was written with, as submitted and as stored. */
const ADDRESSES = [...new Set([...LEGACY_SIGNUPS.map((signup) => signup.email.trim()), ...LEGACY_ROWS.map((row) => row.email)])];

/** The rows the spec says the five legacy people read as: no consent, and a ticked opt-out a
 *  withdrawal at the row's `updated_at`. */
const EXPECTED_ROWS: WaitlistRow[] = LEGACY_ROWS.map(({ optedOut, ...kept }) => ({
  ...kept,
  updatesOptIn: false,
  updatesConsentAt: null,
  updatesConsentNoticeId: null,
  updatesWithdrawnAt: optedOut ? kept.updatedAt : null,
}));

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whim-migrate-'));
}

/** `waitlist.db` in `dataDir`, written by the opt-out-model code (BASE's pragmas, schema and upsert). */
function writeLegacyWaitlist(dataDir: string): string {
  const file = path.join(dataDir, 'waitlist.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA secure_delete = ON');
  createLegacySqliteSchema(db);
  for (const signup of LEGACY_SIGNUPS) legacySqliteUpsert(db, signup);
  db.close();
  return file;
}

/** What the store holds in `dir`: the SHA-256 of every `.db` file, by name, and the bytes of every
 *  write-ahead log. A read-only connection to a WAL file can leave SQLite's shared-memory index and
 *  an empty log beside it; neither holds a row, so neither is compared. */
function fileHashes(dir: string): { db: Record<string, string>; walBytes: number } {
  const db: Record<string, string> = {};
  let walBytes = 0;
  for (const name of fs.readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
    if (name.endsWith('.db')) db[name] = createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
    if (name.endsWith('-wal')) walBytes += fs.statSync(path.join(dir, name)).size;
  }
  return { db, walBytes };
}

function config(dataDir: string): MigrateConfig {
  return { storeBackend: 'sqlite', firestoreDatabase: '(default)', dataDir, waitlistFingerprintKey: KEY };
}

function printOf(email: string): string {
  return waitlistFingerprint(KEY, email).slice(0, 12);
}

/** The output lines naming `outcome`, by fingerprint prefix. */
function linesOf(output: string, outcome: string): Map<string, string> {
  const lines = output.split('\n').filter((line) => line.startsWith(`${outcome} `));
  return new Map(lines.map((line) => [line.split(' ')[1]!, line]));
}

/** The line the command prints for `row` under `outcome`. */
function expectedLine(outcome: string, row: WaitlistRow): string {
  return `${outcome} ${printOf(row.email)} platform=${row.platform} noticeId=${row.noticeId} createdAt=${row.createdAt} updatedAt=${row.updatedAt} updatesOptIn=${row.updatesOptIn} updatesConsentAt=${row.updatesConsentAt} updatesConsentNoticeId=${row.updatesConsentNoticeId} updatesWithdrawnAt=${row.updatesWithdrawnAt}`;
}

function totalsOf(output: string): string | undefined {
  return output.split('\n').find((line) => line.startsWith('totals: '));
}

function printsNoAddress(output: string): boolean {
  const lower = output.toLowerCase();
  return ADDRESSES.every((address) => !lower.includes(address.toLowerCase()));
}

/** Every stored column of every row, straight from the file. */
function rawRows(file: string): Record<string, unknown>[] {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return (db.prepare('SELECT * FROM waitlist ORDER BY created_at').all() as unknown as Record<string, unknown>[]).map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

async function testDryRun(): Promise<void> {
  section('migrate-waitlist — a dry run plans every legacy row and writes nothing');
  const dataDir = tempDir();
  try {
    writeLegacyWaitlist(dataDir);
    const before = fileHashes(dataDir);
    const dry = await runMigrateWaitlist([], config(dataDir));
    eq('the dry run exits 0', dry.exitCode, 0);
    eq('  ... and leaves every file in the data directory byte-for-byte unchanged', fileHashes(dataDir), before);
    eq('  ... counting 5 planned migrations', totalsOf(dry.output), 'totals: 5 planned, 0 already migrated, 5 total');
    eq(
      '  ... printing each row\'s preserved fields and the consent the spec maps it to',
      [...linesOf(dry.output, 'planned').values()].sort((a, b) => a.localeCompare(b)),
      EXPECTED_ROWS.map((row) => expectedLine('planned', row)).sort((a, b) => a.localeCompare(b)),
    );
    check('  ... and no address', printsNoAddress(dry.output), dry.output);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function testApplyThenRerun(): Promise<void> {
  section('migrate-waitlist --apply — migrates every legacy row once, keeping every preserved field');
  const dataDir = tempDir();
  try {
    const file = writeLegacyWaitlist(dataDir);
    const legacyRaw = rawRows(file);

    const first = await runMigrateWaitlist(['--apply'], config(dataDir));
    eq('the first apply exits 0', first.exitCode, 0);
    eq('  ... migrating 5 rows', totalsOf(first.output), 'totals: 5 migrated, 0 already migrated, 5 total');
    check('  ... and reporting the verification read', first.output.includes('verified: 5 row(s) read back, none in the opt-out model, every earlier row unchanged'), first.output);
    eq('  ... printing every row it read back', [...linesOf(first.output, 'read-back').keys()].sort((a, b) => a.localeCompare(b)), EXPECTED_ROWS.map((row) => printOf(row.email)).sort((a, b) => a.localeCompare(b)));
    check('  ... and no address', printsNoAddress(first.output), first.output);
    eq('every row reads as the spec maps it', readWaitlistFile(file), EXPECTED_ROWS);
    const migratedRaw = rawRows(file);
    eq(
      'every row keeps email, platform, notice id and both timestamps byte for byte',
      migratedRaw.map(({ email, platform, notice_id, created_at, updated_at }) => ({ email, platform, notice_id, created_at, updated_at })),
      legacyRaw.map(({ email, platform, notice_id, created_at, updated_at }) => ({ email, platform, notice_id, created_at, updated_at })),
    );
    check('  ... and is stored in the opt-in model, not left to the read mapping', migratedRaw.every((row) => row.updates_opt_in === 0), JSON.stringify(migratedRaw));
    check('  ... with the rollback shadow saying "no updates" for every row', migratedRaw.every((row) => row.updates_opt_out === 1), JSON.stringify(migratedRaw));

    const migrated = fileHashes(dataDir);
    const second = await runMigrateWaitlist(['--apply'], config(dataDir));
    eq('a second apply exits 0', second.exitCode, 0);
    eq('  ... migrating none, with 5 already migrated', totalsOf(second.output), 'totals: 0 migrated, 5 already migrated, 5 total');
    check('  ... saying it wrote nothing', second.output.includes('nothing to migrate: every row is already in the opt-in model; nothing was written'), second.output);
    eq('  ... and writing nothing', fileHashes(dataDir), migrated);
    eq('  ... every row\'s line equal to the first run\'s but for the outcome', [...linesOf(second.output, 'already-migrated').values()].map((line) => line.replace(/^already-migrated /, '')).sort((a, b) => a.localeCompare(b)), [...linesOf(first.output, 'migrated').values()].map((line) => line.replace(/^migrated /, '')).sort((a, b) => a.localeCompare(b)));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function testAnswersAfterMigration(): Promise<void> {
  section('migrate-waitlist — answers given after the migration survive a rerun, and a legacy opt-out stays respected');
  const dataDir = tempDir();
  const now = LEGACY_T0 + DAY_MS;
  try {
    const file = writeLegacyWaitlist(dataDir);
    eq('setup: the apply migrates the five rows', totalsOf((await runMigrateWaitlist(['--apply'], config(dataDir))).output), 'totals: 5 migrated, 0 already migrated, 5 total');

    const store = new NodeSqliteWaitlistStore(file, { fingerprintKey: KEY });
    try {
      eq('a migrated legacy opt-out signs up with the news box ticked: updated', await store.upsert({ email: 'tick@example.com', platform: 'ios', updatesOptIn: true, noticeId: 'beta-2', now }), 'updated');
      eq('una writes in to ask for news', await store.setUpdates('una@example.com', true, now), true);
      eq(
        'only the written request gave news consent: neither the legacy rows nor the re-ticked opt-out have any',
        (await store.export({ updatesOk: true })).map((row) => [row.email, row.updatesConsentNoticeId]),
        [['una@example.com', WRITTEN_REQUEST_NOTICE_ID]],
      );
    } finally {
      await store.close();
    }
    const answered = readWaitlistFile(file);
    const tick = answered.find((row) => row.email === 'tick@example.com');
    eq('the re-ticked legacy opt-out keeps its withdrawal', [tick?.updatesOptIn, tick?.updatesWithdrawnAt], [false, LEGACY_ROWS[1].updatedAt]);

    const rerun = await runMigrateWaitlist(['--apply'], config(dataDir));
    eq('a rerun after those answers migrates nothing', totalsOf(rerun.output), 'totals: 0 migrated, 5 already migrated, 5 total');
    eq('  ... and leaves every row as the answers left it', readWaitlistFile(file), answered);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function testUnmigratedRow(): Promise<void> {
  section('migrate-waitlist — a row a rolled-back revision writes later is read by the mapping and migrated by a rerun');
  const dataDir = tempDir();
  try {
    const file = writeLegacyWaitlist(dataDir);
    await runMigrateWaitlist(['--apply'], config(dataDir));
    const late = { email: 'late-tick@example.com', platform: 'android' as const, updatesOptOut: true, noticeId: 'beta-1', now: LEGACY_T0 + DAY_MS };
    const rolledBack = new DatabaseSync(file);
    legacySqliteUpsert(rolledBack, late);
    rolledBack.close();
    const lateRow: WaitlistRow = { email: late.email, platform: late.platform, noticeId: late.noticeId, createdAt: late.now, updatedAt: late.now, updatesOptIn: false, updatesConsentAt: null, updatesConsentNoticeId: null, updatesWithdrawnAt: late.now };

    const before = fileHashes(dataDir);
    const dry = await runMigrateWaitlist([], config(dataDir));
    eq('a dry run plans the one unmigrated row beside 5 migrated ones', totalsOf(dry.output), 'totals: 1 planned, 5 already migrated, 6 total');
    eq('  ... planning its ticked opt-out as a withdrawal with no consent', linesOf(dry.output, 'planned').get(printOf(late.email)), expectedLine('planned', lateRow));
    eq('  ... writing nothing', fileHashes(dataDir), before);
    eq('the read-only reader maps it the same way', readWaitlistFile(file).find((row) => row.email === late.email), lateRow);

    const apply = await runMigrateWaitlist(['--apply'], config(dataDir));
    eq('an apply migrates just that row', totalsOf(apply.output), 'totals: 1 migrated, 5 already migrated, 6 total');
    eq('  ... verified', apply.exitCode, 0);
    const store = new NodeSqliteWaitlistStore(file, { fingerprintKey: KEY });
    try {
      check('the export with --updates-ok omits it', !(await store.export({ updatesOk: true })).some((row) => row.email === late.email));
    } finally {
      await store.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function testRefusals(): Promise<void> {
  section('migrate-waitlist — refusals write nothing');
  const empty = tempDir();
  try {
    const typo = await runMigrateWaitlist(['--aply'], config(empty));
    eq('an unknown flag exits 1 with the usage line', [typo.exitCode, typo.output], [1, 'Usage: migrate-waitlist [--apply]\n']);
    const missing = await runMigrateWaitlist(['--apply'], config(empty));
    eq('a data directory without waitlist.db exits 1', missing.exitCode, 1);
    eq('  ... creating no file', fs.readdirSync(empty), []);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }

  const dataDir = tempDir();
  try {
    const file = writeLegacyWaitlist(dataDir);
    // A platform outside the set the opt-out-model route accepted: a row no store wrote.
    const forged = new DatabaseSync(file);
    forged.prepare('UPDATE waitlist SET platform = ? WHERE email = ?').run('windows', 'last@example.com');
    forged.close();
    const before = fileHashes(dataDir);
    const apply = await runMigrateWaitlist(['--apply'], config(dataDir));
    eq('an apply over a row it cannot read exits 2', apply.exitCode, 2);
    check('  ... naming the row by fingerprint and the field', apply.output.includes(`unreadable ${printOf('last@example.com')} (platform)`), apply.output);
    eq('  ... and writes nothing, not even the readable rows', fileHashes(dataDir), before);
    check('  ... printing no address', printsNoAddress(apply.output), apply.output);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

export async function runMigrateWaitlistTests(): Promise<void> {
  await testDryRun();
  await testApplyThenRerun();
  await testAnswersAfterMigration();
  await testUnmigratedRow();
  await testRefusals();
}
