/**
 * fork-op — "Make a copy" as Home runs it: busy for the app while the copy is made, and a result the
 * tile menu can answer with a toast (app-launcher "Forking creates an independent launcher entry").
 * No React import.
 */
import type { InstalledApp } from './app-index';
import { DataCopyError, type DataCopyErrorKind } from '../storage-engine/copy-contract';
import type { ForkOptions } from './store-access';
import { COPY } from './copy';

const DATA_COPY_FAILED: Readonly<Record<DataCopyErrorKind, string>> = {
  no_space: COPY.copyNoRoomToast,
  source_unreadable: COPY.copyUnreadableToast,
  verify_failed: COPY.copyDataFailedToast,
  io: COPY.copyDataFailedToast,
};

/**
 * What a failed "Make a copy" says (app-data-copy "A failed copy creates nothing and says so"). A
 * "Copy the data" that failed in its data step (`DataCopyError`) names what went wrong and offers
 * "Start fresh", which the person chooses: never a silent fresh copy in its place. Any other
 * failure (the version store, a fresh copy) says the copy couldn't be made and offers nothing,
 * since starting fresh would fail the same way.
 */
export function copyFailure(error: unknown, data: ForkOptions['data']): { message: string; startFresh: boolean } {
  if (data === 'copy' && error instanceof DataCopyError) return { message: DATA_COPY_FAILED[error.kind], startFresh: true };
  return { message: COPY.copyFailedToast, startFresh: false };
}

/**
 * Runs `fork` inside the app's busy slot (`runBusy`, the shell's `runAppOp` for this app). Resolves
 * the new entry; resolves `null` when the slot was taken (a copy or an open of the app is already
 * running) and nothing was started; rejects with the fork's own error when the copy could not be
 * made, after `onFailure` has seen it. A rejected fork created nothing (`StoreAccess.fork`).
 */
export async function runFork(
  runBusy: (work: () => Promise<void>) => Promise<boolean>,
  fork: () => Promise<InstalledApp>,
  onFailure: (error: unknown) => void,
): Promise<InstalledApp | null> {
  let made: InstalledApp | null = null;
  let failed = false;
  let failure: unknown;
  await runBusy(async () => {
    try {
      made = await fork();
    } catch (error) {
      failed = true;
      failure = error;
      onFailure(error);
    }
  });
  if (failed) throw failure;
  return made;
}
