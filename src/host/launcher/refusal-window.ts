/**
 * refusal-window — the live timing of a service refusal's notice (design D11/D12; spec
 * `service-refusals`): the gate that holds a refused action until its window ends, and the clear
 * that drops a sender notice when it does. The notice itself is drawn by `FlowNoticeBlock` (the
 * shell's `Notice`).
 */
import { useEffect, useReducer, useRef } from 'react';
import { noticeExpiredAt, retryWindowState } from './refusal-landing';

/**
 * The retry-window's live gate (design D11: "the primary action is disabled with its label kept,
 * and a single `setTimeout` re-enables it; nothing is sent automatically"). `retryAt` is read
 * once per mount/change; the ONE timer this sets re-renders exactly once, when the window lifts —
 * never a ticking countdown, and never a request of its own.
 */
export function useRetryGate(retryAt: number | undefined): boolean {
  const [, forceRecheck] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (retryAt === undefined) return undefined;
    const state = retryWindowState(retryAt, Date.now());
    if (!state.disabled) return undefined;
    const timer = setTimeout(() => forceRecheck(), state.msUntilEnable);
    return () => clearTimeout(timer);
  }, [retryAt]);
  return retryAt !== undefined && retryWindowState(retryAt, Date.now()).disabled;
}

/**
 * Clears a sender-landing (`neutral`-tone) notice the instant its retry window ends (design D12:
 * "A sender refusal clears when its window ends"). A `danger`-tone (text-landing) notice never
 * clears this way — that one clears only on the next edit to the refused text
 * (`composeTextChanged`/`updatePlanRow`). The decision is the pure, tested `noticeExpiredAt`
 * (`refusal-landing.ts`); this hook is only the live wiring around it, arming at most ONE timer —
 * same discipline as `useRetryGate` — and re-arming only when `tone`/`retryAt` actually change, so
 * an unrelated re-render never resets the countdown. `onExpire` is read through a ref that a
 * plain (no-deps) effect keeps current, so the timer always calls the LATEST closure — the one
 * that still knows which notice it was armed for — without that forcing the timer itself to
 * restart on every render.
 */
export function useNoticeWindowClear(
  notice: { readonly tone: 'danger' | 'neutral'; readonly retryAt?: number } | undefined,
  onExpire: () => void,
): void {
  const latestExpire = useRef(onExpire);
  useEffect(() => {
    latestExpire.current = onExpire;
  });
  const tone = notice?.tone;
  const retryAt = notice?.retryAt;
  useEffect(() => {
    if (tone !== 'neutral' || retryAt === undefined) return undefined;
    if (noticeExpiredAt({ tone, retryAt }, Date.now())) {
      latestExpire.current();
      return undefined;
    }
    const timer = setTimeout(() => latestExpire.current(), retryWindowState(retryAt, Date.now()).msUntilEnable);
    return () => clearTimeout(timer);
  }, [tone, retryAt]);
}
