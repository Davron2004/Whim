/**
 * The Firestore client the `firestore` store backend runs on (durable-server-stores D1, D3, D4).
 *
 * `openFirestoreClient` builds one client for the named database. The project comes from
 * `GOOGLE_CLOUD_PROJECT` or Application Default Credentials, and the client library itself sends
 * every call to `FIRESTORE_EMULATOR_HOST` when that is set, so local runs and tests need no other
 * switch. Before handing the client out it makes one probe read, so a missing credential, a missing
 * permission or a wrong database fails the open (boot's `stores` step) instead of the first request.
 */
import { Firestore, type DocumentReference, type Query } from '@google-cloud/firestore';

/** How long the probe read may take before the open fails. The client retries an unreachable host
 *  for about a minute on its own. */
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

/** Firestore's limit on writes in one batch. */
export const DELETE_BATCH_SIZE = 500;

/** Where a store's collections live: the database root in production, one document per isolated
 *  run in tests. Both expose `collection(name)`. */
export type FirestoreRoot = Firestore | DocumentReference;

export interface FirestoreClientOptions {
  /** Defaults to `DEFAULT_PROBE_TIMEOUT_MS`. */
  readonly probeTimeoutMs?: number;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A client for `database` that has completed one read. Rejects naming the store backend and the
 * database when the read fails or does not answer within the probe timeout.
 *
 * The client is constructed before this function's first `await`, so it reads
 * `FIRESTORE_EMULATOR_HOST` as the environment holds it at the call.
 */
export async function openFirestoreClient(database: string, options: FirestoreClientOptions = {}): Promise<Firestore> {
  const db = new Firestore({ databaseId: database });
  const timeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const failure = (detail: string): Error => new Error(`WHIM_STORE_BACKEND=firestore: cannot read Firestore database "${database}": ${detail}`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timed out'>((resolve) => {
    timer = setTimeout(() => resolve('timed out'), timeoutMs);
  });
  try {
    // A unary call: it fails at once on a permanent error, where a document read is a stream the
    // client retries.
    const probe = db.listCollections().then(
      () => 'ok' as const,
      (err: unknown) => ({ error: messageOf(err) }),
    );
    const outcome = await Promise.race([probe, timedOut]);
    if (outcome === 'timed out') {
      // The probe is still retrying, and terminating the client waits for it, so the client is left
      // to fail on its own; the process is about to exit on the boot failure.
      throw failure(`the probe read did not answer within ${timeoutMs} ms`);
    }
    if (outcome !== 'ok') {
      await db.terminate();
      throw failure(outcome.error);
    }
    return db;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deletes every document `query` matches, `batchSize` per committed batch, and returns how many went.
 * Each batch re-runs the query, so documents a batch deleted never come back. Not atomic across
 * batches.
 */
export async function deleteInBatches(db: Firestore, query: Query, batchSize: number = DELETE_BATCH_SIZE): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snapshot = await query.limit(batchSize).get();
    if (snapshot.empty) return deleted;
    const batch = db.batch();
    for (const doc of snapshot.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snapshot.size;
    if (snapshot.size < batchSize) return deleted;
  }
}
