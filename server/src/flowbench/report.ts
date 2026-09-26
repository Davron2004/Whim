import type { ApiError, Clarification } from '@whim/contract';

export interface EvalCase {
  caseId: string;
  appSlug: string;
  prompt: string;
  assertions: readonly unknown[];
}

export interface EvalSet {
  setId: string;
  visibility: string;
  cases: readonly EvalCase[];
}

export interface PhaseReport {
  status: number;
  durationMs: number;
  retries: number;
  error?: ApiError;
}

export interface StageTiming {
  stage: 'plan' | 'generate' | 'check' | 'run' | 'repair';
  attempt?: number;
  durationMs: number;
}

export interface GenerateReport extends PhaseReport {
  firstEventMs?: number;
  stages: StageTiming[];
  repairs: number;
  tailMs?: number;
  terminal?:
    | { type: 'result'; sourceBytes: number }
    | { type: 'failure'; reason: string; attempts: number };
}

/** `limit` is clarify saying the request's core needs something a mini-app cannot do (beta-1 D9):
 *  the case stops before rewrite, and it is not a failure. `clarified` is a run that stopped once
 *  clarify answered with questions or none (`--stop-after clarify`); it is not a failure either. */
export type CaseOutcome =
  | { type: 'result' }
  | { type: 'limit'; reason: string; alternative: string }
  | { type: 'clarified' }
  | { type: 'failure'; phase: 'clarify' | 'rewrite' | 'generate'; reason: string; attempts: number };

export interface CaseReport {
  caseId: string;
  /** Which run of the case this is, from 1 (`--repeat`). */
  run: number;
  appSlug: string;
  prompt: string;
  deviceId: string;
  clarifications: Clarification[];
  phases: {
    clarify: PhaseReport;
    rewrite?: PhaseReport;
    generate?: GenerateReport;
  };
  outcome: CaseOutcome;
}

export interface PhaseSummary {
  medianMs: number;
  maxMs: number;
}

/** What clarify answered across one case's runs: a `limit`, at least one question, no question,
 *  or no usable answer at all (`failure`: an error status or an off-contract body). Every run counts
 *  once. A failure after clarify is not a clarify answer: it counts in `summary.failures`. */
export interface CaseTally {
  caseId: string;
  runs: number;
  limit: number;
  questions: number;
  empty: number;
  failure: number;
}

type ClarifyAnswer = Exclude<keyof CaseTally, 'caseId' | 'runs'>;

export interface FlowBenchmarkReport {
  setId: string;
  url: string;
  startedAt: string;
  finishedAt: string;
  cases: CaseReport[];
  summary: {
    phases: Record<'clarify' | 'rewrite' | 'generate', PhaseSummary>;
    results: number;
    /** Real failures only: a `limit` outcome is counted in `limits`. */
    failures: number;
    limits: number;
    /** One per case, in eval-set order. */
    tallies: CaseTally[];
  };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

function phaseSummary(reports: readonly (PhaseReport | GenerateReport | undefined)[]): PhaseSummary {
  const durations = reports.filter((report): report is PhaseReport | GenerateReport => report !== undefined && report.status > 0).map((report) => report.durationMs);
  return {
    medianMs: median(durations),
    maxMs: durations.length === 0 ? 0 : Math.max(...durations),
  };
}

function clarifyAnswer(item: CaseReport): ClarifyAnswer {
  if (item.outcome.type === 'limit') return 'limit';
  if (item.outcome.type === 'failure' && item.outcome.phase === 'clarify') return 'failure';
  // Each question clarify asked gets exactly one auto-answer.
  return item.clarifications.length > 0 ? 'questions' : 'empty';
}

function tallies(cases: readonly CaseReport[]): CaseTally[] {
  const byCase = new Map<string, CaseTally>();
  for (const item of cases) {
    const tally = byCase.get(item.caseId) ?? { caseId: item.caseId, runs: 0, limit: 0, questions: 0, empty: 0, failure: 0 };
    tally.runs += 1;
    tally[clarifyAnswer(item)] += 1;
    byCase.set(item.caseId, tally);
  }
  return [...byCase.values()];
}

export function buildReport(setId: string, url: string, startedAt: string, cases: readonly CaseReport[], finishedAt = new Date().toISOString()): FlowBenchmarkReport {
  return {
    setId,
    url,
    startedAt,
    finishedAt,
    cases: [...cases],
    summary: {
      phases: {
        clarify: phaseSummary(cases.map((item) => item.phases.clarify)),
        rewrite: phaseSummary(cases.map((item) => item.phases.rewrite)),
        generate: phaseSummary(cases.map((item) => item.phases.generate)),
      },
      results: cases.filter((item) => item.outcome.type === 'result').length,
      failures: cases.filter((item) => item.outcome.type === 'failure').length,
      limits: cases.filter((item) => item.outcome.type === 'limit').length,
      tallies: tallies(cases),
    },
  };
}

function durationText(durationMs: number | undefined): string {
  return durationMs === undefined ? '-' : `${durationMs} ms`;
}

function statusText(report: PhaseReport | GenerateReport | undefined): string {
  return report === undefined ? '-' : `${report.status} / ${durationText(report.durationMs)}`;
}

function outcomeText(item: CaseReport): string {
  const { outcome } = item;
  if (outcome.type === 'result') return 'result';
  if (outcome.type === 'limit') return `limit: ${outcome.reason} → ${outcome.alternative}`;
  if (outcome.type === 'clarified') return `clarified: ${item.clarifications.length} question(s)`;
  return `failure: ${outcome.reason}`;
}

export function formatMarkdownReport(report: FlowBenchmarkReport): string {
  const lines = [
    `| Case | Clarify | Rewrite | Generate | Stages | Outcome |`,
    `| --- | ---: | ---: | ---: | --- | --- |`,
  ];
  const repeated = report.cases.some((item) => item.run > 1);
  for (const item of report.cases) {
    const generate = item.phases.generate;
    const stages = generate?.stages.map((stage) => {
      const attempt = stage.attempt === undefined ? '' : `#${stage.attempt}`;
      return `${stage.stage}${attempt}: ${stage.durationMs} ms`;
    }).join('<br>') ?? '-';
    const outcome = outcomeText(item);
    const label = repeated ? `${item.caseId} #${item.run}` : item.caseId;
    lines.push(`| ${label} | ${statusText(item.phases.clarify)} | ${statusText(item.phases.rewrite)} | ${statusText(generate)} | ${stages} | ${outcome} |`);
  }
  lines.push('', '| Phase | Median | Maximum |', '| --- | ---: | ---: |');
  for (const phase of ['clarify', 'rewrite', 'generate'] as const) {
    const summary = report.summary.phases[phase];
    lines.push(`| ${phase} | ${summary.medianMs} ms | ${summary.maxMs} ms |`);
  }
  lines.push('', '| Case | Runs | Limit | Questions | Empty | Failure |', '| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const tally of report.summary.tallies) {
    lines.push(`| ${tally.caseId} | ${tally.runs} | ${tally.limit} | ${tally.questions} | ${tally.empty} | ${tally.failure} |`);
  }
  return `${lines.join('\n')}\n`;
}
