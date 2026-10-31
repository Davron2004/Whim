/**
 * connectivity — the session connectivity state machine (design.md decisions 4-6; spec
 * "A configured server is probed at startup and retried with capped exponential backoff until
 * first success", "A real generation or rewrite call succeeding counts as the session's first
 * success", "Session connectivity state drives an offline UX without blocking local use", "No
 * server address configured is distinct from an unreachable configured address").
 *
 * Pure, RN-free and therefore directly Node-testable: `LauncherRoot.tsx` imports react-native and
 * cannot be imported under the launcher's Node suite, so the retry loop's actual scheduling logic
 * lives here rather than inline in the component's `useEffect` — mirrors this repo's
 * pure-logic-in-non-RN-siblings convention (`server-probe.ts`, `history-wait.ts`).
 */

import { log } from '../logging';
import { CHANNELS } from '../logging/channels';

export type Connectivity = 'unknown' | 'checking' | 'online' | 'offline';

const INITIAL_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30000;
/** The least time between two probes asked for by returns to the foreground. iOS flips the app
 *  through inactive and back for the app switcher, Control Center and permission sheets, none of
 *  which says anything about the network. */
const FOREGROUND_PROBE_FLOOR_MS = 10000;
/** Failed probes in a row that turn an online session offline. One lost probe on a slow network
 *  is not evidence of an outage; the startup path needs no such margin because there is no earlier
 *  success to contradict. The second probe follows after the first backoff step. */
const OFFLINE_AFTER_FAILURES = 2;

/** The retry loop's backoff schedule (spec "Backoff doubles up to the cap"): 2s, 4s, 8s, 16s,
 *  30s, and 30s on every attempt after the cap is reached. `attempt` is 0-indexed — the delay
 *  before the (attempt + 1)th retry, counting from the first `'unreachable'` result. */
export function backoffDelayMs(attempt: number): number {
  return Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

/** Injectable timer seam, the same shape as the global `setTimeout`/`clearTimeout` — lets a Node
 *  suite drive the loop with a manually-fired fake clock instead of real wall-clock delays. */
export interface TimerLike {
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

// The global `clearTimeout` is typed to accept only the exact handle its own `setTimeout`
// returns, not `unknown` (strict function-type contravariance) — the cast here is the one place
// that boundary is crossed, and it is sound: the handle a `TimerLike` caller passes back is
// always exactly what this same `setTimeout` just returned.
const REAL_TIMERS: TimerLike = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
};

type ProbeResult = 'verified' | 'unverified' | 'unreachable';

export interface ConnectivityLoopOptions {
  /** One probe attempt. `probeServer` never rejects, but the caller's wrapper around it may — a
   *  rejection is a probe that learned nothing (see `ConnectivityLoop`).
   *  `'verified'`/`'unverified'` both count as a successful probe for retry purposes (design
   *  decision 5); only `'unreachable'` schedules a retry. */
  probe: () => Promise<ProbeResult>;
  /** Published on every state transition — the screen's `setState` mirror. */
  publish: (state: Connectivity) => void;
  /** Defaults to the real global timers. */
  timers?: TimerLike;
  /** Milliseconds clock for the foreground floor. Defaults to `Date.now`. */
  now?: () => number;
  /** Whether the app is in the foreground when the loop is built; nothing is sent until it is.
   *  Defaults to true. */
  foreground?: boolean;
}

/**
 * One session's connectivity state machine. `start()` runs the checking → probe →
 * online/offline+backoff cycle; `markOnline()` is the shared success hook a real
 * clarify/generate call also invokes (spec "A real generation or rewrite call succeeding...");
 * `stop()` cancels any pending timer without publishing a new state (effect cleanup / unmount).
 *
 * An online, idle session schedules nothing: a steady probe would keep the server from ever
 * scaling to zero. Two things look again, both foreground only. `noteNetworkFailure()` — a
 * request of the app's own that failed at the network level — asks for a probe straight away, and
 * the probe's own failure confirms it. Returning to the foreground probes, at most once per
 * `FOREGROUND_PROBE_FLOOR_MS`. A probe failure turns an online session offline only on the second
 * in a row, the second following after the first backoff step; the session then follows the same
 * backoff as at startup until a probe or a real response proves the server is back. Nothing is
 * probed or scheduled in the background.
 *
 * A probe that rejects (the caller's wrapper threw) learned nothing: it is a failure while the
 * session is starting or offline, so the backoff carries on, and not a failure while it is online.
 *
 * `start()` and `stop()` are idempotent. Owns at most one pending timer and at most one probe in
 * flight at a time: a probe asked for while one is running is that probe.
 */
export class ConnectivityLoop {
  private state: Connectivity = 'unknown';
  private attempt = 0;
  private failures = 0;
  private pendingTimer: unknown = null;
  private stopped = false;
  private foreground: boolean;
  private lastProbeAt = Number.NEGATIVE_INFINITY;
  /** Bumped by every real response: a probe that started before it is older than that proof and
   *  must not turn the session offline. */
  private proofs = 0;
  private readonly timers: TimerLike;
  private readonly now: () => number;
  /** The probe running right now, if any — also what `whenIdle()` awaits, so a suite driving a
   *  fake clock can await one full cycle (probe + resulting schedule/state) deterministically,
   *  without polling or a fixed flush budget. Real callers never need this: the loop is
   *  fire-and-forget by design. */
  private probing: Promise<void> | null = null;

  constructor(private readonly opts: ConnectivityLoopOptions) {
    this.timers = opts.timers ?? REAL_TIMERS;
    this.now = opts.now ?? Date.now;
    this.foreground = opts.foreground ?? true;
  }

  /** Begins the checking → probe cycle; while the app is not in the foreground the startup probe
   *  waits for the first return to it. A no-op once stopped or already online. */
  start(): void {
    if (this.stopped || this.state === 'online') return;
    this.setState('checking');
    if (this.foreground) this.probeNow();
  }

  /** Resolves once the loop's current probe — and the timer or state change it just produced —
   *  has settled. */
  async whenIdle(): Promise<void> {
    await this.probing;
  }

  /** Whether the app is in the foreground. Nothing is probed or scheduled while it is not, and an
   *  unconfirmed failure is forgotten. Coming back probes, because whatever happened meanwhile is
   *  unknown, unless the last probe was under the floor ago; an offline session then keeps to its
   *  backoff. */
  setForeground(foreground: boolean): void {
    if (this.stopped || this.foreground === foreground) return;
    this.foreground = foreground;
    if (!foreground) {
      this.clearPendingTimer();
      this.failures = 0;
      return;
    }
    this.failures = 0;
    if (this.state === 'checking') {
      this.probeNow();
      return;
    }
    if (this.state !== 'online' && this.state !== 'offline') return;
    if (this.now() - this.lastProbeAt >= FOREGROUND_PROBE_FLOOR_MS) this.probeNow();
    else this.schedule();
  }

  /** A request of the app's own failed at the network level (no answer from a server). One such
   *  failure plus one failed probe is as much evidence as two failed probes, so the probe runs now
   *  and a single failure of it turns the session offline. Ignored unless the session is online
   *  and in the foreground: startup and offline are already probing, and a request that fails in
   *  the background says nothing the return to the foreground will not check. */
  noteNetworkFailure(): void {
    if (this.stopped || this.state !== 'online' || !this.foreground) return;
    this.failures = OFFLINE_AFTER_FAILURES - 1;
    this.probeNow();
  }

  /** Any successful server response — the dedicated probe, or a real clarify/generate call (spec
   *  "A real generation or rewrite call succeeding..."). Cancels a pending retry. */
  markOnline(): void {
    if (this.stopped) return;
    this.proofs += 1;
    this.failures = 0;
    if (this.state === 'online') return;
    this.goOnline();
  }

  /** Cancels any pending timer without publishing a new state — effect cleanup / unmount. */
  stop(): void {
    this.stopped = true;
    this.clearPendingTimer();
  }

  /** The one probe, shared by whoever asks while it runs. */
  private probeNow(): void {
    if (this.probing) return;
    this.clearPendingTimer();
    this.lastProbeAt = this.now();
    const running: Promise<void> = this.runProbe().finally(() => {
      if (this.probing === running) this.probing = null;
    });
    this.probing = running;
  }

  private async runProbe(): Promise<void> {
    const proofs = this.proofs;
    let result: ProbeResult | null = null;
    try {
      result = await this.opts.probe();
    } catch (e) {
      // The probe learned nothing; `settle` decides what that means for the session's state.
      log.warn(CHANNELS.app, 'connectivity probe failed to run', { detail: e instanceof Error ? e.message : String(e) });
    }
    this.settle(result, proofs);
  }

  private settle(result: ProbeResult | null, proofs: number): void {
    if (this.stopped) return;
    if (proofs !== this.proofs) {
      this.schedule();
      return;
    }
    if (result === 'verified' || result === 'unverified') {
      this.failures = 0;
      this.goOnline();
      return;
    }
    if (this.state === 'online') {
      if (result === null || !this.foreground) {
        this.failures = 0;
        return;
      }
      this.failures += 1;
      if (this.failures < OFFLINE_AFTER_FAILURES) {
        this.schedule();
        return;
      }
      this.failures = 0;
    }
    this.setState('offline');
    this.schedule();
  }

  private goOnline(): void {
    this.clearPendingTimer();
    this.attempt = 0;
    this.setState('online');
  }

  /** The next probe, foreground only: an offline session backs off, and an online one with an
   *  unconfirmed failure confirms it after the first backoff step. An online session with nothing
   *  to confirm schedules nothing. */
  private schedule(): void {
    this.clearPendingTimer();
    if (this.stopped || !this.foreground) return;
    let delay: number;
    if (this.state === 'offline') {
      delay = backoffDelayMs(this.attempt);
    } else if (this.state === 'online' && this.failures > 0) {
      delay = backoffDelayMs(0);
    } else {
      return;
    }
    this.pendingTimer = this.timers.setTimeout(() => {
      this.pendingTimer = null;
      if (this.state === 'offline') this.attempt += 1;
      this.probeNow();
    }, delay);
  }

  private clearPendingTimer(): void {
    if (this.pendingTimer != null) {
      this.timers.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private setState(next: Connectivity): void {
    if (this.state === next) return;
    this.state = next;
    this.opts.publish(next);
  }
}
