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
import type { Firestore } from '@google-cloud/firestore';
import { openFirestoreClient, type FirestoreClientOptions, type FirestoreRoot } from './firestore/client';
import { FirestoreReportStore } from './firestore/report-store';
import { FirestoreWaitlistStore } from './firestore/waitlist-store';
import { FirestoreUsageStore } from './firestore/usage-store';

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

export interface FirestoreStoresOptions extends FirestoreClientOptions {
  /** Where the stores' collections live. Defaults to the database root. */
  readonly root?: (db: Firestore) => FirestoreRoot;
}

/**
 * `store` with every call that returns a promise held in `inFlight` until it settles. Terminating a
 * Firestore client under a call that has not reached its connection pool yet throws "The client
 * has already been terminated" from inside the library, uncaught, so the opener's `close()` waits
 * for these first. Nothing awaits a scheduled purge, so a drain can close the stores under one.
 */
function trackInFlight<T extends object>(store: T, inFlight: Set<Promise<void>>): T {
  return new Proxy(store, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]): unknown => {
        const result: unknown = Reflect.apply(value, target, args);
        if (result instanceof Promise) {
          const settled: Promise<void> = result.then(
            () => {
              inFlight.delete(settled);
            },
            () => {
              inFlight.delete(settled);
            },
          );
          inFlight.add(settled);
        }
        return result;
      };
    },
  });
}

/** An opener for the `firestore` backend: one client for `config.firestoreDatabase` that has
 *  passed its probe read, and every store on it. `close()` waits for the stores' calls in flight,
 *  then terminates the client. */
export function createFirestoreStoresOpener(options: FirestoreStoresOptions = {}): FirestoreStoresOpener {
  return async (config) => {
    const db = await openFirestoreClient(config.firestoreDatabase, options);
    try {
      const root = options.root?.(db) ?? db;
      const inFlight = new Set<Promise<void>>();
      const reports = trackInFlight(new FirestoreReportStore(db, root), inFlight);
      const waitlist = trackInFlight(new FirestoreWaitlistStore(db, root), inFlight);
      const usage = trackInFlight(new FirestoreUsageStore(db, root, { now: config.now }), inFlight);
      return {
        usage,
        reports,
        waitlist,
        close: async () => {
          try {
            await closeAll([reports, waitlist, usage]);
          } finally {
            while (inFlight.size > 0) await Promise.all(inFlight);
            await db.terminate();
          }
        },
      };
    } catch (err) {
      await db.terminate();
      throw err;
    }
  };
}

/** The `firestore` backend's opener, on the database root with the default probe timeout. */
export const openFirestoreStores: FirestoreStoresOpener = createFirestoreStoresOpener();

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
