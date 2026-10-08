/**
 * The Firestore backend against the Firestore emulator (durable-server-stores D3–D5;
 * specs/server-storage-backends). Bundled and run by `server/test/firestore.run.mjs`, which
 * `npm run stores:firestore:test` starts with `FIRESTORE_EMULATOR_HOST` set.
 *
 * Every open gets a fresh namespace — `conformance/<run id>-<n>` — under which the stores keep
 * their collections, so no case reads another's records and the emulator is never cleared. The
 * usage store stays in memory until the Firestore usage store exists; the cases run here are the
 * ones that exercise reports and the waitlist.
 */
import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import nodeAssert from 'node:assert';
import { check, report, section } from './harness';
import { REPORT_AND_WAITLIST_CASES, runStoreConformance, type StoreBackendFactory } from './store-conformance.suite';
import { loadServerConfig } from '../src/config';
import { createFirestoreStoresOpener, openStores, type FirestoreStoresOptions, type OpenedStores, type StoreConfig } from '../src/stores';
import { deleteInBatches, openFirestoreClient } from '../src/firestore/client';
import { InMemoryUsageStore } from '../src/usage-store';

const RUN_ID = randomUUID();
const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
let opens = 0;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function firestoreConfig(now: () => number = () => T0): StoreConfig {
  return { ...loadServerConfig({ WHIM_DATA_DIR: os.tmpdir(), WHIM_STORE_BACKEND: 'firestore' }), now };
}

/** The real opener, with every collection under `conformance/<namespace>` and an in-memory usage store. */
function namespacedOpener(namespace: string, options: FirestoreStoresOptions = {}): FirestoreStoresOptions {
  return {
    root: (db) => db.collection('conformance').doc(namespace),
    openUsage: (_db, _root, config) => new InMemoryUsageStore({ now: config.now }),
    ...options,
  };
}

function openNamespace(namespace: string, now?: () => number): Promise<OpenedStores> {
  return openStores(firestoreConfig(now), { openFirestore: createFirestoreStoresOpener(namespacedOpener(namespace)) });
}

const firestoreBackend: StoreBackendFactory = {
  label: 'firestore',
  open: (now) => openNamespace(`${RUN_ID}-${++opens}`, now),
};

async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function unreachableDatabaseTest(): Promise<void> {
  section('Firestore: a database the probe cannot read fails the open, by name, within its bound');
  const probeTimeoutMs = 1000;
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${await closedPort()}`;
  const started = Date.now();
  let pending: Promise<OpenedStores>;
  try {
    // The client reads the emulator host when it is constructed, which is before the first await.
    pending = openStores(firestoreConfig(), { openFirestore: createFirestoreStoresOpener({ probeTimeoutMs }) });
  } finally {
    process.env.FIRESTORE_EMULATOR_HOST = emulator;
  }
  const outcome = await pending.then(
    async (stores) => {
      await stores.close();
      return 'opened';
    },
    messageOf,
  );
  check(
    'the open rejects naming the store backend and the database',
    outcome.startsWith('WHIM_STORE_BACKEND=firestore: cannot read Firestore database "(default)"') && outcome.includes(`within ${probeTimeoutMs} ms`),
    outcome,
  );
  check('  ... once its probe bound has passed, not after the client gives up', Date.now() - started < probeTimeoutMs + 2000, `${Date.now() - started} ms`);
}

async function persistenceTest(): Promise<void> {
  section('Firestore: records outlive the client that wrote them');
  const namespace = `${RUN_ID}-persistence`;
  const first = await openNamespace(namespace);
  await first.waitlist.upsert({ email: ' Kept@Example.com', platform: 'android', updatesOptOut: false, noticeId: 'notice-1', now: T0 });
  const reportId = await first.reports.insert({ deviceId: 'dev-a', reason: 'broken', now: T0 });
  await first.close();

  const second = await openNamespace(namespace);
  try {
    const rows = await second.waitlist.export();
    check('a new client exports the signup with its original created_at', rows.length === 1 && rows[0]?.email === 'kept@example.com' && rows[0].createdAt === T0, JSON.stringify(rows));
    check('  ... and reads the report back', (await second.reports.get(reportId))?.receivedAt === T0);
  } finally {
    await second.close();
  }
}

async function documentModelTest(): Promise<void> {
  section('Firestore: the document model (design D3)');
  const namespace = `${RUN_ID}-model`;
  const stores = await openNamespace(namespace);
  const db = await openFirestoreClient('(default)');
  try {
    await stores.waitlist.upsert({ email: '  Model@Example.COM ', platform: 'ios', updatesOptOut: true, noticeId: 'notice-1', now: T0 });
    const reportId = await stores.reports.insert({ deviceId: 'dev-a', reason: 'harmful', now: T0 });
    const root = db.collection('conformance').doc(namespace);

    const id = createHash('sha256').update('model@example.com').digest('hex');
    const signup = await root.collection('waitlist').doc(id).get();
    check('a signup is the waitlist document named by the SHA-256 of its normalized email', signup.exists, id);
    check('  ... holding the normalized email', signup.get('email') === 'model@example.com', String(signup.get('email')));

    const stored = (await root.collection('reports').doc(reportId).get()).data();
    nodeAssert.ok(stored, 'the report document exists');
    check(
      'a report is the reports document named by its id, unsent texts stored as empty strings',
      [stored.note, stored.appName, stored.prompt, stored.source, stored.deviceId, stored.receivedAt].join('|') === `||||dev-a|${T0}`,
      JSON.stringify(stored),
    );
  } finally {
    await stores.close();
    await db.terminate();
  }
}

async function batchedDeleteTest(): Promise<void> {
  section('Firestore: batched deletes');
  const db = await openFirestoreClient('(default)');
  try {
    const items = db.collection('conformance').doc(`${RUN_ID}-batches`).collection('items');
    await Promise.all(Array.from({ length: 7 }, (_, n) => items.doc(`item-${n}`).set({ n })));
    const deleted = await deleteInBatches(db, items.where('n', '<', 5), 2);
    const left = (await items.get()).docs.map((doc) => doc.get('n') as number).sort((a, b) => a - b);
    check('every match goes, across batches smaller than the match count', deleted === 5 && left.join(',') === '5,6', `deleted ${deleted}, left ${left.join(',')}`);
  } finally {
    await db.terminate();
  }
}

section('Store conformance: firestore (reports and waitlist; usage in memory)');
await runStoreConformance(firestoreBackend, REPORT_AND_WAITLIST_CASES);
await persistenceTest();
await documentModelTest();
await batchedDeleteTest();
await unreachableDatabaseTest();
report();
