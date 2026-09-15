/**
 * refusal-landing — where a service refusal's notice lands in the five-step flow, and the retry
 * window's pure disabled/enabled arithmetic (design D9/D11; spec `service-refusals`).
 *
 * `ServiceRefusalCode` is imported TYPE-ONLY from `@whim/contract` — the same discipline
 * `service-refusal.ts` keeps — so no zod value reaches Metro through this module. No React Native
 * import: this must load under the launcher's Node acceptance suite.
 */
import type { ServiceRefusalCode } from '@whim/contract';
import { REFUSAL_RULES } from './service-refusal';

/** Which request a refusal answered. */
export type RefusalRequest = 'clarify' | 'rewrite' | 'generate';

/** Which step's primary action actually sent the request — the `sender` landing's target when
 *  the refusal isn't about the user's own text. `'plan'` only ever applies to a `generate`
 *  request; `'clarify'` only ever applies to a `rewrite` request reached through the clarify
 *  step's own `Continue`. */
export type RefusalSentFrom = 'compose' | 'clarify' | 'plan';

/** The step a refusal's notice attaches to (design D9): a `text`-landing code always returns to
 *  wherever the refused words are edited — compose for a `clarify`/`rewrite` request, plan for a
 *  plan-started `generate`. A `sender`-landing code returns to whichever step's primary action
 *  sent the request — `sentFrom`, verbatim — except `generate`, which is always plan-started and
 *  so always lands on plan either way. Matching is by the contract identifier alone, through the
 *  same `REFUSAL_RULES` table `serviceRefusalOf` reads — never a second table to drift from it. */
export function refusalLanding(
  request: RefusalRequest,
  sentFrom: RefusalSentFrom,
  code: ServiceRefusalCode,
): 'compose' | 'clarify' | 'plan' {
  if (request === 'generate') return 'plan';
  return REFUSAL_RULES[code].landing === 'text' ? 'compose' : sentFrom;
}

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
