/**
 * server/src/stores.ts — the ONE production constructor of server stores (durable-server-stores
 * D1, D4; specs/server-storage-backends "The operator selects one durable backend for every server
 * store"). Boot (`lifecycle.ts`), `whim-admin` and `whim-waitlist` all obtain their usage ledger,
 * reports and beta waitlist here, from the backend `WHIM_STORE_BACKEND` selects.
 *
 * `sqlite` opens the three `node:sqlite` files under `WHIM_DATA_DIR`, exactly as boot always did.
 * `firestore` delegates to an opener (`deps.openFirestore`, defaulting to `openFirestoreStores`),
 * which may be async and may throw at open — a probe read that finds no credentials fails here, so
 * boot fails at its `stores` step.
 */
import path from 'node:path';
import type { ServerConfig } from './config';
import { log } from './logger';
import { NodeSqliteUsageStore, type UsageRecordKeeping, type UsageStore } from './usage-store';
import { NodeSqliteReportStore, type ReportRecordKeeping, type ReportStore } from './reports/store';
import { NodeSqliteWaitlistStore, type WaitlistStore } from './waitlist/store';

/** The configuration `openStores` reads. */
export type StoreConfig = Pick<ServerConfig, 'storeBackend' | 'firestoreDatabase' | 'dataDir' | 'now' | 'usageIdleDays'>;

/** Every server store, open on one backend. */
export interface OpenedStores {
  readonly usage: UsageStore & UsageRecordKeeping;
  readonly reports: ReportStore & ReportRecordKeeping;
  readonly waitlist: WaitlistStore;
  /** Closes all three stores (reports, waitlist, then usage). */
  close(): Promise<void>;
}

/** Opens the three stores on the `firestore` backend. Rejects when the backend is unusable. */
export type FirestoreStoresOpener = (config: StoreConfig) => Promise<OpenedStores>;

export interface OpenStoresDeps {
  /** Replaces the `firestore` backend's opener. Defaults to `openFirestoreStores`. */
  readonly openFirestore?: FirestoreStoresOpener;
}

/** The `firestore` backend's opener. Not built yet: it rejects naming the backend. */
export const openFirestoreStores: FirestoreStoresOpener = () =>
  Promise.reject(new Error('WHIM_STORE_BACKEND=firestore: the firestore store backend is not built'));

/** Closes each store in order, attempting every one even when an earlier close fails, then rethrows
 *  the first failure. */
async function closeAll(stores: readonly { close(): Promise<void> }[]): Promise<void> {
  let first: { error: unknown } | undefined;
  for (const store of stores) {
    try {
      await store.close();
    } catch (error) {
      first ??= { error };
    }
  }
  if (first) throw first.error;
}

async function openSqliteStores(config: StoreConfig): Promise<OpenedStores> {
  const opened: { close(): Promise<void> }[] = [];
  try {
    const usage = new NodeSqliteUsageStore(path.join(config.dataDir, 'usage.db'), { now: config.now, usageIdleDays: config.usageIdleDays });
    opened.push(usage);
    const reports = new NodeSqliteReportStore(path.join(config.dataDir, 'reports.db'));
    opened.push(reports);
    const waitlist = new NodeSqliteWaitlistStore(path.join(config.dataDir, 'waitlist.db'));
    return { usage, reports, waitlist, close: () => closeAll([reports, waitlist, usage]) };
  } catch (err) {
    // A store that failed to open leaves the ones before it open; release them before reporting.
    await closeAll(opened.reverse()).catch((closeErr: unknown) => {
      log.warn({ detail: closeErr instanceof Error ? closeErr.message : String(closeErr) }, 'a store opened before the failure did not close');
    });
    throw err;
  }
}

/** Opens every server store on `config.storeBackend`. Rejects when a store cannot be opened, with
 *  nothing left open. */
export async function openStores(config: StoreConfig, deps: OpenStoresDeps = {}): Promise<OpenedStores> {
  if (config.storeBackend === 'firestore') return (deps.openFirestore ?? openFirestoreStores)(config);
  return openSqliteStores(config);
}
