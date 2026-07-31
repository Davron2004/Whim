/**
 * evals/report/compare.ts — chain-E, task 5.4. Per-tier pass-rate divergence between a
 * `visible`-set report and a `holdout`-set report, raising `overfitting_alarm` when the holdout
 * Tier-A+B pass rate trails the visible one by more than a configured threshold (design D10,
 * spec "Visible-versus-holdout divergence raises an overfitting alarm").
 *
 * Refuses (never computes a divergence number) when schema versions differ, or when rubric
 * versions differ while Tier C is in play on either side — "a divergence number computed across
 * incompatible runs is worse than no number" (D10). Structurally inherits redaction: reads only
 * `evalSet.setId` and pass-rate primitives off each report (via `summary.ts`), never a
 * `case.prompt`/`case.expectation`/`case.candidateSource`.
 */
import type { EvalRunReport } from '../contract';
import { overallRate, tierARate, tierBRate } from './summary';
import type { TierRate } from './summary';

export interface TierDivergence {
  readonly tier: 'A' | 'B' | 'A+B';
  readonly visibleRate: number;
  readonly holdoutRate: number;
  /** `visibleRate - holdoutRate`; positive means the holdout set trails. */
  readonly divergence: number;
}

export interface CompareRefusal {
  readonly status: 'refused';
  readonly reason: string;
}

export interface CompareResult {
  readonly status: 'ok';
  readonly visibleSetId: string;
  readonly holdoutSetId: string;
  readonly threshold: number;
  /** Per-tier divergence for A, B, and the combined A+B rate the alarm is keyed on. */
  readonly tiers: readonly [TierDivergence, TierDivergence, TierDivergence];
  /** `true` iff the A+B divergence exceeds `threshold`. */
  readonly overfittingAlarm: boolean;
}

export type CompareOutcome = CompareResult | CompareRefusal;

/** Exit-code contract chain-F wires: `0` clean, `1` overfitting alarm, `2` refused. Both
 *  non-`0` outcomes are failures for a CI-style caller; they differ only in which. */
export const COMPARE_EXIT_OK = 0;
export const COMPARE_EXIT_ALARM = 1;
export const COMPARE_EXIT_REFUSED = 2;

export function compareReports(visible: EvalRunReport, holdout: EvalRunReport, threshold: number): CompareOutcome {
  if (visible.schemaVersion !== holdout.schemaVersion) {
    return {
      status: 'refused',
      reason: `schema version mismatch: visible=${visible.schemaVersion}, holdout=${holdout.schemaVersion}`,
    };
  }

  const tierCInPlay = visible.rubricVersion !== undefined || holdout.rubricVersion !== undefined;
  if (tierCInPlay && visible.rubricVersion !== holdout.rubricVersion) {
    return {
      status: 'refused',
      reason: `rubric version mismatch while Tier C is compared: visible=${visible.rubricVersion ?? 'none'}, holdout=${holdout.rubricVersion ?? 'none'}`,
    };
  }

  const a = toDivergence('A', tierARate(visible), tierARate(holdout));
  const b = toDivergence('B', tierBRate(visible), tierBRate(holdout));
  const combined = toDivergence('A+B', overallRate(visible), overallRate(holdout));

  return {
    status: 'ok',
    visibleSetId: visible.evalSet.setId,
    holdoutSetId: holdout.evalSet.setId,
    threshold,
    tiers: [a, b, combined],
    overfittingAlarm: combined.divergence > threshold,
  };
}

function toDivergence(tier: TierDivergence['tier'], visible: TierRate, holdout: TierRate): TierDivergence {
  return { tier, visibleRate: visible.rate, holdoutRate: holdout.rate, divergence: visible.rate - holdout.rate };
}

export function compareExitCode(outcome: CompareOutcome): number {
  if (outcome.status === 'refused') return COMPARE_EXIT_REFUSED;
  return outcome.overfittingAlarm ? COMPARE_EXIT_ALARM : COMPARE_EXIT_OK;
}

/** Human-readable rendering, for console output. Reads only set ids/rates/the refusal reason —
 *  never prompt/expectation text. */
export function renderCompare(outcome: CompareOutcome): string {
  if (outcome.status === 'refused') {
    return `REFUSED: ${outcome.reason}\n`;
  }
  const lines = [
    `visible=${outcome.visibleSetId} holdout=${outcome.holdoutSetId} threshold=${outcome.threshold}`,
    ...outcome.tiers.map(
      (t) => `Tier ${t.tier}: visible=${(t.visibleRate * 100).toFixed(1)}% holdout=${(t.holdoutRate * 100).toFixed(1)}% divergence=${(t.divergence * 100).toFixed(1)}pp`,
    ),
    outcome.overfittingAlarm ? 'overfitting_alarm: TRUE' : 'overfitting_alarm: false',
  ];
  return `${lines.join('\n')}\n`;
}
