/**
 * webview-pool — the one warm WebView (design-system-v1 task 18.4, `app-launcher` "One WebView SHALL
 * be kept warm in a pool"), as a pure state machine `MiniAppView` renders from.
 *
 * Pure and RN-free, so the launcher's Node suite drives it directly (the `boot-state.ts` precedent).
 *
 * ONE WebView waits with the runtime page loaded: the page and its idle, empty sandbox iframe,
 * nothing else. Opening an app hands that WebView to the launch, and a fresh one starts loading
 * beside it once the launch has opened, so the next launch finds it warm too. The delivery is a
 * `reinject({ reset: true })` — the page recreates the iframe with a new nonce and
 * the launch's own generation (spike2 §5: a realm reset is a recreate). A WebView that has hosted a
 * launch is NEVER handed out again: closing the app, a failure surface and Retry all destroy it,
 * and the next launch gets a WebView no app has ever touched (the waiting one, or a cold one).
 * Destroying it is the safer of the two options spike2 §5 allows: a realm reset alone would leave
 * the outer page, its nonce history and whatever native state the previous app reached in place.
 *
 * A waiting WebView is handed out only while its page is still loading or after the page answered
 * the warm probe (its scripts ran). One that loaded but never answered — iOS starts a WebView with
 * page JavaScript off while the network-deny rule list is not compiled yet (decision #74) — is
 * dropped for a cold one; so is one whose web content process died or whose page failed to load.
 */

/** Where a WebView's page is: loading, loaded (probe sent, unanswered), or answered (`warm`). */
export type PageState = 'loading' | 'loaded' | 'warm';

/** How a launch got its WebView, for the tap-to-first-paint record. */
export type HandedOut = 'warm' | 'loading' | 'cold';

export interface PoolSlot {
  /** The WebView's React key, never reused: a new key is a new native WebView. */
  readonly key: number;
  readonly page: PageState;
  /** The launch the WebView belongs to; `null` while it waits. Set once, never cleared. */
  readonly launch: number | null;
  /** How the launch got it; `null` while it waits. */
  readonly handedOut: HandedOut | null;
}

export interface WebViewPool {
  /** The app the current launch opened; `null` when no app is open. */
  readonly appId: string | null;
  /** The current launch, a token never reused; `null` when no app is open. */
  readonly launch: number | null;
  /** The WebViews in the order they are drawn, bottom first: the waiting one under the launch's. */
  readonly slots: readonly PoolSlot[];
  /** The next key or launch token. */
  readonly next: number;
}

export const EMPTY_POOL: WebViewPool = { appId: null, launch: null, slots: [], next: 1 };

/** Injected into a waiting page once it has loaded: posts `WARM_ANSWER` iff the page's own
 *  orchestration script ran. It reads nothing and leaves nothing behind. */
export const WARM_PROBE_JS = 'window.ReactNativeWebView.postMessage(JSON.stringify({__whimWarm:typeof window.__whimControl==="object"}));true;';
/** The probe's answer from a page whose scripts run, exactly as the bridge carries it. */
export const WARM_ANSWER = '{"__whimWarm":true}';

/** The WebView waiting in the pool, if any. */
export function waitingSlot(pool: WebViewPool): PoolSlot | undefined {
  return pool.slots.find((s) => s.launch === null);
}

/** The WebView of the current launch, if it has one (none on a failure surface). */
export function launchSlot(pool: WebViewPool): PoolSlot | undefined {
  return pool.launch === null ? undefined : pool.slots.find((s) => s.launch === pool.launch);
}

/** One WebView waits. A new waiting WebView goes first, under the launch's, so it is never the view
 *  a touch on the app finds. A WebView is handed over only once the previous launch's is gone (it
 *  is then the only one), so no native view ever changes its place among its siblings. */
function keepOneWaiting(pool: WebViewPool): WebViewPool {
  if (waitingSlot(pool)) return pool;
  return { ...pool, slots: [{ key: pool.next, page: 'loading', launch: null, handedOut: null }, ...pool.slots], next: pool.next + 1 };
}

/** Give the current launch a WebView: the waiting one if it may be handed out, else a cold one
 *  (and the waiting one that may not is destroyed). None waits until the launch has opened. */
function bindLaunch(pool: WebViewPool, launch: number): WebViewPool {
  const waiting = waitingSlot(pool);
  if (waiting && waiting.page !== 'loaded') {
    const bound: PoolSlot = { ...waiting, launch, handedOut: waiting.page };
    return { ...pool, slots: pool.slots.map((s) => (s === waiting ? bound : s)) };
  }
  const others = pool.slots.filter((s) => s !== waiting);
  return { ...pool, slots: [...others, { key: pool.next, page: 'loading', launch, handedOut: 'cold' }], next: pool.next + 1 };
}

/** Destroy the current launch's WebView. */
function dropLaunchSlot(pool: WebViewPool): WebViewPool {
  return pool.launch === null ? pool : { ...pool, slots: pool.slots.filter((s) => s.launch !== pool.launch) };
}

/**
 * The pool for `appId` open (or no app, for `null`). A different app than the open one is a new
 * launch: the previous launch's WebView is destroyed, and the new one takes the waiting WebView or
 * a cold one. Closing leaves one WebView waiting. The same app id is no change.
 */
export function openApp(pool: WebViewPool, appId: string | null): WebViewPool {
  if (pool.appId === appId) return appId === null ? keepOneWaiting(pool) : pool;
  const closed: WebViewPool = { ...dropLaunchSlot(pool), appId: null, launch: null };
  if (appId === null) return keepOneWaiting(closed);
  return bindLaunch({ ...closed, appId, launch: closed.next, next: closed.next + 1 }, closed.next);
}

/** The launch has opened (its first accepted paint): a fresh WebView starts loading beside it, so
 *  the next launch (after a close, another app, a failure or Retry) finds one warm. Not earlier:
 *  loading a page alongside the opening slowed the opening itself (18e, measured on Android). */
export function launchOpened(pool: WebViewPool): WebViewPool {
  return pool.launch === null ? pool : keepOneWaiting(pool);
}

/** The launch reached a failure surface: its WebView is destroyed, and one waits for Retry. */
export function launchFailed(pool: WebViewPool): WebViewPool {
  return keepOneWaiting(dropLaunchSlot(pool));
}

/** Retry: the launch's WebView, if it still has one, is destroyed and a fresh one is bound. */
export function retryLaunch(pool: WebViewPool): WebViewPool {
  return pool.launch === null ? pool : bindLaunch(dropLaunchSlot(pool), pool.launch);
}

function updateWaiting(pool: WebViewPool, key: number, from: PageState, to: PageState): WebViewPool {
  const slot = pool.slots.find((s) => s.key === key);
  if (!slot || slot.launch !== null || slot.page !== from) return pool;
  return { ...pool, slots: pool.slots.map((s) => (s === slot ? { ...s, page: to } : s)) };
}

/** The waiting WebView's page finished loading (the probe goes out now). */
export function pageLoaded(pool: WebViewPool, key: number): WebViewPool {
  return updateWaiting(pool, key, 'loading', 'loaded');
}

/** The waiting WebView's page answered the probe: it may be handed out warm. */
export function pageAnswered(pool: WebViewPool, key: number): WebViewPool {
  return updateWaiting(pool, key, 'loaded', 'warm');
}

/** The waiting WebView failed to load or lost its web content process: it is never handed out,
 *  and a fresh one takes its place. A launch's own WebView is the launch's to fail (its failure
 *  surface, then `launchFailed`). */
export function pageGone(pool: WebViewPool, key: number): WebViewPool {
  const slot = pool.slots.find((s) => s.key === key);
  if (!slot || slot.launch !== null) return pool;
  return keepOneWaiting({ ...pool, slots: pool.slots.filter((s) => s !== slot) });
}
