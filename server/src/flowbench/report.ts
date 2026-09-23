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

export type CaseOutcome =
  | { type: 'result' }
  | { type: 'failure'; phase: 'clarify' | 'rewrite' | 'generate'; reason: string; attempts: number };

export interface CaseReport {
  caseId: string;
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

export interface FlowBenchmarkReport {
  setId: string;
  url: string;
  startedAt: string;
  finishedAt: string;
  cases: CaseReport[];
  summary: {
    phases: Record<'clarify' | 'rewrite' | 'generate', PhaseSummary>;
    results: number;
    failures: number;
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
    },
  };
}

function durationText(durationMs: number | undefined): string {
  return durationMs === undefined ? '-' : `${durationMs} ms`;
}

function statusText(report: PhaseReport | GenerateReport | undefined): string {
  return report === undefined ? '-' : `${report.status} / ${durationText(report.durationMs)}`;
}

export function formatMarkdownReport(report: FlowBenchmarkReport): string {
  const lines = [
    `| Case | Clarify | Rewrite | Generate | Stages | Outcome |`,
    `| --- | ---: | ---: | ---: | --- | --- |`,
  ];
  for (const item of report.cases) {
    const generate = item.phases.generate;
    const stages = generate?.stages.map((stage) => {
      const attempt = stage.attempt === undefined ? '' : `#${stage.attempt}`;
      return `${stage.stage}${attempt}: ${stage.durationMs} ms`;
    }).join('<br>') ?? '-';
    const outcome = item.outcome.type === 'result' ? 'result' : `failure: ${item.outcome.reason}`;
    lines.push(`| ${item.caseId} | ${statusText(item.phases.clarify)} | ${statusText(item.phases.rewrite)} | ${statusText(generate)} | ${stages} | ${outcome} |`);
  }
  lines.push('', '| Phase | Median | Maximum |', '| --- | ---: | ---: |');
  for (const phase of ['clarify', 'rewrite', 'generate'] as const) {
    const summary = report.summary.phases[phase];
    lines.push(`| ${phase} | ${summary.medianMs} ms | ${summary.maxMs} ms |`);
  }
  return `${lines.join('\n')}\n`;
}
