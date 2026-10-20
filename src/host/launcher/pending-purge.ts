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
import type { PendingBuildStore } from './pending-builds';
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
}

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

  /** Arm the purge of a pending-build attempt (Discard). */
  armAttempt(id: string): void {
    this.kv.set(PURGE_KEY('attempt', id), '{}');
  }

  /** Undo: the purge will not happen. A no-op when none is armed. */
  cancel(kind: PurgeKind, id: string): void {
    this.kv.delete(PURGE_KEY(kind, id));
  }

  has(kind: PurgeKind, id: string): boolean {
    return this.kv.getString(PURGE_KEY(kind, id)) != null;
  }

  /** Every armed purge. An app marker whose stored record is unreadable still lists, without it. */
  list(): PurgeMarker[] {
    const out: PurgeMarker[] = [];
    for (const key of this.kv.getAllKeys()) {
      if (!key.startsWith(PURGE_PREFIX)) continue;
      const rest = key.slice(PURGE_PREFIX.length);
      const kind = kindOf(rest);
      if (kind === undefined) continue;
      const id = rest.slice(kind.length + 1);
      out.push(kind === 'app' ? { kind, id, ...this.storedEntry(key, id) } : { kind, id });
    }
    return out;
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
 * retained last-run report; an attempt goes the way a dismiss goes (record and journal).
 */
export async function completePurge(deps: PurgeDeps, marker: PurgeMarker): Promise<void> {
  if (marker.kind === 'app') {
    const entry = deps.index.get(marker.id) ?? marker.entry;
    if (entry) await deps.access.remove(entry);
    deps.journal.deleteLastRun(marker.id);
  } else {
    removeAttempt(deps, marker.id);
  }
  deps.purges.cancel(marker.kind, marker.id);
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
