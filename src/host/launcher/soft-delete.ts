/**
 * soft-delete — the Undo windows of Delete and Discard (app-launcher "Deleting an app leaves no
 * residue"; system.md §9 Delete; design-system-v1 D16, task 15.4). Delete and Discard hide at once
 * and purge when the window ends: the marker in the launcher KV (`pending-purge.ts`) is the truth, so
 * a Whim closed mid-window still completes the purge at the next launch; this class only owns the
 * timers of the process that armed it. No React import.
 *
 * Arming deletes nothing: the entry stays in its store until `complete` runs (so Undo restores it
 * whole and the storage and history refcounts stay exact). Once the window has ended and the purge is
 * running, Undo no longer applies.
 */
import type { InstalledApp } from './app-index';
import type { PendingPurgeStore, PurgeKind, PurgeMarker } from './pending-purge';

/** How long Undo is offered: 10 s after Delete, 6 s after Discard (the same times the toast shows). */
export const UNDO_WINDOW_MS: Readonly<Record<PurgeKind, number>> = { app: 10_000, attempt: 6_000 };

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
  readonly timer: ReturnType<typeof setTimeout>;
  settling: boolean;
}

const windowKey = (kind: PurgeKind, id: string) => `${kind}:${id}`;

export class PurgeWindows {
  private readonly open = new Map<string, OpenWindow>();

  constructor(private readonly deps: PurgeWindowDeps) {}

  /** Delete: hide `entry` and purge it when its window ends. */
  armApp(entry: InstalledApp): void {
    this.deps.purges.armApp(entry);
    this.start({ kind: 'app', id: entry.id, entry });
  }

  /** Discard: hide the pending-build record `id` and purge it when its window ends. */
  armAttempt(id: string): void {
    this.deps.purges.armAttempt(id);
    this.start({ kind: 'attempt', id });
  }

  /** Undo. True when the purge was cancelled; false when none was open or it is already running. */
  undo(kind: PurgeKind, id: string): boolean {
    const key = windowKey(kind, id);
    const window = this.open.get(key);
    if (!window || window.settling) return false;
    clearTimeout(window.timer);
    this.open.delete(key);
    this.deps.purges.cancel(kind, id);
    this.deps.changed();
    return true;
  }

  /** Stop every timer. The markers stay, so the next launch finishes the purges. */
  dispose(): void {
    for (const window of this.open.values()) clearTimeout(window.timer);
    this.open.clear();
  }

  private start(marker: PurgeMarker): void {
    const key = windowKey(marker.kind, marker.id);
    const earlier = this.open.get(key);
    if (earlier) clearTimeout(earlier.timer);
    const window: OpenWindow = {
      marker,
      timer: setTimeout(() => this.settle(key).catch(() => undefined), UNDO_WINDOW_MS[marker.kind]),
      settling: false,
    };
    this.open.set(key, window);
    this.deps.changed();
  }

  private async settle(key: string): Promise<void> {
    const window = this.open.get(key);
    if (!window) return;
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
}
