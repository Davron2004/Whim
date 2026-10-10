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
import type { Connectivity } from '../connectivity';
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

  await runOnlineEdgeTests(h);
}

type ProbeAnswer = 'verified' | 'unreachable';

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

/** A probe that answers from `script` in order (the last answer repeats) and counts its calls. */
function scriptedProbe(script: ProbeAnswer[]) {
  const log = { calls: 0 };
  const probe = async (): Promise<ProbeAnswer> => script[Math.min(log.calls++, script.length - 1)];
  return { probe, log };
}

/** A probe that stays in flight until the test settles it, so overlap is observable. */
function heldProbe() {
  const log = { calls: 0 };
  const waiting: Array<(answer: ProbeAnswer) => void> = [];
  const probe = (): Promise<ProbeAnswer> => {
    log.calls++;
    return new Promise((resolve) => waiting.push(resolve));
  };
  return { probe, log, settle: (answer: ProbeAnswer) => waiting.shift()?.(answer) };
}

/** An online, watched, foreground loop that has probed once, with its published states. */
async function onlineWatched(script: ProbeAnswer[]) {
  const timers = new FakeTimers();
  const { probe, log } = scriptedProbe(['verified', ...script]);
  const states: Connectivity[] = [];
  const loop = new ConnectivityLoop({ probe, publish: (s) => states.push(s), timers });
  loop.setWatching(true);
  loop.start();
  await idle(loop);
  return { timers, log, states, loop };
}

async function runOnlineEdgeTests(h: Harness): Promise<void> {
  await h.test('ConnectivityLoop: online is not terminal — probes failing on a watched Home turn it offline after two, not one', async () => {
    const { timers, log, states, loop } = await onlineWatched(['unreachable', 'unreachable']);
    h.eq(timers.delays, [30000], 'online and watched: the next check is the 30s interval');

    timers.fireOnly();
    await idle(loop);
    h.eq(states, ['checking', 'online'], 'one failed probe publishes nothing — a slow network is not an outage');
    h.eq(timers.delays, [30000, 2000], 'the failure is confirmed after the first backoff step, not after a full interval');

    timers.fireOnly();
    await idle(loop);
    h.eq(states, ['checking', 'online', 'offline'], 'the second consecutive failure turns the session offline');
    h.eq(log.calls, 3, 'exactly one startup probe and two failed re-checks');
    h.eq(timers.delays, [30000, 2000, 2000], 'offline then follows the startup backoff from its first step');
  });

  await h.test('ConnectivityLoop: a single failed probe followed by a success never shows offline, and the count starts over', async () => {
    const { timers, states, loop } = await onlineWatched(['unreachable', 'verified', 'unreachable', 'verified']);
    timers.fireOnly();
    await idle(loop);
    timers.fireOnly();
    await idle(loop);
    timers.fireOnly();
    await idle(loop);
    timers.fireOnly();
    await idle(loop);
    h.eq(states, ['checking', 'online'], 'two non-consecutive failures are not an outage');
    h.eq(timers.delays, [30000, 2000, 30000, 2000, 30000], 'a success returns to the 30s interval');
  });

  await h.test('ConnectivityLoop: offline, then a probe succeeds — online again by the existing backoff loop', async () => {
    const { timers, states, loop } = await onlineWatched(['unreachable', 'unreachable', 'verified']);
    timers.fireOnly();
    await idle(loop);
    timers.fireOnly();
    await idle(loop);
    h.eq(states[states.length - 1], 'offline', 'precondition: the session went offline');

    timers.fireOnly();
    await idle(loop);
    h.eq(states, ['checking', 'online', 'offline', 'online'], 'a successful probe clears offline');
    h.eq(timers.delays[timers.delays.length - 1], 30000, 'and the watched Home goes back to the 30s interval');
  });

  await h.test('ConnectivityLoop: a network-level request failure is confirmed by one probe and turns the session offline', async () => {
    const { timers, log, states, loop } = await onlineWatched(['unreachable']);
    loop.noteNetworkFailure();
    await idle(loop);
    h.eq(log.calls, 2, 'the failure probes straight away instead of waiting out the interval');
    h.eq(states, ['checking', 'online', 'offline'], 'a request that got no answer plus a failed probe is offline');
    h.eq(timers.pendingCount, 1, 'the backoff probe is scheduled');
  });

  await h.test('ConnectivityLoop: a network-level request failure while the server answers the probe leaves the session online', async () => {
    const { log, states, loop } = await onlineWatched(['verified']);
    loop.noteNetworkFailure();
    await idle(loop);
    h.eq(log.calls, 2, 'the failure was checked');
    h.eq(states, ['checking', 'online'], 'a reachable server means the failed request was not a connectivity problem');
  });

  await h.test('ConnectivityLoop: a request failure on a session that is not online starts no extra probe', async () => {
    const timers = new FakeTimers();
    const { probe, log } = scriptedProbe(['unreachable']);
    const loop = new ConnectivityLoop({ probe, publish: () => {}, timers });
    loop.start();
    await idle(loop);
    loop.noteNetworkFailure();
    await idle(loop);
    h.eq(log.calls, 1, 'offline already retries on its backoff');
  });

  await h.test('ConnectivityLoop: a probe that started before a real response cannot confirm a later request failure', async () => {
    const timers = new FakeTimers();
    const held = heldProbe();
    const states: Connectivity[] = [];
    const loop = new ConnectivityLoop({ probe: held.probe, publish: (s) => states.push(s), timers });
    loop.setWatching(true);
    loop.start();
    held.settle('verified');
    await idle(loop);
    timers.fireOnly();
    loop.markOnline();
    loop.noteNetworkFailure();
    held.settle('unreachable');
    await idle(loop);
    h.eq(states, ['checking', 'online'], 'a probe older than a successful request is not evidence about the failure after it');
    h.eq(timers.delays, [30000, 2000], 'the unconfirmed failure is re-checked after the first backoff step');

    timers.fireOnly();
    held.settle('unreachable');
    await idle(loop);
    h.eq(states, ['checking', 'online', 'offline'], 'a probe that started after the failure confirms it');
  });

  await h.test('ConnectivityLoop: nothing is probed or scheduled in the background, and returning to the foreground probes at once', async () => {
    const { timers, log, states, loop } = await onlineWatched(['unreachable', 'unreachable']);
    loop.setForeground(false);
    h.eq(timers.pendingCount, 0, 'backgrounding cancels the re-check');
    loop.setWatching(false);
    loop.setWatching(true);
    h.eq(timers.pendingCount, 0, 'a Home visit in the background schedules nothing');

    loop.setForeground(true);
    await idle(loop);
    h.eq(log.calls, 2, 'the return to the foreground fires one probe without waiting for a timer');
    h.eq(states, ['checking', 'online'], 'one failed probe after the return is still not an outage');
  });

  await h.test('ConnectivityLoop: an offline session pauses its backoff in the background and probes on return', async () => {
    const timers = new FakeTimers();
    const { probe, log } = scriptedProbe(['unreachable', 'verified']);
    const states: Connectivity[] = [];
    const loop = new ConnectivityLoop({ probe, publish: (s) => states.push(s), timers });
    loop.start();
    await idle(loop);
    loop.setForeground(false);
    h.eq(timers.pendingCount, 0, 'no backoff probe is pending in the background');

    loop.setForeground(true);
    await idle(loop);
    h.eq(log.calls, 2, 'the return probes at once');
    h.eq(states, ['checking', 'offline', 'online'], 'and a reachable server clears the notice');
  });

  await h.test('ConnectivityLoop: an unwatched online session does not re-check on its own', async () => {
    const timers = new FakeTimers();
    const { probe } = scriptedProbe(['verified']);
    const loop = new ConnectivityLoop({ probe, publish: () => {}, timers });
    loop.start();
    await idle(loop);
    h.eq(timers.pendingCount, 0, 'no timer without a watched Home');
    loop.setWatching(true);
    h.eq(timers.delays, [30000], 'showing Home starts the 30s re-check');
    loop.setWatching(false);
    h.eq(timers.pendingCount, 0, 'leaving Home stops it');
  });

  await h.test('ConnectivityLoop: never two probes in flight, however they are asked for', async () => {
    const timers = new FakeTimers();
    const held = heldProbe();
    const loop = new ConnectivityLoop({ probe: held.probe, publish: () => {}, timers });
    loop.setWatching(true);
    loop.start();
    held.settle('verified');
    await idle(loop);
    h.eq(held.log.calls, 1, 'the startup probe');

    loop.noteNetworkFailure();
    loop.noteNetworkFailure();
    loop.setForeground(false);
    loop.setForeground(true);
    h.eq(held.log.calls, 2, 'a failure, a second failure and a foreground return share one probe');
    held.settle('verified');
    await idle(loop);
    h.eq(timers.pendingCount, 1, 'the settled probe schedules the one next check');
    timers.fireOnly();
    h.eq(held.log.calls, 3, 'the next check is a fresh probe');
    held.settle('verified');
    await idle(loop);
  });

  await h.test('ConnectivityLoop: stop() cancels the online re-check and ignores a probe still in flight', async () => {
    const timers = new FakeTimers();
    const held = heldProbe();
    const states: Connectivity[] = [];
    const loop = new ConnectivityLoop({ probe: held.probe, publish: (s) => states.push(s), timers });
    loop.setWatching(true);
    loop.start();
    held.settle('verified');
    await idle(loop);
    timers.fireOnly();
    loop.stop();
    held.settle('unreachable');
    await idle(loop);
    h.eq(states, ['checking', 'online'], 'a stopped loop publishes nothing');
    h.eq(timers.pendingCount, 0, 'and schedules nothing');
  });
}
