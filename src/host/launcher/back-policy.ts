/**
 * back-policy — the host-owned guaranteed-exit state machine (launcher-shell / #5 D4).
 *
 * The pure decision core behind Android system back for a running mini-app. It is the host
 * half of the nav-depth seam (the SDK half is `sdk-design-system` / #3) and the home of the
 * GUARANTEED-EXIT INVARIANT: no app, however buggy or hostile, can trap the user.
 *
 * Pure by construction — no timers, no I/O, deterministic (`src/host/launcher/test/
 * back-policy.spec.md`). The host owns the wall clock: it forwards a `nav-back` request on a
 * `forward` verdict, arms a single UNHANDLED_PRESS_WINDOW_MS timer, and feeds the machine a
 * `timeout` event if no depth decrease arrives. nav-depth reports are UNTRUSTED hints (F4) and
 * stale-generation reports are ignored (the same fencing rule as capability-bridge / #41 D3).
 */

/** The unhandled-press window: after a forwarded pop, if no depth DECREASE arrives within this
 *  many ms, the press is unhandled and the next back press exits unconditionally. Host-side
 *  timer; the machine only consumes the resulting `timeout` event. Tunable on-device (D8). */
export const UNHANDLED_PRESS_WINDOW_MS = 400;

export type BackEvent =
  | { type: 'reset'; generation: number }
  | { type: 'navDepth'; depth: number; generation: number }
  | { type: 'backPress' }
  | { type: 'timeout' };

/** What a back press resolves to. `ignore` = no realm bound (the launcher owns that press). */
export type BackAction = 'exit' | 'forward' | 'ignore';

export interface BackState {
  /** A realm is bound (false before the first reset; the launcher handles back at home). */
  bound: boolean;
  /** The realm generation the machine currently trusts (stale reports are fenced against it). */
  generation: number;
  /** The last trusted depth hint for the current generation. Starts at 0. */
  depth: number;
  /** A nav-back was forwarded and we are awaiting a depth DECREASE to confirm it was handled. */
  awaitingPop: boolean;
  /** The unhandled-press window elapsed with no decrease → the next press exits unconditionally. */
  escapeArmed: boolean;
}

export function initialBackState(): BackState {
  return { bound: false, generation: 0, depth: 0, awaitingPop: false, escapeArmed: false };
}

export interface BackStep {
  state: BackState;
  /** Non-null only for a `backPress` event (the user-visible decision). */
  action: BackAction | null;
}

function clampDepth(d: number, fallback: number): number {
  return Number.isFinite(d) ? Math.max(0, Math.floor(d)) : fallback;
}

/** The pure reducer. `(state, event) → { state, action }`. The single source of the policy. */
export function step(state: BackState, event: BackEvent): BackStep {
  switch (event.type) {
    case 'reset':
      // A fresh realm: depth 0, no outstanding pop, escape disarmed. The new generation is the
      // only one the machine will trust until the next reset.
      return {
        state: { bound: true, generation: event.generation, depth: 0, awaitingPop: false, escapeArmed: false },
        action: null,
      };

    case 'navDepth': {
      // Hint, never authority. Ignore when no realm is bound or the generation is stale (D3).
      if (!state.bound || event.generation !== state.generation) return { state, action: null };
      const depth = clampDepth(event.depth, state.depth);
      // A genuine decrease while we awaited a pop proves the app is cooperating: clear the
      // outstanding pop AND disarm any escape (do not exit out from under a slow-but-honest app).
      if (state.awaitingPop && depth < state.depth) {
        return { state: { ...state, depth, awaitingPop: false, escapeArmed: false }, action: null };
      }
      return { state: { ...state, depth }, action: null };
    }

    case 'backPress': {
      if (!state.bound) return { state, action: 'ignore' };
      // Depth 0 (or never reported): the user is at the app root → exit immediately.
      if (state.depth <= 0) return { state, action: 'exit' };
      // Depth > 0 but a prior pop went unacknowledged (escape armed by timeout) OR is still
      // outstanding (the natural double-tap reflex): exit unconditionally. The claim bought the
      // app at most one forwarded pop.
      if (state.escapeArmed || state.awaitingPop) {
        return { state: { ...state, awaitingPop: false, escapeArmed: false }, action: 'exit' };
      }
      // First press at a positive depth: forward one nav-back and await the pop (host arms the
      // UNHANDLED_PRESS_WINDOW_MS timer).
      return { state: { ...state, awaitingPop: true }, action: 'forward' };
    }

    case 'timeout':
      // The window elapsed. If a pop is still outstanding, mark it unhandled so the next press
      // exits. A timeout for an already-resolved pop is a no-op.
      if (state.bound && state.awaitingPop) return { state: { ...state, escapeArmed: true }, action: null };
      return { state, action: null };

    default:
      return { state, action: null };
  }
}

/**
 * A thin stateful wrapper for the host (the mini-app host hook holds one of these). All the
 * decision logic lives in `step`; this only threads state and exposes a snapshot for tests.
 */
export class BackPolicy {
  private s: BackState = initialBackState();

  /** Bind a fresh realm at `generation` (called on every launch/relaunch/reset). */
  reset(generation: number): void {
    this.s = step(this.s, { type: 'reset', generation }).state;
  }

  /** Feed a relayed nav-depth hint (already source-checked + generation-stamped by the page). */
  navDepth(depth: number, generation: number): void {
    this.s = step(this.s, { type: 'navDepth', depth, generation }).state;
  }

  /** Resolve a system-back press. The host acts on the returned action (exit / forward / ignore). */
  backPress(): BackAction {
    const r = step(this.s, { type: 'backPress' });
    this.s = r.state;
    return r.action ?? 'ignore';
  }

  /** The unhandled-press window elapsed (host timer fired). */
  timeout(): void {
    this.s = step(this.s, { type: 'timeout' }).state;
  }

  /** Whether a forwarded pop is outstanding (the host uses this to decide whether to arm a timer). */
  get awaitingPop(): boolean {
    return this.s.awaitingPop;
  }

  get snapshot(): Readonly<BackState> {
    return this.s;
  }
}
