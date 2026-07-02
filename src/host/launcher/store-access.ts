/**
 * store-access — the ONLY sanctioned path from the launcher to the version store
 * (launcher-shell / #5 D2). Every install / seed / fork / delete / active-bundle read for an
 * installed entry goes through here, so the `storeId` + `lineageId` discipline lives in exactly
 * one place (the ledger contract note: #6 reads through this, never raw `VersionStore`).
 *
 * The two-id model (D2):
 *   • Original install:  launcher id == version-store appId; `storeId` omitted.
 *   • Fork:              a fresh launcher id; `storeId` points at the original's repo; the
 *                        entry tracks its own `lineageId` (`fork-N`).
 * The runtime ENGINE appId is ALWAYS the launcher id (`entry.id`) — a fork gets its own user
 * data even though it shares a repo. This is load-bearing (D8): the realm launches with the
 * launcher id as its engine appId, while version-store access uses `storeId` + lineage.
 *
 * Lineage discipline: exactly one mini-app is foregrounded (one WebView == one realm) and all
 * store access is serialized here, so a small in-memory per-repo lineage cache lets the wrapper
 * `switchLineage` only on an ACTUAL change (D2 "checks first"). `fork()` switches the repo HEAD
 * to the new lineage as a side effect; the cache records that, and the next access to the
 * ORIGINAL switches back. On a fresh process the cache is empty → one safe switch on first use.
 */

import type { VersionStore } from '../version-store';
import type { AppRecord } from '../bridge/contract';
import { AppIndex, InstalledApp } from './app-index';

/** Drop an installed app's per-app user-data store (the storage engine's SQLite db). Device →
 *  op-sqlite `db.delete()`; Node tests → a spy. Injected so store-access stays device-free. */
export type DeleteStorage = (appId: string) => void | Promise<void>;

export interface StoreAccessOptions {
  store: VersionStore;
  index: AppIndex;
  /** Drops the per-launcher-id user-data db. Defaults to a no-op (e.g. seeding-only contexts). */
  deleteStorage?: DeleteStorage;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
}

export interface InstallSpec {
  id: string;
  name: string;
  record: AppRecord;
  bundleSource: string;
  /** The structured prompt tracked as snapshot #1 (honest product string; surfaces in #6). */
  prompt: string;
  example?: boolean;
}

/** The version-store repo an entry reads/writes (its own id for originals; the shared repo for forks). */
export function storeIdOf(entry: InstalledApp): string {
  return entry.storeId ?? entry.id;
}

export class StoreAccess {
  private readonly store: VersionStore;
  private readonly index: AppIndex;
  private readonly deleteStorage: DeleteStorage;
  private readonly now: () => number;
  /** repoId → the lineage the repo HEAD is currently on (this session's knowledge). */
  private readonly repoLineage = new Map<string, string>();

  constructor(opts: StoreAccessOptions) {
    this.store = opts.store;
    this.index = opts.index;
    this.deleteStorage = opts.deleteStorage ?? (() => {});
    this.now = opts.now ?? (() => Date.now());
  }

  /** The runtime engine appId for an entry (D8): always the launcher id. A fork's own user data. */
  engineAppId(entry: InstalledApp): string {
    return entry.id;
  }

  /** Switch the repo to the entry's lineage only if it is not already there (D2 "checks first"). */
  private async ensureLineage(entry: InstalledApp): Promise<void> {
    const repo = storeIdOf(entry);
    if (this.repoLineage.get(repo) === entry.lineageId) return;
    await this.store.switchLineage(repo, entry.lineageId);
    this.repoLineage.set(repo, entry.lineageId);
  }

  /**
   * Install a brand-new app: snapshot the bundle into the store as snapshot #1 (so #6 has
   * history from day one), then write the index entry. Store first, index second (D1: the store
   * is the source of truth). Used by first-run seeding (D7) and, later, #7's generation flow.
   */
  async install(spec: InstallSpec): Promise<InstalledApp> {
    await this.store.snapshot(spec.id, { 'bundle.js': spec.bundleSource }, spec.prompt);
    this.repoLineage.set(spec.id, 'main');
    const entry: InstalledApp = {
      id: spec.id,
      name: spec.name,
      example: spec.example,
      createdAt: this.now(),
      record: spec.record,
      lineageId: 'main',
    };
    this.index.put(entry);
    return entry;
  }

  /** The active snapshot's bundle source for an entry (switching to its lineage first). */
  async activeBundle(entry: InstalledApp): Promise<string> {
    await this.ensureLineage(entry);
    const active = await this.store.active(storeIdOf(entry));
    const src = active?.artifacts['bundle.js'];
    if (src == null) throw new Error(`no active bundle for "${entry.id}"`);
    return src;
  }

  /**
   * Fork an installed entry (D2): version-store fork from the original's current snapshot →
   * a new lineage in the SAME repo, then a new index entry tracking it. The fork shares the
   * repo (and its pre-fork history) but evolves independently and gets its OWN engine appId.
   */
  async fork(entry: InstalledApp): Promise<InstalledApp> {
    const repo = storeIdOf(entry);
    await this.ensureLineage(entry);
    const active = await this.store.active(repo);
    if (!active) throw new Error(`cannot fork "${entry.id}": no active snapshot`);
    const { lineageId } = await this.store.fork(repo, active.id);
    // fork() left the repo HEAD on the new lineage.
    this.repoLineage.set(repo, lineageId);
    const forkEntry: InstalledApp = {
      id: `${repo}__${lineageId}`,
      name: entry.name,
      createdAt: this.now(),
      record: entry.record,
      storeId: repo,
      lineageId,
      forkedFrom: { id: entry.id, name: entry.name },
    };
    this.index.put(forkEntry);
    return forkEntry;
  }

  /**
   * Delete an installed entry (D2): drop the index entry + the per-app user-data db, and — when
   * no installed entry references the repo any longer — the version history too (`store.remove`).
   * A surviving sibling fork keeps the repo (and its own user data). Order matters: remove the
   * index entry FIRST, then refcount the repo against the remaining entries.
   */
  async remove(entry: InstalledApp): Promise<void> {
    const repo = storeIdOf(entry);
    this.index.remove(entry.id);
    await this.deleteStorage(entry.id); // no per-app user-data residue (D8)
    if (this.index.refCount(repo) === 0) {
      await this.store.remove(repo);
      this.repoLineage.delete(repo);
    }
  }
}
