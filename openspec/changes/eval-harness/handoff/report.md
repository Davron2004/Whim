# Handoff: report (chain-E → chain-F)

Implemented in `evals/report/serialize.ts`, `evals/report/summary.ts`, `evals/report/diff.ts`,
`evals/report/compare.ts`. `EvalRunReport`/`CaseResult`/`EVAL_REPORT_SCHEMA_VERSION` are
`evals/contract.ts` (chain-A) — import from there. **Redaction happens at construction (D3):
`buildCaseResult` is the ONLY function that may produce a `CaseResult.case`, and it always calls
`evals/redact.ts`'s `redactCase`.** `summary.ts`/`diff.ts`/`compare.ts` only ever read an
already-built `EvalRunReport` — there is no code path in this repo that holds an unredacted
holdout case in memory.

## Building + serializing — `evals/report/serialize.ts`
```ts
export interface CaseInput {
  readonly caseId: string; readonly appSlug: string; readonly prompt: string;
  readonly expectation?: string; readonly candidateSource?: string;
  readonly tierA: TierAResult; readonly tierB: TierBResult; readonly tierC: TierCResult;
}
export function buildCaseResult(input: CaseInput, visibility: EvalSetVisibility): CaseResult;

export interface BuildReportInput {
  readonly evalSet: { readonly setId: string; readonly visibility: EvalSetVisibility; readonly location: string };
  readonly runnerVersion: string; readonly candidateLabel: string;
  readonly cases: readonly CaseInput[];
  readonly startedAt: string; readonly finishedAt: string; // ISO-8601
}
export function buildReport(input: BuildReportInput): EvalRunReport;
```
`buildReport` sorts `cases` by `case.caseId` and **derives `rubricVersion`** from the first
`status: 'scored'` Tier-C result across the (already redaction-safe) cases — never
caller-supplied, so it can never disagree with what actually ran. Absent iff no case ran Tier C.

```ts
export function canonicalize(value: unknown): unknown; // recursive alphabetical key sort, arrays keep order, drops `undefined` values
export function diffableBody(report: EvalRunReport): Readonly<Record<string, unknown>>; // report minus `timings`
export function serializeDiffableBody(report: EvalRunReport): string; // canonical JSON, 2-space indent, of diffableBody
export function serializeReport(report: EvalRunReport): string; // canonical JSON of the FULL report (incl. timings) — what a CLI writes to disk
```
**Canonical body field order (the pinned contract):** every object's own keys are sorted
alphabetically at every depth, recursively — not the field order the type declarations happen to
list. Two `EvalRunReport`s that are structurally equal always serialize byte-identically via
`serializeDiffableBody` regardless of upstream property-insertion order. `cases` array order is
NOT alphabetical-key-sorted (arrays keep insertion order) — it is explicitly sorted by
`case.caseId` in `buildReport`. Tier-B `assertions` arrays keep the tier evaluators' declared
order (chain-C's `evaluateTierB` already preserves it; nothing here reorders an array). `timings`
is present on `serializeReport`'s output but absent from `diffableBody`/`serializeDiffableBody` —
that is the whole determinism guarantee (spec "Identical inputs produce an identical body").

Chain-F does NOT yet have a file-write helper here — "reports write under a git-ignored default
directory, never overwrite a tracked file" (spec) is CLI behavior, unimplemented; chain-F must add
it, calling `serializeReport` for the bytes.

## Markdown summary — `evals/report/summary.ts`
```ts
export interface TierRate { readonly passed: number; readonly total: number; readonly rate: number; } // rate is 0 when total is 0, never NaN
export function tierARate(report: EvalRunReport): TierRate;
export function tierBRate(report: EvalRunReport): TierRate;   // a skipped Tier B counts as not-passed
export function overallRate(report: EvalRunReport): TierRate; // fraction with verdict === 'pass' — the Tier-A+B combined rate compare.ts's alarm is keyed on
export function failingCaseIds(report: EvalRunReport): readonly string[];
export function renderSummary(report: EvalRunReport): string; // Markdown: provenance header, per-tier + overall pass rates, failing-case-id list
```

## Diff — `evals/report/diff.ts`
```ts
export interface TierARegression { readonly caseId: string; readonly tier: 'A'; readonly from: 'pass'; readonly to: 'fail'; }
export interface TierBAssertionRegression { readonly caseId: string; readonly tier: 'B'; readonly english: string; readonly kind: AssertionKind; readonly from: 'pass'; readonly to: 'fail'; }
export interface TierCScoreDelta { readonly caseId: string; readonly criterion: string; readonly from: number | undefined; readonly to: number | undefined; readonly deterministic: false; }
export interface ReportDiff {
  readonly baseSchemaVersion: number; readonly candidateSchemaVersion: number;
  readonly casesAdded: readonly string[]; readonly casesRemoved: readonly string[];
  readonly tierARegressions: readonly TierARegression[];
  readonly tierBRegressions: readonly TierBAssertionRegression[];
  readonly tierCScoreDeltas: readonly TierCScoreDelta[]; // NEVER folded into the regression lists — always marked non-deterministic
}
export function diffReports(base: EvalRunReport, candidate: EvalRunReport): ReportDiff;
export function renderDiff(diff: ReportDiff): string; // human-readable console rendering
```
Only pass→fail transitions are named as "regressions" (fail→pass is not surfaced — out of scope).
Tier-B assertions are paired positionally per case (stable for a fixed eval set).

## Compare — `evals/report/compare.ts`
```ts
export interface TierDivergence { readonly tier: 'A' | 'B' | 'A+B'; readonly visibleRate: number; readonly holdoutRate: number; readonly divergence: number; } // visibleRate - holdoutRate
export interface CompareRefusal { readonly status: 'refused'; readonly reason: string; }
export interface CompareResult {
  readonly status: 'ok'; readonly visibleSetId: string; readonly holdoutSetId: string; readonly threshold: number;
  readonly tiers: readonly [TierDivergence, TierDivergence, TierDivergence]; // A, B, A+B in that order
  readonly overfittingAlarm: boolean; // true iff the A+B entry's divergence > threshold
}
export type CompareOutcome = CompareResult | CompareRefusal;
export function compareReports(visible: EvalRunReport, holdout: EvalRunReport, threshold: number): CompareOutcome;
export function renderCompare(outcome: CompareOutcome): string;

export const COMPARE_EXIT_OK = 0;       // ok, no alarm
export const COMPARE_EXIT_ALARM = 1;    // ok, overfitting_alarm true
export const COMPARE_EXIT_REFUSED = 2;  // schema or (Tier-C-relevant) rubric version mismatch
export function compareExitCode(outcome: CompareOutcome): number;
```
**This is the exit-code contract chain-F's CLI wires verbatim** — `process.exitCode =
compareExitCode(compareReports(...))`. Refusal fires when `schemaVersion` differs, OR when either
report's `rubricVersion` is defined and the two `rubricVersion`s differ (covers one-ran-Tier-C /
other-didn't as a mismatch too). A refusal computes no divergence number at all.

## What chain-F still owns
File I/O (default output directory, tracked-file-overwrite refusal), CLI argument parsing, wiring
`compareExitCode` to `process.exitCode`, and choosing the alarm `threshold` value/flag.
