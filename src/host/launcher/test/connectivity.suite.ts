/**
 * connectivity Node suite (server-connectivity chain-3, tasks 3.1-3.4) — `ConnectivityLoop`
 * against a manually-fired fake clock, no real wall-clock delays and no fixed flush budget
 * (`whenIdle()` awaits exactly the loop's current in-flight cycle).
 *
 * Scenarios (spec `server-connectivity/spec.md` "A configured server is probed at startup and
 * retried with capped exponential backoff until first success", "A real generation or rewrite
 * call succeeding counts as the session's first success", "No server address configured is
 * distinct from an unreachable configured address"):
 *   - backoff doubles 2s, 4s, 8s, 16s, 30s and stays at 30s on every attempt after the cap.
 *   - the loop stops scheduling once the dedicated probe itself succeeds (verified or unverified
 *     both count).
 *   - `markOnline()` (the generation-call-site hook) stops a still-retrying loop even though the
 *     dedicated probe never succeeded on its own, and cancels the pending retry timer.
 *   - a loop that is never `start()`-ed never publishes anything — `'unknown'`, not `'offline'`.
 *   - once online, no further probe is scheduled — `start()` and a late external `markOnline()`
 *     are both no-ops.
 */

import { Harness } from './harness';
import { ConnectivityLoop, backoffDelayMs } from '../connectivity';
import type { Connectivity, TimerLike } from '../connectivity';

/** A fake `TimerLike` with exactly the control a suite needs: fire the single pending timer on
 *  demand, and read back every delay `setTimeout` was called with (the backoff schedule). Never
 *  schedules against the real clock, so nothing here can hang or flake on wall-clock timing. */
class FakeTimers implements TimerLike {
  private nextId = 1;
  private readonly pending = new Map<number, () => void>();
  readonly delays: number[] = [];

  setTimeout = (cb: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.pending.set(id, cb);
    this.delays.push(ms);
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.pending.delete(handle as number);
  };

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Fire the one pending timer. Throws if there isn't exactly one — the loop never schedules
   *  more than one at a time, so a suite asserting on a specific count catches a regression here
   *  rather than firing the wrong one silently. */
  fireOnly(): void {
    const entries = [...this.pending.entries()];
    if (entries.length !== 1) {
      throw new Error(`expected exactly one pending timer, found ${entries.length}`);
    }
    const [id, cb] = entries[0];
    this.pending.delete(id);
    cb();
  }
}

function neverSucceeds(): () => Promise<'unreachable'> {
  return async () => 'unreachable';
}

export async function runConnectivityTests(h: Harness): Promise<void> {
  await h.test('ConnectivityLoop: backoff doubles 2s,4s,8s,16s,30s and stays at 30s past the cap', async () => {
    h.eq(
      [0, 1, 2, 3, 4, 5, 6].map(backoffDelayMs),
      [2000, 4000, 8000, 16000, 30000, 30000, 30000],
      'backoffDelayMs schedule',
    );

    const timers = new FakeTimers();
    const states: Connectivity[] = [];
    const loop = new ConnectivityLoop({ probe: neverSucceeds(), publish: (s) => states.push(s), timers });

    loop.start();
    await loop.whenIdle();
    for (let i = 0; i < 5; i++) {
      timers.fireOnly();
      await loop.whenIdle();
    }

    h.eq(timers.delays, [2000, 4000, 8000, 16000, 30000, 30000], 'six scheduled retries follow the capped schedule');
    h.eq(states, ['checking', 'offline'], 'state settles at offline and never republishes on repeated failure');
  });

  await h.test('ConnectivityLoop: stops scheduling once the dedicated probe itself succeeds', async () => {
    const timers = new FakeTimers();
    let calls = 0;
    const probe = async (): Promise<'verified' | 'unverified' | 'unreachable'> => {
      calls++;
      return calls < 3 ? 'unreachable' : 'unverified'; // a 200-but-unverified probe still counts
    };
    const states: Connectivity[] = [];
    const loop = new ConnectivityLoop({ probe, publish: (s) => states.push(s), timers });

    loop.start();
    await loop.whenIdle();
    timers.fireOnly();
    await loop.whenIdle();
    timers.fireOnly();
    await loop.whenIdle();

    h.eq(calls, 3, 'probed exactly three times before succeeding');
    h.eq(states, ['checking', 'offline', 'online'], 'reaches online on the third (unverified) probe');
    h.eq(timers.pendingCount, 0, 'no further retry is scheduled once online');

    // A late external markOnline() (e.g. a generation call landing just after) is a no-op.
    loop.markOnline();
    h.eq(states, ['checking', 'offline', 'online'], 'markOnline() once already online publishes nothing new');
  });

  await h.test(
    'ConnectivityLoop: markOnline() stops a still-retrying loop even though the dedicated probe never succeeded',
    async () => {
      const timers = new FakeTimers();
      let calls = 0;
      const probe = async (): Promise<'unreachable'> => {
        calls++;
        return 'unreachable';
      };
      const states: Connectivity[] = [];
      const loop = new ConnectivityLoop({ probe, publish: (s) => states.push(s), timers });

      loop.start();
      await loop.whenIdle();
      h.eq(states, ['checking', 'offline'], 'still retrying: offline with a pending backoff timer');
      h.eq(timers.pendingCount, 1, 'a retry is scheduled');

      // Simulate a real generation/clarify call succeeding while the probe loop is still waiting
      // on its next backoff attempt — spec "A successful generation stops a still-retrying probe
      // loop".
      loop.markOnline();

      h.eq(states, ['checking', 'offline', 'online'], 'markOnline() transitions straight to online');
      h.eq(timers.pendingCount, 0, 'the pending scheduled retry is cancelled');
      h.eq(calls, 1, 'the dedicated probe is never invoked again after markOnline()');
    },
  );

  await h.test('ConnectivityLoop: a loop that is never start()-ed stays unknown, never reaches offline', async () => {
    const timers = new FakeTimers();
    const states: Connectivity[] = [];
    const loop = new ConnectivityLoop({ probe: neverSucceeds(), publish: (s) => states.push(s), timers });
    await loop.whenIdle(); // resolves immediately: nothing has been started yet

    h.eq(states, [], 'no state was ever published — unknown is the caller-side default, never offline');
    h.eq(timers.pendingCount, 0, 'no retry loop was scheduled for an address that was never configured');
  });

  await h.test('ConnectivityLoop: stop() clears a pending retry timer, not just future scheduling', async () => {
    const timers = new FakeTimers();
    let calls = 0;
    const probe = async (): Promise<'unreachable'> => {
      calls++;
      return 'unreachable';
    };
    const states: Connectivity[] = [];
    const loop = new ConnectivityLoop({ probe, publish: (s) => states.push(s), timers });

    loop.start();
    await loop.whenIdle();
    h.eq(states, ['checking', 'offline'], 'still retrying: offline with a pending backoff timer');
    h.eq(timers.pendingCount, 1, 'a retry is scheduled before stop()');
    h.eq(calls, 1, 'probed exactly once so far');

    loop.stop();

    h.eq(timers.pendingCount, 0, 'stop() clears the already-pending retry timer, effect cleanup / unmount');
    h.eq(calls, 1, 'the cleared retry never fires — probe is never called a second time');
    h.eq(states, ['checking', 'offline'], 'stop() publishes nothing new');
  });

  await h.test('ConnectivityLoop: once online, start() is a no-op and re-probes nothing', async () => {
    const timers = new FakeTimers();
    let calls = 0;
    const probe = async (): Promise<'verified'> => {
      calls++;
      return 'verified';
    };
    const states: Connectivity[] = [];
    const loop = new ConnectivityLoop({ probe, publish: (s) => states.push(s), timers });

    loop.start();
    await loop.whenIdle();
    h.eq(states, ['checking', 'online'], 'a verified probe reaches online on the first attempt');
    h.eq(calls, 1, 'probed exactly once');

    loop.start();
    h.eq(calls, 1, 'start() after online never probes again');
    h.eq(states, ['checking', 'online'], 'start() after online publishes nothing new');
  });
}
