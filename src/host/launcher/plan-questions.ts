/**
 * plan-questions — the plan page's question rows, as decisions (design-system-v1 task 16.4; spec
 * `prompt-flow` "The plan page shows the questions and the plan together"; `system.md` §7.1
 * Question row): what a question reads as once it is answered, and when an answered question that
 * has been scrolled past folds to one line.
 *
 * No React Native import — this module must load under the Node acceptance suite.
 */
import type { FlowAnswer, FlowQuestion } from './prompt-flow';

/** Whether the person has answered a question themselves: anything but the starting "Decide for me". */
export function isAnswered(answer: FlowAnswer | undefined): boolean {
  return answer !== undefined && !answer.decide;
}

/** An answered question as one line: the picks in the order the question lists them, then the typed
 *  answer, joined with a middle dot ("Brewer · V60"). */
export function answerSummary(question: FlowQuestion, answer: FlowAnswer): string {
  const picks = question.options.filter((option) => answer.choices.includes(option));
  const typed = answer.other.trim();
  return [...picks, ...(typed === '' ? [] : [typed])].join(' · ');
}

/** Where a question's block sits in the scroll content. */
export interface BlockExtent {
  readonly y: number;
  readonly height: number;
}

/** Whether a block has scrolled wholly out of view above a scroll view at `offset`. */
export function scrolledPast(offset: number, block: BlockExtent): boolean {
  return offset >= block.y + block.height;
}

/**
 * The questions that fold to one line at this scroll `offset`: those already folded stay folded
 * until they are tapped open, and an answered one joins them when it scrolls past. Returns the
 * same set when nothing changes, so the page sets no state while scrolling.
 */
export function foldedAt(
  folded: ReadonlySet<string>,
  offset: number,
  extents: Readonly<Record<string, BlockExtent>>,
  answers: Readonly<Record<string, FlowAnswer>>,
): ReadonlySet<string> {
  const joining = Object.keys(extents).filter(
    (id) => !folded.has(id) && isAnswered(answers[id]) && scrolledPast(offset, extents[id]),
  );
  return joining.length === 0 ? folded : new Set([...folded, ...joining]);
}
