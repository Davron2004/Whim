/**
 * system-back — the one seam every launcher screen's hardware back listener goes through (design
 * D1/D9; spec launcher-screen-exits "System back and the visible control perform the same
 * action"). React Native-free so it loads under the launcher's Node acceptance suite; the RN
 * binding lives in `use-system-back.ts`, the only file in this directory that imports
 * `BackHandler`.
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */

/** The slice of RN's `BackHandler` this module needs — small enough to fake in a Node test
 *  without pulling in `react-native`. */
export interface BackHandlerLike {
  addEventListener(eventType: 'hardwareBackPress', listener: () => boolean): { remove(): void };
}

/**
 * Registers exactly one `hardwareBackPress` listener that always runs the LATEST handler `current`
 * resolves to, not the one that was live when it was bound — the fix for the listener-churn bug
 * `useBuildBack` already worked around ad hoc (`LauncherRoot.tsx`'s old build-screen comment).
 * Returns `true` (system back was handled) when `current()` gives a handler, and calls it; returns
 * `false` (falls through to the platform default) when `current()` is `null`. The returned function
 * unsubscribes.
 */
export function bindSystemBack(api: BackHandlerLike, current: () => (() => void) | null): () => void {
  const sub = api.addEventListener('hardwareBackPress', () => {
    const handler = current();
    if (handler == null) return false;
    handler();
    return true;
  });
  return () => sub.remove();
}
