/**
 * history-wait — the history screen's three wait states (`version-history`: "History's first load
 * shows a loading state, never fake-empty", "The confirm sheet's Restore and Copy actions disable
 * while in flight", "The restore-diff reassurance line shows a pending state while it loads").
 *
 * Pure, RN-free and therefore directly Node-testable: `HistoryScreen.tsx` imports `react-native`
 * and cannot be imported under the launcher's Node suite, so the parts that are actually easy to
 * get wrong — the double-submit refusal and the loading/pending resolutions — live here rather
 * than as ad-hoc booleans inside the component.
 *
 * The double-submit guard has to be synchronous and independent of React's render cycle: two taps
 * inside one frame both read the same `useState` value, so a `disabled` prop alone cannot refuse
 * the second. Hence a plain object the screen holds in a ref, with the refusal sitting in front of
 * the version-store call itself (`runConfirmOp`), not merely on the control that triggers it.
 */

import type { Snapshot } from '../version-store';

// ── first load ───────────────────────────────────────────────────────────────────────────────

/** What the screen renders the timeline from. `loading` is true only until the FIRST read of the
 *  snapshot list and active version settles — a reload after a restore keeps the rows on screen
 *  rather than flashing the skeleton back in. */
export interface HistoryLoadState {
  loading: boolean;
  snapshots: Snapshot[];
  activeId: string | null;
}

/** The pre-first-load state: loading, with nothing to show yet. Distinct from a genuinely empty
 *  history, which is `{ loading: false, snapshots: [] }`. */
export const HISTORY_LOADING: HistoryLoadState = { loading: true, snapshots: [], activeId: null };

/** The screen's `setState` mirror: it takes a new state or, as React's does, an updater over the
 *  previous one — which is what lets a FAILED read clear the wait without inventing rows. */
export type PublishHistoryLoad = (
  next: HistoryLoadState | ((prev: HistoryLoadState) => HistoryLoadState),
) => void;

/**
 * Run one history read and publish its result. `loading` is always published false once the read
 * settles — including when it rejects, so a failed read surfaces the honest empty history instead
 * of stranding the screen in a permanent skeleton. The rejection itself still propagates, so this
 * changes no error semantics beyond clearing the wait.
 *
 * A rejection clears `loading` and NOTHING else: this same function runs the reload after a
 * restore, and publishing the default empty result there would wipe the rows already on screen —
 * turning a failed reload into an apparently empty history.
 */
export async function runHistoryLoad(
  read: () => Promise<{ snapshots: Snapshot[]; activeId: string | null }>,
  publish: PublishHistoryLoad,
): Promise<void> {
  let result: { snapshots: Snapshot[]; activeId: string | null };
  try {
    result = await read();
  } catch (e) {
    publish((prev) => ({ ...prev, loading: false }));
    throw e;
  }
  publish({ loading: false, snapshots: result.snapshots, activeId: result.activeId });
}

// ── confirm-sheet double-submit guard ────────────────────────────────────────────────────────

/** At most one restore-or-fork may be in flight for the sheet. A ref-held mutable claim, so the
 *  refusal does not depend on a re-render having landed. */
export class ConfirmFlight {
  private running = false;

  /** Claim the sheet. Returns `false` — changing nothing — when an operation is already running. */
  begin(): boolean {
    if (this.running) return false;
    this.running = true;
    return true;
  }

  /** The operation settled, success or failure alike. Idempotent. */
  end(): void {
    this.running = false;
  }

  get inFlight(): boolean {
    return this.running;
  }
}

/**
 * Run one confirmed restore/fork under the guard: claim, publish the busy state, and release once
 * `work` settles — resolved, rejected or thrown alike, so a failed restore can never strand the
 * confirm button disabled. Returns `false` without running `work` at all when one is already in
 * flight; the caller then does nothing (no toast, no reload, no sheet close).
 */
export async function runConfirmOp(
  flight: ConfirmFlight,
  publish: (busy: boolean) => void,
  work: () => Promise<unknown>,
): Promise<boolean> {
  if (!flight.begin()) return false;
  publish(true);
  try {
    await work();
  } finally {
    flight.end();
    publish(false);
  }
  return true;
}

// ── restore-diff reassurance line ────────────────────────────────────────────────────────────

/** The reassurance line's data: still being computed, or settled on the fields that would leave
 *  view. `pending` exists so the line can reserve its space instead of popping in. */
export type RestoreDiffState = { status: 'pending' } | { status: 'ready'; fields: string[] };

/** The settled state carrying no fields — what a non-restore sheet shows, with nothing pending. */
export const RESTORE_DIFF_NONE: RestoreDiffState = { status: 'ready', fields: [] };

/** What to draw where the reassurance line goes: the muted placeholder while it is computing, the
 *  reassurance sentence once fields are known to leave view, and nothing at all when none would. */
export function restoreDiffLine(state: RestoreDiffState): 'pending' | 'reassurance' | 'none' {
  if (state.status === 'pending') return 'pending';
  return state.fields.length > 0 ? 'reassurance' : 'none';
}
