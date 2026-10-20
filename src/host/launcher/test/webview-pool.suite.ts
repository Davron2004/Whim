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
  waitingSlot,
  type WebViewPool,
} from '../webview-pool';

/** A waiting WebView whose page loaded and answered the probe. */
function warmed(pool: WebViewPool): WebViewPool {
  const key = waitingSlot(pool)!.key;
  return pageAnswered(pageLoaded(pool, key), key);
}

/** How `pool` breaks the pool's promises, given `owner` (every WebView's launch so far, updated) and
 *  the pool before the step: a WebView serving a second launch or waiting again after one, more than
 *  one waiting (or none with no app open), more than one WebView bound, the waiting one drawn over
 *  the bound one, or two WebViews swapping places (a native view moved under a running app). */
function violations(pool: WebViewPool, before: WebViewPool, owner: Map<number, number>): number {
  let broken = 0;
  for (const slot of pool.slots) {
    const was = owner.get(slot.key);
    if (was !== undefined && was !== slot.launch) broken += 1;
    if (slot.launch !== null) owner.set(slot.key, slot.launch);
  }
  const waiting = pool.slots.filter((s) => s.launch === null).length;
  if (waiting > 1 || (pool.launch === null && waiting !== 1)) broken += 1;
  if (pool.slots.filter((s) => s.launch !== null).length > 1) broken += 1;
  if (pool.slots.some((s, i) => s.launch === null && pool.slots.slice(0, i).some((under) => under.launch !== null))) broken += 1;
  const kept = (p: WebViewPool, q: WebViewPool) => p.slots.map((s) => s.key).filter((key) => q.slots.some((s) => s.key === key));
  if (kept(pool, before).join() !== kept(before, pool).join()) broken += 1;
  return broken;
}

/** mulberry32: a 32-bit PRNG whose every step stays an exact integer (`Math.imul`), so the sequence
 *  reaches every step kind evenly. */
function mulberry32(seed: number): () => number {
  /* eslint-disable no-bitwise -- 32-bit integer mixing is what this generator is, not a bitmask */
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  /* eslint-enable no-bitwise */
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

  await h.test('pool: the open app opened again in place (Reload) is a new launch: its WebView is destroyed and the new launch takes the one that waited beside it', () => {
    const running = launchOpened(openApp(warmed(openApp(EMPTY_POOL, null)), 'tip@1'));
    const reloaded = openApp(warmed(running), 'tip@2');
    h.ok(reloaded.launch !== running.launch, 'a new launch');
    h.ok(!reloaded.slots.some((s) => s.key === launchSlot(running)!.key), 'the running launch’s WebView is gone, never handed out again');
    h.eq([launchSlot(reloaded)?.key, launchSlot(reloaded)?.handedOut, reloaded.slots.length], [waitingSlot(running)!.key, 'warm', 1],
      'the new launch has the WebView that warmed while the app ran, and none other loads while it opens');
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

  await h.test('pool: a failure surface destroys the launch’s WebView, and Reload (a new opening) takes the one that waited meanwhile', () => {
    const open = openApp(warmed(openApp(EMPTY_POOL, null)), 'a@1');
    const first = launchSlot(open)!.key;
    const failed = launchFailed(open);
    h.eq([launchSlot(failed), failed.slots.length, failed.launch], [undefined, 1, open.launch], 'no WebView of its own while the recovery screen shows; one starts waiting');
    const reloaded = openApp(warmed(failed), 'a@2');
    h.ok(launchSlot(reloaded)!.key !== first && launchSlot(reloaded)!.key === waitingSlot(failed)!.key && launchSlot(reloaded)!.handedOut === 'warm',
      'Reload binds the WebView that warmed while the crash screen showed');
    h.ok(reloaded.launch !== open.launch && reloaded.slots.length === 1, 'as a new launch, with none other loading while it opens');
  });

  await h.test('pool: over any sequence of opens, closes, failures and page events, no WebView ever serves two launches or waits again', () => {
    let pool = openApp(EMPTY_POOL, null);
    const owner = new Map<number, number>();
    let notWaiting = 0;
    const opened = (p: WebViewPool) => {
      const q = launchOpened(p);
      if (waitingSlot(q) === undefined) notWaiting += 1;
      return q;
    };
    const waitingKey = (p: WebViewPool, step: (p: WebViewPool, key: number) => WebViewPool) => (waitingSlot(p) ? step(p, waitingSlot(p)!.key) : p);
    const steps: Record<string, (p: WebViewPool) => WebViewPool> = {
      'open a': (p) => openApp(p, 'a'), 'open b': (p) => openApp(p, 'b'), close: (p) => openApp(p, null),
      launchFailed, launchOpened: opened,
      pageLoaded: (p) => waitingKey(p, pageLoaded), pageAnswered: (p) => waitingKey(p, pageAnswered), pageGone: (p) => waitingKey(p, pageGone),
    };
    const kinds = Object.keys(steps);
    const took = new Map<string, number>(kinds.map((kind) => [kind, 0]));
    let warmHandOvers = 0;
    let appToApp = 0;
    const random = mulberry32(7);
    let broken = 0;
    for (let i = 0; i < 2_000; i++) {
      const kind = kinds[Math.floor(random() * kinds.length)];
      const before = pool;
      pool = steps[kind](pool);
      if (pool !== before) took.set(kind, took.get(kind)! + 1);
      const bound = launchSlot(pool);
      if (bound !== undefined && pool.launch !== before.launch && bound.key === waitingSlot(before)?.key) {
        if (bound.handedOut === 'warm') warmHandOvers += 1;
        if (before.opening !== null && before.opening !== pool.opening) appToApp += 1;
      }
      broken += violations(pool, before, owner);
    }
    h.eq(broken, 0, 'every WebView serves at most one launch and never waits after it; at most one waits, exactly one with no app open, under the bound one; none moves');
    h.eq(notWaiting, 0, 'and once a launch has opened, one waits beside it');
    h.eq(kinds.filter((kind) => took.get(kind)! < 25), [], `every kind of step changed the pool at least 25 times (${[...took].join(' ')})`);
    h.ok(warmHandOvers >= 10 && appToApp >= 10,`with warm hand-overs (${warmHandOvers}) and one app straight to another taking the WebView that waited beside the first (${appToApp})`);
    h.ok(owner.size > 100, 'over many launches');
  });
}
