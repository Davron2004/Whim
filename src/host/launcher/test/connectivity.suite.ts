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
 *   - online by request evidence only: an idle online session probes nothing, however long it
 *     sits; a network-level request failure plus a failed probe turns it offline; a return to the
 *     foreground probes at most once per floor; nothing is probed in the background.
 */

import { Harness } from './harness';
import { ConnectivityLoop, backoffDelayMs } from '../connectivity';
import type { Connectivity, TimerLike } from '../connectivity';
import { FakeTimers } from './fake-timers';

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

  await runRequestEvidenceTests(h);
}

const SECOND = 1000;
const HOUR = 3600 * SECOND;

type ProbeAnswer = 'verified' | 'unreachable' | 'throws';

/** `whenIdle()` raced against a real timeout: a probe the test never settles (a second one that
 *  should not have started) fails the test by name instead of hanging the suite. */
async function idle(loop: ConnectivityLoop): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('the loop never went idle: a probe is still in flight')), 2000);
  });
  try {
    await Promise.race([loop.whenIdle(), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/** Fake time: timers fire only when `advance` moves the clock past them, so "an hour goes by" is
 *  one call, and the loop's foreground floor reads the same clock. */
class VirtualClock implements TimerLike {
  time = 0;
  /** Timers that fired, by delay. */
  readonly fired: number[] = [];
  private nextId = 1;
  private readonly pending = new Map<number, { at: number; delay: number; cb: () => void }>();

  setTimeout = (cb: () => void, delay: number): unknown => {
    const id = this.nextId++;
    this.pending.set(id, { at: this.time + delay, delay, cb });
    return id;
  };

  clearTimeout = (handle: unknown): void => {
    this.pending.delete(handle as number);
  };

  now = (): number => this.time;

  get pendingCount(): number {
    return this.pending.size;
  }

  /** The delay of the one pending timer. */
  get pendingDelay(): number | undefined {
    return [...this.pending.values()][0]?.delay;
  }

  /** Fires the earliest timer due by `end`, moving time to it; false when none is due. */
  fireNext(end = Number.POSITIVE_INFINITY): boolean {
    const due = [...this.pending.entries()]
      .filter(([, timer]) => timer.at <= end)
      .sort(([, a], [, b]) => a.at - b.at)[0];
    if (!due) return false;
    const [id, timer] = due;
    this.pending.delete(id);
    this.time = timer.at;
    this.fired.push(timer.delay);
    timer.cb();
    return true;
  }

  /** Moves time forward, firing each timer that falls due in order and letting the loop settle
   *  after each one before looking for the next. */
  async advance(loop: ConnectivityLoop, ms: number): Promise<void> {
    const end = this.time + ms;
    while (this.fireNext(end)) await idle(loop);
    this.time = end;
  }
}

/** A probe that answers from `script` in order (the last answer repeats) and counts its calls. */
function scriptedProbe(script: ProbeAnswer[]) {
  const log = { calls: 0 };
  const probe = async (): Promise<'verified' | 'unreachable'> => {
    const answer = script[Math.min(log.calls++, script.length - 1)];
    if (answer === 'throws') throw new Error('the probe wrapper failed');
    return answer;
  };
  return { probe, log };
}

/** A probe that stays in flight until the test settles it, so overlap is observable. */
function heldProbe() {
  const log = { calls: 0 };
  const waiting: Array<(answer: 'verified' | 'unreachable') => void> = [];
  const probe = (): Promise<'verified' | 'unreachable'> => {
    log.calls++;
    return new Promise((resolve) => waiting.push(resolve));
  };
  return { probe, log, settle: (answer: 'verified' | 'unreachable') => waiting.shift()?.(answer) };
}

/** A foreground loop on a virtual clock that has made its startup probe (which succeeded); the
 *  probes after it answer from `script`. */
async function onlineLoop(script: ProbeAnswer[]) {
  const clock = new VirtualClock();
  const { probe, log } = scriptedProbe(['verified', ...script]);
  const states: Connectivity[] = [];
  const loop = new ConnectivityLoop({ probe, publish: (s) => states.push(s), timers: clock, now: clock.now });
  loop.start();
  await idle(loop);
  return { clock, log, states, loop };
}

/** The app leaves and comes back, `away` ms later. */
async function leaveAndReturn(loop: ConnectivityLoop, clock: VirtualClock, away: number): Promise<void> {
  loop.setForeground(false);
  await clock.advance(loop, away);
  loop.setForeground(true);
  await idle(loop);
}

async function runRequestEvidenceTests(h: Harness): Promise<void> {
  await h.test('ConnectivityLoop: an idle online session schedules no probe, however long it sits', async () => {
    const { clock, log, states, loop } = await onlineLoop(['unreachable']);
    h.eq(clock.pendingCount, 0, 'online and idle: no timer at all');
    await clock.advance(loop, HOUR);
    h.eq(log.calls, 1, 'an hour on Home in the foreground sends only the startup probe');
    h.eq(clock.fired, [], 'and fires no timer');
    h.eq(states, ['checking', 'online'], 'the session stays online');
  });

  await h.test('ConnectivityLoop: a network-level request failure is confirmed by one probe and turns the session offline', async () => {
    const { clock, log, states, loop } = await onlineLoop(['unreachable']);
    loop.noteNetworkFailure();
    await idle(loop);
    h.eq(log.calls, 2, 'the failure probes straight away');
    h.eq(states, ['checking', 'online', 'offline'], 'a request that got no answer plus a failed probe is offline');
    h.eq(clock.pendingDelay, 2000, 'the backoff probe is scheduled');
  });

  await h.test('ConnectivityLoop: a network-level request failure while the server answers the probe leaves the session online', async () => {
    const { clock, log, states, loop } = await onlineLoop(['verified']);
    loop.noteNetworkFailure();
    await idle(loop);
    h.eq(log.calls, 2, 'the failure was checked');
    h.eq(states, ['checking', 'online'], 'a reachable server means the failed request was not a connectivity problem');
    h.eq(clock.pendingCount, 0, 'and the session is idle again, with nothing scheduled');
    await clock.advance(loop, HOUR);
    h.eq(log.calls, 2, 'for the rest of the hour');
  });

  await h.test('ConnectivityLoop: a request failure on a session that is not online starts no extra probe', async () => {
    const clock = new VirtualClock();
    const { probe, log } = scriptedProbe(['unreachable']);
    const loop = new ConnectivityLoop({ probe, publish: () => {}, timers: clock, now: clock.now });
    loop.start();
    await idle(loop);
    loop.noteNetworkFailure();
    await idle(loop);
    h.eq(log.calls, 1, 'offline already retries on its backoff');
  });

  await h.test('ConnectivityLoop: a request failure in the background asks for nothing', async () => {
    const { clock, log, states, loop } = await onlineLoop(['unreachable']);
    loop.setForeground(false);
    loop.noteNetworkFailure();
    await idle(loop);
    h.eq(log.calls, 1, 'no probe is sent while the app is not in the foreground');
    h.eq(clock.pendingCount, 0, 'and none is scheduled');
    h.eq(states, ['checking', 'online'], 'the session is as it was');
  });

  await h.test('ConnectivityLoop: a probe that started before a real response cannot confirm a later request failure', async () => {
    const clock = new VirtualClock();
    const held = heldProbe();
    const states: Connectivity[] = [];
    const loop = new ConnectivityLoop({ probe: held.probe, publish: (s) => states.push(s), timers: clock, now: clock.now });
    loop.start();
    held.settle('verified');
    await idle(loop);
    loop.setForeground(false);
    clock.time += 20 * SECOND;
    loop.setForeground(true);
    h.eq(held.log.calls, 2, 'the return to the foreground is in flight');
    loop.markOnline();
    loop.noteNetworkFailure();
    held.settle('unreachable');
    await idle(loop);
    h.eq(states, ['checking', 'online'], 'a probe older than a successful request is not evidence about the failure after it');
    h.eq(clock.pendingDelay, 2000, 'the unconfirmed failure is re-checked after the first backoff step');

    clock.fireNext();
    held.settle('unreachable');
    await idle(loop);
    h.eq(states, ['checking', 'online', 'offline'], 'a probe that started after the failure confirms it');
  });

  await h.test('ConnectivityLoop: one failed probe on return to the foreground is not an outage; a second after the first backoff step is', async () => {
    const { clock, log, states, loop } = await onlineLoop(['unreachable', 'unreachable']);
    await leaveAndReturn(loop, clock, 30 * SECOND);
    h.eq(log.calls, 2, 'the return sent one probe');
    h.eq(states, ['checking', 'online'], 'whose single failure publishes nothing');
    h.eq(clock.pendingDelay, 2000, 'the confirmation follows after the first backoff step');

    await clock.advance(loop, 2000);
    h.eq(log.calls, 3, 'the confirmation probe ran');
    h.eq(states, ['checking', 'online', 'offline'], 'two failures in a row turn the session offline');
  });

  await h.test('ConnectivityLoop: a failed probe followed by a success never shows offline, and the count starts over', async () => {
    const { clock, states, loop } = await onlineLoop(['unreachable', 'verified', 'unreachable', 'verified']);
    await leaveAndReturn(loop, clock, 30 * SECOND);
    await clock.advance(loop, 2000);
    await leaveAndReturn(loop, clock, 30 * SECOND);
    await clock.advance(loop, 2000);
    h.eq(states, ['checking', 'online'], 'two failures that are not consecutive are not an outage');
    h.eq(clock.pendingCount, 0, 'and the session is idle again');
  });

  await h.test('ConnectivityLoop: a failure waiting for its confirmation is forgotten when the app goes to the background', async () => {
    const { clock, log, states, loop } = await onlineLoop(['unreachable', 'unreachable']);
    await leaveAndReturn(loop, clock, 30 * SECOND);
    h.eq(clock.pendingDelay, 2000, 'precondition: one failure awaits its confirmation');

    loop.setForeground(false);
    h.eq(clock.pendingCount, 0, 'backgrounding cancels the confirmation');
    clock.time += 30 * SECOND;
    loop.setForeground(true);
    await idle(loop);
    h.eq(log.calls, 3, 'the next return probes');
    h.eq(states, ['checking', 'online'], 'and its failure counts as the first, not the second');
    h.eq(clock.pendingDelay, 2000, 'it awaits its own confirmation');
  });

  await h.test('ConnectivityLoop: returns to the foreground probe at most once per ten seconds', async () => {
    const { clock, log, loop } = await onlineLoop(['verified']);
    await leaveAndReturn(loop, clock, 4 * SECOND);
    h.eq(log.calls, 1, 'a return four seconds after the startup probe sends none');

    await leaveAndReturn(loop, clock, 7 * SECOND);
    h.eq(log.calls, 2, 'a return after the floor sends one');

    await leaveAndReturn(loop, clock, 3 * SECOND);
    await leaveAndReturn(loop, clock, 3 * SECOND);
    h.eq(log.calls, 2, 'two more inside ten seconds send none');

    await leaveAndReturn(loop, clock, 5 * SECOND);
    h.eq(log.calls, 3, 'the one after the floor sends the next');
  });

  await h.test('ConnectivityLoop: nothing is probed or scheduled in the background, offline or online', async () => {
    const { clock, log, loop } = await onlineLoop(['unreachable', 'unreachable', 'unreachable']);
    loop.setForeground(false);
    await clock.advance(loop, HOUR);
    h.eq(log.calls, 1, 'an online session probes nothing in the background');

    loop.setForeground(true);
    await idle(loop);
    await clock.advance(loop, 2000);
    h.eq(log.calls, 3, 'precondition: back in the foreground the failing probes turn it offline');
    h.eq(clock.pendingCount, 1, 'and the backoff is pending');

    loop.setForeground(false);
    h.eq(clock.pendingCount, 0, 'backgrounding cancels the backoff');
    await clock.advance(loop, HOUR);
    h.eq(log.calls, 3, 'an offline session probes nothing in the background either');
  });

  await h.test('ConnectivityLoop: offline, the backoff probe succeeds and the session is online again with nothing scheduled', async () => {
    const { clock, log, states, loop } = await onlineLoop(['unreachable', 'unreachable', 'verified']);
    await leaveAndReturn(loop, clock, 30 * SECOND);
    await clock.advance(loop, 2000);
    h.eq(states[states.length - 1], 'offline', 'precondition: the session went offline');

    await clock.advance(loop, 2000);
    h.eq(states, ['checking', 'online', 'offline', 'online'], 'the first backoff probe that answers clears the notice');
    h.eq(clock.pendingCount, 0, 'and nothing more is scheduled');
    await clock.advance(loop, HOUR);
    h.eq(log.calls, 4, 'for the rest of the hour');
  });

  await h.test('ConnectivityLoop: an offline session returning to the foreground under the floor keeps its backoff', async () => {
    const clock = new VirtualClock();
    const { probe, log } = scriptedProbe(['unreachable']);
    const loop = new ConnectivityLoop({ probe, publish: () => {}, timers: clock, now: clock.now });
    loop.start();
    await idle(loop);
    loop.setForeground(false);
    loop.setForeground(true);
    h.eq(log.calls, 1, 'no probe a moment after the last one');
    h.eq(clock.pendingDelay, 2000, 'the backoff continues');
  });

  await h.test('ConnectivityLoop: an offline session returning after the floor probes at once and a reachable server clears it', async () => {
    const clock = new VirtualClock();
    const { probe, log } = scriptedProbe(['unreachable', 'verified']);
    const states: Connectivity[] = [];
    const loop = new ConnectivityLoop({ probe, publish: (s) => states.push(s), timers: clock, now: clock.now });
    loop.start();
    await idle(loop);
    await leaveAndReturn(loop, clock, 20 * SECOND);
    h.eq(log.calls, 2, 'the return probes without waiting for the backoff');
    h.eq(states, ['checking', 'offline', 'online'], 'and a reachable server clears the notice');
  });

  await h.test('ConnectivityLoop: a probe that throws does not stop later probes', async () => {
    const { clock, log, states, loop } = await onlineLoop(['throws', 'unreachable', 'unreachable']);
    await leaveAndReturn(loop, clock, 30 * SECOND);
    h.eq(log.calls, 2, 'the return probed, and the probe threw');
    h.eq(states, ['checking', 'online'], 'a probe that learned nothing is not a failure of the server');
    h.eq(clock.pendingCount, 0, 'and nothing waits on it');

    await leaveAndReturn(loop, clock, 30 * SECOND);
    h.eq(log.calls, 3, 'the next return still probes');
    h.eq(clock.pendingDelay, 2000, 'and that probe counts');
  });

  await h.test('ConnectivityLoop: a startup probe that throws is retried on the backoff like an unreachable one', async () => {
    const clock = new VirtualClock();
    const { probe, log } = scriptedProbe(['throws', 'verified']);
    const states: Connectivity[] = [];
    const loop = new ConnectivityLoop({ probe, publish: (s) => states.push(s), timers: clock, now: clock.now });
    loop.start();
    await idle(loop);
    h.eq(clock.pendingDelay, 2000, 'a retry is scheduled');
    await clock.advance(loop, 2000);
    h.eq(log.calls, 2, 'the retry ran');
    h.eq(states, ['checking', 'offline', 'online'], 'and the session recovered');
  });

  await h.test('ConnectivityLoop: never two probes in flight, however they are asked for', async () => {
    const clock = new VirtualClock();
    const held = heldProbe();
    const loop = new ConnectivityLoop({ probe: held.probe, publish: () => {}, timers: clock, now: clock.now });
    loop.start();
    held.settle('verified');
    await idle(loop);
    h.eq(held.log.calls, 1, 'the startup probe');

    loop.noteNetworkFailure();
    loop.noteNetworkFailure();
    loop.setForeground(false);
    clock.time += 20 * SECOND;
    loop.setForeground(true);
    h.eq(held.log.calls, 2, 'a failure, a second failure and a foreground return share one probe');
    held.settle('verified');
    await idle(loop);
    h.eq(clock.pendingCount, 0, 'the settled probe schedules nothing');
  });

  await h.test('ConnectivityLoop: stop() cancels what is scheduled and ignores a probe still in flight', async () => {
    const clock = new VirtualClock();
    const held = heldProbe();
    const states: Connectivity[] = [];
    const loop = new ConnectivityLoop({ probe: held.probe, publish: (s) => states.push(s), timers: clock, now: clock.now });
    loop.start();
    held.settle('verified');
    await idle(loop);
    loop.noteNetworkFailure();
    loop.stop();
    held.settle('unreachable');
    await idle(loop);
    h.eq(states, ['checking', 'online'], 'a stopped loop publishes nothing');
    h.eq(clock.pendingCount, 0, 'and schedules nothing');
  });
}
