/**
 * evals/report/summary.ts — chain-E, task 5.2. The human-readable Markdown summary of an
 * `EvalRunReport`: per-tier pass rates and a failure list.
 *
 * Structurally inherits redaction (design D3): every function here reads only `case.caseId`,
 * `appSlug`, `verdict`, and the tier results off an already-built `CaseResult` — never
 * `case.prompt`/`case.expectation`/`case.candidateSource`. For a holdout report those fields
 * are simply absent on the object (see `serialize.ts`/`redact.ts`), so there is nothing here
 * that could leak them even by mistake. `tierARate`/`tierBRate`/`overallRate` are also the
 * shared pass-rate primitives `compare.ts` reuses (D10).
 */
import type { EvalRunReport } from '../contract';

export interface TierRate {
  readonly passed: number;
  readonly total: number;
  /** `0` when `total` is `0` (never `NaN`). */
  readonly rate: number;
}

function rate(passed: number, total: number): TierRate {
  return { passed, total, rate: total === 0 ? 0 : passed / total };
}

/** Tier A pass rate over every case in the report. */
export function tierARate(report: EvalRunReport): TierRate {
  return rate(report.cases.filter((c) => c.tierA.status === 'pass').length, report.cases.length);
}

/** Tier B pass rate over every case in the report — a `skipped` Tier B counts as not-passed,
 *  the same way `computeCaseVerdict` treats it (`evals/tiers/case.ts`). */
export function tierBRate(report: EvalRunReport): TierRate {
  const passed = report.cases.filter(
    (c) => c.tierB.status === 'evaluated' && c.tierB.assertions.every((a) => a.status === 'pass'),
  ).length;
  return rate(passed, report.cases.length);
}

/** The combined Tier-A+B pass rate — equivalently, the fraction of cases whose `verdict` is
 *  `'pass'` (Tier C never contributes; `computeCaseVerdict` already encodes A+B gating). This is
 *  the rate `compare.ts`'s overfitting alarm is keyed on (spec "Tier-A+B pass rate"). */
export function overallRate(report: EvalRunReport): TierRate {
  return rate(report.cases.filter((c) => c.verdict === 'pass').length, report.cases.length);
}

export function failingCaseIds(report: EvalRunReport): readonly string[] {
  return report.cases.filter((c) => c.verdict === 'fail').map((c) => c.case.caseId);
}

function formatPct(r: number): string {
  return `${(r * 100).toFixed(1)}%`;
}

function formatRate(label: string, r: TierRate): string {
  return `- ${label}: ${r.passed}/${r.total} (${formatPct(r.rate)})`;
}

/** Renders the Markdown summary: provenance header, per-tier pass rates, and a failing-case-id
 *  list (never assertion prose or prompt text — only ids, which are safe under holdout too). */
export function renderSummary(report: EvalRunReport): string {
  const failing = failingCaseIds(report);
  const lines: string[] = [
    `# Eval run: ${report.evalSet.setId} (${report.evalSet.visibility})`,
    '',
    `- schema version: ${report.schemaVersion}`,
    `- runner version: ${report.runnerVersion}`,
    `- candidate label: ${report.candidateLabel}`,
    ...(report.rubricVersion !== undefined ? [`- rubric version: ${report.rubricVersion}`] : []),
    '',
    '## Pass rates',
    '',
    formatRate('Tier A', tierARate(report)),
    formatRate('Tier B', tierBRate(report)),
    formatRate('Overall (Tier A+B)', overallRate(report)),
    '',
    '## Failing cases',
    '',
    ...(failing.length === 0 ? ['None.'] : failing.map((id) => `- ${id}`)),
  ];
  return `${lines.join('\n')}\n`;
}
