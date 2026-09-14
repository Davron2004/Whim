/**
 * settings-probe Node suite (server-connectivity chain-4, tasks 4.1-4.4) — `DebouncedProbe`
 * against a manually-fired fake clock, no real wall-clock delays and no fixed flush budget
 * (`whenIdle()` awaits exactly the instance's current debounce+probe cycle), plus static source
 * assertions on `SettingsScreen.tsx` and `copy.ts` for the pieces a `react-native`-importing
 * screen can't be really rendered for under this Node runner (the idiom
 * `launch-failure-ui.suite.ts` established).
 *
 * Scenarios (spec `server-connectivity/spec.md` "Saving a server address in Settings immediately
 * probes it and shows the result inline"):
 *   - the probe fires ~600ms after the last edit, not per keystroke.
 *   - rapid retyping cancels the pending debounce timer AND discards a probe already in flight
 *     from an earlier edit — its result never lands after a newer edit superseded it.
 *   - each of the three classifications renders through its own distinct `copy.ts` string.
 *   - the save path (`onServerUrlChange`) is called unconditionally on every edit, independent of
 *     the probe.
 *
 * Nothing here awaits a promise that could fail to settle — a bare `await` on a pending promise
 * turns one failed check into a whole-suite hang with no test named (`whim-node-suite-bare-await-
 * hang`).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { COPY, serverProbeLabel } from '../copy';
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

function readSource(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

export async function runSettingsProbeTests(h: Harness): Promise<void> {
  // ── DebouncedProbe: really run, against a fake clock ────────────────────────

  await h.test('DebouncedProbe: fires once, ~600ms after the last edit — not per keystroke', async () => {
    const timers = new FakeTimers();
    let calls = 0;
    const probe = async (): Promise<ProbeResult> => {
      calls++;
      return 'verified';
    };
    const states: SettingsProbeState[] = [];
    const d = new DebouncedProbe({ probe, publish: (s) => states.push(s), timers });

    d.schedule('https://a.example');
    d.schedule('https://ab.example');
    d.schedule('https://abc.example');
    h.eq(timers.delays, [600, 600, 600], 'every edit re-schedules the SAME 600ms debounce window');
    h.eq(timers.pendingCount, 1, 'only the latest timer is still pending — the earlier two were cancelled');
    h.eq(calls, 0, 'no probe has fired yet');

    timers.fireOnly();
    await d.whenIdle();
    h.eq(calls, 1, 'exactly one probe fires, for the final edit');
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

    // Resolve the SECOND (current) probe first — `whenIdle()` awaits DebouncedProbe's own
    // tracked in-flight promise directly, not a fixed microtask-flush count.
    d.resolve(1, 'verified');
    await loop.whenIdle();
    h.eq(states, ['checking', 'verified'], 'the second (current) probe’s result lands');

    // Now resolve the STALE first probe late. Await ITS OWN promise (not `whenIdle()`, which now
    // tracks the second cycle) so the suite observes DebouncedProbe's internal `await` on that
    // same promise actually running before asserting the discard — see `deferredProbe`'s comment.
    d.resolve(0, 'unreachable');
    await d.promises[0];
    h.eq(states, ['checking', 'verified'], 'the stale first probe’s late result is discarded, not applied');
  });

  await h.test('DebouncedProbe: an empty/cleared address resets straight to idle, nothing scheduled', async () => {
    const timers = new FakeTimers();
    const states: SettingsProbeState[] = [];
    const d = new DebouncedProbe({ probe: async () => 'verified', publish: (s) => states.push(s), timers });

    d.schedule('https://a.example');
    timers.fireOnly();
    await d.whenIdle();
    h.eq(states, ['checking', 'verified'], 'sanity: a real address reaches a result');

    d.schedule('');
    h.eq(timers.pendingCount, 0, 'clearing the field schedules no probe');
    h.eq(states, ['checking', 'verified', 'idle'], 'state resets to idle immediately');
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

  // ── SettingsScreen.tsx / copy.ts: static wiring (react-native import, not renderable here) ──

  const screenSrc = readSource('SettingsScreen.tsx');

  await h.test('SettingsScreen: save is unconditional — onServerUrlChange is called before the probe is scheduled, never gated on its result', () => {
    const handler = screenSrc.slice(screenSrc.indexOf('onChangeText={(next)'), screenSrc.indexOf('placeholder={COPY.serverAddressPlaceholder}'));
    h.ok(handler.includes('onServerUrlChange(next)'), 'the save call site must exist in the handler');
    h.ok(handler.includes('debouncedProbe.schedule('), 'the debounced probe must be scheduled from the same handler');
    const saveIdx = handler.indexOf('onServerUrlChange(next)');
    const scheduleIdx = handler.indexOf('debouncedProbe.schedule(');
    h.ok(saveIdx < scheduleIdx, 'save runs before the probe is scheduled — never behind an if on the probe result');
    h.ok(!/if\s*\([^)]*probe/i.test(handler), 'the save call is not conditioned on any probe check');
  });

  await h.test('SettingsScreen: cleared field resolves through sanitizeServerUrl, never an unsanitized draft', () => {
    h.ok(screenSrc.includes("debouncedProbe.schedule(sanitizeServerUrl(next) ?? '')"), 'the probe is scheduled off the sanitized draft, matching what actually gets saved');
  });

  await h.test('SettingsScreen: renders each of the three classifications through its own copy.ts string', () => {
    h.ok(screenSrc.includes('serverProbeLabel(probeState)'), 'the inline result must render through serverProbeLabel, not an inline ternary');
    h.eq(serverProbeLabel('verified'), COPY.serverProbeVerified, 'verified maps to its own string');
    h.eq(serverProbeLabel('unverified'), COPY.serverProbeUnverified, 'unverified maps to its own string');
    h.eq(serverProbeLabel('unreachable'), COPY.serverProbeUnreachable, 'unreachable maps to its own string');
    h.ok(
      new Set([COPY.serverProbeVerified, COPY.serverProbeUnverified, COPY.serverProbeUnreachable]).size === 3,
      'the three results are textually distinct',
    );
  });

  await h.test('SettingsScreen: idle and checking render nothing — only a settled result shows', () => {
    h.ok(
      screenSrc.includes("probeState !== 'idle' && probeState !== 'checking'"),
      'the inline result is gated on a settled classification, not shown mid-probe or on an untouched field',
    );
  });

  await h.test('SettingsScreen: the probe result uses only SHELL_PALETTE/STATUS_COLORS tokens, no hex literal of its own', () => {
    const colorFn = screenSrc.slice(screenSrc.indexOf('function probeResultColor'), screenSrc.indexOf('export default function SettingsScreen'));
    h.ok(!/#[0-9a-fA-F]{3,8}\b/.test(colorFn), 'no hex literal inside the colour mapping');
    h.ok(colorFn.includes('STATUS_COLORS.done') && colorFn.includes('STATUS_COLORS.waiting') && colorFn.includes('dangerColor'), 'all three branches read from existing shell tokens');
    // The fixed-theme tripwire (theme.suite.ts) already asserts, repo-wide, that no launcher
    // source file names the palette TYPE outside theme.ts; `dangerColor` above (a plain string
    // parameter) is how this function stays off that scan.
  });

  await h.test('SettingsScreen: unmount cancels the debounced probe (no leaked timer/state update)', () => {
    h.ok(/useEffect\(\(\) => \(\) => debouncedProbe\.cancel\(\), \[debouncedProbe\]\)/.test(screenSrc), 'the cleanup effect must call cancel() on unmount');
  });
}
