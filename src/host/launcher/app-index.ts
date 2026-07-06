/**
 * app-index — the installed-apps INDEX (launcher-shell / #5 D1).
 *
 * A small, synchronous, list-shaped store: one record per installed mini-app + one ordered id
 * list + a seed marker. This is exactly what the home grid needs at mount (fast, sync). The
 * heavy artifacts (bundle source, prompt, history) live in the version store, reached only
 * through `store-access.ts`; the index never holds a bundle (D1 — the store is the source of
 * truth, the index is rebuildable in principle).
 *
 * Backed by `react-native-mmkv` on device (one instance, `whim.launcher`) and by `MapKVBackend`
 * in Node tests — both satisfy the same minimal `KVBackend` seam (getString/set/delete/
 * getAllKeys). No git vocabulary, no mechanism names: every value here is product data.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';
import type { AppRecord } from '../bridge/contract';

/**
 * The launcher-facing record (D1). The launcher id IS the version-store appId for original
 * installs (`storeId` omitted ≡ `id`); a FORK carries an explicit `storeId` pointing at the
 * original's repo plus its own `lineageId`. The runtime engine appId is ALWAYS `id` (the fork
 * gets its own user data) — load-bearing per D8.
 */
export interface InstalledApp {
  /** Launcher id. Original installs: == version-store appId. Forks: a fresh id (engine appId). */
  id: string;
  /** Display name (product surface). */
  name: string;
  /** Seeded example label (first-run apps). */
  example?: boolean;
  /** Epoch ms. */
  createdAt: number;
  /** #41's host-held manifest + schema artifact — verbatim. The gate reads ONLY this. */
  record: AppRecord;
  /** Present only on forks: the version-store repo this entry shares with its original. */
  storeId?: string;
  /** The version-store lineage this entry tracks (`main` for originals; `fork-N` for forks). */
  lineageId: string;
  /** Provenance for the tile/UI only (forks). */
  forkedFrom?: { id: string; name: string };
}

const APP_KEY = (id: string) => `app:${id}`;
const ORDER_KEY = 'order';
const SEED_KEY = 'seed:version';

export class AppIndex {
  constructor(private kv: KVBackend) {}

  private readOrder(): string[] {
    const raw = this.kv.getString(ORDER_KEY);
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private writeOrder(ids: string[]): void {
    this.kv.set(ORDER_KEY, JSON.stringify(ids));
  }

  /** Read one record (or null). */
  get(id: string): InstalledApp | null {
    const raw = this.kv.getString(APP_KEY(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as InstalledApp;
    } catch {
      return null;
    }
  }

  has(id: string): boolean {
    return this.kv.getString(APP_KEY(id)) != null;
  }

  /** All records in install order (newest last). Drops any dangling order id with no record. */
  list(): InstalledApp[] {
    const out: InstalledApp[] = [];
    for (const id of this.readOrder()) {
      const app = this.get(id);
      if (app) out.push(app);
    }
    return out;
  }

  /** Insert (appends to the order) or update in place (order unchanged). */
  put(app: InstalledApp): void {
    const existed = this.has(app.id);
    this.kv.set(APP_KEY(app.id), JSON.stringify(app));
    if (!existed) {
      const ids = this.readOrder();
      ids.push(app.id);
      this.writeOrder(ids);
    }
  }

  /** Drop a record and its order entry; survivors keep their relative order. */
  remove(id: string): void {
    this.kv.delete(APP_KEY(id));
    this.writeOrder(this.readOrder().filter(x => x !== id));
  }

  /** Count installed entries that reference a given version-store repo (the delete refcount). */
  refCount(storeId: string): number {
    return this.list().filter(a => (a.storeId ?? a.id) === storeId).length;
  }

  /** The seed marker (0 on a virgin backend). Gates first-run seeding idempotence (D7). */
  seedVersion(): number {
    const raw = this.kv.getString(SEED_KEY);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  markSeeded(version: number): void {
    this.kv.set(SEED_KEY, String(version));
  }
}
