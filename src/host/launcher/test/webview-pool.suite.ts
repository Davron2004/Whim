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
  launchOpened,
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
 *  a WebView serving a second launch or waiting again after one, more than one waiting (or none
 *  with no app open), more than one WebView bound, or a WebView changing its place among the
 *  others (a native view moved under a running app). */
function violations(pool: WebViewPool, owner: Map<number, number>): number {
  let broken = 0;
  for (const slot of pool.slots) {
    const was = owner.get(slot.key);
    if (was !== undefined && was !== slot.launch) broken += 1;
    if (slot.launch !== null) owner.set(slot.key, slot.launch);
  }
  const waiting = pool.slots.filter((s) => s.launch === null).length;
  if (waiting > 1 || (pool.launch === null && waiting !== 1)) broken += 1;
  if (pool.slots.filter((s) => s.launch !== null).length > 1) broken += 1;
  if (pool.slots.some((s, i) => i > 0 && pool.slots[i - 1].key > s.key)) broken += 1;
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
      'the launch takes the waiting WebView, warm, and none other loads while it opens');
    const opened = launchOpened(open);
    const replacement = waitingSlot(opened);
    h.ok(replacement !== undefined && replacement.key !== waiting.key && replacement.page === 'loading',
      'once it has opened, a fresh one starts loading beside it, while the app runs');
    h.eq(launchOpened(opened), opened, 'and only one');
    h.eq(openApp(opened, 'tip'), opened, 'the same app open is no new launch');
    const closed = openApp(warmed(opened), null);
    h.ok(!closed.slots.some((s) => s.key === waiting.key), 'closing the app destroys its WebView');
    h.eq([closed.slots.length, waitingSlot(closed)?.key, waitingSlot(closed)?.page], [1, replacement!.key, 'warm'],
      'and the one that warmed while it ran waits, already warm');
    const next = openApp(closed, 'tip');
    h.ok(launchSlot(next)!.key === replacement!.key && launchSlot(next)!.handedOut === 'warm' && next.launch !== open.launch,
      'opening the same app again is a new launch, warm, in a WebView it never had');
  });

  await h.test('pool: one app straight after another destroys the first app’s WebView; the second takes the one that waited beside it', () => {
    const a = launchOpened(openApp(warmed(openApp(EMPTY_POOL, null)), 'a'));
    const b = openApp(a, 'b');
    h.ok(!b.slots.some((s) => s.key === launchSlot(a)!.key), 'the first app’s WebView is gone');
    h.eq([launchSlot(b)?.key, launchSlot(b)?.handedOut, b.slots.length], [waitingSlot(a)!.key, 'loading', 1],
      'the second app’s is the one A never had, still loading, and none other loads while it opens');
    const unopened = openApp(openApp(warmed(openApp(EMPTY_POOL, null)), 'a'), 'b');
    h.eq(launchSlot(unopened)?.handedOut, 'cold', 'an app left before it opened leaves none waiting: the next gets a cold one');
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
    h.eq([launchSlot(failed), failed.slots.length, failed.launch], [undefined, 1, open.launch], 'no WebView of its own while the recovery screen shows; one starts waiting');
    const retried = retryLaunch(warmed(failed));
    h.ok(launchSlot(retried)!.key !== first && launchSlot(retried)!.handedOut === 'warm' && retried.launch === open.launch,
      'Retry gives the same launch a new WebView: the one that warmed meanwhile');
    h.ok(launchSlot(retryLaunch(retried))!.key !== launchSlot(retried)!.key, 'and Retry without a failure screen replaces the WebView too');
  });

  await h.test('pool: over any sequence of opens, closes, failures, retries and page events, no WebView ever serves two launches or waits again', () => {
    let pool = openApp(EMPTY_POOL, null);
    const owner = new Map<number, number>();
    let notWaiting = 0;
    const opened = (p: WebViewPool) => {
      const q = launchOpened(p);
      if (waitingSlot(q) === undefined) notWaiting += 1;
      return q;
    };
    const steps: ((p: WebViewPool) => WebViewPool)[] = [
      (p) => openApp(p, 'a'), (p) => openApp(p, 'b'), (p) => openApp(p, null), (p) => openApp(p, 'a'),
      launchFailed, retryLaunch, opened,
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
    h.eq(broken, 0, 'every WebView serves at most one launch and never waits after it; at most one waits, exactly one with no app open; none moves');
    h.eq(notWaiting, 0, 'and once a launch has opened, one waits beside it');
    h.ok(owner.size > 100, 'over many launches');
  });
}
