/**
 * `whim-admin import-sqlite --data-dir <dir>` (durable-server-stores D7; specs/server-storage-backends
 * "A SQLite data directory can be imported into Firestore").
 *
 * Copies every waitlist row, report, lifetime usage row and ledger row from the SQLite files in
 * `<dir>` into the configured Firestore database, under the ids and timestamps they already have.
 * The files are opened read-only and a file that is absent imports nothing. The command refuses
 * unless `WHIM_STORE_BACKEND=firestore`.
 *
 * A document that does not exist yet is created. One that already exists is never overwritten: when
 * it equals what the import would write it counts as imported (an earlier run wrote it), otherwise
 * it counts as kept (a server on the Firestore backend has written there since). So a rerun writes
 * nothing and prints the same counts, and an import that runs after the server started on Firestore
 * never replaces what the server wrote.
 *
 * Then, for every imported ledger day still inside `WHIM_LEDGER_RETENTION_DAYS`, the admission
 * counters of the kinds imported on that day are set to absolute counts of that day's non-refunded
 * `requests` documents of those kinds, imported or written live. Each day is one transaction that
 * first reads the day's global counters of those kinds, which every admit, refund and device delete
 * of those kinds writes, so a server admitting meanwhile serializes with the rebuild instead of
 * losing a unit to it. Counters of kinds nothing was imported for are the server's own and stay.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { CollectionReference, DocumentData, Firestore } from '@google-cloud/firestore';
import type { ServerConfig } from '../config';
import { openFirestoreClient, type FirestoreRoot } from '../firestore/client';
import { REPORTS_COLLECTION } from '../firestore/report-store';
import { WAITLIST_COLLECTION, waitlistDocId } from '../firestore/waitlist-store';
import {
  ADMISSION_COLLECTION,
  REQUESTS_COLLECTION,
  USAGE_COLLECTION,
  deviceCounterId,
  firestoreKey,
  globalCounterId,
  type RequestDoc,
} from '../firestore/usage-store';
import { readReportsFile } from '../reports/store';
import { readUsageFile, utcDayString, type RequestKind } from '../usage-store';
import { readWaitlistFile } from '../waitlist/store';
import type { AdminCliResult } from './cli';

const DAY_MS = 86_400_000;

/** Firestore's limit on writes in one batch. */
const WRITE_BATCH_SIZE = 500;

/** The configuration the import reads. */
export type ImportConfig = Pick<ServerConfig, 'storeBackend' | 'firestoreDatabase' | 'now' | 'ledgerRetentionDays'>;

export interface ImportDeps {
  /** Opens the target client. Defaults to `openFirestoreClient` (one probe read). */
  readonly openFirestore?: (database: string) => Promise<Firestore>;
  /** Where the collections live. Defaults to the database root. */
  readonly root?: (db: Firestore) => FirestoreRoot;
}

/** One collection's outcome: documents that now hold the source row, and existing ones left as they were. */
export interface CopyCount {
  imported: number;
  kept: number;
}

export interface ImportCounts {
  waitlist: CopyCount;
  reports: CopyCount;
  usage: CopyCount;
  requests: CopyCount;
  /** Admission counters set, over `counterDays` ledger days. */
  counters: number;
  counterDays: number;
}

interface SourceDoc {
  readonly id: string;
  readonly data: DocumentData;
}

/** Everything the import writes, read from the SQLite files under `dataDir`. */
interface SqliteSource {
  waitlist: SourceDoc[];
  reports: SourceDoc[];
  usage: SourceDoc[];
  requests: { id: string; data: RequestDoc }[];
}

const SOURCE_FILES = ['usage.db', 'reports.db', 'waitlist.db'] as const;

/** The SQLite files under `dataDir`, as the Firestore documents the stores keep. */
function readSource(dataDir: string): SqliteSource {
  const file = (name: (typeof SOURCE_FILES)[number]): string | undefined => {
    const filePath = path.join(dataDir, name);
    return fs.existsSync(filePath) ? filePath : undefined;
  };
  const usageFile = file('usage.db');
  const reportsFile = file('reports.db');
  const waitlistFile = file('waitlist.db');
  const usage = usageFile === undefined ? { usage: [], ledger: [] } : readUsageFile(usageFile);
  return {
    waitlist: (waitlistFile === undefined ? [] : readWaitlistFile(waitlistFile)).map((row) => ({
      id: waitlistDocId(row.email),
      data: { email: row.email, platform: row.platform, updatesOptOut: row.updatesOptOut, noticeId: row.noticeId, createdAt: row.createdAt, updatedAt: row.updatedAt },
    })),
    reports: (reportsFile === undefined ? [] : readReportsFile(reportsFile)).map(({ reportId, ...doc }) => ({ id: reportId, data: doc })),
    usage: usage.usage.map(({ deviceId, ...doc }) => ({ id: firestoreKey(deviceId), data: doc })),
    requests: usage.ledger.map(({ id, generationIds, ...row }) => ({
      id: firestoreKey(id),
      data: { ...row, generationIds: generationIds === null ? null : [...generationIds] },
    })),
  };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Creates each document of `docs` that `collection` does not hold yet, `WRITE_BATCH_SIZE` per batch. */
async function copyInto(db: Firestore, collection: CollectionReference, docs: readonly SourceDoc[]): Promise<CopyCount> {
  const count: CopyCount = { imported: 0, kept: 0 };
  for (const chunk of chunks(docs, WRITE_BATCH_SIZE)) {
    const refs = chunk.map((doc) => collection.doc(doc.id));
    const existing = await db.getAll(...refs);
    const batch = db.batch();
    let writes = 0;
    existing.forEach((snapshot, i) => {
      const { data } = chunk[i]!;
      if (!snapshot.exists) {
        batch.create(refs[i]!, data);
        writes++;
        count.imported++;
      } else if (isDeepStrictEqual(snapshot.data(), data)) {
        count.imported++;
      } else {
        count.kept++;
      }
    });
    if (writes > 0) await batch.commit();
  }
  return count;
}

/** Sets the admission counters of `kinds` on `utcDay` to the day's non-refunded `requests`
 *  documents of those kinds, in one transaction. Returns how many counters it set. */
async function rebuildDay(db: Firestore, root: FirestoreRoot, utcDay: string, kinds: readonly RequestKind[]): Promise<number> {
  const admission = root.collection(ADMISSION_COLLECTION);
  const day = root.collection(REQUESTS_COLLECTION).where('utcDay', '==', utcDay);
  return db.runTransaction(async (tx) => {
    // Read before the rows: an admit of these kinds that commits after this read conflicts with the
    // transaction, and one that committed before it is among the rows the query returns.
    await tx.getAll(...kinds.map((kind) => admission.doc(globalCounterId(utcDay, kind))));
    const rows = (await tx.get(day)).docs.map((doc) => doc.data() as RequestDoc).filter((row) => kinds.includes(row.kind) && !row.refunded);
    const devices = new Map<string, { kind: RequestKind; deviceId: string; count: number }>();
    for (const row of rows) {
      const id = deviceCounterId(utcDay, row.kind, row.deviceId);
      const counter = devices.get(id) ?? { kind: row.kind, deviceId: row.deviceId, count: 0 };
      counter.count++;
      devices.set(id, counter);
    }
    for (const [id, { kind, deviceId, count }] of devices) tx.set(admission.doc(id), { utcDay, kind, deviceId, count });
    for (const kind of kinds) {
      tx.set(admission.doc(globalCounterId(utcDay, kind)), { utcDay, kind, count: rows.filter((row) => row.kind === kind).length });
    }
    return devices.size + kinds.length;
  });
}

/** Copies `source` under `root` and rebuilds the admission counters of its ledger days on or after `keptFrom`. */
async function importSource(db: Firestore, root: FirestoreRoot, source: SqliteSource, keptFrom: string): Promise<ImportCounts> {
  const waitlist = await copyInto(db, root.collection(WAITLIST_COLLECTION), source.waitlist);
  const reports = await copyInto(db, root.collection(REPORTS_COLLECTION), source.reports);
  const usage = await copyInto(db, root.collection(USAGE_COLLECTION), source.usage);
  const requests = await copyInto(db, root.collection(REQUESTS_COLLECTION), source.requests);
  const days = new Map<string, Set<RequestKind>>();
  for (const { data } of source.requests) {
    if (data.utcDay >= keptFrom) days.set(data.utcDay, (days.get(data.utcDay) ?? new Set()).add(data.kind));
  }
  let counters = 0;
  for (const [utcDay, kinds] of [...days].sort(([a], [b]) => a.localeCompare(b))) counters += await rebuildDay(db, root, utcDay, [...kinds].sort((a, b) => a.localeCompare(b)));
  return { waitlist, reports, usage, requests, counters, counterDays: days.size };
}

function formatCounts(counts: ImportCounts, dataDir: string): string {
  const missing = (file: string): string => (fs.existsSync(path.join(dataDir, file)) ? '' : ` (no ${file})`);
  const line = (name: string, count: CopyCount, file: string): string =>
    `${name}: ${count.imported} imported, ${count.kept} kept as found${missing(file)}`;
  return [
    line('waitlist', counts.waitlist, 'waitlist.db'),
    line('reports', counts.reports, 'reports.db'),
    line('usage', counts.usage, 'usage.db'),
    line('requests', counts.requests, 'usage.db'),
    `admission counters: ${counts.counters} set for ${counts.counterDays} ledger day(s) inside retention`,
  ].join('\n') + '\n';
}

/** Runs `import-sqlite <argv>`: 0 with one line per store, 1 on a refusal; rejects when a read or write fails. */
export async function runImportSqlite(argv: readonly string[], config: ImportConfig, deps: ImportDeps = {}): Promise<AdminCliResult> {
  const flag = argv.indexOf('--data-dir');
  const dataDir = flag >= 0 ? argv[flag + 1] : undefined;
  if (dataDir === undefined || dataDir.startsWith('--') || argv.length !== 2) {
    return { exitCode: 1, output: 'Usage: import-sqlite --data-dir <dir>\n' };
  }
  if (config.storeBackend !== 'firestore') {
    return { exitCode: 1, output: `import-sqlite writes into the firestore backend; set WHIM_STORE_BACKEND=firestore (configured: ${config.storeBackend})\n` };
  }
  if (!SOURCE_FILES.some((file) => fs.existsSync(path.join(dataDir, file)))) {
    return { exitCode: 1, output: `${dataDir} holds none of ${SOURCE_FILES.join(', ')}\n` };
  }
  const source = readSource(dataDir);
  const keptFrom = utcDayString(config.now() - config.ledgerRetentionDays * DAY_MS);
  const db = await (deps.openFirestore ?? openFirestoreClient)(config.firestoreDatabase);
  try {
    const counts = await importSource(db, deps.root?.(db) ?? db, source, keptFrom);
    return { exitCode: 0, output: formatCounts(counts, dataDir) };
  } finally {
    await db.terminate();
  }
}
