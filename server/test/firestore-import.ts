/**
 * `whim-admin import-sqlite` against the Firestore emulator (durable-server-stores D7;
 * specs/server-storage-backends "A SQLite data directory can be imported into Firestore", scenario
 * "Import is idempotent"). The data directory is written by the real `NodeSqlite*` stores; the
 * imported documents are read back through the real Firestore stores.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
import { runImportSqlite, type ImportConfig } from '../src/admin/import-sqlite';
import { openFirestoreClient } from '../src/firestore/client';
import { deviceCounterId, globalCounterId } from '../src/firestore/usage-store';
import type { OpenedStores } from '../src/stores';

const COLLECTIONS = ['waitlist', 'reports', 'usage', 'requests', 'admission'] as const;
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
      first.output.split('\n').slice(0, 4),
      [
        'waitlist: 1 imported, 1 kept as found',
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
        'reports: 2 imported, 0 kept as found',
        'usage: 0 imported, 0 kept as found (no usage.db)',
        'requests: 0 imported, 0 kept as found (no usage.db)',
        'admission counters: 0 set for 0 ledger day(s) inside retention',
      ],
    );
    const written = await documentSet(root);
    nodeAssert.deepStrictEqual(COLLECTIONS.map((name) => Object.keys(written[name] ?? {}).length), [0, 2, 0, 0, 0], 'only the reports were written');
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
    nodeAssert.strictEqual(first.output.split('\n')[1], 'reports: 2 imported, 0 kept as found');

    const target = (await root.collection('reports').get()).docs[0]!;
    const [field] = Object.keys(target.data());
    nodeAssert.ok(field !== undefined, 'setup: a report document has a field to change');
    await target.ref.update({ [field]: 'changed in Firestore' });
    const modified = await documentSet(root);

    const second = await importInto(dataDir, namespace);
    const third = await importInto(dataDir, namespace);
    nodeAssert.deepStrictEqual([second.exitCode, third.exitCode], [0, 0], `${second.output}${third.output}`);
    nodeAssert.strictEqual(second.output.split('\n')[1], 'reports: 1 imported, 1 kept as found', 'the differing report is kept, the other counted as imported');
    nodeAssert.strictEqual(third.output, second.output, 'a further rerun prints the same counts');
    nodeAssert.deepStrictEqual(await documentSet(root), modified, 'the modified document is left exactly as modified');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
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
  } finally {
    await db.terminate();
  }
}
