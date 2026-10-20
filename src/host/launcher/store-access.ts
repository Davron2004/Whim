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
 * Lineage discipline: a repo's HEAD is a single shared mutable cursor, and one repo is shared by
 * an original and ALL of its forks (`storeIdOf`), which are distinct launcher ids. So every
 * operation is serialized PER REPO here (`serial`), which is what makes the small in-memory
 * per-repo lineage cache safe: switch-then-read is atomic against other operations on the same
 * repo, and the cache lets the wrapper `switchLineage` only on an ACTUAL change (D2 "checks
 * first"). `fork()` switches the repo HEAD to the new lineage as a side effect; the cache records
 * that, and the next access to the ORIGINAL switches back. On a fresh process the cache is empty
 * → one safe switch on first use. Operations on DIFFERENT repos stay fully concurrent.
 */

import type { VersionStore, Snapshot, SnapshotContent, Pin, FileChange } from '../version-store';
import type { AppManifest, AppRecord } from '../bridge/contract';
import type { SchemaArtifact } from '../storage-engine/contract';
import { AppIndex, InstalledApp } from './app-index';
import { parsePromptEnvelope } from './prompt-envelope';
import { assignedTile, copyTile, declaredTile, resolveTileRequest, type TileRequest } from './tile-identity';
import { DataCopyError, type CopyStorage } from '../storage-engine/copy-contract';
import { sweepDataCopies, type DataCopyJournal } from './data-copy-journal';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

/** Drop an installed app's per-app user-data store (the storage engine's SQLite db). Device →
 *  op-sqlite `db.delete()`; Node tests → a spy. Injected so store-access stays device-free. */
export type DeleteStorage = (appId: string) => void | Promise<void>;

interface StoreAccessBaseOptions {
  store: VersionStore;
  index: AppIndex;
  /** Drops the per-launcher-id user-data db. Defaults to a no-op (e.g. seeding-only contexts). */
  deleteStorage?: DeleteStorage;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
}

/** The data-copy seam (copy-app-data D3): the snapshot routine and the journal that makes it
 *  crash-safe, injected together or not at all — a copy without its journal could leave a
 *  half-written store behind. Device: `copyStorage` from the storage engine and a journal over the
 *  launcher KV; Node suites: `createNodeCopyStorage(dir)`. */
type DataCopySeam =
  | { copyStorage: CopyStorage; copyJournal: DataCopyJournal }
  | { copyStorage?: undefined; copyJournal?: undefined };

export type StoreAccessOptions = StoreAccessBaseOptions & DataCopySeam;

/** What "Make a copy" does with the original's user data: `'fresh'` (the default) gives the copy an
 *  empty store; `'copy'` gives it a one-time snapshot of the original's store. Either way the copy
 *  gets its own store — no option shares the original's (app-data-copy, linked-apps). */
export interface ForkOptions {
  data?: 'fresh' | 'copy';
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
  /** How the entry gets its tile. Absent: assigned from `record.manifest`'s declaration. */
  tile?: TileRequest;
}

/** The prompt-flow's delivery spec for `StoreAccess.update` (design D7). */
export interface UpdateSpec {
  record: AppRecord;
  bundleSource: string;
  /** The original TypeScript the bundle was compiled from (#52-D5 / D14) — see `InstallSpec.source`. */
  source?: string;
  /** The structured prompt tracked as this snapshot (honest product string; surfaces in #6). */
  prompt: string;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The files a version is saved as: its code, its original source when there is one, and the
 *  manifest and schema the bridge runs it with (`manifest.json`, `schema.json`: decision #36's repo
 *  contents). Both come from the record the version was built with and nowhere else, so the schema
 *  file exists exactly when the record declares a schema. The manifest is saved without the tile
 *  colour: that is the host's, kept on the app, never moved by a version (`versionRecord`). */
function versionFiles(spec: { record: AppRecord; bundleSource: string; source?: string }): Record<string, string> {
  const manifest = { ...spec.record.manifest };
  delete manifest.tileColor;
  return {
    'bundle.js': spec.bundleSource,
    ...(spec.source != null ? { 'source.ts': spec.source } : {}),
    'manifest.json': JSON.stringify(manifest),
    ...(spec.record.schemaArtifact != null ? { 'schema.json': JSON.stringify(spec.record.schemaArtifact) } : {}),
  };
}

/** What a saved version declares about itself (`versionFiles`): its manifest and, when it declares
 *  storage, its schema. `null` for a version saved before versions kept their manifest. */
interface VersionDeclaration {
  manifest: AppManifest;
  schemaArtifact?: SchemaArtifact;
}

/** Reads `version`'s declaration. Throws when its files cannot be parsed — callers read it before
 *  anything moves, so a damaged version is refused while the app is still where it was. */
function versionDeclaration(version: SnapshotContent): VersionDeclaration | null {
  const manifestFile = version.artifacts['manifest.json'];
  if (manifestFile == null) return null;
  const manifest = JSON.parse(manifestFile) as AppManifest;
  delete manifest.tileColor; // a version saved before the colour was left out of its manifest
  const schemaFile = version.artifacts['schema.json'];
  return { manifest, ...(schemaFile != null ? { schemaArtifact: JSON.parse(schemaFile) as SchemaArtifact } : {}) };
}

/**
 * The record a version runs with: what it declares (`versionDeclaration`) over the host's own fields
 * of `current` (the app id, its name, and the tile colour, which a version switch never moves).
 *
 * KNOWN LIMITATION (pre-release, accepted — decision #81): a version saved before versions kept
 * their manifest (`declared` null) runs with `current` unchanged, which is whatever record the app
 * holds now — possibly a later version's. Its own manifest was never saved, so there is nothing
 * truer to run it with.
 *
 * The schema is the version's own declared artifact, never the store's: the engine keeps the
 * accumulated union in `_meta`, so an older version opens its store as an older subset — no DDL,
 * nothing dropped — and the fields a later version added stay in the store, unnamed by the older
 * code and so unused by it, until a version that names them runs again.
 */
function versionRecord(current: AppRecord, declared: VersionDeclaration | null): AppRecord {
  if (declared == null) return current;
  const manifest = { ...declared.manifest };
  if (current.manifest.tileColor !== undefined) manifest.tileColor = current.manifest.tileColor;
  return {
    appId: current.appId,
    name: current.name,
    manifest,
    ...(declared.schemaArtifact != null ? { schemaArtifact: declared.schemaArtifact } : {}),
  };
}

/** `value` as JSON with every object's keys sorted, so two records that say the same compare equal. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/** What a launch runs (`StoreAccess.activeLaunch`): the app as the index holds it, carrying the
 *  record its active version runs with; that version's code; and its id. */
export interface ActiveLaunch {
  app: InstalledApp;
  source: string;
  versionId: string;
}

/** What a change of an app is made from (`StoreAccess.activeEdit`): the app carrying the record its
 *  active version runs with, that version's original TypeScript when it has one (`source.ts`, never
 *  the bundle), the words that made it, and its id. */
export interface ActiveEdit {
  app: InstalledApp;
  source?: string;
  description?: string;
  versionId: string;
}

/** The version-store repo an entry reads/writes (its own id for originals; the shared repo for forks). */
export function storeIdOf(entry: InstalledApp): string {
  return entry.storeId ?? entry.id;
}

export class StoreAccess {
  private readonly store: VersionStore;
  private readonly index: AppIndex;
  private readonly deleteStorage: DeleteStorage;
  private readonly copyStorage: CopyStorage | undefined;
  private readonly copyJournal: DataCopyJournal | undefined;
  private readonly now: () => number;
  /** The copy appIds whose data copy is running in this process (the sweep leaves them alone). */
  private readonly copying = new Set<string>();
  /** Whether "Copy the data" can be offered: true exactly when the data-copy seam was injected. */
  readonly canCopyData: boolean;
  /** repoId → the lineage the repo HEAD is currently on (this session's knowledge). */
  private readonly repoLineage = new Map<string, string>();
  /** repoId → the tail of that repo's in-flight operation chain (see `serial`). */
  private readonly chains = new Map<string, Promise<unknown>>();
  /** repoId → version id → the schema that version declares (`schemaOf`); dropped with the repo. */
  private readonly schemas = new Map<string, Map<string, SchemaArtifact | null>>();

  constructor(opts: StoreAccessOptions) {
    this.store = opts.store;
    this.index = opts.index;
    this.deleteStorage = opts.deleteStorage ?? (() => {});
    this.copyStorage = opts.copyStorage;
    this.copyJournal = opts.copyJournal;
    this.canCopyData = opts.copyStorage !== undefined;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Per-repo async mutex: `op` runs with exclusive access to one version-store repo.
   *
   * Every public method here is a check-then-act across `await`s — `ensureLineage` reads the
   * per-repo lineage cache, `switchLineage`s the repo HEAD, then reads/writes through that HEAD —
   * and one repo is shared by an original and all of its forks, which are DIFFERENT launcher ids.
   * The launcher's per-app busy gate (`app-busy.ts`) is keyed by launcher id, so it does not
   * serialize them: an un-awaited call on a fork (the prompt flow's `activeDescription`) can
   * interleave with an "Open" on the original, and the loser's read lands on the other lineage's
   * snapshot — wrong data, silently. Chaining each operation onto the previous one for the same
   * repo makes switch + read atomic against every other operation on that repo. Different repos
   * never share a chain, so they stay fully concurrent.
   */
  private serial<T>(repo: string, op: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(repo);
    // `prev` is a neutralized tail (below), so it never rejects: a failed operation ORDERS the
    // next one without failing it. That rejection is not lost — it is delivered to its own caller
    // through the `result` promise that caller already holds; it is swallowed for chaining only.
    const result = prev != null ? prev.then(op) : op();
    // Both handlers, so the tail settles whatever the operation did. It also drains its own map
    // entry once the repo goes idle, so a long-lived StoreAccess doesn't retain one settled
    // promise per repo forever — guarded, because a later operation may already own the slot.
    const slot: { tail?: Promise<void> } = {};
    const drain = (): void => {
      if (this.chains.get(repo) === slot.tail) this.chains.delete(repo);
    };
    slot.tail = result.then(drain, drain);
    this.chains.set(repo, slot.tail);
    return result;
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
    return this.serial(spec.id, async () => {
      await this.store.snapshot(spec.id, versionFiles(spec), spec.prompt);
      this.repoLineage.set(spec.id, 'main');
      // Assigned against the index as it is NOW, with no await before the write below, so two
      // installs landing together cannot both take the same free tint.
      const others = this.index.list().filter((app) => app.id !== spec.id);
      const request = spec.tile ?? { kind: 'assign', declared: declaredTile(spec.record.manifest, spec.id, spec.name) };
      const tile = resolveTileRequest(request, others);
      const entry: InstalledApp = {
        id: spec.id,
        name: spec.name,
        example: spec.example,
        createdAt: this.now(),
        record: spec.record,
        lineageId: 'main',
        tint: tile.tint,
        icon: tile.icon,
      };
      this.index.put(entry);
      return entry;
    });
  }

  /**
   * Deliver a new version onto an already-installed entry's own lineage (design D7 — the prompt
   * flow's "update" path): a snapshot (bundle + optional schema artifact) followed by an index
   * record refresh. `id`/`lineageId`/`createdAt` are untouched; only `record` changes.
   *
   * The tile is host state, not the wire's: the assigned tint and glyph and any override are read
   * from the index entry as it is at write time (never the caller's possibly stale `entry`, which
   * would undo an override set while this ran), so a rebuild never moves the tile. A record from
   * before tints gets the tile it was showing written down here.
   */
  async update(entry: InstalledApp, spec: UpdateSpec): Promise<InstalledApp> {
    return this.serial(storeIdOf(entry), async () => {
      await this.ensureLineage(entry);
      await this.store.snapshot(storeIdOf(entry), versionFiles(spec), spec.prompt);
      // `entry.name` is deliberately NOT refreshed from `spec.record.name` here (they can differ —
      // `mapWireRecord` sets `record.name = wire.name`). `app.name` is what tile-colour resolution
      // hashes for a record with no declared/injected colour (`tiles.ts#tileColor` -> `fallbackTint(name)`
      // via `AppTile`); build-lifecycle.ts's `deliverResult` PRESERVE comment depends on this holding
      // in the other direction. Adopting the new name here would move that app's hue on its next
      // rename-carrying rebuild. Pinned: store-access.suite.ts §34.
      const current = this.index.get(entry.id) ?? entry;
      const { tint, icon } = assignedTile(current);
      const updated: InstalledApp = { ...entry, record: spec.record, tint, icon };
      if (current.tileOverride) updated.tileOverride = current.tileOverride;
      else delete updated.tileOverride;
      this.index.put(updated);
      return updated;
    });
  }

  /** The active snapshot's bundle source for an entry (switching to its lineage first). */
  async activeBundle(entry: InstalledApp): Promise<string> {
    return this.serial(storeIdOf(entry), async () => {
      await this.ensureLineage(entry);
      const active = await this.store.active(storeIdOf(entry));
      const src = active?.artifacts['bundle.js'];
      if (src == null) throw new Error(`no active bundle for "${entry.id}"`);
      return src;
    });
  }

  /**
   * What a launch of `entry` runs (decision #81): its active version's code and the record that
   * version runs with (`versionRecord`), read together in one `serial` section, so no version switch
   * can land between them. The record comes from the version, never from the caller's `entry` — a
   * copy of it can be older than an Undo that has landed since — and the host's own fields from the
   * index as it is now. When the index holds another record for the entry (a write that failed after
   * the version moved), the derived one is written down, so every other reader agrees again; that
   * write failing does not stop the launch.
   */
  async activeLaunch(entry: InstalledApp): Promise<ActiveLaunch> {
    return this.serial(storeIdOf(entry), async () => {
      const { active, app } = await this.readActive(entry);
      const source = active.artifacts['bundle.js'];
      if (source == null) throw new Error(`no active bundle for "${entry.id}"`);
      return { app, source, versionId: active.id };
    });
  }

  /**
   * What a change of `entry` is made from: its ACTIVE version's original source and words and the
   * record that version runs with, read together in one `serial` section exactly as `activeLaunch`
   * reads a launch, so a change request never describes one version's code with another's manifest
   * (a caller's copy of the entry can be older than an Undo, or than a record write that failed).
   *
   * The active version, not the one a running realm happens to show: delivery builds on the active
   * version (`build-lifecycle.ts#deliverResult` updates it at the tip, or continues from it behind
   * the tip), so the request describes the version the change will follow. A running app is behind
   * the active version only when a change landed and was not reloaded (or a switch landed over it);
   * changing the code it shows would silently drop that landed change from the app's line.
   */
  async activeEdit(entry: InstalledApp): Promise<ActiveEdit> {
    return this.serial(storeIdOf(entry), async () => {
      const { active, app } = await this.readActive(entry);
      const source = active.artifacts['source.ts'];
      return {
        app,
        ...(source != null ? { source } : {}),
        description: parsePromptEnvelope(active.prompt).text,
        versionId: active.id,
      };
    });
  }

  /** The active version of `entry` and the app carrying the record it runs with (`versionRecord`), the
   *  record written down when the index holds another. Runs inside the caller's `serial(repo)`. */
  private async readActive(entry: InstalledApp): Promise<{ active: SnapshotContent; app: InstalledApp }> {
    await this.ensureLineage(entry);
    const active = await this.store.active(storeIdOf(entry));
    if (active == null) throw new Error(`no active version for "${entry.id}"`);
    const current = this.index.get(entry.id);
    const app = current ?? entry;
    const record = versionRecord(app.record, versionDeclaration(active));
    if (current != null && canonicalJson(current.record) !== canonicalJson(record)) this.writeRecord(current, record);
    return { active, app: { ...app, record } };
  }

  /** The active snapshot's ORIGINAL TypeScript source for an entry (#52-D5 / D14) — the genuine
   *  `source.ts` artifact, never `activeBundle`'s compiled `bundle.js`. Returns `undefined` when
   *  this snapshot predates source tracking: absence is a legitimate legacy state, reported
   *  honestly, never silently substituted with the bundle. */
  async activeSource(entry: InstalledApp): Promise<string | undefined> {
    return this.serial(storeIdOf(entry), async () => {
      await this.ensureLineage(entry);
      const active = await this.store.active(storeIdOf(entry));
      return active?.artifacts['source.ts'];
    });
  }

  /**
   * The prompt that produced this entry's CURRENT version, as the user's own words — read-only,
   * best-effort context for a re-prompt (`generation-request.ts#buildRewriteAppContext`'s
   * `description`, sent to both the clarify and rewrite calls). Resolved through
   * `parsePromptEnvelope` the same way `history-logic.ts#buildHistoryRows` reads a snapshot's
   * prompt, so a v1 envelope or a raw legacy string reads exactly as honestly here as there.
   * `undefined` when the entry has never snapshotted — a legitimate state, never an error; callers
   * decide what "no description" means for their own request (`buildRewriteAppContext` omits the
   * field entirely).
   */
  async activeDescription(entry: InstalledApp): Promise<string | undefined> {
    return this.serial(storeIdOf(entry), async () => {
      await this.ensureLineage(entry);
      const active = await this.store.active(storeIdOf(entry));
      if (active == null) return undefined;
      return parsePromptEnvelope(active.prompt).text;
    });
  }

  /** This entry's own lineage line, newest-first (D6) — an ancestry walk from its active tip. */
  async history(entry: InstalledApp, opts?: { limit?: number }): Promise<Snapshot[]> {
    return this.serial(storeIdOf(entry), async () => {
      await this.ensureLineage(entry);
      return this.store.history(storeIdOf(entry), opts);
    });
  }

  /** Same as `history`, but survives a rollback: later same-line snapshots stay listed (D6). */
  async timeline(entry: InstalledApp, opts?: { limit?: number }): Promise<Snapshot[]> {
    return this.serial(storeIdOf(entry), async () => {
      await this.ensureLineage(entry);
      return this.store.timeline(storeIdOf(entry), opts);
    });
  }

  /** Move this entry's active snapshot (non-destructive — later snaps stay reachable) (D6), and the
   *  entry's record with it: the app runs that version with the manifest and schema it was saved
   *  with (`versionRecord`). The version is read before anything moves, so one that cannot be read
   *  is refused with the app where it was. The record is read from the index as it is now, so
   *  nothing set on the entry since the caller read it is undone, and an entry removed meanwhile is
   *  not written back. The index write is a copy: when it fails the switch still stands and is
   *  reported, and the next launch, which derives the record from the version (`activeLaunch`),
   *  writes it down. */
  async rollback(entry: InstalledApp, snapshotId: string): Promise<{ activeId: string }> {
    const repo = storeIdOf(entry);
    return this.serial(repo, async () => {
      await this.ensureLineage(entry);
      const declared = versionDeclaration(await this.store.getSnapshot(repo, snapshotId));
      const moved = await this.store.rollback(repo, snapshotId);
      const current = this.index.get(entry.id);
      if (current != null) this.writeRecord(current, versionRecord(current.record, declared));
      return moved;
    });
  }

  /** Write `entry` down running `record`, with the tile it shows (as `update` does), so a record from
   *  before tints keeps showing the tile it showed. Only ever a copy of what the version declares, so
   *  a failure is logged, not thrown: the next launch derives the record again and retries. */
  private writeRecord(entry: InstalledApp, record: AppRecord): void {
    const { tint, icon } = assignedTile(entry);
    try {
      this.index.put({ ...entry, record, tint, icon });
    } catch (e) {
      log.warn(CHANNELS.app, 'an app record could not be written down', { appId: entry.id, detail: messageOf(e) });
    }
  }

  /**
   * The schema every saved version declares, of every app whose code opens `entry`'s store: each
   * entry of `entry`'s repo in its storage group (a rewind continuation shares it), over each one's
   * whole timeline, so it includes versions delivered and never opened and the ones a rollback left
   * behind. A version saved before versions kept their schema contributes nothing. A change request
   * sends the fields these declare that the store does not hold (`generation-request.ts`).
   *
   * A version never changes once saved, so each one's schema is read once per repo and kept
   * (`schemaOf`): a change request reads only the versions saved since the last one, rather than
   * every file of every version while it holds the repo.
   */
  async declaredSchemas(entry: InstalledApp): Promise<SchemaArtifact[]> {
    const repo = storeIdOf(entry);
    const group = this.engineAppId(entry);
    return this.serial(repo, async () => {
      const sharers = this.index.list().filter((e) => e.id !== entry.id && storeIdOf(e) === repo && this.engineAppId(e) === group);
      const seen = new Set<string>();
      const schemas: SchemaArtifact[] = [];
      for (const member of [entry, ...sharers]) {
        await this.ensureLineage(member);
        for (const { id } of await this.store.timeline(repo, { limit: Number.POSITIVE_INFINITY })) {
          if (seen.has(id)) continue;
          seen.add(id);
          const schema = await this.schemaOf(repo, id);
          if (schema != null) schemas.push(schema);
        }
      }
      return schemas;
    });
  }

  /** The schema version `id` of `repo` declares (`null`: none, or saved before versions kept it),
   *  read from the store the first time only. Runs inside the caller's `serial(repo)`. */
  private async schemaOf(repo: string, id: string): Promise<SchemaArtifact | null> {
    let kept = this.schemas.get(repo);
    if (kept == null) {
      kept = new Map();
      this.schemas.set(repo, kept);
    }
    const known = kept.get(id);
    if (known !== undefined) return known;
    const schema = versionDeclaration(await this.store.getSnapshot(repo, id))?.schemaArtifact ?? null;
    kept.set(id, schema);
    return schema;
  }

  /** Label a snapshot (D6/D8): re-pinning an existing label MOVES it (last write wins) —
   *  verified against the engine's tag-based pin storage (`force: true`, never throws). */
  async pin(entry: InstalledApp, snapshotId: string, label: string): Promise<Pin> {
    return this.serial(storeIdOf(entry), async () => {
      await this.ensureLineage(entry);
      return this.store.pin(storeIdOf(entry), snapshotId, label);
    });
  }

  /** This entry's pins (D6). */
  async listPins(entry: InstalledApp): Promise<Pin[]> {
    return this.serial(storeIdOf(entry), async () => {
      await this.ensureLineage(entry);
      return this.store.listPins(storeIdOf(entry));
    });
  }

  /** Per-file changes between two of this entry's snapshots (D6). */
  async diff(entry: InstalledApp, fromId: string, toId: string): Promise<FileChange[]> {
    return this.serial(storeIdOf(entry), async () => {
      await this.ensureLineage(entry);
      return this.store.diff(storeIdOf(entry), fromId, toId);
    });
  }

  /** This entry's current active snapshot id, or null if it has never snapshotted (D6). Thin
   *  wrapper over `active()` for the history screen's current-marker. */
  async activeId(entry: InstalledApp): Promise<string | null> {
    return this.serial(storeIdOf(entry), async () => {
      await this.ensureLineage(entry);
      const active = await this.store.active(storeIdOf(entry));
      return active?.id ?? null;
    });
  }

  /** Fork `entry`'s lineage in the version store from `versionId` (or its active snapshot) and
   *  return the new lineage with what the version it starts from declares, read before the fork.
   *  Runs inside the caller's `serial(repo)` section. */
  private async forkLineage(
    entry: InstalledApp,
    repo: string,
    versionId: string | undefined,
  ): Promise<{ lineageId: string; declared: VersionDeclaration | null }> {
    await this.ensureLineage(entry);
    let version: SnapshotContent;
    if (versionId != null) {
      version = await this.store.getSnapshot(repo, versionId);
    } else {
      const active = await this.store.active(repo);
      if (!active) throw new Error(`cannot fork "${entry.id}": no active snapshot`);
      version = active;
    }
    const declared = versionDeclaration(version);
    const { lineageId } = await this.store.fork(repo, version.id);
    // fork() left the repo HEAD on the new lineage.
    this.repoLineage.set(repo, lineageId);
    return { lineageId, declared };
  }

  /** The index entry for a new lineage of `entry`'s repo, running the version it starts from with the
   *  record that version declares (`versionRecord`). Its tile is the original's glyph with the tint
   *  farthest from the original's among the least used — read from the index now, so an override set since the caller
   *  read `entry` counts. No await may sit between this and the `index.put` that writes it, so two
   *  copies landing together cannot take the same tint. */
  private lineageEntry(
    entry: InstalledApp,
    repo: string,
    from: { lineageId: string; declared: VersionDeclaration | null },
    storageGroupId?: string,
  ): InstalledApp {
    const current = this.index.get(entry.id) ?? entry;
    const tile = copyTile(current, this.index.list());
    const { lineageId } = from;
    return {
      id: `${repo}__${lineageId}`,
      name: entry.name,
      createdAt: this.now(),
      record: versionRecord(current.record, from.declared),
      storeId: repo,
      lineageId,
      forkedFrom: { id: entry.id, name: entry.name },
      ...(storageGroupId != null ? { storageGroupId } : {}),
      tint: tile.tint,
      icon: tile.icon,
    };
  }

  /**
   * "Make a copy" (D2; copy-app-data D2/D3): version-store fork from a snapshot → a new lineage in
   * the SAME repo, then a new index entry tracking it. The copy shares the repo (and its pre-fork
   * history) but evolves independently, and ALWAYS gets its own engine appId (its launcher id):
   * no option places it in the original's storage group. `versionId` forks from that snapshot
   * instead of the entry's current active one ("make this version its own app").
   *
   * `opts.data` decides what the copy's store starts with: `'fresh'` (the default) an empty store;
   * `'copy'` a verified one-time snapshot of the store `entry` resolves to (`engineAppId`: its
   * group's when it is grouped). Either way a stray store file under the copy's appId is deleted
   * before the entry exists, and an appId some entry already uses is refused, never overwritten.
   * A `'copy'` is all-or-nothing: the journal records the copy's appId before any byte is
   * written, the snapshot is written and verified, and only then is the index entry written — the
   * commit. A failure deletes what the copy wrote, writes no entry and rejects with a
   * `DataCopyError`; a process death is settled by `sweepDataCopies` at the next launch. A
   * `'copy'` on an instance without the seam rejects before any write. The version-store lineage
   * a failed copy forked stays behind, unused and invisible, like any fork whose entry was never
   * written.
   */
  async fork(entry: InstalledApp, versionId?: string, opts?: ForkOptions): Promise<InstalledApp> {
    const data = opts?.data ?? 'fresh';
    if (data !== 'fresh' && data !== 'copy') throw new Error(`cannot fork "${entry.id}": unknown data option "${String(data)}"`);
    const seam = this.copyStorage && this.copyJournal ? { copy: this.copyStorage, journal: this.copyJournal } : undefined;
    if (data === 'copy' && !seam) throw new Error(`cannot copy the data of "${entry.id}": this build has no data copy`);
    const repo = storeIdOf(entry);
    return this.serial(repo, async () => {
      const forked = await this.forkLineage(entry, repo, versionId);
      const copyAppId = `${repo}__${forked.lineageId}`;
      if (this.index.has(copyAppId) || this.index.storageRefCount(copyAppId) > 0) {
        // Fork ids are never reused while their repo lives; an entry here is a broken invariant,
        // and both that entry and its store must stay as they are.
        throw new DataCopyError('io', `cannot make a copy: an app already uses "${copyAppId}"`);
      }
      const commit = (): InstalledApp => {
        const forkEntry = this.lineageEntry(entry, repo, forked);
        this.index.put(forkEntry);
        return forkEntry;
      };
      if (data === 'copy' && seam) return this.copyData(seam, this.engineAppId(entry), copyAppId, commit);
      await this.deleteStorage(copyAppId); // a stray file never leaks into a fresh copy
      return commit();
    });
  }

  /**
   * The data step of a `'copy'` fork (copy-app-data D2, steps 2–6), inside the repo's `serial`
   * section, for a `copyAppId` no entry uses: journal → stray guard → snapshot (verified by
   * `copyStorage`) → `commit` (the index entry) → clear the journal. A failure before the commit
   * deletes the copy's store and then clears the journal; when that delete fails the record stays,
   * and the next launch's sweep finishes it.
   */
  private async copyData(
    seam: { copy: CopyStorage; journal: DataCopyJournal },
    sourceAppId: string,
    copyAppId: string,
    commit: () => InstalledApp,
  ): Promise<InstalledApp> {
    seam.journal.put({ copyAppId, sourceAppId, startedAt: this.now() });
    this.copying.add(copyAppId);
    let committed: InstalledApp;
    try {
      await this.deleteStorage(copyAppId); // a stray file never leaks into the copy
      await seam.copy({ from: sourceAppId, to: copyAppId });
      committed = commit();
    } catch (e) {
      await this.discardCopy(seam.journal, copyAppId);
      throw e instanceof DataCopyError ? e : new DataCopyError('io', `cannot copy the data: ${messageOf(e)}`, e);
    } finally {
      this.copying.delete(copyAppId);
    }
    try {
      seam.journal.clear(copyAppId);
    } catch (e) {
      // The copy is committed; its leftover record only costs the next launch's sweep a clear.
      log.warn(CHANNELS.app, 'a finished data copy is still recorded', { appId: copyAppId, detail: messageOf(e) });
    }
    return committed;
  }

  /** Undo an uncommitted copy: drop any index record the failed commit may have left, delete the
   *  store, then clear the journal. Whatever fails here leaves the record for the launch sweep. */
  private async discardCopy(journal: DataCopyJournal, copyAppId: string): Promise<void> {
    try {
      this.index.remove(copyAppId);
      await this.deleteStorage(copyAppId);
      journal.clear(copyAppId);
    } catch (cleanup) {
      log.error(CHANNELS.app, 'a failed data copy could not be cleaned up yet', { appId: copyAppId, detail: messageOf(cleanup) });
    }
  }

  /**
   * A rewind continuation (linked-apps "Rewind continuations share by default"; #53 D5): a new
   * lineage from `entry`'s active snapshot whose entry joins `entry`'s storage group — the
   * founder's own id, whether `entry` is the founder or already a member, so membership is never
   * re-rooted at an intermediate member. The only creation path that can share a store; "Make a
   * copy" goes through `fork`, which cannot.
   */
  async continueSharingData(entry: InstalledApp): Promise<InstalledApp> {
    const repo = storeIdOf(entry);
    return this.serial(repo, async () => {
      const forked = await this.forkLineage(entry, repo, undefined);
      const continuation = this.lineageEntry(entry, repo, forked, this.engineAppId(entry));
      this.index.put(continuation);
      return continuation;
    });
  }

  /**
   * At launch, before any app's store is opened: settle every data copy a closed process left
   * unfinished (`sweepDataCopies`). Copies running in this process are left alone. A no-op without
   * the data-copy seam.
   */
  async sweepDataCopies(): Promise<void> {
    if (!this.copyJournal) return;
    await sweepDataCopies({
      journal: this.copyJournal,
      index: this.index,
      deleteStorage: this.deleteStorage,
      inFlight: (copyAppId) => this.copying.has(copyAppId),
    });
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
    return this.serial(repo, async () => {
      const groupId = this.engineAppId(entry);
      this.index.remove(entry.id);
      if (this.index.storageRefCount(groupId) === 0) {
        await this.deleteStorage(groupId); // no residue once no entry resolves to the group (D3)
      }
      if (this.index.refCount(repo) === 0) {
        await this.store.remove(repo);
        this.repoLineage.delete(repo);
        this.schemas.delete(repo);
      }
    });
  }
}
