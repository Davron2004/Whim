/**
 * back-policy Node suite (task 2.2, from back-policy.spec.md). The pure guaranteed-exit
 * machine: depth-0 exit, pop-forwarding, the unhandled-press window + double-back escape,
 * inflated-depth claims, slow-but-cooperative apps, generation fencing, fresh-realm reset,
 * no-realm ignore. Every numbered case maps to a spec scenario.
 */

import { Harness } from './harness';
import { BackPolicy, step, initialBackState } from '../back-policy';

export async function runBackPolicyTests(h: Harness): Promise<void> {
  // §1–2 depth-0 exit
  await h.test('back-policy §1 reset then no nav-depth → back exits', async () => {
    const p = new BackPolicy();
    p.reset(2);
    h.eq(p.backPress(), 'exit', 'depth-0 (never reported) exits');
  });

  await h.test('back-policy §2 explicit depth 0 → back exits', async () => {
    const p = new BackPolicy();
    p.reset(2);
    p.navDepth(0, 2);
    h.eq(p.backPress(), 'exit', 'depth 0 exits');
  });

  // §3–4 pop-forwarding (cooperating app: depth 2, three presses → forward, forward, exit)
  await h.test('back-policy §3-4 depth 2, three presses → forward, forward, exit', async () => {
    const p = new BackPolicy();
    p.reset(7);
    p.navDepth(2, 7);
    h.eq(p.backPress(), 'forward', 'press 1 forwards a pop');
    h.ok(p.awaitingPop, 'awaitingPop set after forward');
    p.navDepth(1, 7); // app popped
    h.ok(!p.awaitingPop, 'cooperating decrease clears awaitingPop');
    h.eq(p.backPress(), 'forward', 'press 2 forwards a pop');
    p.navDepth(0, 7); // app popped to root
    h.eq(p.backPress(), 'exit', 'press 3 exits at root');
  });

  // §5 double-back escape (misbehaving app, impatient user — exits inside the window)
  await h.test('back-policy §5 no decrease → second press exits (double-back)', async () => {
    const p = new BackPolicy();
    p.reset(1);
    p.navDepth(5, 1);
    h.eq(p.backPress(), 'forward', 'press 1 forwards');
    h.eq(p.backPress(), 'exit', 'press 2 exits (pop unacknowledged)');
  });

  // §6 the unhandled-press window (patient user — timeout arms the escape)
  await h.test('back-policy §6 timeout arms escape → next press exits', async () => {
    const p = new BackPolicy();
    p.reset(1);
    p.navDepth(5, 1);
    h.eq(p.backPress(), 'forward', 'press 1 forwards');
    p.timeout(); // window elapsed, no decrease
    h.eq(p.backPress(), 'exit', 'next press exits after timeout');
  });

  // §7 inflated-depth claim buys nothing beyond one forwarded pop
  await h.test('back-policy §7 inflated depth resolves to exit within one window', async () => {
    const p = new BackPolicy();
    p.reset(1);
    p.navDepth(999999, 1);
    h.eq(p.backPress(), 'forward', 'press 1 forwards (one pop)');
    h.eq(p.backPress(), 'exit', 'press 2 exits regardless of claimed magnitude');
  });

  // §8 slow-but-cooperative: escape must yield when a genuine decrease finally arrives
  await h.test('back-policy §8 late decrease disarms escape (cooperation not punished)', async () => {
    const p = new BackPolicy();
    p.reset(3);
    p.navDepth(2, 3);
    h.eq(p.backPress(), 'forward', 'press 1 forwards');
    p.timeout(); // escape armed
    p.navDepth(1, 3); // app finally pops
    h.ok(!p.snapshot.escapeArmed, 'late genuine decrease disarms the escape');
    h.eq(p.backPress(), 'forward', 'next press forwards again (app is cooperating)');
  });

  // §9-11 generation fencing + fresh-realm reset
  await h.test('back-policy §9 stale-generation depth report is ignored', async () => {
    const p = new BackPolicy();
    p.reset(2); // current generation 2
    p.navDepth(7, 1); // a report from the previous realm
    h.eq(p.snapshot.depth, 0, 'stale report does not change depth');
    h.eq(p.backPress(), 'exit', 'fresh realm starts at depth 0 → exit');
  });

  await h.test('back-policy §10 non-current generation never mutates pop/escape flags', async () => {
    const before = (() => {
      let s = initialBackState();
      s = step(s, { type: 'reset', generation: 5 }).state;
      s = step(s, { type: 'navDepth', depth: 4, generation: 5 }).state;
      s = step(s, { type: 'backPress' }).state; // awaitingPop now true
      return s;
    })();
    const after = step(before, { type: 'navDepth', depth: 0, generation: 4 }).state; // stale
    h.eq(after, before, 'a stale report is a no-op on the whole state');
  });

  await h.test('back-policy §11 fresh realm reset clears depth + flags', async () => {
    const p = new BackPolicy();
    p.reset(1);
    p.navDepth(4, 1);
    p.backPress(); // forward, awaitingPop true
    p.reset(2); // new realm
    h.eq(p.snapshot.depth, 0, 'reset clears depth');
    h.ok(!p.snapshot.awaitingPop && !p.snapshot.escapeArmed, 'reset clears pop/escape flags');
    h.eq(p.backPress(), 'exit', 'fresh realm exits at root');
  });

  // §12 no realm bound → ignore (the launcher owns that press)
  await h.test('back-policy §12 no realm bound → ignore', async () => {
    const p = new BackPolicy();
    h.eq(p.backPress(), 'ignore', 'unbound back press is ignored');
  });
}
