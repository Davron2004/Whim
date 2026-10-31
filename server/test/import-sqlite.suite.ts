/**
 * `whim-admin import-sqlite` without a database (durable-server-stores D7): the refusals that come
 * before any Firestore client is opened, and the read-only readers of the three SQLite files. The
 * copy itself runs against the Firestore emulator in `firestore-import.ts`.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Firestore } from '@google-cloud/firestore';
import { caught, check, eq, section } from './harness';
import { DEVICE_A, DEVICE_UNSAFE, IMPORT_T0, writeSqliteFixture, writeUsageFixture } from './sqlite-import-fixtures';
import { LEGACY_ROWS, LEGACY_SIGNUPS, LEGACY_T0, createLegacySqliteSchema, legacySqliteUpsert } from './waitlist-legacy-fixtures';
import { readWaitlistFingerprints, runImportSqlite, type ImportConfig, type ImportDeps } from '../src/admin/import-sqlite';
import { readReportsFile } from '../src/reports/store';
import { readUsageFile } from '../src/usage-store';
import { NodeSqliteWaitlistStore, readWaitlistFile, waitlistFingerprint } from '../src/waitlist/store';

function tempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `whim-import-${label}-`));
}

/** SHA-256 of every `.db` file in `dir`, by name. */
function dbHashes(dir: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.db')).sort((a, b) => a.localeCompare(b))) {
    hashes[name] = createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
  }
  return hashes;
}

/** A target opener that records that it was asked for a client, and never hands one out. */
function unopenedTarget(): { deps: ImportDeps; opened: () => boolean } {
  let opened = false;
  return {
    deps: {
      openFirestore: (): Promise<Firestore> => {
        opened = true;
        return Promise.reject(new Error('the import opened a Firestore client'));
      },
    },
    opened: () => opened,
  };
}

const FIRESTORE_CONFIG: ImportConfig = { storeBackend: 'firestore', firestoreDatabase: '(default)', now: () => IMPORT_T0, ledgerRetentionDays: 90 };

async function testRefusals(): Promise<void> {
  section('import-sqlite — refusals before any write');
  const dataDir = tempDir('refuse');
  try {
    await writeSqliteFixture(dataDir);

    const onSqlite = unopenedTarget();
    const refused = await runImportSqlite(['--data-dir', dataDir], { ...FIRESTORE_CONFIG, storeBackend: 'sqlite' }, onSqlite.deps);
    eq('a sqlite-configured import exits 1', refused.exitCode, 1);
    check('  ... naming the backend it needs', refused.output.includes('WHIM_STORE_BACKEND=firestore'), refused.output);
    check('  ... without opening Firestore', !onSqlite.opened());

    const noDir = unopenedTarget();
    const usage = await runImportSqlite([], FIRESTORE_CONFIG, noDir.deps);
    check('an import without --data-dir exits 1 with its usage line', usage.exitCode === 1 && usage.output.includes('import-sqlite --data-dir <dir>'), usage.output);

    const empty = tempDir('empty');
    const emptyTarget = unopenedTarget();
    try {
      const none = await runImportSqlite(['--data-dir', empty], FIRESTORE_CONFIG, emptyTarget.deps);
      check('a directory with none of the three files exits 1, naming them', none.exitCode === 1 && none.output.includes('usage.db, reports.db, waitlist.db'), none.output);
      check('  ... without opening Firestore', !noDir.opened() && !emptyTarget.opened());
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function testReadersAreReadOnly(): Promise<void> {
  section('import-sqlite — the SQLite files are read as their stores wrote them, and never written');
  const dataDir = tempDir('read');
  try {
    const views = await writeSqliteFixture(dataDir);
    const before = dbHashes(dataDir);
    const usage = readUsageFile(path.join(dataDir, 'usage.db'));
    const reports = readReportsFile(path.join(dataDir, 'reports.db'));
    const waitlist = readWaitlistFile(path.join(dataDir, 'waitlist.db'));

    eq('the waitlist reads back as the store exports it', waitlist, views.waitlist);
    eq('every report reads back as the store lists it by device', reports, [...views.reportsByDevice[DEVICE_A]!, ...views.reportsByDevice[DEVICE_UNSAFE]!]);
    const devices = [DEVICE_A, DEVICE_UNSAFE];
    eq(
      'every ledger row reads back as the store exports it by device',
      devices.flatMap((device) => usage.ledger.filter((row) => row.deviceId === device)),
      devices.flatMap((device) => views.usageByDevice[device]!.ledger),
    );
    eq(
      'every lifetime row reads back as the store exports it by device',
      usage.usage,
      devices.map((device) => views.usageByDevice[device]!.usage).sort((a, b) => a!.deviceId.localeCompare(b!.deviceId)),
    );
    eq('reading changes no byte of the three files', dbHashes(dataDir), before);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function testUnmigratedUsageFile(): Promise<void> {
  section('import-sqlite — a usage.db its migrations have not finished on is refused, not migrated');
  const dataDir = tempDir('legacy');
  try {
    await writeUsageFixture(dataDir);
    const file = path.join(dataDir, 'usage.db');
    // The state a pre-`last_credited_day` build leaves: a lifetime row with no day.
    const legacy = new DatabaseSync(file);
    legacy.prepare('UPDATE usage SET last_credited_day = NULL WHERE device_id = ?').run(DEVICE_A);
    legacy.close();
    const before = dbHashes(dataDir);

    const target = unopenedTarget();
    const error = await caught(() => runImportSqlite(['--data-dir', dataDir], FIRESTORE_CONFIG, target.deps).then(() => undefined));
    const message = error instanceof Error ? error.message : String(error);
    check('the import rejects naming the file and how to migrate it', message.includes(file) && message.includes('WHIM_STORE_BACKEND=sqlite'), message);
    check('  ... before opening Firestore', !target.opened());
    eq('  ... leaving the file as it was', dbHashes(dataDir), before);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function testWaitlistModels(): Promise<void> {
  section('import-sqlite — an opt-out-model waitlist.db reads in the opt-in model, and removal fingerprints read back');
  const legacyDir = tempDir('waitlist-legacy');
  try {
    // BASE's schema and upsert: the file a pre-waitlist-hardening server left.
    const legacy = new DatabaseSync(path.join(legacyDir, 'waitlist.db'));
    legacy.exec('PRAGMA journal_mode = WAL');
    createLegacySqliteSchema(legacy);
    for (const signup of LEGACY_SIGNUPS) legacySqliteUpsert(legacy, signup);
    legacy.close();
    const before = dbHashes(legacyDir);
    eq(
      'every legacy row reads with no news consent, a ticked opt-out as a withdrawal at its updated_at',
      readWaitlistFile(path.join(legacyDir, 'waitlist.db')),
      LEGACY_ROWS.map(({ optedOut, ...kept }) => ({ ...kept, updatesOptIn: false, updatesConsentAt: null, updatesConsentNoticeId: null, updatesWithdrawnAt: optedOut ? kept.updatedAt : null })),
    );
    eq('  ... a file from before fingerprints holds none', readWaitlistFingerprints(path.join(legacyDir, 'waitlist.db')), []);
    eq('  ... and neither read changes a byte of it', dbHashes(legacyDir), before);
  } finally {
    fs.rmSync(legacyDir, { recursive: true, force: true });
  }

  const dataDir = tempDir('waitlist-removed');
  const key = 'import-suite-fingerprint-key-0123456789';
  try {
    const store = new NodeSqliteWaitlistStore(path.join(dataDir, 'waitlist.db'), { fingerprintKey: key });
    try {
      await store.upsert({ email: 'Gone@Example.com', platform: 'ios', updatesOptIn: true, noticeId: 'beta-2', now: LEGACY_T0 });
      await store.remove('gone@example.com', LEGACY_T0 + 1000);
    } finally {
      await store.close();
    }
    const before = dbHashes(dataDir);
    eq(
      'a removal reads back as the fingerprint the store keeps, at the time it was removed',
      readWaitlistFingerprints(path.join(dataDir, 'waitlist.db')),
      [{ fingerprint: waitlistFingerprint(key, ' GONE@example.com'), suppressedAt: LEGACY_T0 + 1000 }],
    );
    eq('  ... without changing a byte of the file', dbHashes(dataDir), before);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

export async function runImportSqliteTests(): Promise<void> {
  await testRefusals();
  await testReadersAreReadOnly();
  await testUnmigratedUsageFile();
  await testWaitlistModels();
}
