# Handoff: eval-contract (chain-A → B, C, D, E, F)

Everything below is implemented in `evals/contract.ts`, `evals/corpus.ts`, `evals/eval-set.ts`,
`evals/redact.ts` — import from there, do not redeclare. `Diagnostic`/`DiagnosticKind` are
re-exported type-only from `evals/contract.ts` (sourced from `checks/contract.ts` — never edit
that file, never mint a new diagnostic kind).

## ASSERTION_KINDS (closed, additive-only)
```ts
export const ASSERTION_KINDS = [
  'screen-reachable', 'syscall-invoked', 'cue-invoked',
  'diagnostic-present', 'renders-without-error', 'storage-roundtrip',
] as const;
export type AssertionKind = (typeof ASSERTION_KINDS)[number];
export interface EvalAssertion {
  readonly english: string;      // mandatory, verbatim into failure output
  readonly kind: AssertionKind;
  readonly target?: string;      // screen/syscall/cue/diagnostic-kind name; absent for renders-without-error
  readonly expected?: boolean;   // presence (true, default) vs absence (false)
}
```

## RunObservation — the ONE normalized shape every tier reads (only chain-B's adapter builds one)
```ts
export interface ContainmentVerdict {
  readonly authenticated: boolean;   // true ONLY from the nonce-authenticated vantage (F4)
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
```

## Tier results
```ts
export type TierBSkipReason = 'tier_a_failed';
export type TierCSkipReason = 'tier_a_failed' | 'no_judge_configured';
export interface TierAResult {   // Tier A always runs — no skipped variant
  readonly status: 'pass' | 'fail';
  readonly diagnostics: readonly Diagnostic[];
  readonly containment: ContainmentVerdict;
}
export interface TierBAssertionResult {
  readonly english: string; readonly kind: AssertionKind;
  readonly status: 'pass' | 'fail'; readonly observed: unknown;  // never a bare boolean
}
export type TierBResult =
  | { readonly status: 'skipped'; readonly reason: TierBSkipReason }
  | { readonly status: 'evaluated'; readonly assertions: readonly TierBAssertionResult[] };
export interface JudgeCriterionScore { readonly criterion: string; readonly score: number; readonly rationale: string; }
export interface JudgeVerdict {
  readonly rubricVersion: string; readonly judgeIdentity: string;
  readonly criteria: readonly JudgeCriterionScore[];
}
export type TierCResult =        // Tier C never gates the case verdict
  | { readonly status: 'skipped'; readonly reason: TierCSkipReason }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'scored'; readonly verdict: JudgeVerdict };
```

## EvalRunReport
`EVAL_REPORT_SCHEMA_VERSION = 1`. `CaseResult.case` is ALREADY redacted — no unredacted case
object exists on this type. `cases` sorted by `case.caseId`; `timings` sits outside the diffable body.
```ts
export interface CaseResult {
  readonly case: { readonly caseId: string; readonly promptSha256: string;
    readonly prompt?: string; readonly expectation?: string; readonly candidateSource?: string };
  readonly appSlug: string; readonly verdict: 'pass' | 'fail';
  readonly tierA: TierAResult; readonly tierB: TierBResult; readonly tierC: TierCResult;
}
export interface EvalRunReport {
  readonly schemaVersion: number;
  readonly evalSet: { readonly setId: string; readonly visibility: EvalSetVisibility; readonly location: string };
  readonly runnerVersion: string; readonly candidateLabel: string; readonly rubricVersion?: string;
  readonly cases: readonly CaseResult[];
  readonly timings: { readonly startedAt: string; readonly finishedAt: string; readonly durationMs: number };
}
```

## Redaction entry point (design D3) — `evals/redact.ts`
```ts
export function redactCase(
  input: { caseId: string; prompt: string; expectation?: string; candidateSource?: string },
  visibility: EvalSetVisibility,
): { caseId: string; promptSha256: string; prompt?: string; expectation?: string; candidateSource?: string };
export function sha256Hex(text: string): string;
```
For `holdout`, the return carries ONLY `caseId` + `promptSha256`, no other key. Chain-E MUST
build every `CaseResult.case` through this function, never by hand.

## Eval-set loader — `evals/eval-set.ts`
```ts
export const EVAL_SET_FLAG = '--eval-set';
export const EVAL_SET_ENV_VAR = 'WHIM_EVAL_SET';
export class EvalSetError extends Error {}
export function resolveEvalSetLocation(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): string; // throws, no default, no network
export function loadEvalSet(location: string): EvalSetManifest; // reads <location>/manifest.json, validates fully
```
`evals/corpus.ts` exports `TIER0_SLUGS: readonly string[]` and `isKnownCorpusSlug(slug): boolean`.
No `evals/sets/holdout/` exists or should ever exist (D2 — the absence is load-bearing).

## Suite auto-discovery convention (D14)
`evals/test/run.mjs` globs `evals/test/*.test.ts`, generates an in-memory esbuild entry
importing each (each file runs its own `check`/`eq` calls from `./harness.ts` as a module-load
side effect), then calls `report()` once. **No registry file — add a `*.test.ts` file and it
runs.** Not wired to `npm run` yet; run `node evals/test/run.mjs` directly plus `./scripts/gate.sh`
until chain-G is applied.

**Gotcha every new `*.test.ts` file needs:** `sonarjs/no-empty-test-file` fires on files with no
jest-shaped `it()`/`test()` calls. A directive comment can't cover it (reports at line 0) — use
this configuration comment right after the header JSDoc, before the first import:
```ts
/* eslint sonarjs/no-empty-test-file: "off" -- house tally idiom (`check`/`eq`), not a jest-shaped test file. */
```
