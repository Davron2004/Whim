/**
 * The shell copy's glossary lint (system.md §8; app-launcher "Shell copy has one name per
 * concept"), one source for the `COPY` table's lint by key (`design-system.suite.ts`) and the
 * lines `copy.ts` composes, by function (`src/host/launcher/test/product-verbs.suite.ts`).
 */
import type { COPY_KINDS } from '../../../src/host/launcher/copy';

/** Who speaks in a line: `copy.ts#COPY_KINDS`'s kinds. */
export type CopyKind = (typeof COPY_KINDS)[keyof typeof COPY_KINDS];

/** The retired words, each with the pattern that finds it, prefixed forms too ("Rebuild it",
 *  "Regenerate"). */
export const RETIRED_WORDS: readonly (readonly [string, RegExp])[] = [
  ['mini-app', /\bmini[- ]?apps?\b/i],
  ['build', /buil(?:d|ds|ding|t)\b/i],
  ['generate', /generat/i],
  ['fork', /fork/i],
  ['snapshot', /snapshots?\b/i],
  ['restore', /restor/i],
  ['revert', /revert/i],
  ['Prompt again', /\bprompt again\b/i],
];

/** Whim's first person: any "I" on a control, and on a person's control the maker's contractions. */
export const FIRST_PERSON = /\bI\b/;
const MAKER_CONTRACTION = /\bI[’'](?:ll|m|ve|d)\b/;

/** What is wrong with the line `text` of `kind`, named `name`: each retired word it says, and
 *  Whim's "I" on a control. A line of no kind is checked for retired words only. */
export function lineFindings(name: string, text: string, kind: CopyKind | undefined): string[] {
  const findings = RETIRED_WORDS.filter(([, word]) => word.test(text)).map(([word]) => `${name}: retired word "${word}" in "${text}"`);
  if (kind === 'control' && FIRST_PERSON.test(text)) findings.push(`${name}: Whim's "I" on a control: "${text}"`);
  if (kind === 'person' && MAKER_CONTRACTION.test(text)) findings.push(`${name}: Whim's "I" on a control: "${text}"`);
  return findings;
}
