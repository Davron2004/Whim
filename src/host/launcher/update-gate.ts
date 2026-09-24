/**
 * update-gate — the RN-free half of the update screen (request-envelope D5; spec app-update-gate):
 * whether the minimums the launch-time `/healthz` check read put the installed build below its
 * platform's, and opening Whim's own store listing with its https fallback. `UpdateRequiredScreen`
 * and `LauncherRoot` are the only callers; this module holds no state.
 */
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import type { AppInfo } from './app-info';
import type { StoreListing } from './release-config';
import type { MinimumBuilds } from './server-probe';

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? 'non-serializable error value';
  // eslint-disable-next-line no-restricted-syntax -- intentional: JSON.stringify throws only on a circular or BigInt-bearing value, and the sentinel below is already the useful string
  } catch {
    return 'non-serializable error value';
  }
}

/**
 * True only when a minimum was read AND the installed build is below it on its own platform — the
 * server's rule exactly (a build equal to the minimum is served, and `0` is no minimum because a
 * build is always positive). A reader that throws counts as not below: that build cannot send a
 * `/v1` request at all (`transport-shared.ts#requestHeaders` fails first), so there is no AI
 * feature for the screen to stand in front of.
 */
export function belowMinimumBuild(appInfo: () => AppInfo, minimums: MinimumBuilds | undefined): boolean {
  if (minimums === undefined) return false;
  let info: AppInfo;
  try {
    info = appInfo();
  } catch (err) {
    log.debug(CHANNELS.app, 'update check skipped: the installed app info is unreadable', { message: messageOf(err) });
    return false;
  }
  return info.build < minimums[info.platform];
}

/**
 * "Update Whim": the store app's link first, the https listing when that one fails to open
 * (`itms-apps://` and `market://` fail on simulators, emulators and phones without the store).
 * Never rejects — when the fallback fails too, the update screen simply stays up, and the failure
 * is recorded through the logging seam.
 */
export async function openStoreListing(listing: StoreListing, openURL: (url: string) => Promise<unknown>): Promise<void> {
  try {
    await openURL(listing.store);
    return;
  } catch (err) {
    log.debug(CHANNELS.app, 'store app link did not open, trying the web listing', { message: messageOf(err) });
  }
  try {
    await openURL(listing.web);
  } catch (err) {
    log.warn(CHANNELS.app, 'store listing did not open', { message: messageOf(err) });
  }
}
