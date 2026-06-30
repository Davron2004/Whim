/**
 * tearDownLiveRealm — the shared unmount/exit teardown helper (E2).
 *
 * Extracted so BOTH the `exit` callback (explicit leave) and the unmount effect (component
 * removed without routing through exit) call identical logic. Intentionally RN-free: only
 * imports from `../bridge` so the Node launcher test suite can import it directly.
 *
 * The caller (useMiniAppHost) is responsible for firing `onExit` AFTER calling this helper
 * when the user is explicitly exiting — unmount-only callers must NOT fire `onExit` (leaving
 * the component is already done by the time unmount fires).
 */

import { tearDownRealm, type RealmRecord } from '../bridge';

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
 * are already null. Does NOT call `onExit` — that is the exit()-path caller's responsibility.
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
    try { live.current.realm.engine?.close(); } catch { /* best effort */ }
    live.current = null;
  }
}
