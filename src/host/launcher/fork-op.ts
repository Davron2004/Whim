/**
 * fork-op — "Make a copy" as Home runs it: busy for the app while the copy is made, and a result the
 * tile menu can answer with a toast (app-launcher "Forking creates an independent launcher entry").
 * No React import.
 */
import type { InstalledApp } from './app-index';

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
