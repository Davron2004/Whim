/**
 * version-switches — History's "Use this version" and its Undo (version-history "Using an older
 * version is immediate and undoable"), owned by the shell as a delete's Undo is (`soft-delete.ts`'s
 * `PurgeWindows`). The Undo's toast outlives History, so the Undo must not need History mounted to
 * run, and whatever shows the app (Home, History) must follow where it leaves the app.
 *
 * Each switch, and each Undo, takes the next number for its app; an Undo whose switch is no longer
 * the app's latest is dropped once a newer one has landed, and kept when every newer one failed. So a
 * toast left over from an earlier switch can never move the app away from the version a newer toast
 * names, and a newer switch that fails never costs an older Undo. An Undo that is not dropped runs through
 * `StoreAccess.rollback`, whose per-repo order runs it after whatever holds the app's versions (a
 * copy being made, a switch landing). Running, queueing and dropping each log at debug level.
 */
import type { InstalledApp } from './app-index';
import { messageOf, type StoreAccess } from './store-access';
import type { ToastApi } from '../ui/Toast';
import { COPY, versionSwitchToast } from './copy';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

export interface VersionSwitchDeps {
  access: StoreAccess;
  /** The shell's toast host. */
  toast: () => ToastApi | null;
  /** The app's version moved (a switch or an Undo landed) to `activeId`: bring what shows it up to date. */
  moved: (app: InstalledApp, activeId: string) => void;
  /** What else holds the app right now (a copy being made, an open), if anything. */
  busyWith: (appId: string) => string | undefined;
}

/** The words a switch's toast says: the version the app went to, and the one it left. */
export interface SwitchWords {
  to: number;
  from: number | null;
}

export class VersionSwitches {
  private next = 0;
  /** Per app, the numbers of the switches and Undos that have not failed, oldest first: the last one's
   *  toast speaks for the app. Those older than the newest one that landed are forgotten. */
  private readonly standing = new Map<string, number[]>();
  /** The rollback of each switch or Undo still running, settled either way. */
  private readonly running = new Map<number, Promise<void>>();

  constructor(private readonly deps: VersionSwitchDeps) {}

  /** "Use this version": `versionId` current at once, then the toast saying which way the app went,
   *  for the Undo window (`undo: true`), with an Undo back to `previousId`. `reread` is what the
   *  caller shows the versions with reading them again: the toast waits for it, so it never names a
   *  version the list does not yet call current. Rejects, with nothing offered, when the switch failed. */
  readonly use = async (app: InstalledApp, versionId: string, words: SwitchWords, previousId: string | null, reread: () => Promise<void>): Promise<void> => {
    const seq = await this.rollback(app, versionId);
    await reread().catch(() => undefined);
    this.deps.toast()?.show({
      message: versionSwitchToast(words.to, words.from),
      undo: true,
      ...(previousId == null ? {} : { action: { label: COPY.toastUndo, onPress: () => this.undo(app, previousId, seq) } }),
    });
  };

  /** Moves the app to `versionId` under the next number: the app's newest once it lands, given up if
   *  it fails, so an older toast's Undo speaks for the app again. Resolves the number. */
  private async rollback(app: InstalledApp, versionId: string): Promise<number> {
    this.next += 1;
    const seq = this.next;
    const standing = this.standing.get(app.id) ?? [];
    standing.push(seq);
    this.standing.set(app.id, standing);
    const keep = (kept: (n: number) => boolean) => this.standing.set(app.id, (this.standing.get(app.id) ?? []).filter(kept));
    const moving = this.deps.access.rollback(app, versionId).then(
      ({ activeId }) => {
        keep((n) => n >= seq);
        return activeId;
      },
      (e: unknown) => {
        keep((n) => n !== seq);
        throw e;
      },
    );
    // Settles once `standing` says how it ended, so an Undo waiting on it reads the outcome.
    const settled = moving.then(() => undefined, () => undefined);
    this.running.set(seq, settled);
    settled.then(() => this.running.delete(seq)).catch(() => undefined);
    this.deps.moved(app, await moving);
    return seq;
  }

  /** A switch's Undo: back to `previousId`, unless a newer switch of the app has landed since. One
   *  still running is waited for: it may fail, and this Undo then still speaks for the app. */
  private undo(app: InstalledApp, previousId: string, seq: number): void {
    const newest = this.standing.get(app.id)?.at(-1);
    if (newest !== seq) {
      const newer = newest === undefined ? undefined : this.running.get(newest);
      if (newer === undefined) {
        log.debug(CHANNELS.app, 'version undo dropped: a newer switch of the app landed', { appId: app.id });
        return;
      }
      log.debug(CHANNELS.app, 'version undo waits for a newer switch of the app', { appId: app.id });
      newer.then(() => this.undo(app, previousId, seq)).catch(() => undefined);
      return;
    }
    const behind = this.deps.busyWith(app.id);
    if (behind === undefined) log.debug(CHANNELS.app, 'version undo running', { appId: app.id });
    else log.debug(CHANNELS.app, 'version undo queued', { appId: app.id, behind });
    this.rollback(app, previousId).catch((e: unknown) => {
      log.warn(CHANNELS.app, 'history operation failed', { operation: 'undo', detail: messageOf(e) });
      this.deps.toast()?.show({ message: COPY.undoTooLateToast });
    });
  }
}
