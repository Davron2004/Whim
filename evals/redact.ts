/**
 * The ONE redaction entry point (design D3, `handoff/eval-contract.md`). Report construction
 * (chain-E) calls `redactCase` instead of ever placing raw prompt/expectation/candidate-source
 * text onto a `CaseResult` for a holdout set. Redaction happens here, at construction, so
 * `diff`/`compare`/the Markdown summary/console output all inherit it — there is no unredacted
 * object downstream for a future output path to leak.
 *
 * `redactTierA`/`redactTierB`/`redactTierC` (`fix/redaction-tier-results`) extend the same
 * choke point to the tier results themselves. This is a DISCLOSURE property, not an execution
 * one — an eval-set author's own words (a Tier-B assertion's `english` — expectation prose, the
 * same disclosure class as `EvalCase.expectation`, which `redactCase` already drops) leak exactly
 * as badly as a candidate's own text reaching a `Diagnostic`'s `message`/`hint`/`symbol` (a static
 * check quoting an offending import specifier back), a Tier-B assertion's `observed` value
 * (deliberately "the concrete observed value, never a bare boolean"), or a Tier-C judge's
 * `rationale`/error `message`. All of the above are dropped (never hashed, never truncated —
 * absence is the safer default) for `holdout`. Closed-vocabulary/numeric/structural fields
 * (`kind`, `severity`, `line`, `column`, `status`, `criterion`, `score`, `rubricVersion`,
 * `judgeIdentity`) always survive — `diff.ts`/`compare.ts`/`summary.ts` read only these, so
 * dropping the free-text fields never breaks diffability or determinism.
 */
import { createHash } from 'node:crypto';
import type {
  Diagnostic,
  EvalSetVisibility,
  JudgeCriterionReportScore,
  JudgeVerdict,
  ReportDiagnostic,
  TierAReportResult,
  TierAResult,
  TierBAssertionReportResult,
  TierBAssertionResult,
  TierBReportResult,
  TierBResult,
  TierCReportResult,
  TierCResult,
} from './contract';

export interface RedactableCaseFields {
  readonly caseId: string;
  readonly prompt: string;
  readonly expectation?: string;
  readonly candidateSource?: string;
}

/** Matches `CaseResult['case']` in `evals/contract.ts` verbatim. */
export interface RedactedCaseFields {
  readonly caseId: string;
  readonly promptSha256: string;
  readonly prompt?: string;
  readonly expectation?: string;
  readonly candidateSource?: string;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * For `visibility === 'holdout'`, returns ONLY `caseId` + `promptSha256` — `prompt`,
 * `expectation`, and `candidateSource` are never present on the result (not even as `undefined`
 * keys with empty values). For `visibility === 'visible'`, all fields pass through verbatim.
 */
export function redactCase(input: RedactableCaseFields, visibility: EvalSetVisibility): RedactedCaseFields {
  const promptSha256 = sha256Hex(input.prompt);
  if (visibility === 'holdout') {
    return { caseId: input.caseId, promptSha256 };
  }
  return {
    caseId: input.caseId,
    promptSha256,
    prompt: input.prompt,
    expectation: input.expectation,
    candidateSource: input.candidateSource,
  };
}

function redactDiagnostic(diagnostic: Diagnostic, visibility: EvalSetVisibility): ReportDiagnostic {
  if (visibility === 'holdout') {
    return { kind: diagnostic.kind, severity: diagnostic.severity, line: diagnostic.line, column: diagnostic.column };
  }
  return { ...diagnostic };
}

/** Redacts a `TierAResult` for the report (`kind`/`severity`/`line`/`column`/`containment`
 *  survive; `symbol`/`message`/`hint` are dropped under `holdout`). */
export function redactTierA(tierA: TierAResult, visibility: EvalSetVisibility): TierAReportResult {
  return {
    status: tierA.status,
    diagnostics: tierA.diagnostics.map((diagnostic) => redactDiagnostic(diagnostic, visibility)),
    containment: tierA.containment,
  };
}

function redactTierBAssertion(assertion: TierBAssertionResult, visibility: EvalSetVisibility): TierBAssertionReportResult {
  if (visibility === 'holdout') {
    return { kind: assertion.kind, status: assertion.status };
  }
  return { ...assertion };
}

/** Redacts a `TierBResult` for the report (`status`/`reason`/`kind` survive; each assertion's
 *  `english` statement — expectation prose, same disclosure class as `EvalCase.expectation` — and
 *  its candidate-derived `observed` are both dropped under `holdout`). */
export function redactTierB(tierB: TierBResult, visibility: EvalSetVisibility): TierBReportResult {
  if (tierB.status === 'skipped') return tierB;
  return { status: 'evaluated', assertions: tierB.assertions.map((assertion) => redactTierBAssertion(assertion, visibility)) };
}

function redactJudgeVerdict(verdict: JudgeVerdict, visibility: EvalSetVisibility): JudgeCriterionReportScore[] {
  return verdict.criteria.map((criterion) =>
    visibility === 'holdout'
      ? { criterion: criterion.criterion, score: criterion.score }
      : { ...criterion },
  );
}

/** Redacts a `TierCResult` for the report (`status`/`reason`/`rubricVersion`/`judgeIdentity`/
 *  `criterion`/`score` survive; each criterion's free-form `rationale` and an `error`'s
 *  `message` are dropped under `holdout` — the judge scores prompt/candidate content, so both
 *  are candidate-derived free text the same way `rationale` is). */
export function redactTierC(tierC: TierCResult, visibility: EvalSetVisibility): TierCReportResult {
  if (tierC.status === 'skipped') return tierC;
  if (tierC.status === 'error') {
    return visibility === 'holdout' ? { status: 'error' } : { status: 'error', message: tierC.message };
  }
  return {
    status: 'scored',
    verdict: {
      rubricVersion: tierC.verdict.rubricVersion,
      judgeIdentity: tierC.verdict.judgeIdentity,
      criteria: redactJudgeVerdict(tierC.verdict, visibility),
    },
  };
}
