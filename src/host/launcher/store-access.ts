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

import type { VersionStore, Snapshot, Pin, FileChange } from '../version-store';
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
  /** The original TypeScript the bundle was compiled from (#52-D5 / D14), written as the
   *  snapshot's own `source.ts` artifact — distinct from `bundle.js`. Absent for install paths
   *  with no original source to track (e.g. the first-run seed examples, which ship only a
   *  compiled bundle): a legitimate legacy state, never a fallback to `bundleSource`. */
  source?: string;
  /** The structured prompt tracked as snapshot #1 (honest product string; surfaces in #6). */
  prompt: string;
  example?: boolean;
  /** Optional storage-engine schema artifact, written alongside `bundle.js` when supplied (D7). */
  schemaJson?: string;
}

/** The prompt-flow's delivery spec for `StoreAccess.update` (design D7). */
export interface UpdateSpec {
  record: AppRecord;
  bundleSource: string;
  /** The original TypeScript the bundle was compiled from (#52-D5 / D14) — see `InstallSpec.source`. */
  source?: string;
  /** Optional storage-engine schema artifact, written alongside `bundle.js` when supplied (D7). */
  schemaJson?: string;
  /** The structured prompt tracked as this snapshot (honest product string; surfaces in #6). */
  prompt: string;
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

  /**
   * The runtime engine appId for an entry (D8, extended by linked-apps-data-model D1): the
   * entry's storage group id when it belongs to one (the founding entry's own launcher id),
   * otherwise its own launcher id — an ungrouped entry's own user data, exactly as before.
   */
  engineAppId(entry: InstalledApp): string {
    return entry.storageGroupId ?? entry.id;
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
    await this.store.snapshot(
      spec.id,
      {
        'bundle.js': spec.bundleSource,
        ...(spec.source != null ? { 'source.ts': spec.source } : {}),
        ...(spec.schemaJson != null ? { 'schema.json': spec.schemaJson } : {}),
      },
      spec.prompt,
    );
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

  /**
   * Deliver a new version onto an already-installed entry's own lineage (design D7 — the prompt
   * flow's "update" path): a snapshot (bundle + optional schema artifact) followed by an index
   * record refresh. `id`/`lineageId`/`createdAt` are untouched; only `record` changes.
   */
  async update(entry: InstalledApp, spec: UpdateSpec): Promise<InstalledApp> {
    await this.ensureLineage(entry);
    await this.store.snapshot(
      storeIdOf(entry),
      {
        'bundle.js': spec.bundleSource,
        ...(spec.source != null ? { 'source.ts': spec.source } : {}),
        ...(spec.schemaJson != null ? { 'schema.json': spec.schemaJson } : {}),
      },
      spec.prompt,
    );
    const updated: InstalledApp = { ...entry, record: spec.record };
    this.index.put(updated);
    return updated;
  }

  /** The active snapshot's bundle source for an entry (switching to its lineage first). */
  async activeBundle(entry: InstalledApp): Promise<string> {
    await this.ensureLineage(entry);
    const active = await this.store.active(storeIdOf(entry));
    const src = active?.artifacts['bundle.js'];
    if (src == null) throw new Error(`no active bundle for "${entry.id}"`);
    return src;
  }

  /** The active snapshot's ORIGINAL TypeScript source for an entry (#52-D5 / D14) — the genuine
   *  `source.ts` artifact, never `activeBundle`'s compiled `bundle.js`. Returns `undefined` when
   *  this snapshot predates source tracking: absence is a legitimate legacy state, reported
   *  honestly, never silently substituted with the bundle. */
  async activeSource(entry: InstalledApp): Promise<string | undefined> {
    await this.ensureLineage(entry);
    const active = await this.store.active(storeIdOf(entry));
    return active?.artifacts['source.ts'];
  }

  /** This entry's own lineage line, newest-first (D6) — an ancestry walk from its active tip. */
  async history(entry: InstalledApp, opts?: { limit?: number }): Promise<Snapshot[]> {
    await this.ensureLineage(entry);
    return this.store.history(storeIdOf(entry), opts);
  }

  /** Same as `history`, but survives a rollback: later same-line snapshots stay listed (D6). */
  async timeline(entry: InstalledApp, opts?: { limit?: number }): Promise<Snapshot[]> {
    await this.ensureLineage(entry);
    return this.store.timeline(storeIdOf(entry), opts);
  }

  /** Move this entry's active snapshot (non-destructive — later snaps stay reachable) (D6). */
  async rollback(entry: InstalledApp, snapshotId: string): Promise<{ activeId: string }> {
    await this.ensureLineage(entry);
    return this.store.rollback(storeIdOf(entry), snapshotId);
  }

  /** Label a snapshot (D6/D8): re-pinning an existing label MOVES it (last write wins) —
   *  verified against the engine's tag-based pin storage (`force: true`, never throws). */
  async pin(entry: InstalledApp, snapshotId: string, label: string): Promise<Pin> {
    await this.ensureLineage(entry);
    return this.store.pin(storeIdOf(entry), snapshotId, label);
  }

  /** This entry's pins (D6). */
  async listPins(entry: InstalledApp): Promise<Pin[]> {
    await this.ensureLineage(entry);
    return this.store.listPins(storeIdOf(entry));
  }

  /** Per-file changes between two of this entry's snapshots (D6). */
  async diff(entry: InstalledApp, fromId: string, toId: string): Promise<FileChange[]> {
    await this.ensureLineage(entry);
    return this.store.diff(storeIdOf(entry), fromId, toId);
  }

  /** This entry's current active snapshot id, or null if it has never snapshotted (D6). Thin
   *  wrapper over `active()` for the history screen's current-marker. */
  async activeId(entry: InstalledApp): Promise<string | null> {
    await this.ensureLineage(entry);
    const active = await this.store.active(storeIdOf(entry));
    return active?.id ?? null;
  }

  /**
   * Fork an installed entry (D2): version-store fork from a snapshot → a new lineage in the
   * SAME repo, then a new index entry tracking it. The fork shares the repo (and its pre-fork
   * history) but evolves independently and gets its OWN engine appId (unless it joins a storage
   * group, below). `versionId` (D6/research fact 2) forks from that snapshot instead of the
   * entry's current active one — "make this version its own app" reuses this same fork→install
   * flow unchanged.
   *
   * `opts.shareData` (linked-apps-data-model D2) decides storage-group membership at creation
   * time only: when true, the new entry's `storageGroupId` copies `entry.storageGroupId ??
   * entry.id` (the founder's own id, whether `entry` is the founder or already a sharer — group
   * membership is never re-rooted at an intermediate fork); when false/absent (including no
   * third argument at all — every pre-existing call site), the new entry gets no
   * `storageGroupId` and keeps its own group, exactly as before this change.
   */
  async fork(entry: InstalledApp, versionId?: string, opts?: { shareData?: boolean }): Promise<InstalledApp> {
    const repo = storeIdOf(entry);
    await this.ensureLineage(entry);
    let snapshotId: string;
    if (versionId != null) {
      snapshotId = versionId;
    } else {
      const active = await this.store.active(repo);
      if (!active) throw new Error(`cannot fork "${entry.id}": no active snapshot`);
      snapshotId = active.id;
    }
    const { lineageId } = await this.store.fork(repo, snapshotId);
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
      storageGroupId: opts?.shareData ? (entry.storageGroupId ?? entry.id) : undefined,
    };
    this.index.put(forkEntry);
    return forkEntry;
  }

  /**
   * Delete an installed entry (D2, refcounting extended by linked-apps-data-model D3): drop the
   * index entry, then drop the group's user-data db only when no remaining entry resolves to it
   * (`storageRefCount`), and drop the repo's version history only when no remaining entry
   * references it (`refCount`) — two independent refcounts, since a storage group and a
   * version-store repo need not have the same membership. A surviving group member or sibling
   * fork keeps its shared resource intact. Order matters: remove the index entry FIRST, then
   * refcount both resources against the remaining entries.
   */
  async remove(entry: InstalledApp): Promise<void> {
    const repo = storeIdOf(entry);
    const groupId = this.engineAppId(entry);
    this.index.remove(entry.id);
    if (this.index.storageRefCount(groupId) === 0) {
      await this.deleteStorage(groupId); // no residue once no entry resolves to the group (D3)
    }
    if (this.index.refCount(repo) === 0) {
      await this.store.remove(repo);
      this.repoLineage.delete(repo);
    }
  }
}
