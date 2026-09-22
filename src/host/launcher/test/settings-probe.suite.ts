/** Debounce and stale-result tests use a manual timer and await the exact probe promise. */
import { runSettingsScreenTests } from './settings-screen.suite';
import { Harness } from './harness';
import { DebouncedProbe } from '../settings-probe';
import type { SettingsProbeState } from '../settings-probe';
import type { TimerLike } from '../connectivity';
import type { ProbeResult } from '../server-probe';

/** Mirrors `connectivity.suite.ts`'s `FakeTimers`: fire the one pending timer on demand, read
 *  back every delay `setTimeout` was called with. Never touches the real clock. */
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

  /** Fire the one pending timer. Throws if there isn't exactly one. */
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

/** A controllable probe stub: `resolvers[i]` resolves the i-th call in call order. `promises[i]`
 *  is that SAME call's own promise — a suite awaits it directly (never a fixed microtask-flush
 *  count) to know a resumed `await` inside `DebouncedProbe` has actually run, per this repo's
 *  fixed-tick-budget-flake lesson: the reaction `DebouncedProbe` attached via its own internal
 *  `await` was registered strictly before the suite's `await promises[i]` reaction, so the FIFO
 *  microtask queue guarantees the former runs first. */
function deferredProbe(): {
  probe: (url: string) => Promise<ProbeResult>;
  calls: string[];
  promises: Array<Promise<ProbeResult>>;
  resolve: (index: number, result: ProbeResult) => void;
} {
  const calls: string[] = [];
  const resolvers: Array<(result: ProbeResult) => void> = [];
  const promises: Array<Promise<ProbeResult>> = [];
  const probe = (url: string): Promise<ProbeResult> => {
    calls.push(url);
    const p = new Promise<ProbeResult>((resolve) => {
      resolvers.push(resolve);
    });
    promises.push(p);
    return p;
  };
  return {
    probe,
    calls,
    promises,
    resolve: (index, result) => resolvers[index](result),
  };
}

export async function runSettingsProbeTests(h: Harness): Promise<void> {
  // ── DebouncedProbe: really run, against a fake clock ────────────────────────

  await h.test('DebouncedProbe: fires once, ~600ms after the last edit — not per keystroke', async () => {
    const timers = new FakeTimers();
    const pending = deferredProbe();
    const probe = pending.probe;
    const states: SettingsProbeState[] = [];
    const d = new DebouncedProbe({ probe, publish: (s) => states.push(s), timers });

    d.schedule('https://a.example');
    d.schedule('https://ab.example');
    d.schedule('https://abc.example');
    h.eq(timers.delays, [600, 600, 600], 'every edit re-schedules the SAME 600ms debounce window');
    h.eq(timers.pendingCount, 1, 'only the latest timer is still pending — the earlier two were cancelled');
    h.eq(pending.calls.length, 0, 'no probe has fired yet');

    timers.fireOnly();
    pending.resolve(0, 'verified');
    await pending.promises[0];
    h.eq(pending.calls.length, 1, 'exactly one probe fires, for the final edit');
    h.eq(states, ['checking', 'verified'], 'publishes checking then the settled result');
  });

  await h.test('DebouncedProbe: rapid retyping discards a probe already in flight from an earlier edit', async () => {
    const timers = new FakeTimers();
    const d = deferredProbe();
    const states: SettingsProbeState[] = [];
    const loop = new DebouncedProbe({ probe: d.probe, publish: (s) => states.push(s), timers });

    // First edit's debounce fires — its probe is now in flight (awaiting resolution).
    loop.schedule('https://a.example');
    timers.fireOnly();
    h.eq(d.calls, ['https://a.example'], 'the first edit’s probe started');
    h.eq(states, ['checking'], 'checking is published while the first probe is in flight');

    // A new edit arrives before that probe settles: it must be fenced off.
    loop.schedule('https://b.example');
    h.eq(timers.pendingCount, 1, 'a new debounce timer is scheduled for the second edit');
    timers.fireOnly();
    h.eq(d.calls, ['https://a.example', 'https://b.example'], 'the second edit’s probe also started');
    // Still just one 'checking' publish — the state machine was already checking, so the second
    // probe starting republishes nothing new (no flicker).
    h.eq(states, ['checking'], 'checking is not re-published for the second, still-in-flight probe');

    // Resolve and await the current probe itself.
    d.resolve(1, 'verified');
    await d.promises[1];
    h.eq(states, ['checking', 'verified'], 'the second (current) probe’s result lands');

    // A late result from the superseded probe cannot replace it.
    d.resolve(0, 'unreachable');
    await d.promises[0];
    h.eq(states, ['checking', 'verified'], 'the stale first probe’s late result is discarded, not applied');
  });

  await h.test('DebouncedProbe: cancel() stops a pending timer and fences off an in-flight probe', async () => {
    const timers = new FakeTimers();
    const d = deferredProbe();
    const states: SettingsProbeState[] = [];
    const loop = new DebouncedProbe({ probe: d.probe, publish: (s) => states.push(s), timers });

    loop.schedule('https://a.example');
    timers.fireOnly();
    h.eq(states, ['checking'], 'a probe is in flight');

    loop.cancel();
    d.resolve(0, 'verified');
    await d.promises[0]; // awaiting the exact settled promise, not a fixed microtask-flush count
    h.eq(states, ['checking'], 'a result arriving after cancel() is never published');

    loop.schedule('https://b.example');
    h.eq(timers.pendingCount, 1, 'cancel() does not disable the instance — a later schedule() still runs a fresh cycle');
  });

  await runSettingsScreenTests(h);
}
