/**
 * The ONE redaction entry point (design D3, `handoff/eval-contract.md`). Report construction
 * (chain-E) calls `redactCase` instead of ever placing raw prompt/expectation/candidate-source
 * text onto a `CaseResult` for a holdout set. Redaction happens here, at construction, so
 * `diff`/`compare`/the Markdown summary/console output all inherit it — there is no unredacted
 * object downstream for a future output path to leak.
 */
import { createHash } from 'node:crypto';
import type { EvalSetVisibility } from './contract';

export interface RedactableCaseFields {
  readonly caseId: string;
  readonly prompt: string;
  readonly expectation?: string;
  readonly candidateSource?: string;
}

/** Matches `CaseResult['case']` in `evals/contract.ts` verbatim. */
export interface RedactedCaseFields {
  readonly caseId: string;
  readonly promptSha256: string;
  readonly prompt?: string;
  readonly expectation?: string;
  readonly candidateSource?: string;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * For `visibility === 'holdout'`, returns ONLY `caseId` + `promptSha256` — `prompt`,
 * `expectation`, and `candidateSource` are never present on the result (not even as `undefined`
 * keys with empty values). For `visibility === 'visible'`, all fields pass through verbatim.
 */
export function redactCase(input: RedactableCaseFields, visibility: EvalSetVisibility): RedactedCaseFields {
  const promptSha256 = sha256Hex(input.prompt);
  if (visibility === 'holdout') {
    return { caseId: input.caseId, promptSha256 };
  }
  return {
    caseId: input.caseId,
    promptSha256,
    prompt: input.prompt,
    expectation: input.expectation,
    candidateSource: input.candidateSource,
  };
}
