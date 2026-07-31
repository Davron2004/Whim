/**
 * The stable slug registry for the 11 Tier-0 corpus apps (design D11). Bound to
 * `docs/app-corpus.md`'s Tier-0 rows' `Slug` column — the two MUST agree; the acceptance suite's
 * "corpus registry drift" section (`evals/test/loader.test.ts`) fails naming any slug present on
 * only one side. Every `EvalCase.appSlug` must resolve against `TIER0_SLUGS`.
 */

export interface CorpusAppRow {
  /** Stable case key — never renamed once an eval case references it. */
  readonly slug: string;
  /** Prose name, matching (not byte-identical to) `docs/app-corpus.md`'s `App` column, for
   *  human-readable messages only — never a case key. */
  readonly name: string;
}

export const TIER0_CORPUS: readonly CorpusAppRow[] = [
  { slug: 'tip-splitter', name: 'tip splitter' },
  { slug: 'spending-tracker', name: 'spending tracker + graph' },
  { slug: 'habit-tracker', name: 'habit tracker w/ streaks' },
  { slug: 'water-counter', name: 'water / calorie counter' },
  { slug: 'workout-log', name: 'workout log' },
  { slug: 'flashcards', name: 'flashcards w/ spaced repetition' },
  { slug: 'score-keeper', name: 'board-game score keeper' },
  { slug: 'packing-checklist', name: 'packing checklist w/ templates' },
  { slug: 'recipe-box', name: 'recipe box' },
  { slug: 'tic-tac-toe', name: 'tic-tac-toe' },
  { slug: 'chore-rotation', name: 'chore rotation roulette' },
];

export const TIER0_SLUGS: readonly string[] = TIER0_CORPUS.map((row) => row.slug);

export function isKnownCorpusSlug(slug: string): boolean {
  return TIER0_SLUGS.includes(slug);
}
