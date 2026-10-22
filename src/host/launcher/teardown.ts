/**
 * tearDownLiveRealm — the realm teardown a launch's unmount runs (E2).
 *
 * Leaving does not call it: `exit` only asks the launcher, which takes the app back into its tile
 * (M3) while the realm stays alive, and unmounts the launch once it is there; the unmount effect
 * (useMiniAppHost) tears the realm down then, and on every other unmount. Intentionally RN-free:
 * only imports from `../bridge` so the Node launcher test suite can import it directly. It never
 * fires `onExit`.
 */

import { tearDownRealm, type RealmRecord } from '../bridge';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

/** Minimal mutable-ref shape (mirrors React.MutableRefObject without importing react). */
interface MutableRef<T> { current: T }

/** The shape of the live-realm ref tracked by useMiniAppHost. */
interface LiveRealm {
  app: string;
  realm: RealmRecord;
  /** dispatcher is present on the real ref; not needed here — keep the shape open. */
  dispatcher: object;
}

/**
 * Clear the popTimer and tear down the live realm (if any). Safe to call when either or both
 * are already null. Does NOT call `onExit`.
 */
export function tearDownLiveRealm(
  live: MutableRef<LiveRealm | null>,
  popTimer: MutableRef<ReturnType<typeof setTimeout> | null>,
): void {
  if (popTimer.current) {
    clearTimeout(popTimer.current);
    popTimer.current = null;
  }
  if (live.current) {
    tearDownRealm(live.current.realm);
    // Best effort: the realm is already fenced, so a failed close changes nothing the user can
    // see — but it is a leaked handle, and it is recorded instead of vanishing.
    try {
      live.current.realm.engine?.close();
    } catch (e) {
      log.warn(CHANNELS.app, 'storage engine close failed', {
        operation: 'teardown',
        errorClass: e instanceof Error ? e.constructor.name : typeof e,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
    live.current = null;
  }
}
