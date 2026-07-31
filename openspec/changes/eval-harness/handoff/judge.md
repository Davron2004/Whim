# Handoff: judge (chain-D → chain-E, chain-F)

Everything below is implemented in `evals/rubric/index.ts`, `evals/judge/*.ts`, `evals/tiers/tier-c.ts`.
`JudgeVerdict`/`TierCResult`/`TierCSkipReason`/`RunObservation` are pinned in `handoff/eval-contract.md` —
import from `evals/contract.ts`, never redeclare.

## Rubric — `evals/rubric/index.ts`
```ts
export const RUBRIC_VERSION = 'v1';
export const RUBRIC_DOCUMENT_PATH = 'evals/rubric/v1.md'; // repo-root-relative
export interface RubricCriterion { readonly id: string; readonly label: string; readonly minScore: number; readonly maxScore: number; }
export const RUBRIC_CRITERIA: readonly RubricCriterion[]; // closed list: intent-fidelity, usability, robustness, polish (all 1–5)
export const RUBRIC_CRITERION_IDS: readonly string[];
export const SCORED_SECTION_START_MARKER = '<!-- rubric-scored-content:start -->';
export const SCORED_SECTION_END_MARKER = '<!-- rubric-scored-content:end -->';
export function extractScoredSection(rubricMarkdown: string): string; // throws if markers missing/out of order
export function hashScoredSection(scoredContent: string): string; // sha256 hex
export const RUBRIC_CONTENT_HASH: string; // checked in against v1.md's CURRENT scored section
```
A rubric edit that changes the scored section's text MUST bump `RUBRIC_VERSION` (a new
`evals/rubric/v2.md` + `RUBRIC_DOCUMENT_PATH` update) and recompute `RUBRIC_CONTENT_HASH`, or
`evals/test/tier-c.test.ts`'s drift check fails, naming the version that must be bumped.

## `Judge` — `evals/judge/judge.ts` (barrel: `evals/judge/index.ts`)
```ts
export interface JudgeInput {
  readonly caseId: string; readonly prompt: string;
  readonly expectation?: string; readonly candidateSource?: string;
  readonly observation: RunObservation;
}
export interface Judge { score(input: JudgeInput): Promise<JudgeVerdict>; }
```
A `Judge` may return a MALFORMED `JudgeVerdict` (missing criterion, missing rationale, out-of-range
score, duplicate/unknown criterion name) — validating it is `evaluateTierC`'s job, never the judge's.

### `createScriptedJudge(map)` — `evals/judge/scripted.ts`
`map: Readonly<Record<string, JudgeVerdict>>`, keyed on `caseId`. `score` throws
`Error` naming the case id when `caseId` has no entry. Fully offline.

### `createReplayJudge(dir)` — `evals/judge/replay.ts`
Reads `<dir>/<caseId>__<RUBRIC_VERSION>.json` (`replayFileName(caseId, rubricVersion): string`),
parses it as a `JudgeVerdict`. `score` throws naming the case id + rubric version when the file is
absent, or naming the JSON error when the file is unparsable. Fully offline (`node:fs` only).
Fixtures: `evals/test/fixtures/judge/*.json`.

### `createLiveJudge(options)` — `evals/judge/live.ts`
```ts
export const LIVE_JUDGE_CREDENTIAL_ENV_VAR = 'OPENROUTER_API_KEY';
export interface LiveJudgeOptions { readonly model: string; readonly optIn: boolean; }
export function createLiveJudge(options: LiveJudgeOptions): Judge; // synchronous, throws
```
Throws SYNCHRONOUSLY, before any I/O: first if `optIn !== true` (message includes `"opt-in"`), then
if `process.env.OPENROUTER_API_KEY` is unset/empty (message includes
`LIVE_JUDGE_CREDENTIAL_ENV_VAR`). Never constructs `OpenRouterClient` during construction — only
`score()` does, and only on first call (cached per process). **Never statically imports
`server/src/openrouter.ts`**: that file needs Node's WHATWG-streaming globals, which conflict with
the root RN tsconfig's react-native-flavored `fetch`/`Response`/`TextDecoder` — a static import
(even type-only) breaks `npm run typecheck`. Instead `score()` shells out to the `esbuild` CLI
binary (`node_modules/.bin/esbuild`, via `node:child_process`'s `execFileSync` — never esbuild's JS
API, which would itself break `evals/test/run.mjs`'s bundling with a "dynamic require of fs" crash)
to bundle `server/src/openrouter.ts` into a throwaway `.mjs`, dynamically imports it, and deletes
it. This path is NEVER reached by the gate or the acceptance suite — only by a human-invoked run
with both opt-in and a real credential.

## Tier C — `evals/tiers/tier-c.ts`
```ts
export interface TierCInput {
  readonly caseId: string; readonly prompt: string;
  readonly expectation?: string; readonly candidateSource?: string;
  readonly observation: RunObservation;
  readonly tierAFailed: boolean;   // caller (chain-E) passes Tier A's own status
  readonly judge: Judge | undefined; // undefined => no_judge_configured
}
export async function evaluateTierC(input: TierCInput): Promise<TierCResult>;
```
Never throws. Order of checks: `tierAFailed` → `{status:'skipped', reason:'tier_a_failed'}`;
no `judge` → `{status:'skipped', reason:'no_judge_configured'}`; `judge.score()` throws →
`{status:'error', message}` (message includes the underlying error text); verdict fails
`findVerdictDefect` (below) → `{status:'error', message}`; else `{status:'scored', verdict}`
(verdict returned VERBATIM — it already carries `rubricVersion` + `judgeIdentity`).

**Verdict validation (`findVerdictDefect`, not exported — behavior only)**, checked against
`RUBRIC_CRITERIA`: a criterion scored more than once; a required criterion (by `RUBRIC_CRITERIA`
id) absent from `verdict.criteria`; a `criterion` name outside `RUBRIC_CRITERIA`; a
`rationale` that is empty/whitespace-only; a `score` outside that criterion's
`minScore`–`maxScore` (inclusive) or non-numeric/`NaN`. Any one of these is a Tier-C `error`
naming the specific defect and the criterion id — never a `scored` result.

## Deviation from the literal task text (see chain-D's final report for full detail)
Task 4.3 says the live judge "wraps `OpenRouterClient`" — it does, but NOT via a static TS
import (breaks root typecheck; see `createLiveJudge` above). Chain-E/F consuming this contract
should treat `createLiveJudge`'s `score()` as doing real, opaque I/O (subprocess + dynamic
import) — nothing about its PUBLIC shape (`Judge`) differs from the scripted/replay judges.
