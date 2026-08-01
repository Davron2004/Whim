/**
 * The Tier-C rubric (design D7/D8, `handoff/judge.md`). The English document lives at
 * `evals/rubric/v1.md`; this module is its executable face — the version identifier, the closed
 * criteria table `evals/tiers/tier-c.ts` validates a `JudgeVerdict` against, and a checked-in
 * hash of the document's scored section so an edit to the criteria without a version bump is
 * red-checkable (`evals/test/tier-c.test.ts`), never a source-grep test.
 */
import { createHash } from 'node:crypto';

export const RUBRIC_VERSION = 'v1';

/** Path (relative to the repo root) of the English rubric document this version's hash covers. */
export const RUBRIC_DOCUMENT_PATH = 'evals/rubric/v1.md';

export interface RubricCriterion {
  /** Stable id — the exact string a `JudgeCriterionScore.criterion` must match. */
  readonly id: string;
  /** Human-readable label, for messages only — never a case/lookup key. */
  readonly label: string;
  readonly minScore: number;
  readonly maxScore: number;
}

/** Closed list (design D8) — additive-only, and never edited without bumping `RUBRIC_VERSION`
 *  and `RUBRIC_CONTENT_HASH` together. Mirrors `v1.md`'s scored table verbatim. */
export const RUBRIC_CRITERIA: readonly RubricCriterion[] = [
  { id: 'intent-fidelity', label: 'Intent fidelity', minScore: 1, maxScore: 5 },
  { id: 'usability', label: 'Usability', minScore: 1, maxScore: 5 },
  { id: 'robustness', label: 'Robustness', minScore: 1, maxScore: 5 },
  { id: 'polish', label: 'Polish', minScore: 1, maxScore: 5 },
];

/** Markers delimiting the scored section inside `v1.md` — everything strictly between them
 *  (trimmed) is what `RUBRIC_CONTENT_HASH` covers. */
export const SCORED_SECTION_START_MARKER = '<!-- rubric-scored-content:start -->';
export const SCORED_SECTION_END_MARKER = '<!-- rubric-scored-content:end -->';

/** Extracts the scored section from the rubric document's full Markdown text. Throws if the
 *  markers are missing or out of order — a document that lost its markers can't be hashed. */
export function extractScoredSection(rubricMarkdown: string): string {
  const startIdx = rubricMarkdown.indexOf(SCORED_SECTION_START_MARKER);
  const endIdx = rubricMarkdown.indexOf(SCORED_SECTION_END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `${RUBRIC_DOCUMENT_PATH} is missing the scored-section markers ` +
        `(${SCORED_SECTION_START_MARKER} / ${SCORED_SECTION_END_MARKER}).`,
    );
  }
  return rubricMarkdown.slice(startIdx + SCORED_SECTION_START_MARKER.length, endIdx).trim();
}

export function hashScoredSection(scoredContent: string): string {
  return createHash('sha256').update(scoredContent, 'utf8').digest('hex');
}

/**
 * Checked in against `v1.md`'s CURRENT scored section (task 4.1). `evals/test/tier-c.test.ts`
 * reads the document, extracts the scored section, hashes it, and compares against this
 * constant — an edit to the scored content that doesn't update this hash (and `RUBRIC_VERSION`)
 * fails that suite, naming the version that must be bumped (design D8).
 */
export const RUBRIC_CONTENT_HASH = '8969c513dbd05f33c6bd0f014de8462ffff2f0c55f09f4e6b87ec9af131c8693';
