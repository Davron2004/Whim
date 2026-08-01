/**
 * evals/tiers/case.ts — the case-level gating rule (design D4, spec "Three tiers with declared
 * gating semantics"). Tier A is a hard gate: on failure, Tier B and Tier C are never evaluated —
 * the orchestrator that composes this module with `evaluateTierB`/`evaluateTierC` (the future
 * CLI, chain-F) decides whether to call those evaluators at all, driven by `tierAFailed` below,
 * the same flag `evals/tiers/tier-c.ts`'s `TierCInput.tierAFailed` already consumes. This module
 * owns only the FINAL aggregation once all three tier results exist.
 */
import type { TierAResult, TierBResult } from '../contract';

/** Whether Tier A failed — the single flag every downstream tier evaluator gates its own
 *  `skipped: tier_a_failed` on, so it is never re-derived ad hoc at each call site. */
export function tierAFailed(tierA: TierAResult): boolean {
  return tierA.status === 'fail';
}

/**
 * The case verdict (spec "case's overall verdict SHALL be `pass` if and only if Tier A passed and
 * every required Tier-B assertion passed"). `TierCResult` is deliberately not a parameter — Tier
 * C is a recorded artifact that structurally cannot influence this function (spec "Tier C SHALL
 * never contribute to the pass/fail verdict").
 */
export function computeCaseVerdict(tierA: TierAResult, tierB: TierBResult): 'pass' | 'fail' {
  if (tierA.status === 'fail') return 'fail';
  if (tierB.status === 'skipped') return 'fail';
  return tierB.assertions.every((assertion) => assertion.status === 'pass') ? 'pass' : 'fail';
}
