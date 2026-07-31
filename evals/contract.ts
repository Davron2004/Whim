/**
 * corpus-eval — the shared contract (`handoff/eval-contract.md`, D14 note). Types plus small
 * const tables, NO I/O and NO engine logic (mirrors `checks/contract.ts` — the storage-engine
 * `contract.ts` precedent), so it stands alone and is importable by the loader, the tier
 * evaluators (chains B/C/D), the report layer (chain E), and this suite.
 *
 * `Diagnostic`/`DiagnosticKind` are imported TYPE-ONLY from `checks/contract.ts` — this file
 * never edits that module and never mints a new diagnostic kind.
 */
import type { Diagnostic, DiagnosticKind } from '../checks/contract';

export type { Diagnostic, DiagnosticKind };

// ─────────────────────────────────────────────────────────────────────────────
// Eval set + case shapes (spec "The eval set is supplied at run time and never embedded",
// "Tier-B specs are English-first and encoded as inert data", "Corpus apps have stable slugs")
// ─────────────────────────────────────────────────────────────────────────────

export type EvalSetVisibility = 'visible' | 'holdout';

/**
 * Closed vocabulary a Tier-B assertion may draw from (design D5). Additive-only, in the same
 * spirit as `DIAGNOSTIC_KINDS` — an eval set naming a kind outside this table is a load error,
 * never a silently-skipped assertion.
 */
export const ASSERTION_KINDS = [
  'screen-reachable',
  'syscall-invoked',
  'cue-invoked',
  'diagnostic-present',
  'renders-without-error',
  'storage-roundtrip',
] as const;

export type AssertionKind = (typeof ASSERTION_KINDS)[number];

/**
 * A Tier-B spec: inert data, never code (D5). `english` is mandatory and carried verbatim into
 * failure output. `target` names the screen/syscall/cue/diagnostic kind the assertion checks,
 * per `kind` (absent for `renders-without-error`). `expected` selects presence (`true`, the
 * default) vs. absence (`false`) for the presence/absence kinds.
 */
export interface EvalAssertion {
  readonly english: string;
  readonly kind: AssertionKind;
  readonly target?: string;
  readonly expected?: boolean;
}

/** One eval case. `assertions` (Tier-B specs) are optional — task 1.6 lands prompts + ids only;
 *  chain-C's task 3.4 adds assertions to these same committed cases. */
export interface EvalCase {
  readonly caseId: string;
  /** Must resolve against `evals/corpus.ts`'s registry — an unknown slug is a load error. */
  readonly appSlug: string;
  readonly prompt: string;
  /** Optional English description of the expected behavior, for Tier-C judge context. Redacted
   *  identically to `prompt` for a holdout set (D3). */
  readonly expectation?: string;
  readonly assertions?: readonly EvalAssertion[];
}

export interface EvalSetManifest {
  readonly setId: string;
  readonly visibility: EvalSetVisibility;
  readonly cases: readonly EvalCase[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Run observation (spec "Tier A is deterministic...", "Tier-B assertions evaluate against the
// normalized run observation") — the ONE shape every tier evaluator reads; chain-B's adapter is
// the only module allowed to produce one from the synthetic-run harness's own shape.
// ─────────────────────────────────────────────────────────────────────────────

/** A containment verdict is trusted ONLY when `authenticated` is `true` — i.e. it came from the
 *  nonce-authenticated observation vantage (spike2 finding F4), never a candidate self-report. */
export interface ContainmentVerdict {
  readonly authenticated: boolean;
  readonly contained: boolean;
}

export interface RunObservation {
  readonly caseId: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly declaredScreens: readonly string[];
  readonly reachedScreens: readonly string[];
  readonly syscallsInvoked: readonly string[];
  readonly cuesInvoked: readonly string[];
  readonly containment: ContainmentVerdict;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier results (spec "Three tiers with declared gating semantics")
// ─────────────────────────────────────────────────────────────────────────────

export type TierBSkipReason = 'tier_a_failed';
export type TierCSkipReason = 'tier_a_failed' | 'no_judge_configured';

/** Tier A always runs (never skipped) — a deterministic gate over `RunObservation`. */
export interface TierAResult {
  readonly status: 'pass' | 'fail';
  readonly diagnostics: readonly Diagnostic[];
  readonly containment: ContainmentVerdict;
}

/** One evaluated Tier-B assertion's result. `observed` is the concrete value that made it pass
 *  or fail — never a bare boolean (spec "Tier-B assertions evaluate..."). */
export interface TierBAssertionResult {
  readonly english: string;
  readonly kind: AssertionKind;
  readonly status: 'pass' | 'fail';
  readonly observed: unknown;
}

export type TierBResult =
  | { readonly status: 'skipped'; readonly reason: TierBSkipReason }
  | { readonly status: 'evaluated'; readonly assertions: readonly TierBAssertionResult[] };

export interface JudgeCriterionScore {
  readonly criterion: string;
  readonly score: number;
  readonly rationale: string;
}

/** A judge's verdict. `rubricVersion` + `judgeIdentity` travel with every score (spec "The
 *  rubric is versioned..."). A verdict missing a criterion/rationale or an out-of-range score is
 *  a `TierCResult` of status `error`, never `scored` — validated by the tier, not the judge. */
export interface JudgeVerdict {
  readonly rubricVersion: string;
  readonly judgeIdentity: string;
  readonly criteria: readonly JudgeCriterionScore[];
}

/** Tier C never gates the case verdict (spec "Tier C never gates"). */
export type TierCResult =
  | { readonly status: 'skipped'; readonly reason: TierCSkipReason }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'scored'; readonly verdict: JudgeVerdict };

// ─────────────────────────────────────────────────────────────────────────────
// Report (spec "Run reports are canonical and diffable") — chain-E owns serialize/diff/compare;
// this is the shape they produce and consume. `case` is ALREADY the redacted view
// (`evals/redact.ts`'s `RedactedCaseFields`) — there is no unredacted case object on this type.
// ─────────────────────────────────────────────────────────────────────────────

export const EVAL_REPORT_SCHEMA_VERSION = 1;

export interface CaseResult {
  readonly case: {
    readonly caseId: string;
    readonly promptSha256: string;
    readonly prompt?: string;
    readonly expectation?: string;
    readonly candidateSource?: string;
  };
  readonly appSlug: string;
  readonly verdict: 'pass' | 'fail';
  readonly tierA: TierAResult;
  readonly tierB: TierBResult;
  readonly tierC: TierCResult;
}

export interface EvalRunReport {
  readonly schemaVersion: number;
  readonly evalSet: {
    readonly setId: string;
    readonly visibility: EvalSetVisibility;
    readonly location: string;
  };
  readonly runnerVersion: string;
  readonly candidateLabel: string;
  /** Present only when at least one case ran Tier C (spec "Provenance is recorded"). */
  readonly rubricVersion?: string;
  /** Sorted by `case.caseId` — canonical ordering (spec "Run reports are canonical..."). */
  readonly cases: readonly CaseResult[];
  /** Wall-clock timing, deliberately OUTSIDE the diffable body. */
  readonly timings: {
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly durationMs: number;
  };
}
