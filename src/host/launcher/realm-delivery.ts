/**
 * realm-delivery — when a WebView load-end event may deliver a bundle (launcher-shell / #5 B1).
 *
 * Pure, RN-free and therefore Node-testable: `MiniAppView.tsx` cannot be imported under the
 * launcher's Node suite, so the decision that is actually easy to get wrong lives here rather
 * than as an `if` inside the component (the `boot-state.ts` precedent).
 *
 * THE STATE MACHINE, per <WebView> instance (one instance == one realm, #41 D2):
 *
 *     undelivered ──onLoadEnd──▶ delivered(key)
 *                                    │ onLoadEnd again, SAME key → 'duplicate' (no-op)
 *                                    │ key changes (Retry remount) → undelivered → deliver again
 *
 * The delivered state is keyed by the WebView's `key`, so "reset on remount" needs no separate
 * reset step and cannot be forgotten: a bumped key never equals the recorded one. A realm reset is
 * a RECREATE, never a re-inject (spike2 §5, #35/#37), so a new key MUST deliver — suppressing that
 * would leave Retry with a blank realm and no way out. Leaving the app unmounts the component and
 * the record dies with it; there is no state to escape from.
 *
 * Why the duplicate case exists at all: Android's WebView fires `onPageFinished` (RN's
 * `onLoadEnd`) more than once for a single page load on some devices/WebView versions. A second
 * delivery would bind a NEW host generation and reinject into the live page, tearing the running
 * realm down mid-flight; the host has no way to tell that apart from a real remount, so the
 * component-side identity of the mount (its key) is the only thing that can.
 */

/** What `onLoadEnd` should do for a given WebView mount. */
export type LoadEndAction = 'deliver' | 'duplicate';

/**
 * @param deliveredKey the WebView key delivery already happened for (`null` = this mount has not
 *        delivered yet)
 * @param webKey the key of the WebView instance that just fired `onLoadEnd`
 */
export function loadEndAction(deliveredKey: number | null, webKey: number): LoadEndAction {
  return deliveredKey === webKey ? 'duplicate' : 'deliver';
}
