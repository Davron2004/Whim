/**
 * evals/tiers/tier-b.ts — Tier B, the behavioral-assertion tier (design D4/D5, spec "Three tiers
 * with declared gating semantics", "Tier-B assertions evaluate against the normalized run
 * observation"). Evaluates every `EvalAssertion` a case declares against one `RunObservation` via
 * `evaluateAssertion` (`../assertions`) — this module owns only the skip/evaluate framing, never
 * the per-kind logic.
 *
 * Every assertion in the current closed `ASSERTION_KINDS` vocabulary is required: `EvalAssertion`
 * carries no `advisory` field, so there is nothing to distinguish yet — `evals/tiers/case.ts`'s
 * `computeCaseVerdict` already gates the case verdict on every evaluated assertion via
 * `.every(...)`. A future advisory kind would need a contract change (`evals/contract.ts`,
 * chain-A), not a change here.
 */
import { evaluateAssertion } from '../assertions';
import type { EvalAssertion, RunObservation, TierBResult } from '../contract';

export interface TierBInput {
  readonly assertions: readonly EvalAssertion[];
  readonly observation: RunObservation;
  /** Whether Tier A failed for this case — short-circuits Tier B to `skipped: tier_a_failed`
   *  without evaluating any assertion, the same flag `evals/tiers/tier-c.ts`'s `TierCInput`
   *  already consumes (spec "Tier A failure short-circuits"). */
  readonly tierAFailed: boolean;
}

/** Evaluates Tier B for one case. Never throws for well-formed input — a loaded eval set's
 *  assertions are already validated by `evals/eval-set.ts`. Evaluating with an empty
 *  `assertions` list still returns `status: 'evaluated'` with an empty array, which
 *  `computeCaseVerdict` treats as a vacuous pass. */
export function evaluateTierB(input: TierBInput): TierBResult {
  if (input.tierAFailed) {
    return { status: 'skipped', reason: 'tier_a_failed' };
  }

  const assertions = input.assertions.map((assertion) => evaluateAssertion(assertion, input.observation));
  return { status: 'evaluated', assertions };
}
