/**
 * Prompt-flow screens (shell-redesign-v2, task D11) — the five-step machine of screen `2a`.
 *
 * The transitions themselves are BEHAVIOURAL here: `prompt-flow.ts` is the pure machine behind
 * compose → clarify → plan → build → done, so every scenario in `specs/prompt-flow/spec.md` that
 * is about "which step comes next, carrying what" is exercised by calling it. The step screens
 * themselves are rendered in `flow-screens-ui.suite.tsx` and, inside the shell, in
 * `prompt-flow-ui.suite.tsx`.
 */

import { Harness } from './harness';
import { COPY } from '../copy';
import { GenerationClientError } from '../transport-shared';
import {
  acceptClarifyQuestions,
  backFrom,
  buildProgressFraction,
  buildStep,
  buildStepStatuses,
  clarificationsFrom,
  clarifyStep,
  composeStep,
  composeTextChanged,
  currentActionSentence,
  doneStep,
  isClarifySkip,
  planRowsFrom,
  planStep,
  primaryActionLabel,
  promptForBuild,
  stepAfterClarifyExchange,
  updatePlanRow,
  withAnswer,
  withDelivering,
  withPlan,
  withQuestions,
  withStage,
  workingLineText,
} from '../prompt-flow';
import type { ClarifyScreen, ComposeScreen, FlowNotice, PlanScreen } from '../prompt-flow';
import type { InstalledApp } from '../app-index';
import type { ClarifyQuestion } from '@whim/contract';


/** A stand-in installed app: the machine only ever carries it through, never reads into it. */
const EDITED = { id: 'app-1', name: 'Pour Timer' } as unknown as InstalledApp;

const QUESTIONS: ClarifyQuestion[] = [
  { id: 'history', question: 'Should it remember past brews?', options: ['Keep a history', 'Just the last one'], select: 'one', other: false },
  { id: 'alert', question: 'How should it tell you a step is done?', options: ['Sound', 'Buzz', 'Both'], select: 'one', other: false },
];

function composedFlow(text = 'a timer for my pour-over'): ComposeScreen {
  return composeStep(EDITED, text);
}

function clarifiedFlow(): ClarifyScreen {
  return withQuestions(clarifyStep(composedFlow()), acceptClarifyQuestions(QUESTIONS));
}

function plannedFlow(rows?: { label: string; text: string }[]): PlanScreen {
  const pending = planStep(clarifiedFlow());
  return withPlan(pending, { rewrittenPrompt: 'a brew timer', ...(rows ? { plan: rows } : {}) });
}

/** A text-landing (`danger`-tone) refusal notice, the shape `content_policy`/`payload_too_large`
 *  produce — the case `composeTextChanged`/`updatePlanRow` clear on an edit. */
const DANGER_NOTICE: FlowNotice = { hint: 'That wording isn’t allowed.', tone: 'danger' };

/** A sender-landing (`neutral`-tone) refusal notice — unrelated to the words being retyped, so it
 *  survives an edit (design D12: "clears when its window ends or the user leaves the step"). */
const NEUTRAL_NOTICE: FlowNotice = { hint: 'Whim is busy right now.', tone: 'neutral' };

export async function runPromptFlowScreensTests(h: Harness): Promise<void> {
  // ── the five steps, in order ────────────────────────────────────────────────────────────────

  await h.test('flow: compose → clarify carries the user’s own words and asks nothing yet', () => {
    const clarify = withQuestions(clarifyStep(composedFlow('make me a dice roller')), acceptClarifyQuestions(QUESTIONS));
    h.eq(clarify.kind, 'clarify', 'the step after compose is clarify');
    h.eq(clarify.text, 'make me a dice roller', 'the submitted prompt is carried verbatim');
    h.eq(clarify.answers, {}, 'no question is answered for the user');
    h.eq(clarify.questions.length, 2, 'both questions reach the step');
  });

  await h.test('composeTextChanged: a danger-tone (text-landing) notice clears when the text changes', () => {
    const withNotice: ComposeScreen = { ...composedFlow(), notice: DANGER_NOTICE };
    const changed = composeTextChanged(withNotice, 'a gentler timer for my pour-over');
    h.eq(changed.text, 'a gentler timer for my pour-over', 'the text always updates');
    h.eq(changed.notice, undefined, 'the notice about the refused words is gone');
  });

  await h.test('composeTextChanged: a neutral-tone (sender-landing) notice survives a text change', () => {
    const withNotice: ComposeScreen = { ...composedFlow(), notice: NEUTRAL_NOTICE };
    const changed = composeTextChanged(withNotice, 'a gentler timer for my pour-over');
    h.eq(changed.notice, NEUTRAL_NOTICE, 'an availability/limit refusal is unrelated to what is being retyped');
  });

  await h.test('composeTextChanged: no notice at all is a plain text update', () => {
    const changed = composeTextChanged(composedFlow(), 'something else entirely');
    h.eq(changed.notice, undefined, 'nothing is invented');
  });

  await h.test('flow: the clarify step opens loading, carrying compose’s text and editing scope', () => {
    const loading = clarifyStep(composedFlow('a dice roller'));
    h.eq(loading.kind, 'clarify', 'still the clarify step');
    h.eq(loading.loading, true, 'the exchange has not answered yet');
    h.eq(loading.text, 'a dice roller', 'the submitted prompt is carried immediately, before any request resolves');
    h.eq(loading.questions, [], 'nothing is invented while the request is in flight');
    h.eq(loading.editing?.id, EDITED.id, 'the edit scope is carried too');
  });

  await h.test('flow: withQuestions fills a loading clarify step and clears loading', () => {
    const loading = clarifyStep(composedFlow());
    const filled = withQuestions(loading, acceptClarifyQuestions(QUESTIONS));
    h.eq(filled.loading, false, 'the wait is over');
    h.eq(filled.questions.length, 2, 'the real questions replace the empty placeholder');
    h.eq(filled.text, loading.text, 'nothing else about the step moves');
  });

  await h.test('flow: a compose continue with zero questions goes straight to the plan step, never an empty clarify', () => {
    // `stepAfterClarifyExchange` is the single source of truth `LauncherRoot.tsx#onComposeContinue`
    // reads: zero questions means the clarify screen the user is already looking at (loading) is
    // replaced by the plan step directly — never rendered with an empty question list.
    const loading = clarifyStep(composedFlow());
    h.eq(stepAfterClarifyExchange(acceptClarifyQuestions([])), 'plan', 'zero questions never opens the clarify step for real');
    const plan = planStep(loading);
    h.eq(plan.kind, 'plan', 'the loading clarify screen can seed the plan step directly');
    h.eq(plan.questions, [], 'with no questions to carry');
  });

  await h.test('flow: a clarify 502 means skip to the plan step, never a dead end', () => {
    h.ok(isClarifySkip(new GenerationClientError('http', { status: 502 })), 'a 502 skips to the plan');
    h.ok(!isClarifySkip(new GenerationClientError('http', { status: 500 })), 'a 500 is a real failure');
    h.ok(!isClarifySkip(new GenerationClientError('network', {})), 'a network error is a real failure');
    h.ok(!isClarifySkip(new Error('boom')), 'an unrelated error is a real failure');
  });

  await h.test('flow: at most three questions reach the step, and an unpickable one is dropped', () => {
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

  await h.test('flow: answering is single-select and never clears', () => {
    const first = withAnswer(clarifiedFlow(), 'alert', 'Sound');
    h.eq(first.answers.alert, 'Sound', 'the tapped option is set');
    const second = withAnswer(first, 'alert', 'Both');
    h.eq(second.answers.alert, 'Both', 'tapping another option replaces the answer');
    const third = withAnswer(second, 'alert', 'Both');
    h.eq(third.answers.alert, 'Both', 'tapping the selected option again never clears it');
  });

  await h.test('flow: only answered questions become clarifications, by value', () => {
    const answered = withAnswer(clarifiedFlow(), 'alert', 'Both');
    h.eq(
      clarificationsFrom(answered.questions, answered.answers),
      [{ id: 'alert', question: 'How should it tell you a step is done?', choices: ['Both'] }],
      'the answered question travels with its own text',
    );
    h.eq(clarificationsFrom(answered.questions, {}), [], 'skipping answers nothing');
  });

  await h.test('flow: the plan step opens under a skeleton and goes live when its rows land', () => {
    const pending = planStep(clarifiedFlow());
    h.eq(pending.loading, true, 'the rows are still coming');
    h.eq(pending.rows, [], 'nothing is invented while they are');
    // The primary action's WORDS never depend on being busy (`prompt-flow` "the clarify wait is a
    // screen, not a grey button") — only whether the screen is scoped to an edit moves the label;
    // `PrimaryAction`'s own disabled state is what changes while `pending.loading` is true.
    h.eq(primaryActionLabel('plan', false), COPY.planBuild, 'a new app reads Build it, loading or not');
    const live = withPlan(pending, { rewrittenPrompt: 'a brew timer', plan: [{ label: 'What it is', text: 'A brew timer.' }] });
    h.eq(live.loading, false, 'the arrived response clears the loading state');
    h.eq(live.rewritten, 'a brew timer', 'the rewritten prompt is what generation will be asked for');
  });

  await h.test('flow: an unstructured plan still renders as one approvable row', () => {
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

  await h.test('flow: editing a plan row inline replaces only that row, everything else intact', () => {
    const plan = plannedFlow([
      { label: 'The screen', text: 'A big countdown.' },
      { label: 'The alert', text: 'A buzz at zero.' },
    ]);
    const originalRowText = plan.rows[0].text; // captured BEFORE the call: a mutating implementation would move this too
    const edited = updatePlanRow(plan, 0, 'A big countdown with the recipe steps.');
    h.ok(edited !== plan, 'a new screen is returned, not the same object mutated in place');
    h.ok(edited.rows !== plan.rows, 'a new rows array is returned, not the same array mutated in place');
    h.eq(edited.kind, 'plan', 'still the plan step — nothing navigates away');
    h.eq(edited.rows[0].text, 'A big countdown with the recipe steps.', 'the tapped row carries the new text');
    h.eq(plan.rows[0].text, originalRowText, 'the original screen is untouched by the edit — pure, not in-place');
    h.eq(edited.rows[1], plan.rows[1], 'the sibling row is untouched');
    h.eq(edited.edited, true, 'the screen now knows a row was hand-edited');
    h.eq(edited.text, plan.text, 'the original prompt survives the edit');
    h.eq(edited.answers, plan.answers, 'the clarify answers survive the edit');
    h.eq(edited.questions, plan.questions, 'the clarify questions survive the edit');
    h.eq(edited.rewritten, plan.rewritten, 'the rewrite response itself is left alone — promptForBuild decides which one wins');
    h.eq(edited.editing?.id, EDITED.id, 'still scoped to the app being re-prompted');
  });

  await h.test('flow: editing a row keeps its identity by position, even with duplicate row text', () => {
    const plan = plannedFlow([
      { label: 'The screen', text: 'Same words.' },
      { label: 'The alert', text: 'Same words.' },
    ]);
    const edited = updatePlanRow(plan, 1, 'Now different.');
    h.eq(edited.rows[0].text, 'Same words.', 'the untouched row keeps its text even though it once matched the edited one');
    h.eq(edited.rows[1].text, 'Now different.', 'the row addressed by position is the one that changes');
    h.eq(edited.rows[0].label, 'The screen', 'labels are untouched too');
  });

  await h.test('updatePlanRow: a danger-tone (text-landing) notice clears when a row is saved', () => {
    const plan = { ...plannedFlow([{ label: '', text: 'a brew timer' }]), notice: DANGER_NOTICE };
    const edited = updatePlanRow(plan, 0, 'a brew timer with a bell at the end');
    h.eq(edited.notice, undefined, 'saving a row edit clears the notice about the refused words');
  });

  await h.test('updatePlanRow: a neutral-tone (sender-landing) notice survives a row save', () => {
    const plan = { ...plannedFlow([{ label: '', text: 'a brew timer' }]), notice: NEUTRAL_NOTICE };
    const edited = updatePlanRow(plan, 0, 'a brew timer with a bell at the end');
    h.eq(edited.notice, NEUTRAL_NOTICE, 'an availability/limit refusal is unrelated to the plan’s own words');
  });

  await h.test('flow: promptForBuild trusts the rewrite response until a row is hand-edited', () => {
    const plan = plannedFlow([{ label: '', text: 'a brew timer' }]);
    h.eq(plan.edited, false, 'nothing has been edited yet');
    h.eq(promptForBuild(plan), plan.rewritten, 'unedited, the build prompt is exactly the rewrite response’s prompt');

    const edited = updatePlanRow(plan, 0, 'a brew timer with a bell at the end');
    h.eq(
      promptForBuild(edited),
      'a brew timer with a bell at the end',
      'edited, the build prompt is assembled from the rows — here the single unlabelled row',
    );
  });

  await h.test('flow: promptForBuild assembles every row, labelled, once any one of them is edited', () => {
    const plan = plannedFlow([
      { label: 'The screen', text: 'A big countdown.' },
      { label: 'The alert', text: 'A buzz at zero.' },
    ]);
    const edited = updatePlanRow(plan, 1, 'A chime at zero.');
    h.eq(
      promptForBuild(edited),
      'The screen: A big countdown.\nThe alert: A chime at zero.',
      'every row is folded in, not just the edited one, each carrying its label',
    );
  });

  await h.test('flow: an unlabelled fallback row assembles to exactly its own edited text', () => {
    const plan = plannedFlow(); // no structured plan → planRowsFrom's single unlabelled row
    h.eq(plan.rows, [{ label: '', text: 'a brew timer' }], 'the fallback row starts identical to the rewrite response');
    const edited = updatePlanRow(plan, 0, 'a brew timer with a bell at the end');
    h.eq(promptForBuild(edited), 'a brew timer with a bell at the end', 'the lossless case: one unlabelled row assembles to just its text');
  });

  await h.test('flow: the build step starts from the plan and carries the answers with it', () => {
    const plan = withPlan(planStep(withAnswer(clarifiedFlow(), 'alert', 'Buzz')), { rewrittenPrompt: 'a brew timer' });
    const build = buildStep(plan);
    h.eq(build.kind, 'build', 'Build it moves to the build step');
    h.eq(build.stage, null, 'no stage has arrived yet');
    h.eq(build.delivering, false, 'nothing is being delivered yet');
    h.eq(build.rewritten, 'a brew timer', 'generation runs against the approved plan’s prompt');
    h.eq(build.text, plan.text, 'the user’s verbatim prompt is still carried, for the snapshot envelope');
    h.eq(clarificationsFrom(build.questions, build.answers).length, 1, 'the clarify answers reach generation');
  });

  await h.test('flow: an edited plan carries the assembled rows into the build step, not the stale rewrite', () => {
    const plan = plannedFlow([
      { label: 'The screen', text: 'A big countdown.' },
      { label: 'The alert', text: 'A buzz at zero.' },
    ]);
    const edited = updatePlanRow(plan, 0, 'A big countdown with the recipe steps.');
    const build = buildStep(edited);
    h.eq(
      build.rewritten,
      'The screen: A big countdown with the recipe steps.\nThe alert: A buzz at zero.',
      'generation runs against the edited plan, with the edit actually reflected',
    );
  });

  await h.test('flow: the done step carries the delivered app', () => {
    const done = doneStep(buildStep(plannedFlow()), { id: 'app-9', name: 'Pour Timer' } as unknown as InstalledApp);
    h.eq(done.kind, 'done', 'delivery ends on the done step');
    h.eq(done.app.name, 'Pour Timer', 'the done step shows the app that was just delivered');
  });

  // ── backward movement ───────────────────────────────────────────────────────────────────────

  await h.test('flow: back is immediate and lossless at every step', () => {
    h.eq(backFrom(composedFlow()), 'home', 'back from compose is the home grid');

    const clarify = withAnswer(clarifiedFlow(), 'alert', 'Sound');
    const toCompose = backFrom(clarify);
    h.eq(toCompose && typeof toCompose === 'object' ? toCompose.kind : toCompose, 'compose', 'back from clarify is compose');
    h.eq(
      toCompose && typeof toCompose === 'object' && toCompose.kind === 'compose' ? toCompose.text : null,
      clarify.text,
      'the prompt survives the back move',
    );

    const plan = withPlan(planStep(clarify), { rewrittenPrompt: 'a brew timer' });
    const toClarify = backFrom(plan);
    h.eq(toClarify && typeof toClarify === 'object' ? toClarify.kind : toClarify, 'clarify', 'back from plan is clarify');
    h.eq(
      toClarify && typeof toClarify === 'object' && toClarify.kind === 'clarify' ? toClarify.answers : null,
      { alert: 'Sound' },
      'the answers survive the back move',
    );
  });

  await h.test('flow: with clarify skipped, back from plan lands on compose', () => {
    const plan = withPlan(planStep(composedFlow()), { rewrittenPrompt: 'a brew timer' });
    const target = backFrom(plan);
    h.eq(target && typeof target === 'object' ? target.kind : target, 'compose', 'no questions were asked, so compose is the step before');
  });

  await h.test('flow: build and done have no back move of their own', () => {
    h.eq(backFrom(buildStep(plannedFlow())), null, 'the build step is not backed out of');
    h.eq(backFrom(doneStep(buildStep(plannedFlow()), EDITED)), null, 'the done step is not backed out of');
  });

  // ── the primary action ──────────────────────────────────────────────────────────────────────

  await h.test('WorkingLine: no clock suffix under 5s, the phrase alone; a clock past it', () => {
    const startedAt = 1_000_000;
    h.eq(workingLineText('Thinking about what to ask', startedAt, startedAt), 'Thinking about what to ask', 'at the very start, no clock');
    h.eq(workingLineText('Thinking about what to ask', startedAt, startedAt + 4_999), 'Thinking about what to ask', 'still no clock just under 5s');
    h.eq(workingLineText('Thinking about what to ask', startedAt, startedAt + 5_000), 'Thinking about what to ask · 0:05', 'the clock appears at exactly 5s');
    h.eq(workingLineText('Thinking about what to ask', startedAt, startedAt + 7_000), 'Thinking about what to ask · 0:07', 'and keeps advancing');
    h.eq(workingLineText('Writing the plan', startedAt, startedAt + 65_000), 'Writing the plan · 1:05', 'minutes read the same as elapsedLabel elsewhere');
  });

  // ── the build step's four named steps ───────────────────────────────────────────────────────

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

  await h.test('build: only a stage event ever changes the screen’s state', () => {
    const build = buildStep(plannedFlow());
    h.eq(withStage(build, 'check').stage, 'check', 'a stage event lands');
    h.eq(withDelivering(build).delivering, true, 'delivery flips the last step on');
    h.eq(withStage(build, 'check').text, build.text, 'nothing else about the step moves');
  });

}
