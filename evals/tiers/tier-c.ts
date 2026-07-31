/**
 * Tier C: rubric judgement via an injected `Judge` (design D7, `handoff/judge.md`). Verdict
 * validation lives HERE, not in any `Judge` implementation — a judge may return a malformed
 * `JudgeVerdict`; this module is what turns that into a `TierCResult` of status `error`, never a
 * passing score (spec "Malformed verdict is an error, not a pass"). Tier C never contributes to
 * a case's pass/fail verdict — that is enforced by callers never reading `TierCResult` for the
 * verdict, not by anything in this file.
 */
import type { RunObservation, TierCResult } from '../contract';
import { RUBRIC_CRITERIA } from '../rubric';
import type { JudgeVerdict } from '../contract';
import type { Judge, JudgeInput } from '../judge/judge';

export interface TierCInput {
  readonly caseId: string;
  readonly prompt: string;
  readonly expectation?: string;
  readonly candidateSource?: string;
  readonly observation: RunObservation;
  /** Whether Tier A failed for this case — short-circuits Tier C to `skipped: tier_a_failed`
   *  regardless of whether a judge is configured (spec "Tier A failure short-circuits"). */
  readonly tierAFailed: boolean;
  /** `undefined` when no judge is configured — the normal state for the gate and for a fully
   *  offline run (spec "No judge configured"). */
  readonly judge: Judge | undefined;
}

/**
 * Evaluates Tier C for one case. Never throws — a judge exception or a malformed verdict both
 * become a `TierCResult` of status `error`, so a flaky/truncated model response never silently
 * reads as a passing (or even present) score.
 */
export async function evaluateTierC(input: TierCInput): Promise<TierCResult> {
  if (input.tierAFailed) {
    return { status: 'skipped', reason: 'tier_a_failed' };
  }
  if (!input.judge) {
    return { status: 'skipped', reason: 'no_judge_configured' };
  }

  const judgeInput: JudgeInput = {
    caseId: input.caseId,
    prompt: input.prompt,
    expectation: input.expectation,
    candidateSource: input.candidateSource,
    observation: input.observation,
  };

  let verdict: JudgeVerdict;
  try {
    verdict = await input.judge.score(judgeInput);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { status: 'error', message: `judge threw while scoring case "${input.caseId}": ${detail}` };
  }

  const defect = findVerdictDefect(verdict);
  if (defect) {
    return { status: 'error', message: defect };
  }
  return { status: 'scored', verdict };
}

/** Returns a message naming the first defect found, or `undefined` if `verdict` is well-formed
 *  against the closed rubric criteria list. Checked, in order: every rubric criterion is present
 *  exactly once with no unknown criterion names; every criterion has a non-empty rationale; every
 *  score is within that criterion's declared range. */
function findVerdictDefect(verdict: JudgeVerdict): string | undefined {
  const seen = new Set<string>();
  for (const entry of verdict.criteria) {
    if (seen.has(entry.criterion)) {
      return `verdict scores criterion "${entry.criterion}" more than once.`;
    }
    seen.add(entry.criterion);
  }

  const missing = RUBRIC_CRITERIA.filter((criterion) => !seen.has(criterion.id));
  if (missing.length > 0) {
    const noun = missing.length > 1 ? 'criteria' : 'criterion';
    return `verdict is missing required rubric ${noun}: ${missing.map((criterion) => criterion.id).join(', ')}.`;
  }

  for (const entry of verdict.criteria) {
    const criterion = RUBRIC_CRITERIA.find((candidate) => candidate.id === entry.criterion);
    if (!criterion) {
      return `verdict scores unknown criterion "${entry.criterion}", outside the closed rubric list.`;
    }
    if (typeof entry.rationale !== 'string' || entry.rationale.trim().length === 0) {
      return `verdict for criterion "${entry.criterion}" is missing a rationale.`;
    }
    if (typeof entry.score !== 'number' || Number.isNaN(entry.score) || entry.score < criterion.minScore || entry.score > criterion.maxScore) {
      return `verdict for criterion "${entry.criterion}" scores ${entry.score}, outside the rubric's ${criterion.minScore}-${criterion.maxScore} range.`;
    }
  }

  return undefined;
}
