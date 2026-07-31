/**
 * evals/report/diff.ts — chain-E, task 5.3. Names per-case, per-tier regressions between two
 * `EvalRunReport`s (`base` → `candidate`), down to the specific Tier-B assertion. Tier-C score
 * changes are reported separately as deltas explicitly marked non-deterministic — never folded
 * into the regression lists, per D9 ("Tier C scores are... marked non-deterministic, so a diff
 * shows score deltas without pretending they are regressions").
 *
 * Structurally inherits redaction (design D3): pairs cases by `case.caseId` only and never reads
 * `case.prompt`/`case.expectation`/`case.candidateSource` off either report — those fields are
 * simply absent for a holdout `CaseResult`, so there is nothing to accidentally surface.
 */
import type { AssertionKind, EvalRunReport } from '../contract';

export interface TierARegression {
  readonly caseId: string;
  readonly tier: 'A';
  readonly from: 'pass';
  readonly to: 'fail';
}

export interface TierBAssertionRegression {
  readonly caseId: string;
  readonly tier: 'B';
  readonly english: string;
  readonly kind: AssertionKind;
  readonly from: 'pass';
  readonly to: 'fail';
}

/** A Tier-C criterion score change. Always `deterministic: false` — the judge is not required
 *  to be reproducible run-to-run, so this is never treated as a pass/fail regression. */
export interface TierCScoreDelta {
  readonly caseId: string;
  readonly criterion: string;
  readonly from: number | undefined;
  readonly to: number | undefined;
  readonly deterministic: false;
}

export interface ReportDiff {
  readonly baseSchemaVersion: number;
  readonly candidateSchemaVersion: number;
  readonly casesAdded: readonly string[];
  readonly casesRemoved: readonly string[];
  readonly tierARegressions: readonly TierARegression[];
  readonly tierBRegressions: readonly TierBAssertionRegression[];
  readonly tierCScoreDeltas: readonly TierCScoreDelta[];
}

type ById = Map<string, EvalRunReport['cases'][number]>;

function byCaseId(cases: EvalRunReport['cases']): ById {
  return new Map(cases.map((c) => [c.case.caseId, c] as const));
}

function tierARegression(caseId: string, base: EvalRunReport['cases'][number], candidate: EvalRunReport['cases'][number]): TierARegression | undefined {
  if (base.tierA.status === 'pass' && candidate.tierA.status === 'fail') {
    return { caseId, tier: 'A', from: 'pass', to: 'fail' };
  }
  return undefined;
}

function tierBRegressions(caseId: string, base: EvalRunReport['cases'][number], candidate: EvalRunReport['cases'][number]): readonly TierBAssertionRegression[] {
  if (base.tierB.status !== 'evaluated' || candidate.tierB.status !== 'evaluated') return [];
  const count = Math.min(base.tierB.assertions.length, candidate.tierB.assertions.length);
  const regressions: TierBAssertionRegression[] = [];
  for (let i = 0; i < count; i++) {
    const before = base.tierB.assertions[i];
    const after = candidate.tierB.assertions[i];
    if (before.status === 'pass' && after.status === 'fail') {
      regressions.push({ caseId, tier: 'B', english: after.english, kind: after.kind, from: 'pass', to: 'fail' });
    }
  }
  return regressions;
}

function tierCDeltas(caseId: string, base: EvalRunReport['cases'][number], candidate: EvalRunReport['cases'][number]): readonly TierCScoreDelta[] {
  if (base.tierC.status !== 'scored' || candidate.tierC.status !== 'scored') return [];
  const before = new Map(base.tierC.verdict.criteria.map((c) => [c.criterion, c.score] as const));
  const after = new Map(candidate.tierC.verdict.criteria.map((c) => [c.criterion, c.score] as const));
  const criteria = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a.localeCompare(b));
  const deltas: TierCScoreDelta[] = [];
  for (const criterion of criteria) {
    const from = before.get(criterion);
    const to = after.get(criterion);
    if (from !== to) deltas.push({ caseId, criterion, from, to, deterministic: false });
  }
  return deltas;
}

/** Compares `base` against `candidate`. Cases present in only one report are named in
 *  `casesAdded`/`casesRemoved`; cases present in both are compared tier by tier. Tier-B
 *  assertions are paired positionally (declared order is stable for a fixed eval set). */
export function diffReports(base: EvalRunReport, candidate: EvalRunReport): ReportDiff {
  const baseById = byCaseId(base.cases);
  const candidateById = byCaseId(candidate.cases);

  const casesAdded = [...candidateById.keys()].filter((id) => !baseById.has(id)).sort((a, b) => a.localeCompare(b));
  const casesRemoved = [...baseById.keys()].filter((id) => !candidateById.has(id)).sort((a, b) => a.localeCompare(b));

  const tierARegressions: TierARegression[] = [];
  const tierBAll: TierBAssertionRegression[] = [];
  const tierCAll: TierCScoreDelta[] = [];

  for (const [caseId, baseCase] of baseById) {
    const candidateCase = candidateById.get(caseId);
    if (candidateCase === undefined) continue;

    const aRegression = tierARegression(caseId, baseCase, candidateCase);
    if (aRegression !== undefined) tierARegressions.push(aRegression);
    tierBAll.push(...tierBRegressions(caseId, baseCase, candidateCase));
    tierCAll.push(...tierCDeltas(caseId, baseCase, candidateCase));
  }

  return {
    baseSchemaVersion: base.schemaVersion,
    candidateSchemaVersion: candidate.schemaVersion,
    casesAdded,
    casesRemoved,
    tierARegressions,
    tierBRegressions: tierBAll,
    tierCScoreDeltas: tierCAll,
  };
}

/** Human-readable rendering of a `ReportDiff`, for console output. Reads nothing off `diff` but
 *  ids/tiers/assertion English/scores — no prompt/expectation text ever enters this function. */
export function renderDiff(diff: ReportDiff): string {
  const lines: string[] = [];
  if (diff.baseSchemaVersion !== diff.candidateSchemaVersion) {
    lines.push(`schema version differs: base=${diff.baseSchemaVersion}, candidate=${diff.candidateSchemaVersion}`);
  }
  diff.casesAdded.forEach((id) => lines.push(`+ case added: ${id}`));
  diff.casesRemoved.forEach((id) => lines.push(`- case removed: ${id}`));
  diff.tierARegressions.forEach((r) => lines.push(`REGRESSION [${r.caseId}] Tier A: pass -> fail`));
  diff.tierBRegressions.forEach((r) =>
    lines.push(`REGRESSION [${r.caseId}] Tier B (${r.kind}): pass -> fail — ${r.english}`),
  );
  diff.tierCScoreDeltas.forEach((d) =>
    lines.push(`Tier C delta (non-deterministic) [${d.caseId}] ${d.criterion}: ${d.from ?? 'n/a'} -> ${d.to ?? 'n/a'}`),
  );
  if (lines.length === 0) lines.push('No differences.');
  return `${lines.join('\n')}\n`;
}
