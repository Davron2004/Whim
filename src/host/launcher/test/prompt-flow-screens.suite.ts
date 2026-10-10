/**
 * Prompt-flow pages (design-system-v1 tasks 16.1, 16.3-16.5) — the page machine of the making sheet.
 *
 * The transitions themselves are BEHAVIOURAL here: `prompt-flow.ts` is the pure machine behind
 * describe → plan → making → ready, so every scenario in `specs/prompt-flow/spec.md` that is about
 * "which page comes next, carrying what" is exercised by calling it. The pages themselves are
 * rendered in `flow-screens-ui.suite.tsx` and, inside the shell, in `prompt-flow-ui.suite.tsx`.
 */

import { Harness } from './harness';
import { COPY, composerContinueLine, composeHeadline, composePlaceholder, planHeadline, planMakeHeader } from '../copy';
import { GenerationClientError } from '../transport-shared';
import {
  OTHER_ANSWER_MAX_CHARS,
  acceptClarifyQuestions,
  answerAfter,
  backToDescribe,
  buildProgressFraction,
  buildProgressView,
  buildStepStatuses,
  clarificationsFrom,
  clarifyLimitOf,
  currentActionSentence,
  delegatedAnswers,
  describeStep,
  describeTextChanged,
  isClarifySkip,
  makingStep,
  missingRequest,
  pageKeyOf,
  planBackAction,
  planRowsFrom,
  planStep,
  promptForBuild,
  readyStep,
  retrying,
  showsChips,
  updatePlanRow,
  withAnswer,
  withDelivering,
  withLimit,
  withPlan,
  withProblem,
  withQuestions,
  withStage,
  withStreamEvent,
  workingLineText,
} from '../prompt-flow';
import type { AnswerChange, DescribeScreen, FlowNotice, FlowQuestion, PlanScreen } from '../prompt-flow';
import { FlowDrafts, NEW_APP_DRAFT_KEY, draftKey, draftPreview } from '../flow-draft';
import { foldedAt, answerSummary, isAnswered } from '../plan-questions';
import type { InstalledApp } from '../app-index';
import { CLARIFICATION_OTHER_MAX_CHARS, Clarification, type ClarifyQuestion, type GenerationEvent } from '@whim/contract';

/** A stand-in installed app: the machine only ever carries it through, never reads into it. */
const EDITED = { id: 'app-1', name: 'Pour Timer' } as unknown as InstalledApp;

const QUESTIONS: ClarifyQuestion[] = [
  { id: 'history', question: 'Should it remember past brews?', options: ['Keep a history', 'Just the last one'], select: 'one', other: false },
  { id: 'alert', question: 'How should it tell you a step is done?', options: ['Sound', 'Buzz', 'Both'], select: 'one', other: false },
];

/** A question that takes several picks and a typed answer. */
const EXTRAS: ClarifyQuestion = { id: 'extras', question: 'What goes in it?', options: ['Honey', 'Lemon', 'Milk'], select: 'many', other: true };

const pick = (option: string): AnswerChange => ({ kind: 'pick', option });
const type = (text: string): AnswerChange => ({ kind: 'type', text });
const DECIDE: AnswerChange = { kind: 'decide' };

function describedFlow(text = 'a timer for my pour-over'): DescribeScreen {
  return describeStep(EDITED, text);
}

/** The plan page with its questions landed (every one delegated) and its rows still coming. */
function askedFlow(questions: readonly ClarifyQuestion[] = QUESTIONS): PlanScreen {
  return withQuestions(planStep(describedFlow()), acceptClarifyQuestions(questions));
}

function plannedFlow(rows?: { label: string; text: string }[]): PlanScreen {
  return withPlan(askedFlow(), { rewrittenPrompt: 'a brew timer', ...(rows ? { plan: rows } : {}) });
}

/** A text-landing (`danger`-tone) refusal notice, the shape `content_policy`/`payload_too_large`
 *  produce — the case `describeTextChanged`/`updatePlanRow` clear on an edit. */
const DANGER_NOTICE: FlowNotice = { hint: 'That wording isn’t allowed.', tone: 'danger' };

/** A sender-landing (`neutral`-tone) refusal notice — unrelated to the words being retyped, so it
 *  survives an edit (design D12: "clears when its window ends or the user leaves the page"). */
const NEUTRAL_NOTICE: FlowNotice = { hint: 'Whim is busy right now.', tone: 'neutral' };

export async function runPromptFlowScreensTests(h: Harness): Promise<void> {
  // ── describe → plan ─────────────────────────────────────────────────────────────────────────

  await h.test('flow: Continue opens the plan page at once, loading, carrying the words verbatim and the change scope', () => {
    const plan = planStep(describedFlow('make me a dice roller'));
    h.eq(plan.kind, 'plan', 'the page after describe is plan');
    h.eq([plan.asking, plan.loading], [true, true], 'the questions and the rows are both still coming');
    h.eq(plan.text, 'make me a dice roller', 'the submitted words are carried verbatim, before any request resolves');
    h.eq([plan.questions, plan.rows, plan.answers], [[], [], {}], 'nothing is invented while they are');
    h.eq(plan.editing?.id, EDITED.id, 'the change scope is carried too');
  });

  await h.test('describeTextChanged: a danger-tone (text-landing) notice clears when the text changes', () => {
    const changed = describeTextChanged({ ...describedFlow(), notice: DANGER_NOTICE }, 'a gentler timer for my pour-over');
    h.eq(changed.text, 'a gentler timer for my pour-over', 'the text always updates');
    h.eq(changed.notice, undefined, 'the notice about the refused words is gone');
  });

  await h.test('describeTextChanged: a neutral-tone (sender-landing) notice survives a text change', () => {
    const changed = describeTextChanged({ ...describedFlow(), notice: NEUTRAL_NOTICE }, 'a gentler timer for my pour-over');
    h.eq(changed.notice, NEUTRAL_NOTICE, 'an availability/limit refusal is unrelated to what is being retyped');
  });

  await h.test('describeTextChanged: no notice at all is a plain text update', () => {
    h.eq(describeTextChanged(describedFlow(), 'something else entirely').notice, undefined, 'nothing is invented');
  });

  await h.test('flow: a clarify 502 means no questions, never a dead end', () => {
    h.ok(isClarifySkip(new GenerationClientError('http', { status: 502 })), 'a 502 skips the questions');
    h.ok(!isClarifySkip(new GenerationClientError('http', { status: 500 })), 'a 500 is a real failure');
    h.ok(!isClarifySkip(new GenerationClientError('network', {})), 'a network error is a real failure');
    h.ok(!isClarifySkip(new Error('boom')), 'an unrelated error is a real failure');
  });

  await h.test('flow: at most three questions reach the page, and an unpickable one is dropped', () => {
    const many: ClarifyQuestion[] = [
      { id: 'a', question: 'a?', options: ['1'], select: 'one', other: false },
      { id: 'b', question: 'b?', options: ['1'], select: 'one', other: false },
      { id: 'c', question: 'c?', options: ['1'], select: 'one', other: false },
      { id: 'd', question: 'd?', options: ['1'], select: 'one', other: false },
    ];
    h.eq(acceptClarifyQuestions(many).map((q) => q.id), ['a', 'b', 'c'], 'capped at three, in order');
    h.eq(acceptClarifyQuestions([{ id: 'x', question: 'x?', options: [], select: 'one', other: false }]), [], 'a question with nothing to pick is not a question');
    h.eq(acceptClarifyQuestions(undefined), [], 'an absent list is an empty one');
  });

  await h.test('flow: questions landing leaves loading for the rows alone, with every question delegated', () => {
    const asked = askedFlow();
    h.eq([asked.asking, asked.loading], [false, true], 'the questions are in; the rows are still coming');
    h.eq(asked.answers, delegatedAnswers(asked.questions), 'every question starts on Decide for me');
    h.eq(Object.values(asked.answers).every((a) => a.decide && a.choices.length === 0 && a.other === ''), true, 'with no pick and no typed text');
    h.eq(withQuestions(planStep(describedFlow()), []).answers, {}, 'a request with no questions has no answers');
  });

  await h.test('flow: a page waiting on a request says which one, and Try again asks for just that one', () => {
    const fresh = planStep(describedFlow());
    h.eq(missingRequest(fresh), 'clarify', 'nothing landed: the clarify exchange');
    h.eq(missingRequest(askedFlow()), 'rewrite', 'questions landed: the plan');
    h.eq(missingRequest(plannedFlow()), null, 'everything landed: nothing missing');
    const failed = withProblem(askedFlow(), { request: 'rewrite', reason: 'I couldn’t reach the server.' });
    h.eq([failed.loading, failed.asking, missingRequest(failed)], [false, false, null], 'a problem stops the wait; nothing resends by itself');
    const again = retrying(failed, 'rewrite');
    h.eq([again.loading, again.asking, again.problem, again.questions.length], [true, false, undefined, 2], 'Try again waits on the plan only, keeping the questions');
    h.eq(retrying(failed, 'clarify').asking, true, 'or on the questions');
  });

  // ── answers ─────────────────────────────────────────────────────────────────────────────────

  await h.test('answers: a select-one question keeps one pick — a second tap moves it, the same tap keeps it', () => {
    const first = withAnswer(askedFlow(), 'alert', pick('Sound'));
    h.eq(first.answers.alert?.choices, ['Sound'], 'the tapped option is picked');
    const second = withAnswer(first, 'alert', pick('Both'));
    h.eq(second.answers.alert?.choices, ['Both'], 'tapping another option moves the pick');
    const third = withAnswer(second, 'alert', pick('Both'));
    h.eq(third.answers.alert?.choices, ['Both'], 'tapping the picked option again keeps it');
    h.eq(withAnswer(third, 'alert', pick('Loud')).answers.alert, third.answers.alert, 'an option the question does not list changes nothing');
    h.eq(clarificationsFrom(third.questions, third.answers).filter((c) => c.id === 'alert').map((c) => c.choices), [['Both']], 'at most one choice is sent');
  });

  await h.test('answers: Decide for me is selected by default and exclusive both ways, in select-one and select-many', () => {
    const many = askedFlow([EXTRAS, QUESTIONS[1]]);
    h.eq(many.answers.extras?.decide, true, 'selected by default');
    const picked = withAnswer(many, 'extras', pick('Milk'));
    h.eq(picked.answers.extras, { choices: ['Milk'], other: '', decide: false }, 'picking another clears it');
    const decided = withAnswer(withAnswer(picked, 'extras', pick('Honey')), 'extras', DECIDE);
    h.eq(decided.answers.extras, { choices: [], other: '', decide: true }, 'picking it clears every pick');
    const typed = withAnswer(decided, 'extras', type('cinnamon'));
    h.eq(typed.answers.extras?.decide, false, 'typing an answer clears it too');
    h.eq(withAnswer(typed, 'extras', DECIDE).answers.extras, { choices: [], other: '', decide: true }, 'and it clears the typed answer');
    const one = withAnswer(withAnswer(many, 'alert', pick('Sound')), 'alert', DECIDE);
    h.eq(one.answers.alert, { choices: [], other: '', decide: true }, 'a select-one question follows the same rule');
  });

  await h.test('answers: taking every pick back falls back to Decide for me, never to no answer', () => {
    const withPick = withAnswer(askedFlow([EXTRAS]), 'extras', pick('Milk'));
    h.eq(withAnswer(withPick, 'extras', pick('Milk')).answers.extras, { choices: [], other: '', decide: true }, 'a toggled-off last pick delegates again');
    h.eq(withAnswer(withAnswer(withPick, 'extras', pick('Milk')), 'extras', type('  ')).answers.extras?.decide, true, 'and so does spaces-only typed text');
  });

  await h.test('answers: several picks toggle and are sent in the question’s order', () => {
    const many = askedFlow([EXTRAS]);
    const both = withAnswer(withAnswer(many, 'extras', pick('Milk')), 'extras', pick('Honey'));
    h.eq(clarificationsFrom(both.questions, both.answers), [{ id: 'extras', question: EXTRAS.question, choices: ['Honey', 'Milk'] }],
      'both picks are the question’s choices, in the order it lists them');
    const untoggled = withAnswer(both, 'extras', pick('Honey'));
    h.eq(clarificationsFrom(untoggled.questions, untoggled.answers).map((c) => c.choices), [['Milk']], 'a second tap takes a pick back');
  });

  await h.test('answers: a typed answer is sent trimmed as `other`, and it is capped', () => {
    const many = askedFlow([EXTRAS]);
    const typed = withAnswer(many, 'extras', type('  oat milk  '));
    h.eq(typed.answers.extras?.other, '  oat milk  ', 'the field holds exactly what was typed');
    h.eq(clarificationsFrom(typed.questions, typed.answers), [{ id: 'extras', question: EXTRAS.question, choices: [], other: 'oat milk' }],
      'the request carries it trimmed, as that question’s `other`');
    const long = withAnswer(many, 'extras', type('x'.repeat(OTHER_ANSWER_MAX_CHARS + 50)));
    h.eq(clarificationsFrom(long.questions, long.answers)[0]?.other?.length, CLARIFICATION_OTHER_MAX_CHARS, 'never longer than the contract allows');
    const noField = withAnswer(askedFlow(), 'alert', type('a whistle'));
    h.eq(noField.answers.alert, delegatedAnswers(noField.questions).alert, 'a question with no Other field takes no typed answer');
  });

  await h.test('answers: a select-one question holds one answer — typing clears its pick, picking clears the typed text; select-many keeps both', () => {
    const cup: ClarifyQuestion = { id: 'cup', question: 'What size is the cup?', options: ['Small', 'Large'], select: 'one', other: true };
    const one = askedFlow([cup, EXTRAS]);
    const typed = withAnswer(withAnswer(one, 'cup', pick('Large')), 'cup', type('a travel mug'));
    h.eq(typed.answers.cup, { choices: [], other: 'a travel mug', decide: false }, 'typing an answer clears the pick');
    const repicked = withAnswer(typed, 'cup', pick('Small'));
    h.eq(repicked.answers.cup, { choices: ['Small'], other: '', decide: false }, 'picking clears the typed answer');
    const both = withAnswer(withAnswer(one, 'extras', pick('Milk')), 'extras', type('cinnamon'));
    h.eq(clarificationsFrom(both.questions, both.answers).find((c) => c.id === 'extras'), { id: 'extras', question: EXTRAS.question, choices: ['Milk'], other: 'cinnamon' },
      'on select-many the pick and the typed answer are both sent');
  });

  await h.test('answers: an untouched page sends every question delegated, and every clarification is one the contract accepts', () => {
    const asked = askedFlow([EXTRAS, QUESTIONS[1]]);
    h.eq(clarificationsFrom(asked.questions, asked.answers), [
      { id: 'extras', question: EXTRAS.question, choices: [], decide: true },
      { id: 'alert', question: QUESTIONS[1].question, choices: [], decide: true },
    ], 'each question goes out as decide: true alone');
    const states = [
      asked,
      withAnswer(withAnswer(asked, 'extras', pick('Milk')), 'extras', type('  and cinnamon ')),
      withAnswer(asked, 'extras', type('x'.repeat(OTHER_ANSWER_MAX_CHARS))),
      withAnswer(withAnswer(asked, 'alert', pick('Sound')), 'alert', pick('Buzz')),
    ];
    for (const state of states) {
      for (const clarification of clarificationsFrom(state.questions, state.answers)) {
        h.ok(Clarification.safeParse(clarification).success, `${JSON.stringify(clarification)} parses as a contract Clarification`);
      }
    }
    h.eq(clarificationsFrom(asked.questions, {}), [], 'a question with no answer at all is left out');
  });

  await h.test('answers: the rewrite is always sent delegated, whatever has been answered', () => {
    const answered = withAnswer(askedFlow(), 'alert', pick('Both'));
    h.eq(clarificationsFrom(answered.questions, delegatedAnswers(answered.questions)).every((c) => c.decide === true), true, 'the rewrite never sees an answer');
    h.eq(clarificationsFrom(answered.questions, answered.answers).find((c) => c.id === 'alert')?.choices, ['Both'], 'while making carries it');
  });

  await h.test('questions: all-short options are chips; one option over 20 characters makes the whole question rows', () => {
    const q = (options: string[]): FlowQuestion => ({ id: 'q', question: 'q?', options, select: 'one', other: false });
    h.eq(showsChips(q(['Sound', 'Buzz'])), true, 'short options are chips');
    h.eq(showsChips(q(['x'.repeat(20)])), true, 'exactly 20 characters is still a chip');
    h.eq(showsChips(q(['x'.repeat(21)])), false, '21 is a row');
    h.eq(showsChips(q(['Short', 'Remember every brew, with my notes'])), false, 'a 34-character option makes the question rows, short siblings included');
  });

  await h.test('questions: an answer reads as one line, and only an answered question that has scrolled past folds', () => {
    const extras = acceptClarifyQuestions([EXTRAS])[0];
    h.eq(answerSummary(extras, { choices: ['Milk', 'Honey'], other: ' cinnamon ', decide: false }), 'Honey · Milk · cinnamon', 'picks in the question’s order, then the typed words');
    h.eq([isAnswered(undefined), isAnswered({ choices: [], other: '', decide: true }), isAnswered({ choices: ['Sound'], other: '', decide: false })], [false, false, true], 'Decide for me is not an answer');
    const answers = { history: { choices: ['Keep a history'], other: '', decide: false }, alert: { choices: [], other: '', decide: true } };
    const extents = { history: { y: 100, height: 80 }, alert: { y: 200, height: 80 } };
    const none: ReadonlySet<string> = new Set();
    h.eq([...foldedAt(none, 150, extents, answers)], [], 'still partly in view: nothing folds');
    h.eq([...foldedAt(none, 180, extents, answers)], ['history'], 'wholly above the viewport: it folds');
    h.eq([...foldedAt(none, 400, extents, answers)], ['history'], 'a delegated question never folds, however far past');
    const folded = new Set(['history']);
    h.ok(foldedAt(folded, 400, extents, answers) === folded, 'with nothing new to fold, the same set comes back and no state is set');
    h.eq([...foldedAt(folded, 0, extents, answers)], ['history'], 'a folded question stays folded until it is tapped open');
  });

  // ── can't make as asked ─────────────────────────────────────────────────────────────────────

  await h.test('limit: it replaces the questions and the plan, is plain words, and Change my idea is the way back with the words', () => {
    const limit = clarifyLimitOf({ limit: { reason: 'Mini-apps can’t fetch live weather.', alternative: 'a packing list you fill in yourself' } });
    h.eq(limit, { reason: 'Mini-apps can’t fetch live weather.', alternative: 'a packing list you fill in yourself' }, 'the limit is read off the response');
    h.eq(clarifyLimitOf({}), undefined, 'a response without one has none');
    const shown = withLimit(planStep(describedFlow()), limit!);
    h.eq([shown.asking, shown.loading, shown.questions, shown.answers, shown.limit], [false, false, [], {}, limit], 'the page leaves loading, with nothing to ask or make');
    h.eq(missingRequest(shown), null, 'and asks for nothing more');
    h.eq(backToDescribe(shown).text, shown.text, 'back is describe with the original words');
  });

  // ── the plan ────────────────────────────────────────────────────────────────────────────────

  await h.test('plan: the page goes live when its rows land', () => {
    const pending = askedFlow();
    h.eq(pending.loading, true, 'the rows are still coming');
    h.eq(pending.rows, [], 'nothing is invented while they are');
    const live = withPlan(pending, { rewrittenPrompt: 'a brew timer', plan: [{ label: 'What it is', text: 'A brew timer.' }] });
    h.eq(live.loading, false, 'the arrived response clears the loading state');
    h.eq(live.rewritten, 'a brew timer', 'the rewritten prompt is what making will be asked for');
  });

  await h.test('plan: an unstructured plan still renders as one approvable row', () => {
    h.eq(
      planRowsFrom({ rewrittenPrompt: 'a brew timer that walks you through the recipe' }),
      [{ label: '', text: 'a brew timer that walks you through the recipe' }],
      'no rows means one unlabelled row carrying the rewritten string',
    );
    h.eq(planRowsFrom({ rewrittenPrompt: 'x', plan: [] }), [{ label: '', text: 'x' }], 'an empty row list means the same thing');
    h.eq(
      planRowsFrom({ rewrittenPrompt: 'x', plan: [{ label: 'The screen', text: 'A big countdown.' }] }),
      [{ label: 'The screen', text: 'A big countdown.' }],
      'structured rows render one row per entry, with its label',
    );
  });

  await h.test('plan: editing a row inline replaces only that row, everything else intact', () => {
    const plan = plannedFlow([
      { label: 'The screen', text: 'A big countdown.' },
      { label: 'The alert', text: 'A buzz at zero.' },
    ]);
    const originalRowText = plan.rows[0].text; // captured BEFORE the call: a mutating implementation would move this too
    const edited = updatePlanRow(plan, 0, 'A big countdown with the recipe steps.');
    h.ok(edited !== plan, 'a new screen is returned, not the same object mutated in place');
    h.ok(edited.rows !== plan.rows, 'a new rows array is returned, not the same array mutated in place');
    h.eq(edited.kind, 'plan', 'still the plan page — nothing navigates away');
    h.eq(edited.rows[0], { label: 'The screen', text: 'A big countdown with the recipe steps.', edited: true }, 'the tapped row carries the new text and is marked Edited');
    h.eq(plan.rows[0].text, originalRowText, 'the original screen is untouched by the edit — pure, not in-place');
    h.eq(edited.rows[1], plan.rows[1], 'the sibling row is untouched');
    h.eq(edited.edited, true, 'the screen now knows a row was hand-edited');
    h.eq([edited.text, edited.answers, edited.questions, edited.rewritten, edited.editing?.id], [plan.text, plan.answers, plan.questions, plan.rewritten, EDITED.id],
      'the words, answers, questions, rewrite response and scope are carried through; promptForBuild decides which prompt wins');
  });

  await h.test('plan: editing a row keeps its identity by position, even with duplicate row text', () => {
    const plan = plannedFlow([
      { label: 'The screen', text: 'Same words.' },
      { label: 'The alert', text: 'Same words.' },
    ]);
    const edited = updatePlanRow(plan, 1, 'Now different.');
    h.eq(edited.rows[0].text, 'Same words.', 'the untouched row keeps its text even though it once matched the edited one');
    h.eq(edited.rows[1].text, 'Now different.', 'the row addressed by position is the one that changes');
  });

  await h.test('updatePlanRow: a danger-tone notice clears when a row is saved, a neutral one survives', () => {
    const rows = [{ label: '', text: 'a brew timer' }];
    h.eq(updatePlanRow({ ...plannedFlow(rows), notice: DANGER_NOTICE }, 0, 'a brew timer with a bell').notice, undefined, 'saving clears the notice about the refused words');
    h.eq(updatePlanRow({ ...plannedFlow(rows), notice: NEUTRAL_NOTICE }, 0, 'a brew timer with a bell').notice, NEUTRAL_NOTICE, 'an availability refusal is unrelated to the plan’s own words');
  });

  await h.test('prompt: an unedited plan’s build prompt is the rewrite’s string, byte for byte', () => {
    const odd = 'A brew timer.  \nWith  two spaces and a trailing newline\n';
    const plan = withPlan(askedFlow(), { rewrittenPrompt: odd, plan: [{ label: 'The screen', text: 'A big countdown.' }] });
    h.eq(plan.edited, false, 'nothing has been edited yet');
    h.ok(promptForBuild(plan) === odd, 'the build prompt is exactly the rewrite response’s prompt, not a rebuilt one');
    h.ok(makingStep(plan).rewritten === odd, 'and that is what making is asked for');
  });

  await h.test('prompt: once a row is hand-edited the build prompt is assembled from the rows, labelled, and stays so when the text is reverted', () => {
    const plan = plannedFlow([
      { label: 'The screen', text: 'A big countdown.' },
      { label: 'The alert', text: 'A buzz at zero.' },
    ]);
    const edited = updatePlanRow(plan, 1, 'A chime at zero.');
    h.eq(promptForBuild(edited), 'The screen: A big countdown.\nThe alert: A chime at zero.', 'every row is folded in, not just the edited one, each carrying its label');
    const reverted = updatePlanRow(edited, 1, 'A buzz at zero.');
    h.eq(reverted.edited, true, 'the edit flag is never cleared');
    h.eq(promptForBuild(reverted), 'The screen: A big countdown.\nThe alert: A buzz at zero.', 'a reverted row is assembled, not trusted back to the rewrite string');
    h.ok(promptForBuild(reverted) !== reverted.rewritten, 'so the build prompt no longer equals the rewrite response');
  });

  await h.test('prompt: a plan that arrives as one string is one row, and its edit assembles to exactly its own text', () => {
    const plan = plannedFlow();
    h.eq(plan.rows, [{ label: '', text: 'a brew timer' }], 'one row, identical to the rewrite response');
    h.eq(promptForBuild(updatePlanRow(plan, 0, 'a brew timer with a bell at the end')), 'a brew timer with a bell at the end', 'the lossless case: one unlabelled row assembles to just its text');
  });

  await h.test('flow: making starts from the plan and carries the answers with it', () => {
    const plan = withPlan(withAnswer(askedFlow(), 'alert', pick('Buzz')), { rewrittenPrompt: 'a brew timer' });
    const making = makingStep(plan);
    h.eq(making.kind, 'making', 'Make it moves to the making page');
    h.eq([making.stage, making.delivering, making.runId], [null, false, undefined], 'no stage has arrived yet, and the run has no journal id until its attempt exists');
    h.eq(making.rewritten, 'a brew timer', 'generation runs against the approved plan’s prompt');
    h.eq(making.text, plan.text, 'the user’s verbatim prompt is still carried, for the snapshot envelope');
    h.eq(clarificationsFrom(making.questions, making.answers).map((c) => [c.id, c.decide === true]), [['history', true], ['alert', false]], 'the answers reach generation, the delegated one as such');
  });

  await h.test('flow: the ready page carries the delivered app', () => {
    const ready = readyStep(makingStep(plannedFlow()), { id: 'app-9', name: 'Pour Timer' } as unknown as InstalledApp);
    h.eq(ready.kind, 'ready', 'delivery ends on the ready page');
    h.eq(ready.app.name, 'Pour Timer', 'the ready page shows the app that was just delivered');
  });

  // ── backward movement and the draft ─────────────────────────────────────────────────────────

  await h.test('back: the plan page returns to Describe with the words kept, and Continue comes back to the same plan while the words stand', () => {
    const plan = withAnswer(plannedFlow(), 'alert', pick('Sound'));
    const back = backToDescribe(plan);
    h.eq([back.kind, back.text, back.editing?.id], ['describe', plan.text, EDITED.id], 'describe, with the words and scope');
    h.ok(back.kept === plan, 'holding the plan page it came from, answers and all');
    h.ok(describeTextChanged(back, plan.text).kept === plan, 'the same words keep it');
    h.eq(describeTextChanged(back, `${plan.text} with a bell`).kept, undefined, 'new words drop it: that is a new idea');
  });

  await h.test('back: while a row is being edited, back cancels the edit instead of leaving', () => {
    h.eq(planBackAction(true), 'cancel-edit', 'mid-edit');
    h.eq(planBackAction(false), 'leave', 'otherwise');
  });

  await h.test('draft: one is kept per app and one for a new app; emptied words clear it; the composer shows the start of the words', () => {
    const drafts = new FlowDrafts();
    const other = { id: 'app-2', name: 'Other' } as unknown as InstalledApp;
    drafts.keep(describeStep(undefined, 'A timer for my pour-over brewing every morning'));
    drafts.keep(describeStep(EDITED, 'Add laps'));
    h.eq([drafts.get(NEW_APP_DRAFT_KEY)?.text, drafts.get(draftKey({ editing: EDITED }))?.text, drafts.get(draftKey({ editing: other }))], ['A timer for my pour-over brewing every morning', 'Add laps', undefined], 'each has its own');
    h.eq(drafts.composerWords(), 'A timer for my pour-over brewing every morning', 'the composer reads the new-app one');
    const plan = plannedFlow();
    drafts.keep({ ...plan, editing: undefined });
    h.eq(drafts.get(NEW_APP_DRAFT_KEY)?.kind, 'plan', 'closing on Plan keeps the plan page itself');
    drafts.keep(describeStep(undefined, '   '));
    h.eq(drafts.composerWords(), undefined, 'emptied words are no draft');
    drafts.clear(draftKey({ editing: EDITED }));
    h.eq(drafts.get(draftKey({ editing: EDITED })), undefined, 'Make it spends the draft');
    h.eq(draftPreview('A timer for my pour-over brewing every morning'), 'A timer for my pour-over…', 'cut at a word boundary with an ellipsis');
    h.eq(draftPreview('A dice roller'), 'A dice roller', 'short words are shown whole');
    h.eq(composerContinueLine(draftPreview('a\n  timer   for my pour-over brewing')), 'Continue “a timer for my pour-over…”', 'whitespace runs collapse into one line');
  });

  await h.test('keys: a draft page is keyed by its app, a run’s pages by the run’s own journal id, so two runs never share a page', () => {
    const first = { ...makingStep(plannedFlow()), runId: 'run-1' };
    const second = { ...makingStep(plannedFlow()), runId: 'run-2' };
    h.ok(pageKeyOf(first) !== pageKeyOf(second), 'two runs, two keys');
    h.eq(pageKeyOf(first), pageKeyOf({ kind: 'failure', journalId: 'run-1' }), 'a run’s making and failure pages share its key');
    h.eq(pageKeyOf(readyStep(first, { id: 'run-1' } as unknown as InstalledApp)), pageKeyOf(first), 'and its ready page, since the app takes the attempt’s id');
    h.ok(pageKeyOf(describeStep(undefined, 'x')) !== pageKeyOf(describeStep(EDITED, 'x')), 'a new app’s draft and an app’s change draft are different pages');
    h.eq(pageKeyOf(describedFlow()), pageKeyOf(plannedFlow()), 'describe and plan are the same draft');
  });

  await h.test('copy: change mode reads as changing on every page', () => {
    h.eq([composeHeadline(true), composeHeadline(false)], [COPY.composeHeadlineEdit, COPY.composeHeadline], 'the describe headline');
    h.eq([composePlaceholder(true), composePlaceholder(false)], [COPY.composePlaceholderEdit, COPY.homeComposerPlaceholder], 'the field placeholder');
    h.eq([planHeadline(true), planHeadline(false)], [COPY.planHeadlineEdit, COPY.planHeadline], 'the plan headline');
    h.eq([planMakeHeader(true), planMakeHeader(false)], [COPY.planMakeHeaderEdit, COPY.planMakeHeader], 'the plan section');
  });

  await h.test('answerAfter: an answer to an option the question does not list, or a typed answer to a question with no Other field, is left as it was', () => {
    const q = acceptClarifyQuestions(QUESTIONS)[0];
    const current = { choices: ['Keep a history'], other: '', decide: false };
    h.ok(answerAfter(q, current, pick('Nope')) === current, 'unlisted option');
    h.ok(answerAfter(q, current, type('hello')) === current, 'no Other field');
  });

  await h.test('WorkingLine: no clock suffix under 5s, the phrase alone; a clock past it', () => {
    const startedAt = 1_000_000;
    h.eq(workingLineText('Thinking about what to ask', startedAt, startedAt), 'Thinking about what to ask', 'at the very start, no clock');
    h.eq(workingLineText('Thinking about what to ask', startedAt, startedAt + 4_999), 'Thinking about what to ask', 'still no clock just under 5s');
    h.eq(workingLineText('Thinking about what to ask', startedAt, startedAt + 5_000), 'Thinking about what to ask · 0:05', 'the clock appears at exactly 5s');
    h.eq(workingLineText('Thinking about what to ask', startedAt, startedAt + 7_000), 'Thinking about what to ask · 0:07', 'and keeps advancing');
    h.eq(workingLineText('Writing the plan', startedAt, startedAt + 65_000), 'Writing the plan · 1:05', 'minutes read the same as elapsedLabel elsewhere');
  });

  // ── the making page's four named steps ───────────────────────────────────────────────────────

  await h.test('build: stage events drive the steps and passed steps stay passed', () => {
    h.eq(buildStepStatuses(null), ['active', 'todo', 'todo', 'todo'], 'an unstarted stream sits on the first step');
    h.eq(buildStepStatuses('generate'), ['passed', 'active', 'todo', 'todo'], 'writing the app: the step before it has passed');
    for (const stage of ['check', 'run', 'repair'] as const) {
      h.eq(buildStepStatuses(stage), ['passed', 'passed', 'active', 'todo'], `${stage} reads as checking it runs safely`);
    }
    h.eq(buildStepStatuses('run', true), ['passed', 'passed', 'passed', 'active'], 'delivery is the last named step');
  });

  await h.test('build: one plain-words sentence describes the current action', () => {
    h.eq(currentActionSentence(null), COPY.buildStepReading, 'the first sentence is the first step');
    h.eq(currentActionSentence('generate'), COPY.buildStepWriting, 'the sentence follows the live stage');
    h.eq(currentActionSentence('run', true), COPY.buildStepInstalling, 'delivery has its own sentence');
  });

  await h.test('build: the progress bar reports real stage progress and never fabricates 100%', () => {
    // A passed step is a full quarter, the live one a half quarter — so the bar tracks the same
    // stage events the named steps do, with nothing invented in between.
    const along = [
      buildProgressFraction(null, false),
      buildProgressFraction('generate', false),
      buildProgressFraction('check', false),
      buildProgressFraction('check', true),
    ];
    h.ok(along[0] > 0, 'an unstarted stream already shows it has begun');
    h.ok(along.every((v, i) => i === 0 || v > along[i - 1]), `each step moves the bar forward (${along.join(' → ')})`);
    for (const stage of ['plan', 'generate', 'check', 'run', 'repair'] as const) {
      h.eq(buildProgressFraction(stage, true), along[3], `delivering (${stage}) is the last step, wherever the stream was`);
    }
    for (const stage of [null, 'plan', 'generate', 'check', 'run', 'repair'] as const) {
      for (const delivering of [false, true]) {
        h.ok(buildProgressFraction(stage, delivering) < 1, `${stage}/${delivering} never reads as finished`);
      }
    }
  });

  await h.test('build: only stage and queued events change the screen’s state', () => {
    const build = makingStep(plannedFlow());
    h.eq(withStage(build, 'check').stage, 'check', 'a stage event lands');
    h.eq(withDelivering(build).delivering, true, 'delivery flips the last step on');
    h.eq(withStage(build, 'check').text, build.text, 'nothing else about the step moves');
    const token: GenerationEvent = { type: 'token', text: 'const x = 1;' };
    h.ok(withStreamEvent(build, token) === build, 'a token outside the line changes nothing');
  });

  await h.test('build: waiting behind two builds says the build is in line with 2 ahead, and no step is live', () => {
    const waiting = withStreamEvent(makingStep(plannedFlow()), { type: 'queued', position: 3 });
    h.eq(waiting.queuedPosition, 3, 'the place in line is held');
    const view = buildProgressView(waiting.stage, waiting.delivering, waiting.queuedPosition);
    h.ok(view.sentence.includes('2 builds ahead'), `the sentence counts the two builds ahead (got "${view.sentence}")`);
    h.eq(view.statuses, ['todo', 'todo', 'todo', 'todo'], 'nothing has started, so no step is live');
    h.eq(view.fraction, 0, 'and the bar claims no progress');
    const next = withStreamEvent(waiting, { type: 'queued', position: 1 });
    h.eq(buildProgressView(next.stage, next.delivering, next.queuedPosition).sentence, COPY.buildQueuedNext, 'at the front it says the build is next');
    const one = withStreamEvent(waiting, { type: 'queued', position: 2 });
    h.ok(buildProgressView(one.stage, one.delivering, one.queuedPosition).sentence.includes('1 build ahead'), 'one build ahead is counted in the singular');
  });

  await h.test('build: the first stage after queued events replaces the in-line message with normal progress', () => {
    const waiting = withStreamEvent(makingStep(plannedFlow()), { type: 'queued', position: 2 });
    const started = withStreamEvent(waiting, { type: 'stage', stage: 'plan', status: 'start' });
    h.eq(started.queuedPosition, undefined, 'the build is out of the line');
    h.eq(buildProgressView(started.stage, started.delivering, started.queuedPosition), {
      statuses: buildStepStatuses('plan'),
      fraction: buildProgressFraction('plan'),
      sentence: currentActionSentence('plan'),
    }, 'the screen reads the stage-driven progress');
    const ended = withStreamEvent(waiting, { type: 'failure', reason: 'Waited too long.', attempts: 0, diagnostics: [] });
    h.eq(ended.queuedPosition, undefined, 'any other event ends the waiting state too — in line only while the latest event is queued');
  });

}
