/**
 * soft-delete — the Undo windows of Delete and Discard (app-launcher "Deleting an app leaves no
 * residue"; system.md §9 Delete; design-system-v1 D16, task 15.4). Delete and Discard hide at once
 * and purge when the window ends: the marker in the launcher KV (`pending-purge.ts`) is the truth, so
 * a Whim closed mid-window still completes the purge at the next launch.
 *
 * The window belongs to the Undo toast, not to a clock of its own: the toast stops its time while it
 * is touched or a screen reader runs, so Undo stays possible exactly as long as it is offered. The
 * caller ends a window (`finish`) when the toast ends: its time ran out, it was swiped away, or
 * another toast replaced it. This class only tracks which windows are open in this process.
 *
 * Arming deletes nothing: the entry stays in its store until `finish` runs (so Undo restores it
 * whole and the storage and history refcounts stay exact). Once the purge is running, Undo no longer
 * applies.
 */
import type { InstalledApp } from './app-index';
import type { PendingPurgeStore, PurgeKind, PurgeMarker } from './pending-purge';

export interface PurgeWindowDeps {
  purges: Pick<PendingPurgeStore, 'armApp' | 'armAttempt' | 'cancel'>;
  /** Carries out one purge (`completePurge`); resolves once its marker is cleared. */
  complete: (marker: PurgeMarker) => Promise<void>;
  /** The set of hidden entries changed, or a purge ended: re-read the stores and render. */
  changed: () => void;
  /** A purge failed; its marker stays armed and the next launch tries again. */
  failed: (marker: PurgeMarker, error: unknown) => void;
}

interface OpenWindow {
  readonly marker: PurgeMarker;
  settling: boolean;
}

const windowKey = (kind: PurgeKind, id: string) => `${kind}:${id}`;

export class PurgeWindows {
  private readonly open = new Map<string, OpenWindow>();

  constructor(private readonly deps: PurgeWindowDeps) {}

  /** Delete: hide `entry`; it is purged when `finish` ends its window. */
  armApp(entry: InstalledApp): void {
    this.deps.purges.armApp(entry);
    this.start({ kind: 'app', id: entry.id, entry });
  }

  /** Discard: hide the pending-build record `id`; it is purged when `finish` ends its window. */
  armAttempt(id: string): void {
    this.deps.purges.armAttempt(id);
    this.start({ kind: 'attempt', id });
  }

  /** Undo. True when the purge was cancelled; false when none was open or it is already running. */
  undo(kind: PurgeKind, id: string): boolean {
    const key = windowKey(kind, id);
    const window = this.open.get(key);
    if (!window || window.settling) return false;
    this.open.delete(key);
    this.deps.purges.cancel(kind, id);
    this.deps.changed();
    return true;
  }

  /** The window's end (its Undo toast is gone): run the purge. A window already undone or running
   *  is left alone. Resolves once the purge has finished or failed. */
  async finish(kind: PurgeKind, id: string): Promise<void> {
    const key = windowKey(kind, id);
    const window = this.open.get(key);
    if (!window || window.settling) return;
    window.settling = true;
    try {
      await this.deps.complete(window.marker);
    } catch (error) {
      this.deps.failed(window.marker, error);
    } finally {
      this.open.delete(key);
      this.deps.changed();
    }
  }

  /** Forget every open window. The markers stay, so the next launch finishes the purges. */
  dispose(): void {
    this.open.clear();
  }

  private start(marker: PurgeMarker): void {
    this.open.set(windowKey(marker.kind, marker.id), { marker, settling: false });
    this.deps.changed();
  }
}
