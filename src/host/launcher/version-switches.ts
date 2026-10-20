/**
 * version-switches — History's "Use this version" and its Undo (version-history "Using an older
 * version is immediate and undoable"), owned by the shell as a delete's Undo is (`soft-delete.ts`'s
 * `PurgeWindows`). The Undo's toast outlives History, so the Undo must not need History mounted to
 * run, and whatever shows the app (Home, History) must follow where it leaves the app.
 *
 * Each switch, and each Undo, takes the next number for its app; an Undo whose switch is no longer
 * the app's latest is dropped. So a toast left over from an earlier switch can never move the app
 * away from the version a newer toast names. An Undo that is not dropped runs at once through
 * `StoreAccess.rollback`, whose per-repo order runs it after whatever holds the app's versions (a
 * copy being made, a switch landing). Running, queueing and dropping each log at debug level.
 */
import type { InstalledApp } from './app-index';
import type { StoreAccess } from './store-access';
import type { ToastApi } from '../ui/Toast';
import { COPY, versionSwitchToast } from './copy';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

export interface VersionSwitchDeps {
  access: StoreAccess;
  /** The shell's toast host. */
  toast: () => ToastApi | null;
  /** The app's version moved (a switch or an Undo landed): bring what shows it up to date. */
  moved: (app: InstalledApp) => void;
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
  private readonly latest = new Map<string, number>();

  constructor(private readonly deps: VersionSwitchDeps) {}

  /** "Use this version": `versionId` current at once, then the toast saying which way the app went,
   *  for the Undo window (`undo: true`), with an Undo back to `previousId`. `reread` is what the
   *  caller shows the versions with reading them again: the toast waits for it, so it never names a
   *  version the list does not yet call current. Rejects, with nothing offered, when the switch failed. */
  readonly use = async (app: InstalledApp, versionId: string, words: SwitchWords, previousId: string | null, reread: () => Promise<void>): Promise<void> => {
    const seq = this.claim(app.id);
    await this.deps.access.rollback(app, versionId);
    this.deps.moved(app);
    await reread().catch(() => undefined);
    this.deps.toast()?.show({
      message: versionSwitchToast(words.to, words.from),
      undo: true,
      ...(previousId == null ? {} : { action: { label: COPY.toastUndo, onPress: () => this.undo(app, previousId, seq) } }),
    });
  };

  private claim(appId: string): number {
    this.next += 1;
    this.latest.set(appId, this.next);
    return this.next;
  }

  /** A switch's Undo: back to `previousId`, unless a newer switch of the app has started since. */
  private undo(app: InstalledApp, previousId: string, seq: number): void {
    if (this.latest.get(app.id) !== seq) {
      log.debug(CHANNELS.app, 'version undo dropped: a newer switch of the app started', { appId: app.id });
      return;
    }
    this.claim(app.id);
    const behind = this.deps.busyWith(app.id);
    if (behind === undefined) log.debug(CHANNELS.app, 'version undo running', { appId: app.id });
    else log.debug(CHANNELS.app, 'version undo queued', { appId: app.id, behind });
    this.deps.access.rollback(app, previousId).then(
      () => this.deps.moved(app),
      (e: unknown) => {
        log.warn(CHANNELS.app, 'history operation failed', { operation: 'undo', detail: e instanceof Error ? e.message : String(e) });
        this.deps.toast()?.show({ message: COPY.undoTooLateToast });
      },
    );
  }
}
