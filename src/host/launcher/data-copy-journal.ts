/**
 * data-copy-journal — the marker that keeps "Copy the data" all-or-nothing across a process death
 * (copy-app-data design D2; app-data-copy "A copy is all-or-nothing across crashes").
 *
 * A copy becomes visible only through its launcher entry, and that entry is written only after the
 * copied store is complete and verified. Before the copy writes a byte, `StoreAccess.fork` records
 * the copy's appId here; it clears the record once the entry is written, or once a failed copy has
 * deleted what it wrote. A record that survives to the next launch therefore names a copy that
 * never committed (no entry: its store is deleted) or one that committed just before the process
 * died (an entry: the record alone goes). Either way the sweep converges on "no copy" or "a
 * complete copy", never an entry bound to a half-written store.
 *
 * Lives in the launcher KV beside the index (one MMKV instance on device, `MapKVBackend` in Node).
 */

import type { KVBackend } from '../version-store/fs/kv-fs';
import type { AppIndex } from './app-index';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

export interface DataCopyJournalEntry {
  /** The appId the copy's store is written under (the copy's own launcher id). */
  readonly copyAppId: string;
  /** The appId of the store being copied (the source's storage group, or its own id). */
  readonly sourceAppId: string;
  /** Epoch ms. */
  readonly startedAt: number;
}

const PREFIX = 'datacopy:';
const KEY = (copyAppId: string) => `${PREFIX}${copyAppId}`;

function isEntry(value: unknown, copyAppId: string): value is DataCopyJournalEntry {
  const v = value as Partial<DataCopyJournalEntry> | null;
  return v != null && v.copyAppId === copyAppId && typeof v.sourceAppId === 'string' && typeof v.startedAt === 'number';
}

export class DataCopyJournal {
  constructor(private readonly kv: KVBackend) {}

  /** Record a copy about to start. Written before any byte of the copy's store. */
  put(entry: DataCopyJournalEntry): void {
    this.kv.set(KEY(entry.copyAppId), JSON.stringify(entry));
  }

  /** Forget a copy: it committed, or what it wrote is gone. A no-op when none is recorded. */
  clear(copyAppId: string): void {
    this.kv.delete(KEY(copyAppId));
  }

  /** Every recorded copy. A record whose body is unreadable still lists, by the id in its key:
   *  the sweep needs only the id, and dropping it would leave a half-written store behind. */
  list(): DataCopyJournalEntry[] {
    const out: DataCopyJournalEntry[] = [];
    for (const key of this.kv.getAllKeys()) {
      if (!key.startsWith(PREFIX)) continue;
      const copyAppId = key.slice(PREFIX.length);
      out.push(this.read(key, copyAppId));
    }
    return out;
  }

  private read(key: string, copyAppId: string): DataCopyJournalEntry {
    const raw = this.kv.getString(key);
    let detail = 'not a data-copy record';
    try {
      const parsed: unknown = raw == null ? null : JSON.parse(raw);
      if (isEntry(parsed, copyAppId)) return parsed;
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e);
    }
    log.warn(CHANNELS.app, 'stored data-copy record is unreadable', { appId: copyAppId, detail });
    return { copyAppId, sourceAppId: '', startedAt: 0 };
  }
}

export interface SweepDeps {
  journal: DataCopyJournal;
  index: AppIndex;
  /** Drops one appId's store file; an absent file is a no-op. */
  deleteStorage: (appId: string) => void | Promise<void>;
  /** Copies running in this process right now; the sweep leaves their records alone. */
  inFlight?: (copyAppId: string) => boolean;
}

/** True when any launcher entry is, or resolves to, `appId`: its store belongs to that entry. */
function hasEntry(index: AppIndex, appId: string): boolean {
  return index.has(appId) || index.storageRefCount(appId) > 0;
}

/**
 * At launch, before any app's store is opened: settle every copy a closed process left recorded.
 * A copy with a launcher entry committed, so only its record goes; a copy without one never did,
 * so its store is deleted and then its record goes. The store of an appId with an entry is never
 * deleted. A delete that fails keeps its record for the next launch and does not stop the others.
 */
export async function sweepDataCopies(deps: SweepDeps): Promise<void> {
  for (const { copyAppId } of deps.journal.list()) {
    if (deps.inFlight?.(copyAppId)) continue;
    try {
      if (!hasEntry(deps.index, copyAppId)) await deps.deleteStorage(copyAppId);
      deps.journal.clear(copyAppId);
    } catch (e) {
      log.error(CHANNELS.app, 'interrupted data copy could not be cleaned up', {
        appId: copyAppId,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }
}
