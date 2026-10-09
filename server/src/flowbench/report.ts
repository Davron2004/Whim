import type { ApiError, Clarification, WireAppRecord } from '@whim/contract';
import { runStaticChecks } from '../../../checks/index';
import type { DiagnosticKind } from '../../../checks/contract';

export interface EvalCase {
  caseId: string;
  appSlug: string;
  prompt: string;
  assertions: readonly unknown[];
  /** A change to ask for once the case's app is delivered: the delivered app goes back to
   *  `/v1/generate` with this prompt, and the report says whether its tile survived. */
  change?: string;
}

/** The longest a clarify option may be (generation-pipeline "Clarify options are short enough to
 *  read as answers"); the prompts suite checks the clarify prompt asks for this same cap. */
export const OPTION_MAX_CHARS = 40;

/** What clarify offered as options in one run: how many, and every one over `OPTION_MAX_CHARS`. */
export interface OptionReport {
  count: number;
  long: string[];
}

/** A delivered app's tile: the tint and icon its manifest carries, and whether each was declared
 *  as exactly a set name — no alias, keyword or fallback applied, per the checker's own
 *  tile-identity diagnostics over the delivered source. */
export interface TileReport {
  tint?: string[];
  icon?: string;
  tintValid: boolean;
  iconValid: boolean;
}

/** The change asked for after the case's app was delivered (`EvalCase.change`). `kept` is present
 *  when the change delivered too: whether the changed app names the same tint and icon. */
export interface ChangeReport {
  prompt: string;
  generate: GenerateReport;
  tile?: TileReport;
  kept?: boolean;
}

const TINT_KINDS: readonly DiagnosticKind[] = ['tint_alias', 'tint_fallback'];
const ICON_KINDS: readonly DiagnosticKind[] = ['icon_alias', 'icon_keyword', 'icon_fallback'];

export function optionReport(options: readonly string[]): OptionReport {
  return { count: options.length, long: options.filter((option) => option.length > OPTION_MAX_CHARS) };
}

export function assessTile(app: WireAppRecord): TileReport {
  const kinds = runStaticChecks(app.source).diagnostics.map((d) => d.kind);
  const tint = Array.isArray(app.manifest.tint) ? app.manifest.tint.filter((name): name is string => typeof name === 'string') : undefined;
  const icon = typeof app.manifest.icon === 'string' ? app.manifest.icon : undefined;
  return {
    ...(tint === undefined ? {} : { tint }),
    ...(icon === undefined ? {} : { icon }),
    tintValid: tint !== undefined && tint.length > 0 && !kinds.some((kind) => TINT_KINDS.includes(kind)),
    iconValid: icon !== undefined && !kinds.some((kind) => ICON_KINDS.includes(kind)),
  };
}

/** Whether a change kept the tile: the same ranked tints and the same icon. */
export function tileKept(before: TileReport, after: TileReport): boolean {
  return JSON.stringify(before.tint) === JSON.stringify(after.tint) && before.icon === after.icon;
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
  | { type: 'failure'; phase: 'clarify' | 'rewrite' | 'generate' | 'change'; reason: string; attempts: number };

export interface CaseReport {
  caseId: string;
  /** Which run of the case this is, from 1 (`--repeat`). */
  run: number;
  appSlug: string;
  prompt: string;
  deviceId: string;
  clarifications: Clarification[];
  /** Clarify's options for this run (none when clarify failed or set a limit). */
  options: OptionReport;
  /** The delivered app's tile, when generate delivered one. */
  tile?: TileReport;
  change?: ChangeReport;
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
    /** Every clarify option across the run, and how many broke `OPTION_MAX_CHARS`. */
    options: { total: number; long: number };
    /** Every delivered app (first builds and changes): how many named a valid tint and icon, the
     *  share whose icon was not exactly a set glyph, and how many changes kept the tile. */
    tiles: { delivered: number; validTint: number; validIcon: number; invalidIconRate: number; changes: number; kept: number };
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

function tileSummary(cases: readonly CaseReport[]): FlowBenchmarkReport['summary']['tiles'] {
  const tiles = cases.flatMap((item) => [item.tile, item.change?.tile]).filter((tile): tile is TileReport => tile !== undefined);
  const validIcon = tiles.filter((tile) => tile.iconValid).length;
  const changes = cases.filter((item) => item.change?.kept !== undefined);
  return {
    delivered: tiles.length,
    validTint: tiles.filter((tile) => tile.tintValid).length,
    validIcon,
    invalidIconRate: tiles.length === 0 ? 0 : (tiles.length - validIcon) / tiles.length,
    changes: changes.length,
    kept: changes.filter((item) => item.change?.kept === true).length,
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
      limits: cases.filter((item) => item.outcome.type === 'limit').length,
      tallies: tallies(cases),
      options: {
        total: cases.reduce((sum, item) => sum + item.options.count, 0),
        long: cases.reduce((sum, item) => sum + item.options.long.length, 0),
      },
      tiles: tileSummary(cases),
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
  const { options, tiles } = report.summary;
  lines.push(
    '',
    `| Options over ${OPTION_MAX_CHARS} chars | Apps delivered | Valid tint | Valid icon | Invalid-icon rate | Tile kept on change |`,
    '| ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${options.long} / ${options.total} | ${tiles.delivered} | ${tiles.validTint} | ${tiles.validIcon} | ${Math.round(tiles.invalidIconRate * 100)}% | ${tiles.kept} / ${tiles.changes} |`,
  );
  const longOptions = report.cases.flatMap((item) => item.options.long.map((option) => `- ${item.caseId}: "${option}" (${option.length} chars)`));
  if (longOptions.length > 0) lines.push('', `Options over ${OPTION_MAX_CHARS} characters:`, ...longOptions);
  return `${lines.join('\n')}\n`;
}
