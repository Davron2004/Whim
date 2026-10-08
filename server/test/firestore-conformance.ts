/**
 * The Firestore backend against the Firestore emulator (durable-server-stores D3–D5;
 * specs/server-storage-backends). Bundled and run by `server/test/firestore.run.mjs`, which
 * `npm run stores:firestore:test` starts with `FIRESTORE_EMULATOR_HOST` set.
 *
 * Every open gets a fresh namespace — `conformance/<run id>-<n>` — under which the stores keep
 * their collections, so no case reads another's records and the emulator is never cleared. Every
 * shared conformance case runs here, and the shape of every query they send is checked against
 * `deploy/firestore/indexes.json`.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import nodeAssert from 'node:assert';
import { check, report, section } from './harness';
import { runStoreConformance, type StoreBackendFactory } from './store-conformance.suite';
import { needsComposite, recordQueryShapes, uncoveredShapes, unusedIndexes, type IndexEntry } from './firestore-index-coverage';
import { loadServerConfig } from '../src/config';
import { startServer } from '../src/lifecycle';
import { createFirestoreStoresOpener, openStores, type FirestoreStoresOptions, type OpenedStores, type StoreConfig } from '../src/stores';
import type { DocumentReference } from '@google-cloud/firestore';
import { deleteInBatches, openFirestoreClient } from '../src/firestore/client';
import { runFirestoreImportTests } from './firestore-import';

const RUN_ID = randomUUID();
const T0 = Date.UTC(2026, 9, 7, 12, 0, 0);
let opens = 0;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** One harness check for a block of `node:assert` assertions: passes when `run` resolves. */
async function verify(name: string, run: () => Promise<void>): Promise<void> {
  const failure = await run().then(() => undefined, messageOf);
  check(name, failure === undefined, failure);
}

function firestoreConfig(now: () => number = () => T0): StoreConfig {
  return { ...loadServerConfig({ WHIM_DATA_DIR: os.tmpdir(), WHIM_STORE_BACKEND: 'firestore' }), now };
}

/** The real opener, with every collection under `conformance/<namespace>`. */
function namespacedOpener(namespace: string, options: FirestoreStoresOptions = {}): FirestoreStoresOptions {
  return { root: (db) => db.collection('conformance').doc(namespace), ...options };
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
  const lastUnit = await first.usage.admit({ requestId: 'last-unit', deviceId: 'dev-a', kind: 'generate', now: T0, deviceLimit: 1, globalLimit: 10 });
  await first.close();

  const second = await openNamespace(namespace);
  try {
    const rows = await second.waitlist.export();
    check('a new client exports the signup with its original created_at', rows.length === 1 && rows[0]?.email === 'kept@example.com' && rows[0].createdAt === T0, JSON.stringify(rows));
    check('  ... and reads the report back', (await second.reports.get(reportId))?.receivedAt === T0);
    // specs/server-storage-backends "Daily ceilings survive a restart".
    const next = await second.usage.admit({ requestId: 'after-restart', deviceId: 'dev-a', kind: 'generate', now: T0 + 1000, deviceLimit: 1, globalLimit: 10 });
    check(
      'a device that used its last unit before the restart is refused as device after it, the same UTC day',
      lastUnit.ok && !next.ok && next.reason === 'device',
      JSON.stringify([lastUnit, next]),
    );
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

    await verify('the usage documents follow the model handoff/firestore-usage.md publishes for an importer', () => usageDocumentModel(stores, root));
  } finally {
    await stores.close();
    await db.terminate();
  }
}

async function usageDocumentModel(stores: OpenedStores, root: DocumentReference): Promise<void> {
  const day = '2026-10-07';
  await stores.usage.admit({ requestId: 'model-row', deviceId: 'dev-a', kind: 'generate', now: T0, deviceLimit: 5 });
  await stores.usage.recordCost('model-row', { state: 'pending', generationIds: ['gen-1', 'gen-2'] });
  const row = await root.collection('requests').doc('model-row').get();
  nodeAssert.deepStrictEqual(
    [row.get('deviceId'), row.get('utcDay'), row.get('refunded'), row.get('costState'), row.get('generationIds')],
    ['dev-a', day, false, 'pending', ['gen-1', 'gen-2']],
    'a ledger row is the requests document named by its id, its generation ids a native array',
  );
  const counts = await Promise.all([`${day}:generate:dev-a`, `${day}:global:generate`].map(async (counter) => (await root.collection('admission').doc(counter).get()).get('count') as unknown));
  nodeAssert.deepStrictEqual(counts, [1, 1], 'an admission counts on the device counter and on its kind\'s global counter');

  // Counters written straight into the database, as an import writes them, bind admission.
  await root.collection('admission').doc(`${day}:generate:dev-imported`).set({ utcDay: day, kind: 'generate', deviceId: 'dev-imported', count: 2 });
  await root.collection('admission').doc(`${day}:global:clarify`).set({ utcDay: day, kind: 'clarify', count: 3 });
  nodeAssert.deepStrictEqual(
    [
      await stores.usage.admit({ requestId: 'imported-device', deviceId: 'dev-imported', kind: 'generate', now: T0, deviceLimit: 2, globalLimit: 10 }),
      await stores.usage.admit({ requestId: 'imported-global', deviceId: 'dev-b', kind: 'rewrite', now: T0, deviceLimit: 5, globalLimit: 4, globalKinds: ['clarify', 'rewrite'] }),
      await stores.usage.admit({ requestId: 'over-imported-global', deviceId: 'dev-c', kind: 'rewrite', now: T0, deviceLimit: 5, globalLimit: 4, globalKinds: ['clarify', 'rewrite'] }),
    ].map((result) => (result.ok ? 'admitted' : result.reason)),
    ['device', 'admitted', 'global'],
    'imported device and global counts are the counts admission checks',
  );
}

async function unsafeKeysTest(): Promise<void> {
  section('Firestore: ids that cannot be document names as they are');
  const stores = await openNamespace(`${RUN_ID}-keys`);
  const { usage } = stores;
  await verify('request and device ids holding "/", "." and "__" admit, count and read back', async () => {
    const pairs = [['..', 'a/b'], ['.', '__dev__'], ['x/y', '..']] as const;
    const admitted = await Promise.all(pairs.map(([requestId, deviceId]) => usage.admit({ requestId, deviceId, kind: 'generate', now: T0, deviceLimit: 1 })));
    nodeAssert.deepStrictEqual(admitted.map((result) => result.ok), [true, true, true]);
    await usage.credit('a/b', { promptTokens: 1, completionTokens: 1, totalTokens: 2 });
    const records = await usage.deviceRecords('a/b');
    nodeAssert.deepStrictEqual([records.ledger.map((row) => row.id), records.usage?.totalTokens], [['..'], 2], 'each row reads back under its own id and device');
    nodeAssert.strictEqual((await usage.unitAvailable({ deviceId: '..', kind: 'generate', now: T0, deviceLimit: 1 })).ok, false, 'and counts toward its own device');
    nodeAssert.strictEqual((await usage.unitAvailable({ deviceId: '.', kind: 'generate', now: T0, deviceLimit: 1 })).ok, true, '  ... and no other');
  }).finally(() => stores.close());
}

async function closeWhileBusyTest(): Promise<void> {
  section('Firestore: closing the stores while their calls are in flight');
  const stores = await openNamespace(`${RUN_ID}-busy`);
  // The boot purges and the hourly ones are not awaited by anything, so a drain can close the
  // stores under them. Each call below starts a read that has not reached the client pool yet.
  const calls = [
    stores.usage.purgeLedger('2026-01-01'),
    stores.usage.summary({ days: 2, now: T0 }),
    stores.reports.purgeOlderThan(T0),
    stores.waitlist.purge(T0),
    stores.usage.admit({ requestId: 'busy', deviceId: 'dev-a', kind: 'generate', now: T0, deviceLimit: 1 }),
  ];
  const closed = await stores.close().then(() => 'closed', messageOf);
  const outcomes = await Promise.allSettled(calls);
  check('the close resolves', closed === 'closed', closed);
  check('  ... after every call in flight completed', outcomes.every((outcome) => outcome.status === 'fulfilled'), JSON.stringify(outcomes.map((outcome) => (outcome.status === 'rejected' ? messageOf(outcome.reason) : 'ok'))));
}

async function firestoreBootTest(): Promise<void> {
  section('Firestore: a firestore boot opens every store and logs which backend it opened');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whim-firestore-boot-'));
  const lines: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  let booted: Awaited<ReturnType<typeof startServer>> | string;
  try {
    booted = await startServer({
      env: { WHIM_DATA_DIR: dataDir, WHIM_PIPELINE: 'stub', WHIM_STORE_BACKEND: 'firestore' },
      listen: { host: '127.0.0.1', port: 0 },
    }).catch(messageOf);
  } finally {
    process.stdout.write = write;
  }
  try {
    const opened = lines
      .flatMap((line) => line.split('\n'))
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((record) => record.msg === 'stores opened');
    check('the server boots on the firestore backend', typeof booted !== 'string', typeof booted === 'string' ? booted : '');
    check('  ... logging the backend and the database it opened', opened?.storeBackend === 'firestore' && opened.database === '(default)', JSON.stringify(opened));
  } finally {
    if (typeof booted !== 'string') await booted.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function indexCoverageTest(shapes: Parameters<typeof uncoveredShapes>[0]): void {
  section('Firestore: deploy/firestore/indexes.json declares every composite index the queries need');
  const file = path.join(process.cwd(), 'deploy', 'firestore', 'indexes.json');
  const declared = (JSON.parse(fs.readFileSync(file, 'utf8')) as { indexes: IndexEntry[] }).indexes;
  check('the run recorded the queries the stores sent', shapes.length > 0, String(shapes.length));
  check('  ... among them one only a composite index serves (the check is not vacuous)', shapes.some(needsComposite));
  const missing = uncoveredShapes(shapes, declared);
  check('every query that needs a composite index has it declared', missing.length === 0, missing.join('; '));
  const unused = unusedIndexes(shapes, declared);
  check('every declared composite index serves a query the stores send', unused.length === 0, unused.join('; '));
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

const shapes = recordQueryShapes();
section('Store conformance: firestore');
await runStoreConformance(firestoreBackend);
await persistenceTest();
await documentModelTest();
await unsafeKeysTest();
await batchedDeleteTest();
await closeWhileBusyTest();
await firestoreBootTest();
await runFirestoreImportTests((namespace) => openNamespace(namespace), RUN_ID, verify);
indexCoverageTest(shapes);
await unreachableDatabaseTest();
report();
