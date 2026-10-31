/**
 * `whim-admin import-sqlite` against the Firestore emulator (durable-server-stores D7;
 * specs/server-storage-backends "A SQLite data directory can be imported into Firestore", scenarios
 * "Import is idempotent" and "An opt-out-model SQLite file imports into the opt-in model"). The data
 * directory is written by the real `NodeSqlite*` stores, or by the opt-out-model code's own schema
 * and upsert (`waitlist-legacy-fixtures.ts`); the imported documents are read back through the real
 * Firestore stores.
 *
 * Also `whim-admin migrate-waitlist` (waitlist-hardening D5; specs/beta-waitlist "Existing rows move
 * to the opt-in model without loss") over documents the opt-out-model Firestore upsert wrote.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import nodeAssert from 'node:assert';
import type { DocumentData, DocumentReference, Firestore } from '@google-cloud/firestore';
import { section } from './harness';
import {
  CHANGED_EMAIL,
  DEVICE_A,
  DEVICE_UNSAFE,
  IMPORT_OLD_DAY,
  IMPORT_T0,
  IMPORT_TODAY,
  IMPORT_YESTERDAY,
  writeReportsFixture,
  writeSqliteFixture,
} from './sqlite-import-fixtures';
import { LEGACY_ROWS, LEGACY_SIGNUPS, LEGACY_T0, createLegacySqliteSchema, legacyFirestoreUpsert, legacySqliteUpsert } from './waitlist-legacy-fixtures';
import { runImportSqlite, type ImportConfig } from '../src/admin/import-sqlite';
import { runMigrateWaitlist, type MigrateConfig } from '../src/admin/migrate-waitlist';
import { openFirestoreClient } from '../src/firestore/client';
import { deviceCounterId, globalCounterId } from '../src/firestore/usage-store';
import { FirestoreWaitlistStore } from '../src/firestore/waitlist-store';
import type { OpenedStores } from '../src/stores';
import { NodeSqliteWaitlistStore, WRITTEN_REQUEST_NOTICE_ID } from '../src/waitlist/store';

const COLLECTIONS = ['waitlist', 'waitlistSuppressed', 'reports', 'usage', 'requests', 'admission'] as const;
const IMPORT_CONFIG: ImportConfig = { storeBackend: 'firestore', firestoreDatabase: '(default)', now: () => IMPORT_T0 + 10_000, ledgerRetentionDays: 90 };

/** Every document under `root`, by collection and id. */
async function documentSet(root: DocumentReference): Promise<Record<string, Record<string, DocumentData>>> {
  const set: Record<string, Record<string, DocumentData>> = {};
  for (const name of COLLECTIONS) {
    const snapshot = await root.collection(name).get();
    set[name] = Object.fromEntries(snapshot.docs.map((doc) => [doc.id, doc.data()]));
  }
  return set;
}

function importInto(dataDir: string, namespace: string): ReturnType<typeof runImportSqlite> {
  return runImportSqlite(['--data-dir', dataDir], IMPORT_CONFIG, { root: (db: Firestore) => db.collection('conformance').doc(namespace) });
}

function outcomes(results: readonly { ok: boolean; reason?: string }[]): string[] {
  return results.map((result) => (result.ok ? 'admitted' : (result.reason ?? 'refused')));
}

/**
 * Before the import, a server on the Firestore backend has already admitted one `generate` today and
 * taken a signup for an email the SQLite waitlist also holds. The import runs twice.
 */
async function idempotentImport(open: (namespace: string) => Promise<OpenedStores>, namespace: string, root: DocumentReference): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-firestore-import-'));
  try {
    const views = await writeSqliteFixture(dataDir);
    const live = await open(namespace);
    try {
      nodeAssert.ok((await live.usage.admit({ requestId: 'req-live', deviceId: 'dev-live', kind: 'generate', now: IMPORT_T0 + 5000, deviceLimit: 5 })).ok);
      await live.waitlist.upsert({ email: CHANGED_EMAIL, platform: 'ios', updatesOptIn: true, noticeId: 'notice-3', now: IMPORT_T0 + 6000 });
    } finally {
      await live.close();
    }

    const first = await importInto(dataDir, namespace);
    const afterFirst = await documentSet(root);
    const second = await importInto(dataDir, namespace);
    const afterSecond = await documentSet(root);

    nodeAssert.deepStrictEqual([first.exitCode, second.exitCode], [0, 0], `${first.output}${second.output}`);
    nodeAssert.strictEqual(second.output, first.output, 'both runs print the same counts');
    nodeAssert.deepStrictEqual(
      first.output.split('\n').slice(0, 5),
      [
        'waitlist: 1 imported, 1 kept as found',
        'waitlist fingerprints: 0 imported, 0 kept as found',
        'reports: 2 imported, 0 kept as found',
        'usage: 2 imported, 0 kept as found',
        'requests: 5 imported, 0 kept as found',
      ],
      'every row is counted once per store, the signup taken live as kept',
    );
    nodeAssert.deepStrictEqual(afterSecond, afterFirst, 'the second run leaves the document set the first one left');

    const stores = await open(namespace);
    try {
      const earliest = views.waitlist.find((row) => row.email === CHANGED_EMAIL)?.createdAt;
      nodeAssert.ok(earliest !== undefined && earliest < IMPORT_T0 + 6000, 'setup: SQLite holds the earlier signup');
      const liveSignup = {
        email: CHANGED_EMAIL,
        platform: 'ios',
        updatesOptIn: true,
        updatesConsentAt: IMPORT_T0 + 6000,
        updatesConsentNoticeId: 'notice-3',
        updatesWithdrawnAt: null,
        noticeId: 'notice-3',
        createdAt: earliest,
        updatedAt: IMPORT_T0 + 6000,
      };
      nodeAssert.deepStrictEqual(
        await stores.waitlist.export(),
        [liveSignup, ...views.waitlist.filter((row) => row.email !== CHANGED_EMAIL)].sort((x, y) => x.createdAt - y.createdAt),
        'the waitlist holds the SQLite rows, and the live signup with the server\'s answers and the earlier signup time',
      );
      for (const device of [DEVICE_A, DEVICE_UNSAFE]) {
        nodeAssert.deepStrictEqual(await stores.reports.listByDevice(device), views.reportsByDevice[device], `${device}'s reports read back with their ids and timestamps`);
        nodeAssert.deepStrictEqual(await stores.usage.deviceRecords(device), views.usageByDevice[device], `${device}'s ledger rows and lifetime totals read back as SQLite held them`);
      }

      const counters = afterSecond.admission;
      nodeAssert.deepStrictEqual(
        counters,
        {
          [deviceCounterId(IMPORT_TODAY, 'generate', DEVICE_A)]: { utcDay: IMPORT_TODAY, kind: 'generate', deviceId: DEVICE_A, count: 1 },
          [deviceCounterId(IMPORT_TODAY, 'generate', 'dev-live')]: { utcDay: IMPORT_TODAY, kind: 'generate', deviceId: 'dev-live', count: 1 },
          [deviceCounterId(IMPORT_TODAY, 'clarify', DEVICE_UNSAFE)]: { utcDay: IMPORT_TODAY, kind: 'clarify', deviceId: DEVICE_UNSAFE, count: 1 },
          [globalCounterId(IMPORT_TODAY, 'generate')]: { utcDay: IMPORT_TODAY, kind: 'generate', count: 2 },
          [globalCounterId(IMPORT_TODAY, 'clarify')]: { utcDay: IMPORT_TODAY, kind: 'clarify', count: 1 },
          [deviceCounterId(IMPORT_YESTERDAY, 'rewrite', DEVICE_A)]: { utcDay: IMPORT_YESTERDAY, kind: 'rewrite', deviceId: DEVICE_A, count: 1 },
          [globalCounterId(IMPORT_YESTERDAY, 'rewrite')]: { utcDay: IMPORT_YESTERDAY, kind: 'rewrite', count: 1 },
        },
        'the counters count every non-refunded row of their day, imported or live, and none exists for a day outside retention',
      );
      nodeAssert.ok(Object.values(afterSecond.requests).some((row) => row.utcDay === IMPORT_OLD_DAY), 'a ledger row outside retention is still copied');

      const now = IMPORT_T0 + 20_000;
      const global = [];
      for (const deviceId of ['dev-c', 'dev-d']) global.push(await stores.usage.admit({ requestId: `after-${deviceId}`, deviceId, kind: 'generate', now, deviceLimit: 5, globalLimit: 3 }));
      nodeAssert.deepStrictEqual(outcomes(global), ['admitted', 'global'], 'with the imported and the live generate counted, one unit of a global limit of 3 is left');
      const device = [];
      for (const requestId of ['after-a-1', 'after-a-2']) device.push(await stores.usage.admit({ requestId, deviceId: DEVICE_A, kind: 'generate', now, deviceLimit: 2 }));
      nodeAssert.deepStrictEqual(outcomes(device), ['admitted', 'device'], 'a device with one imported generate (and one refunded) has one unit of 2 left');
      const unsafe = await stores.usage.admit({ requestId: 'after-unsafe', deviceId: DEVICE_UNSAFE, kind: 'clarify', now, deviceLimit: 1 });
      nodeAssert.deepStrictEqual(outcomes([unsafe]), ['device'], 'an imported clarify uses its device\'s only unit');
    } finally {
      await stores.close();
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/** A data directory holding only `reports.db` imports the reports and reports 0 for the rest. */
async function partialImport(namespace: string, root: DocumentReference): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-firestore-import-partial-'));
  try {
    await writeReportsFixture(dataDir);
    const result = await importInto(dataDir, namespace);
    nodeAssert.strictEqual(result.exitCode, 0, result.output);
    nodeAssert.deepStrictEqual(
      result.output.trimEnd().split('\n'),
      [
        'waitlist: 0 imported, 0 kept as found (no waitlist.db)',
        'waitlist fingerprints: 0 imported, 0 kept as found (no waitlist.db)',
        'reports: 2 imported, 0 kept as found',
        'usage: 0 imported, 0 kept as found (no usage.db)',
        'requests: 0 imported, 0 kept as found (no usage.db)',
        'admission counters: 0 set for 0 ledger day(s) inside retention',
      ],
    );
    const written = await documentSet(root);
    nodeAssert.deepStrictEqual(COLLECTIONS.map((name) => Object.keys(written[name] ?? {}).length), [0, 0, 2, 0, 0, 0], 'only the reports were written');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/** A report that differs from its SQLite source is kept as found, never overwritten, on every re-import. */
async function differingReportKept(namespace: string, root: DocumentReference): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-firestore-import-differing-'));
  try {
    await writeReportsFixture(dataDir);
    const first = await importInto(dataDir, namespace);
    nodeAssert.strictEqual(first.exitCode, 0, first.output);
    nodeAssert.strictEqual(first.output.split('\n')[2], 'reports: 2 imported, 0 kept as found');

    const target = (await root.collection('reports').get()).docs[0]!;
    const [field] = Object.keys(target.data());
    nodeAssert.ok(field !== undefined, 'setup: a report document has a field to change');
    await target.ref.update({ [field]: 'changed in Firestore' });
    const modified = await documentSet(root);

    const second = await importInto(dataDir, namespace);
    const third = await importInto(dataDir, namespace);
    nodeAssert.deepStrictEqual([second.exitCode, third.exitCode], [0, 0], `${second.output}${third.output}`);
    nodeAssert.strictEqual(second.output.split('\n')[2], 'reports: 1 imported, 1 kept as found', 'the differing report is kept, the other counted as imported');
    nodeAssert.strictEqual(third.output, second.output, 'a further rerun prints the same counts');
    nodeAssert.deepStrictEqual(await documentSet(root), modified, 'the modified document is left exactly as modified');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/** The documents the five legacy people should hold in the opt-in model: their preserved fields as
 *  the opt-out-model code stored them, no news consent, a ticked opt-out a withdrawal at the row's
 *  `updatedAt`, and the rollback shadow saying "no updates". */
const MIGRATED_DOCS = LEGACY_ROWS.map(({ optedOut, ...kept }) => ({
  ...kept,
  updatesOptIn: false,
  updatesConsentAt: null,
  updatesConsentNoticeId: null,
  updatesWithdrawnAt: optedOut ? kept.updatedAt : null,
  updatesOptOut: true,
}));

/** The waitlist documents under `root`, by email, oldest signup first. */
async function waitlistDocs(root: DocumentReference): Promise<DocumentData[]> {
  return (await root.collection('waitlist').get()).docs.map((doc) => doc.data()).sort((a, b) => (a.createdAt as number) - (b.createdAt as number));
}

/** A `waitlist.db` the opt-out-model server left imports into the opt-in model, idempotently. */
async function legacyFileImport(namespace: string, root: DocumentReference): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-firestore-import-legacy-'));
  try {
    const legacy = new DatabaseSync(path.join(dataDir, 'waitlist.db'));
    legacy.exec('PRAGMA journal_mode = WAL');
    createLegacySqliteSchema(legacy);
    for (const signup of LEGACY_SIGNUPS) legacySqliteUpsert(legacy, signup);
    legacy.close();

    const first = await importInto(dataDir, namespace);
    const afterFirst = await documentSet(root);
    const second = await importInto(dataDir, namespace);
    nodeAssert.deepStrictEqual([first.exitCode, second.exitCode], [0, 0], `${first.output}${second.output}`);
    nodeAssert.deepStrictEqual(first.output.split('\n').slice(0, 2), ['waitlist: 5 imported, 0 kept as found', 'waitlist fingerprints: 0 imported, 0 kept as found']);
    nodeAssert.strictEqual(second.output, first.output, 'a rerun prints the same counts');
    nodeAssert.deepStrictEqual(await documentSet(root), afterFirst, 'a rerun changes nothing');
    nodeAssert.deepStrictEqual(await waitlistDocs(root), MIGRATED_DOCS, 'every row arrives with no news consent, a ticked opt-out as a withdrawal, and its email, platform, notice id and timestamps unchanged');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/** A removal kept in SQLite keeps blocking the address on Firestore under the same key. */
async function fingerprintImport(db: Firestore, namespace: string, root: DocumentReference): Promise<void> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-firestore-import-fingerprint-'));
  const fingerprintKey = 'import-fingerprint-key-shared-0123456789';
  try {
    const sqlite = new NodeSqliteWaitlistStore(path.join(dataDir, 'waitlist.db'), { fingerprintKey });
    try {
      await sqlite.upsert({ email: 'gone@example.com', platform: 'ios', updatesOptIn: true, noticeId: 'beta-2', now: IMPORT_T0 - 2000 });
      await sqlite.upsert({ email: 'stay@example.com', platform: 'android', updatesOptIn: false, noticeId: 'beta-2', now: IMPORT_T0 - 1500 });
      nodeAssert.strictEqual(await sqlite.remove('gone@example.com', IMPORT_T0 - 1000), true, 'setup: the removal found its row');
    } finally {
      await sqlite.close();
    }

    const first = await importInto(dataDir, namespace);
    const afterFirst = await documentSet(root);
    const second = await importInto(dataDir, namespace);
    nodeAssert.deepStrictEqual([first.exitCode, second.exitCode], [0, 0], `${first.output}${second.output}`);
    nodeAssert.deepStrictEqual(first.output.split('\n').slice(0, 2), ['waitlist: 1 imported, 0 kept as found', 'waitlist fingerprints: 1 imported, 0 kept as found']);
    nodeAssert.strictEqual(second.output, first.output, 'a rerun prints the same counts');
    nodeAssert.deepStrictEqual(await documentSet(root), afterFirst, 'a rerun changes nothing');
    nodeAssert.deepStrictEqual(Object.values(afterFirst.waitlistSuppressed ?? {}), [{ suppressedAt: IMPORT_T0 - 1000 }], 'the fingerprint keeps its removal time and nothing else');

    const store = new FirestoreWaitlistStore(db, root, { fingerprintKey });
    nodeAssert.strictEqual(await store.upsert({ email: 'Gone@Example.com', platform: 'ios', updatesOptIn: true, noticeId: 'beta-2', now: IMPORT_T0 }), 'suppressed', 'the removed address signing up on Firestore stores nothing');
    nodeAssert.deepStrictEqual((await store.export()).map((row) => row.email), ['stay@example.com'], 'only the kept row is on the list');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

const MIGRATE_KEY = 'firestore-migrate-fingerprint-key-0123456789';
const MIGRATE_CONFIG: MigrateConfig = { storeBackend: 'firestore', firestoreDatabase: '(default)', dataDir: os.tmpdir(), waitlistFingerprintKey: MIGRATE_KEY };

function totalsOf(output: string): string | undefined {
  return output.split('\n').find((line) => line.startsWith('totals: '));
}

/**
 * Five people signed up through the opt-out-model Firestore upsert. A dry run changes no document;
 * `--apply` migrates all five and a rerun none, every preserved field equal; answers given after
 * the migration survive a rerun; and the address of no one is printed.
 */
async function migrateLegacyDocuments(open: (namespace: string) => Promise<OpenedStores>, db: Firestore, namespace: string, root: DocumentReference): Promise<void> {
  for (const signup of LEGACY_SIGNUPS) await legacyFirestoreUpsert(db, root, signup);
  const migrate = (argv: string[]): ReturnType<typeof runMigrateWaitlist> => runMigrateWaitlist(argv, MIGRATE_CONFIG, { root: (client: Firestore) => client.collection('conformance').doc(namespace) });
  const addresses = [...new Set(LEGACY_SIGNUPS.map((signup) => signup.email.trim().toLowerCase()))];
  const printsNoAddress = (output: string): boolean => addresses.every((address) => !output.toLowerCase().includes(address));

  const unmigrated = await open(namespace);
  try {
    nodeAssert.deepStrictEqual(await unmigrated.waitlist.export({ updatesOk: true }), [], 'before any migration, the export with --updates-ok omits every legacy row, ticked or not');
  } finally {
    await unmigrated.close();
  }

  const before = await documentSet(root);
  const dry = await migrate([]);
  nodeAssert.strictEqual(dry.exitCode, 0, dry.output);
  nodeAssert.deepStrictEqual(await documentSet(root), before, 'the dry run leaves every document deep-equal');
  nodeAssert.strictEqual(totalsOf(dry.output), 'totals: 5 planned, 0 already migrated, 5 total', dry.output);
  nodeAssert.ok(printsNoAddress(dry.output), dry.output);

  const first = await migrate(['--apply']);
  nodeAssert.strictEqual(first.exitCode, 0, first.output);
  nodeAssert.strictEqual(totalsOf(first.output), 'totals: 5 migrated, 0 already migrated, 5 total', first.output);
  nodeAssert.ok(first.output.includes('verified: 5 row(s) read back, none in the opt-out model, every earlier row unchanged'), first.output);
  nodeAssert.ok(printsNoAddress(first.output), first.output);
  nodeAssert.deepStrictEqual(await waitlistDocs(root), MIGRATED_DOCS, 'every document holds its preserved fields unchanged, the consent the spec maps it to, and the shadow');
  const strip = (output: string, outcome: string): string[] => output.split('\n').filter((line) => line.startsWith(`${outcome} `)).map((line) => line.slice(outcome.length + 1)).sort((a, b) => a.localeCompare(b));
  nodeAssert.deepStrictEqual(strip(first.output, 'migrated'), strip(dry.output, 'planned'), 'each row migrated exactly as the dry run planned it');

  const second = await migrate(['--apply']);
  nodeAssert.strictEqual(second.exitCode, 0, second.output);
  nodeAssert.strictEqual(totalsOf(second.output), 'totals: 0 migrated, 5 already migrated, 5 total', second.output);
  nodeAssert.ok(second.output.includes('nothing to migrate: every row is already in the opt-in model; nothing was written'), second.output);
  nodeAssert.deepStrictEqual(await waitlistDocs(root), MIGRATED_DOCS, 'a rerun leaves every document as the first run left it');

  const stores = await open(namespace);
  try {
    nodeAssert.strictEqual(await stores.waitlist.upsert({ email: 'tick@example.com', platform: 'ios', updatesOptIn: true, noticeId: 'beta-2', now: LEGACY_T0 + 1000 }), 'updated');
    nodeAssert.strictEqual(await stores.waitlist.setUpdates('una@example.com', true, LEGACY_T0 + 2000), true);
    nodeAssert.deepStrictEqual(
      (await stores.waitlist.export({ updatesOk: true })).map((row) => [row.email, row.updatesConsentNoticeId]),
      [['una@example.com', WRITTEN_REQUEST_NOTICE_ID]],
      'a migrated legacy opt-out ticking the box gains no consent; only the written request does',
    );
  } finally {
    await stores.close();
  }
  const answered = await documentSet(root);
  const rerun = await migrate(['--apply']);
  nodeAssert.strictEqual(totalsOf(rerun.output), 'totals: 0 migrated, 5 already migrated, 5 total', rerun.output);
  nodeAssert.deepStrictEqual(await documentSet(root), answered, 'a rerun after those answers leaves every document as the answers left it');
}

/** The probe bound for this file's own client: a hang ceiling, as `PROBE_CEILING_MS` in
 *  `firestore-conformance.ts` (the 10 s default is the production boot's budget, #144). */
const PROBE_CEILING_MS = 120_000;

/** Runs the import checks, each in its own namespace under `conformance/`. */
export async function runFirestoreImportTests(open: (namespace: string) => Promise<OpenedStores>, runId: string, verify: (name: string, run: () => Promise<void>) => Promise<void>): Promise<void> {
  section('Firestore: import-sqlite copies a SQLite data directory, idempotently');
  const db = await openFirestoreClient('(default)', { probeTimeoutMs: PROBE_CEILING_MS });
  try {
    const idempotent = `${runId}-import`;
    await verify('importing twice leaves one document set, the same counts, and admission honouring imported and live rows', () =>
      idempotentImport(open, idempotent, db.collection('conformance').doc(idempotent)),
    );
    const partial = `${runId}-import-partial`;
    await verify('a data directory with only some files imports those and counts 0 for the rest', () => partialImport(partial, db.collection('conformance').doc(partial)));
    const differing = `${runId}-import-differing`;
    await verify('a report that differs from its SQLite source is kept as found and never overwritten', () => differingReportKept(differing, db.collection('conformance').doc(differing)));
    const legacy = `${runId}-import-legacy`;
    await verify('an opt-out-model waitlist.db imports into the opt-in model, idempotently', () => legacyFileImport(legacy, db.collection('conformance').doc(legacy)));
    const fingerprints = `${runId}-import-fingerprints`;
    await verify('a removal fingerprint imports, and keeps the address off the list under the same key', () => fingerprintImport(db, fingerprints, db.collection('conformance').doc(fingerprints)));

    section('Firestore: migrate-waitlist moves opt-out-model documents to the opt-in model');
    const migrate = `${runId}-migrate`;
    await verify('a dry run changes nothing; --apply migrates 5 rows, a rerun 0; preserved fields equal; no address printed', () =>
      migrateLegacyDocuments(open, db, migrate, db.collection('conformance').doc(migrate)),
    );
  } finally {
    await db.terminate();
  }
}
