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

export type Connectivity = 'unknown' | 'checking' | 'online' | 'offline';

const INITIAL_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30000;

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

export interface ConnectivityLoopOptions {
  /** One probe attempt. Never rejects (`server-probe.ts`'s `probeServer` contract) —
   *  `'verified'`/`'unverified'` both count as a successful probe for retry purposes (design
   *  decision 5); only `'unreachable'` schedules a retry. */
  probe: () => Promise<'verified' | 'unverified' | 'unreachable'>;
  /** Published on every state transition — the screen's `setState` mirror. */
  publish: (state: Connectivity) => void;
  /** Defaults to the real global timers. */
  timers?: TimerLike;
}

/**
 * One session's startup/retry state machine. `start()` runs the checking → probe →
 * online/offline+backoff cycle; `markOnline()` is the shared success hook a real
 * clarify/generate call also invokes (spec "A real generation or rewrite call succeeding...");
 * `stop()` cancels any pending retry without publishing a new state (effect cleanup / unmount).
 * All three are idempotent — calling any of them after `stop()`, or `markOnline()`/`start()` once
 * already `'online'`, is a no-op. Owns at most one pending timer at a time.
 */
export class ConnectivityLoop {
  private state: Connectivity = 'unknown';
  private attempt = 0;
  private pendingTimer: unknown = null;
  private stopped = false;
  private readonly timers: TimerLike;
  /** The most recently started probe's settlement — exposed via `whenIdle()` so a suite driving
   *  a fake clock can await one full cycle (probe + resulting schedule/state) deterministically,
   *  without polling or a fixed flush budget. Real callers never need this: the loop is
   *  fire-and-forget by design. */
  private inFlight: Promise<void> = Promise.resolve();

  constructor(private readonly opts: ConnectivityLoopOptions) {
    this.timers = opts.timers ?? REAL_TIMERS;
  }

  /** Begins the checking → probe cycle. A no-op once stopped or already online. */
  start(): void {
    if (this.stopped || this.state === 'online') return;
    this.setState('checking');
    this.inFlight = this.runProbe();
  }

  /** Resolves once the loop's current probe — and, on failure, the timer it just scheduled — has
   *  settled. */
  async whenIdle(): Promise<void> {
    await this.inFlight;
  }

  private async runProbe(): Promise<void> {
    const result = await this.opts.probe();
    if (this.stopped || this.state === 'online') return;
    if (result === 'unreachable') {
      this.setState('offline');
      const delay = backoffDelayMs(this.attempt);
      this.attempt += 1;
      this.pendingTimer = this.timers.setTimeout(() => {
        this.pendingTimer = null;
        this.inFlight = this.runProbe();
      }, delay);
    } else {
      this.markOnline();
    }
  }

  /** Any successful server response — the dedicated probe above, or a real clarify/generate call
   *  (spec "A real generation or rewrite call succeeding..."). Cancels a pending retry. Idempotent
   *  once already online or stopped. */
  markOnline(): void {
    if (this.stopped || this.state === 'online') return;
    this.clearPendingTimer();
    this.setState('online');
  }

  /** Cancels any pending retry without publishing a new state — effect cleanup / unmount. */
  stop(): void {
    this.stopped = true;
    this.clearPendingTimer();
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
