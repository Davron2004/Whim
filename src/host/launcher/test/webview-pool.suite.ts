/**
 * The one warm WebView (`webview-pool.ts`, design-system-v1 task 18.4), driven directly: which
 * WebView a launch gets, and that no WebView ever serves a second launch. The rendered container,
 * its frames and deliveries are in `mini-app-host-ui.suite.tsx`; the warm probe, against the real
 * page and a page whose scripts did not run, is in `deliver-by-source.desktop.mjs`.
 */
import { Harness } from './harness';
import {
  EMPTY_POOL,
  launchFailed,
  launchSlot,
  openApp,
  pageAnswered,
  pageGone,
  pageLoaded,
  retryLaunch,
  waitingSlot,
  type WebViewPool,
} from '../webview-pool';

/** A waiting WebView whose page loaded and answered the probe. */
function warmed(pool: WebViewPool): WebViewPool {
  const key = waitingSlot(pool)!.key;
  return pageAnswered(pageLoaded(pool, key), key);
}

/** How `pool` breaks the pool's promises, given `owner` (every WebView's launch so far, updated):
 *  a WebView serving a second launch or waiting again after one, more than one waiting, or one
 *  waiting while an app is open. */
function violations(pool: WebViewPool, owner: Map<number, number>): number {
  let broken = 0;
  for (const slot of pool.slots) {
    const was = owner.get(slot.key);
    if (was !== undefined && was !== slot.launch) broken += 1;
    if (slot.launch !== null) owner.set(slot.key, slot.launch);
  }
  const waiting = pool.slots.filter((s) => s.launch === null).length;
  if (waiting > 1 || (pool.launch !== null && waiting > 0)) broken += 1;
  return broken;
}

export async function runWebViewPoolTests(h: Harness): Promise<void> {
  await h.test('pool: with no app open one WebView waits; opening hands it over warm, and closing destroys it', () => {
    const idle = openApp(EMPTY_POOL, null);
    h.eq(idle.slots.length, 1, 'one WebView waits');
    const waiting = waitingSlot(idle)!;
    const ready = warmed(idle);
    const open = openApp(ready, 'tip');
    h.eq([launchSlot(open)?.key, launchSlot(open)?.handedOut, waitingSlot(open)], [waiting.key, 'warm', undefined],
      'the launch takes the waiting WebView, warm, and no other waits while the app is open');
    h.eq(openApp(open, 'tip'), open, 'the same app open is no new launch');
    const closed = openApp(open, null);
    h.ok(!closed.slots.some((s) => s.key === waiting.key), 'closing the app destroys its WebView');
    h.ok(waitingSlot(closed) !== undefined && waitingSlot(closed)!.key !== waiting.key, 'and a fresh one waits');
    const next = openApp(closed, 'tip');
    h.ok(launchSlot(next)!.key !== waiting.key && next.launch !== open.launch, 'opening the same app again is a new launch in a WebView it never had');
  });

  await h.test('pool: one app straight after another destroys the first app’s WebView; the second gets a cold one', () => {
    const a = openApp(warmed(openApp(EMPTY_POOL, null)), 'a');
    const b = openApp(a, 'b');
    h.ok(!b.slots.some((s) => s.key === launchSlot(a)!.key), 'the first app’s WebView is gone');
    h.eq([b.slots.length, launchSlot(b)?.handedOut], [1, 'cold'], 'the second app’s is a new one');
  });

  await h.test('pool: a waiting WebView still loading is handed out as it is; one that loaded without answering is not', () => {
    const loading = openApp(openApp(EMPTY_POOL, null), 'a');
    h.eq(launchSlot(loading)?.handedOut, 'loading', 'a page still loading is handed over, to be delivered into once it loads');
    const idle = openApp(EMPTY_POOL, null);
    const silent = waitingSlot(idle)!.key;
    const open = openApp(pageLoaded(idle, silent), 'a');
    h.ok(launchSlot(open)!.key !== silent && launchSlot(open)!.handedOut === 'cold', 'a page that loaded but never answered the probe is passed over for a cold WebView');
    h.ok(!open.slots.some((s) => s.key === silent), 'and destroyed');
  });

  await h.test('pool: a waiting WebView whose page failed or whose web process died is never handed out; a fresh one waits', () => {
    const idle = warmed(openApp(EMPTY_POOL, null));
    const dead = waitingSlot(idle)!.key;
    const after = pageGone(idle, dead);
    h.ok(waitingSlot(after) !== undefined && waitingSlot(after)!.key !== dead, 'a new WebView waits in its place');
    h.eq(pageAnswered(after, dead), after, 'a late answer from the dead page changes nothing');
    h.ok(launchSlot(openApp(after, 'a'))!.key !== dead, 'the launch never gets the dead one');
    const open = openApp(warmed(openApp(EMPTY_POOL, null)), 'a');
    h.eq(pageGone(open, launchSlot(open)!.key), open, 'the open app’s own WebView is the launch’s to fail, not the pool’s');
  });

  await h.test('pool: a failure surface destroys the launch’s WebView, and Retry binds one it never had', () => {
    const open = openApp(warmed(openApp(EMPTY_POOL, null)), 'a');
    const first = launchSlot(open)!.key;
    const failed = launchFailed(open);
    h.eq([launchSlot(failed), failed.slots.length, failed.launch], [undefined, 0, open.launch], 'no WebView while the recovery screen shows, and no other waits');
    const retried = retryLaunch(failed);
    h.ok(launchSlot(retried)!.key !== first && launchSlot(retried)!.handedOut === 'cold' && retried.launch === open.launch,
      'Retry gives the same launch a new WebView');
    h.ok(launchSlot(retryLaunch(retried))!.key !== launchSlot(retried)!.key, 'and Retry without a failure screen replaces the WebView too');
  });

  await h.test('pool: over any sequence of opens, closes, failures, retries and page events, no WebView ever serves two launches or waits again', () => {
    let pool = openApp(EMPTY_POOL, null);
    const owner = new Map<number, number>();
    const steps: ((p: WebViewPool) => WebViewPool)[] = [
      (p) => openApp(p, 'a'), (p) => openApp(p, 'b'), (p) => openApp(p, null), (p) => openApp(p, 'a'),
      launchFailed, retryLaunch,
      (p) => (waitingSlot(p) ? pageLoaded(p, waitingSlot(p)!.key) : p),
      (p) => (waitingSlot(p) ? pageAnswered(p, waitingSlot(p)!.key) : p),
      (p) => (waitingSlot(p) ? pageGone(p, waitingSlot(p)!.key) : p),
    ];
    let seed = 7;
    let broken = 0;
    for (let i = 0; i < 2_000; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      pool = steps[seed % steps.length](pool);
      broken += violations(pool, owner);
    }
    h.eq(broken, 0, 'every WebView serves at most one launch, never waits after it, and at most one waits, only with no app open');
    h.ok(owner.size > 100, 'over many launches');
  });
}
