/**
 * refusal-landing — the retry window's pure disabled/enabled arithmetic (design D11/D12; spec
 * `service-refusals`). A clarify or rewrite refusal lands on Describe, the page whose Continue sent
 * it, and a generate refusal on Plan, the page whose `Make it` did; this module decides when the
 * window that notice carries has ended.
 *
 * No React Native import: this must load under the launcher's Node acceptance suite.
 */

/** The retry-window's disabled/enabled state at `now` (design D11): disabled with the
 *  milliseconds remaining until it lifts, or already enabled — with nothing to wait for — when
 *  `retryAt` is absent or already passed. Pure: the caller owns the ONE timer that re-checks it
 *  once `msUntilEnable` has elapsed, and never sends a request on its own. */
export interface RetryWindowState {
  readonly disabled: boolean;
  readonly msUntilEnable: number;
}

export function retryWindowState(retryAt: number | undefined, now: number): RetryWindowState {
  if (retryAt === undefined) return { disabled: false, msUntilEnable: 0 };
  const remaining = retryAt - now;
  return remaining > 0 ? { disabled: true, msUntilEnable: remaining } : { disabled: false, msUntilEnable: 0 };
}

/** Whether a notice should clear because its own retry window just ended (design D12: "A sender
 *  refusal clears when its window ends"). Only a `neutral`-tone (sender-landing) notice with an
 *  active `retryAt` clears this way — a `danger`-tone (text-landing) notice never does; it clears
 *  only when the refused text changes (`composeTextChanged`/`updatePlanRow`'s own rule), and a
 *  notice with no `retryAt` at all has no window to end. Shares `retryWindowState` with
 *  `useRetryGate`, so "the action re-enables" and "the notice clears" are the exact same moment. */
export function noticeExpiredAt(
  notice: { readonly tone: 'danger' | 'neutral'; readonly retryAt?: number } | undefined,
  now: number,
): boolean {
  if (notice === undefined || notice.tone !== 'neutral' || notice.retryAt === undefined) return false;
  return !retryWindowState(notice.retryAt, now).disabled;
}
