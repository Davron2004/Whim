/**
 * pending-purge — the marker that makes a soft delete survive Whim closing (design-system-v1 D16;
 * app-launcher "Deleting an app leaves no residue").
 *
 * Delete hides an app and arms a purge that completes when its Undo window ends; Discard does the
 * same for a failed or stopped attempt. The window lives in memory, so the marker lives in the
 * launcher KV: Undo clears it, the window's end completes the purge, and a launch completes every
 * purge a closed process left armed. A purge clears its marker only after its last step, so a death
 * part-way through is finished at the next launch (each step is idempotent).
 *
 * Arming hides nothing by itself and deletes nothing: the app stays in the index (so Undo restores
 * it whole and the storage and history refcounts still see it) until the purge completes.
 */

import type { KVBackend } from '../version-store/fs/kv-fs';
import type { AppIndex, InstalledApp } from './app-index';
import type { StoreAccess } from './store-access';
import type { PendingBuildRecord, PendingBuildStore } from './pending-builds';
import type { RunJournalStore } from './run-journal';
import { dropPendingBuild } from './build-lifecycle';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

/** What a purge removes: an installed app, or a pending-build attempt (Discard). */
export type PurgeKind = 'app' | 'attempt';

export interface PurgeMarker {
  readonly kind: PurgeKind;
  readonly id: string;
  /** For an app, the record as it was when the delete was armed: what the purge removes if the
   *  index entry is already gone (a purge that died after dropping it). */
  readonly entry?: InstalledApp;
  /** For an attempt, the `createdAt` of the run Discard was armed for. A change's attempt id is its
   *  app's id, so a later run can reuse it while the marker is armed: the marker hides and removes
   *  only the run it names. Absent on a marker that names no run (written before this field). */
  readonly createdAt?: number;
}

/** The run an attempt purge is armed for: its id and when it was created. */
export type PurgedRun = Pick<PendingBuildRecord, 'id' | 'createdAt'>;

const PURGE_PREFIX = 'purge:';
const PURGE_KEY = (kind: PurgeKind, id: string) => `${PURGE_PREFIX}${kind}:${id}`;

function kindOf(rest: string): PurgeKind | undefined {
  if (rest.startsWith('app:')) return 'app';
  if (rest.startsWith('attempt:')) return 'attempt';
  return undefined;
}

export class PendingPurgeStore {
  constructor(private readonly kv: KVBackend) {}

  /** Arm the purge of an installed app (Delete). */
  armApp(entry: InstalledApp): void {
    this.kv.set(PURGE_KEY('app', entry.id), JSON.stringify(entry));
  }

  /** Arm the purge of a pending-build attempt (Discard), for the run `run` names. */
  armAttempt(run: PurgedRun): void {
    this.kv.set(PURGE_KEY('attempt', run.id), JSON.stringify({ createdAt: run.createdAt }));
  }

  /** Undo: the purge will not happen. A no-op when none is armed. For an attempt, `createdAt` names
   *  the run being cancelled: a marker since armed for another run of the id stays (a marker naming
   *  no run goes, and so does any marker when no run is named). */
  cancel(kind: PurgeKind, id: string, createdAt?: number): void {
    const key = PURGE_KEY(kind, id);
    if (kind === 'attempt' && createdAt !== undefined) {
      const armedFor = this.armedRun(key, id);
      if (armedFor !== undefined && armedFor !== createdAt) return;
    }
    this.kv.delete(key);
  }

  has(kind: PurgeKind, id: string): boolean {
    return this.kv.getString(PURGE_KEY(kind, id)) != null;
  }

  /** Whether a Discard hides this run: one is armed for its id, and for this run of it (a marker
   *  naming no run hides whatever holds the id). */
  hidesAttempt(run: PurgedRun): boolean {
    const key = PURGE_KEY('attempt', run.id);
    if (this.kv.getString(key) == null) return false;
    const armedFor = this.armedRun(key, run.id);
    return armedFor === undefined || armedFor === run.createdAt;
  }

  /** Every armed purge. An app marker whose stored record is unreadable still lists, without it;
   *  so does an attempt marker without its run. */
  list(): PurgeMarker[] {
    const out: PurgeMarker[] = [];
    for (const key of this.kv.getAllKeys()) {
      if (!key.startsWith(PURGE_PREFIX)) continue;
      const rest = key.slice(PURGE_PREFIX.length);
      const kind = kindOf(rest);
      if (kind === undefined) continue;
      const id = rest.slice(kind.length + 1);
      if (kind === 'app') {
        out.push({ kind, id, ...this.storedEntry(key, id) });
      } else {
        const createdAt = this.armedRun(key, id);
        out.push(createdAt === undefined ? { kind, id } : { kind, id, createdAt });
      }
    }
    return out;
  }

  private armedRun(key: string, id: string): number | undefined {
    const raw = this.kv.getString(key);
    if (raw == null) return undefined;
    try {
      const createdAt = (JSON.parse(raw) as { createdAt?: unknown }).createdAt;
      return typeof createdAt === 'number' ? createdAt : undefined;
    } catch (e) {
      log.warn(CHANNELS.app, 'stored discard marker is unreadable', {
        appId: id,
        detail: e instanceof Error ? e.message : String(e),
      });
      return undefined;
    }
  }

  private storedEntry(key: string, id: string): { entry?: InstalledApp } {
    const raw = this.kv.getString(key);
    if (raw == null) return {};
    try {
      const entry = JSON.parse(raw) as InstalledApp;
      return entry.id === id ? { entry } : {};
    } catch (e) {
      log.warn(CHANNELS.app, 'stored purge record is unreadable', {
        appId: id,
        detail: e instanceof Error ? e.message : String(e),
      });
      return {};
    }
  }
}

export interface PurgeDeps {
  purges: PendingPurgeStore;
  index: AppIndex;
  access: StoreAccess;
  pending: PendingBuildStore;
  journal: RunJournalStore;
}

/**
 * Carry out one armed purge, then clear its marker. An app goes through `StoreAccess.remove` (the
 * index entry, then its user data and history when nothing else shares them) along with its
 * retained last-run report; an attempt goes the way a dismiss goes (record and journal), unless a
 * later run now holds its id: that run's record and journal are its own, and the marker just goes —
 * unless it now names that later run (its own leftovers armed since), which keeps it.
 */
export async function completePurge(deps: PurgeDeps, marker: PurgeMarker): Promise<void> {
  if (marker.kind === 'app') {
    const entry = deps.index.get(marker.id) ?? marker.entry;
    if (entry) await deps.access.remove(entry);
    deps.journal.deleteLastRun(marker.id);
  } else if (!heldByLaterRun(deps.pending, marker)) {
    removeAttempt(deps, marker.id);
  }
  deps.purges.cancel(marker.kind, marker.id, marker.createdAt);
}

/** A run other than the one the marker was armed for holds its id (a change made again while the
 *  Discard's window was open, or after a launch that could not finish it). A run starts by writing
 *  its record, so a record that is gone leaves nothing of a later run to spare. */
function heldByLaterRun(pending: PendingBuildStore, marker: PurgeMarker): boolean {
  const current = pending.readCurrent(marker.id)?.record;
  return marker.createdAt !== undefined && current != null && current.createdAt !== marker.createdAt;
}

/**
 * Remove a discarded attempt: its record and order entry, then its journal, each tried whatever
 * the other did, then read back. Anything still there (a removal that threw, or one the store
 * reported and did not do) throws, so the marker stays armed, the attempt stays hidden, and a later
 * launch finishes it. Once everything reads back gone, the store's in-memory view of the attempt (a
 * failure this process could not persist) goes too, so nothing brings the tile back.
 */
function removeAttempt({ pending, journal }: PurgeDeps, id: string): void {
  const errors: string[] = [];
  try {
    dropPendingBuild(pending, id);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  try {
    journal.delete(id);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  const left = [
    ...(pending.get(id) == null ? [] : ['record']),
    ...(pending.isOrderExcluded(id) ? [] : ['order entry']),
    ...(journal.get(id) == null ? [] : ['journal']),
  ];
  if (left.length > 0) {
    const why = errors.length > 0 ? ` (${errors.join('; ')})` : '';
    throw new Error(`the discarded attempt still has its ${left.join(', ')}${why}`);
  }
  pending.forgetRetained(id);
}

/** At launch, before the first grid render: finish every purge a closed process left armed. One
 *  that fails keeps its marker for the next launch and does not stop the others. */
export async function completeInterruptedPurges(deps: PurgeDeps): Promise<void> {
  for (const marker of deps.purges.list()) {
    try {
      await completePurge(deps, marker);
    } catch (e) {
      log.error(CHANNELS.app, 'interrupted purge did not complete', {
        kind: marker.kind,
        appId: marker.id,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
