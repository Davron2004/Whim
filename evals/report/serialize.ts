/**
 * evals/report/serialize.ts — chain-E, tasks 5.1. Builds an `EvalRunReport` from raw case
 * inputs and renders it as canonical JSON (design D9, `handoff/eval-contract.md`).
 *
 * Redaction (design D3) happens HERE, at construction: `buildCaseResult` is the only place a
 * `CaseResult.case` is ever produced, and it always goes through `evals/redact.ts`'s
 * `redactCase`. No function in this module — or `summary.ts`/`diff.ts`/`compare.ts`, which only
 * ever consume an already-built `EvalRunReport` — can construct a `CaseResult` any other way,
 * so there is no code path that can hold an unredacted holdout case in memory.
 *
 * Canonical form: `cases` sorted by `case.caseId` (done once, in `buildReport`), assertions kept
 * in the order the tier evaluators produced them (already the declared order — nothing here
 * reorders an array), and every object's keys sorted alphabetically at every depth
 * (`canonicalize`) so two structurally-equal reports always serialize byte-identically regardless
 * of property-insertion order upstream. `timings` carries wall-clock/duration data and is
 * deliberately excluded from `diffableBody`/`serializeDiffableBody` — the determinism guarantee
 * (spec "Identical inputs produce an identical body") is scoped to that body, never the full
 * report.
 */
import { redactCase } from '../redact';
import type {
  CaseResult,
  EvalRunReport,
  EvalSetVisibility,
  TierAResult,
  TierBResult,
  TierCResult,
} from '../contract';
import { EVAL_REPORT_SCHEMA_VERSION } from '../contract';
import { computeCaseVerdict } from '../tiers/case';

const CANONICAL_INDENT = 2;

export interface CaseInput {
  readonly caseId: string;
  readonly appSlug: string;
  readonly prompt: string;
  readonly expectation?: string;
  readonly candidateSource?: string;
  readonly tierA: TierAResult;
  readonly tierB: TierBResult;
  readonly tierC: TierCResult;
}

/** Builds one `CaseResult`, redacting `case` per `visibility` (design D3). The ONLY sanctioned
 *  way to produce a `CaseResult` — never assemble one by hand. */
export function buildCaseResult(input: CaseInput, visibility: EvalSetVisibility): CaseResult {
  const redacted = redactCase(
    {
      caseId: input.caseId,
      prompt: input.prompt,
      expectation: input.expectation,
      candidateSource: input.candidateSource,
    },
    visibility,
  );
  return {
    case: redacted,
    appSlug: input.appSlug,
    verdict: computeCaseVerdict(input.tierA, input.tierB),
    tierA: input.tierA,
    tierB: input.tierB,
    tierC: input.tierC,
  };
}

export interface BuildReportInput {
  readonly evalSet: { readonly setId: string; readonly visibility: EvalSetVisibility; readonly location: string };
  readonly runnerVersion: string;
  readonly candidateLabel: string;
  readonly cases: readonly CaseInput[];
  readonly startedAt: string; // ISO-8601
  readonly finishedAt: string; // ISO-8601
}

/** Assembles the full report: builds+redacts every case, sorts by `caseId`, and derives
 *  `rubricVersion` from the first `scored` Tier-C result (undefined if none ran — spec
 *  "rubric version when Tier C ran"), so a caller can never pass a `rubricVersion` that
 *  disagrees with what actually ran. */
export function buildReport(input: BuildReportInput): EvalRunReport {
  const cases = input.cases
    .map((c) => buildCaseResult(c, input.evalSet.visibility))
    .sort((a, b) => a.case.caseId.localeCompare(b.case.caseId));
  const rubricVersion = deriveRubricVersion(cases);
  const durationMs = Date.parse(input.finishedAt) - Date.parse(input.startedAt);

  return {
    schemaVersion: EVAL_REPORT_SCHEMA_VERSION,
    evalSet: input.evalSet,
    runnerVersion: input.runnerVersion,
    candidateLabel: input.candidateLabel,
    ...(rubricVersion !== undefined ? { rubricVersion } : {}),
    cases,
    timings: { startedAt: input.startedAt, finishedAt: input.finishedAt, durationMs },
  };
}

function deriveRubricVersion(cases: readonly CaseResult[]): string | undefined {
  const scored = cases.find((c) => c.tierC.status === 'scored');
  return scored?.tierC.status === 'scored' ? scored.tierC.verdict.rubricVersion : undefined;
}

/** Recursively sorts every plain object's keys (alphabetical, `localeCompare`); arrays keep
 *  their existing order. `undefined` values are dropped (matches `JSON.stringify`'s own
 *  behavior for object properties, made explicit so canonicalized output never varies by
 *  whether an optional key was set to `undefined` vs. omitted). */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort((a, b) => a.localeCompare(b))) {
      const v = obj[key];
      if (v === undefined) continue;
      result[key] = canonicalize(v);
    }
    return result;
  }
  return value;
}

/** The full report minus `timings` — the piece two runs over identical inputs must produce
 *  byte-identically (spec "Identical inputs produce an identical body"). */
export function diffableBody(report: EvalRunReport): Readonly<Record<string, unknown>> {
  const body: Record<string, unknown> = { ...report };
  delete body.timings;
  return body;
}

/** Canonical JSON of `diffableBody(report)` — what `diff`/`compare`'s determinism guarantee is
 *  actually measured against. */
export function serializeDiffableBody(report: EvalRunReport): string {
  return JSON.stringify(canonicalize(diffableBody(report)), null, CANONICAL_INDENT);
}

/** Canonical JSON of the full report, including `timings` — what gets written to disk. */
export function serializeReport(report: EvalRunReport): string {
  return JSON.stringify(canonicalize(report), null, CANONICAL_INDENT);
}
