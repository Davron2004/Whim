/**
 * Prompt-flow screens (shell-redesign-v2, task D11) — the five-step machine of screen `2a`.
 *
 * The transitions themselves are BEHAVIOURAL here: `prompt-flow.ts` is the pure machine behind
 * compose → clarify → plan → build → done, so every scenario in `specs/prompt-flow/spec.md` that
 * is about "which step comes next, carrying what" is exercised by calling it. Only the handful of
 * claims that live in JSX — a chip that fills without advancing, a field that is never lexed while
 * it is typed, no fade/typewriter on arriving prose, no log panel — fall back to source assertions
 * (the `launch-failure-ui.suite.ts` idiom), because these RN components are not rendered under
 * Node.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Harness } from './harness';
import { COPY } from '../copy';
import { GenerationClientError } from '../transport-shared';
import {
  BUILD_STEPS,
  acceptClarifyQuestions,
  backFrom,
  buildProgressFraction,
  buildStep,
  buildStepStatuses,
  clarificationsFrom,
  clarifyStep,
  composeStep,
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
import type { ClarifyScreen, ComposeScreen, PlanScreen } from '../prompt-flow';
import type { InstalledApp } from '../app-index';

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), 'src/host/launcher', file), 'utf8');
}

/** Source with its comments removed: the negative assertions below are about what the code DOES,
 *  not about prose that happens to name the very thing being forbidden. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** A stand-in installed app: the machine only ever carries it through, never reads into it. */
const EDITED = { id: 'app-1', name: 'Pour Timer' } as unknown as InstalledApp;

const QUESTIONS = [
  { id: 'history', question: 'Should it remember past brews?', options: ['Keep a history', 'Just the last one'] },
  { id: 'alert', question: 'How should it tell you a step is done?', options: ['Sound', 'Buzz', 'Both'] },
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

export async function runPromptFlowScreensTests(h: Harness): Promise<void> {
  // ── the five steps, in order ────────────────────────────────────────────────────────────────

  await h.test('flow: compose → clarify carries the user’s own words and asks nothing yet', () => {
    const clarify = withQuestions(clarifyStep(composedFlow('make me a dice roller')), acceptClarifyQuestions(QUESTIONS));
    h.eq(clarify.kind, 'clarify', 'the step after compose is clarify');
    h.eq(clarify.text, 'make me a dice roller', 'the submitted prompt is carried verbatim');
    h.eq(clarify.answers, {}, 'no question is answered for the user');
    h.eq(clarify.questions.length, 2, 'both questions reach the step');
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

  await h.test('flow: zero questions skips the clarify step entirely', () => {
    h.eq(stepAfterClarifyExchange([]), 'plan', 'nothing to ask means the plan step is next');
    h.eq(stepAfterClarifyExchange(acceptClarifyQuestions(QUESTIONS)), 'clarify', 'questions mean the clarify step');
  });

  await h.test('flow: a clarify 502 means skip to the plan step, never a dead end', () => {
    h.ok(isClarifySkip(new GenerationClientError('http', { status: 502 })), 'a 502 skips to the plan');
    h.ok(!isClarifySkip(new GenerationClientError('http', { status: 500 })), 'a 500 is a real failure');
    h.ok(!isClarifySkip(new GenerationClientError('network', {})), 'a network error is a real failure');
    h.ok(!isClarifySkip(new Error('boom')), 'an unrelated error is a real failure');
  });

  await h.test('flow: at most three questions reach the step, and an unpickable one is dropped', () => {
    const many = [
      { id: 'a', question: 'a?', options: ['1'] },
      { id: 'b', question: 'b?', options: ['1'] },
      { id: 'c', question: 'c?', options: ['1'] },
      { id: 'd', question: 'd?', options: ['1'] },
    ];
    h.eq(acceptClarifyQuestions(many).map((q) => q.id), ['a', 'b', 'c'], 'capped at three, in order');
    h.eq(acceptClarifyQuestions([{ id: 'x', question: 'x?', options: [] }]), [], 'a question with nothing to pick is not a question');
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
      [{ id: 'alert', question: 'How should it tell you a step is done?', answer: 'Both' }],
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

  await h.test('flow: the primary action’s words never depend on being busy — only editing branches them', () => {
    // C2: the label is the same whether or not the step is busy — never a "One moment" placeholder
    // (removed with `COPY.flowBusy`; the wait is the clarify screen's own loading state instead,
    // `prompt-flow` "the clarify wait is a screen, not a grey button").
    h.eq(primaryActionLabel('compose', false), COPY.flowContinue, 'compose reads Continue');
    h.eq(primaryActionLabel('clarify', false), COPY.flowContinue, 'clarify reads Continue');
    h.eq(primaryActionLabel('clarify', true), COPY.flowContinue, 'clarify is unbranched by editing too');
    h.eq(primaryActionLabel('plan', false), COPY.planBuild, 'a new app’s plan reads Build it');
    h.eq(primaryActionLabel('plan', true), COPY.planBuildEdit, 'an edit’s plan reads Make the change');
    h.ok(!('flowBusy' in COPY), 'the grey-button placeholder label is gone entirely');
  });

  await h.test('WorkingLine: no clock suffix under 5s, the phrase alone; a clock past it', () => {
    const startedAt = 1_000_000;
    h.eq(workingLineText('Thinking about what to ask', startedAt, startedAt), 'Thinking about what to ask', 'at the very start, no clock');
    h.eq(workingLineText('Thinking about what to ask', startedAt, startedAt + 4_999), 'Thinking about what to ask', 'still no clock just under 5s');
    h.eq(workingLineText('Thinking about what to ask', startedAt, startedAt + 5_000), 'Thinking about what to ask · 0:05', 'the clock appears at exactly 5s');
    h.eq(workingLineText('Thinking about what to ask', startedAt, startedAt + 7_000), 'Thinking about what to ask · 0:07', 'and keeps advancing');
    h.eq(workingLineText('Writing the plan', startedAt, startedAt + 65_000), 'Writing the plan · 1:05', 'minutes read the same as elapsedLabel elsewhere');
  });

  // ── the build step's four named steps ───────────────────────────────────────────────────────

  await h.test('build: the four named steps are the design’s, in order', () => {
    h.eq(
      BUILD_STEPS,
      [COPY.buildStepReading, COPY.buildStepWriting, COPY.buildStepChecking, COPY.buildStepInstalling],
      'four steps, in order, from the copy table',
    );
  });

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
    h.eq(buildProgressFraction(null, false), 0.125, 'an unstarted stream sits half-way into the first step');
    h.eq(buildProgressFraction('plan', false), 0.125, 'reading the request');
    h.eq(buildProgressFraction('generate', false), 0.375, 'writing the app: one step passed, one live');
    h.eq(buildProgressFraction('check', false), 0.625, 'checking it runs safely');
    for (const stage of ['plan', 'generate', 'check', 'run', 'repair'] as const) {
      h.eq(buildProgressFraction(stage, true), 0.875, `delivering (${stage}) is the last step, still not full`);
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

  // ── the claims that only live in JSX ────────────────────────────────────────────────────────

  const composeSrc = code(read('ComposeStep.tsx'));
  const clarifySrc = code(read('ClarifyStep.tsx'));
  const planSrc = code(read('PlanStep.tsx'));
  const buildSrc = code(read('BuildStep.tsx'));
  const doneSrc = code(read('DoneStep.tsx'));
  const skeletonSrc = code(read('flow-skeletons.tsx'));

  await h.test('compose: a suggestion chip fills the prompt and does not advance the flow', () => {
    h.ok(/onPress=\{\(\) => onChangeText\(chip\)\}/.test(composeSrc), 'a chip only ever fills the field');
    const chipBlock = composeSrc.slice(composeSrc.indexOf('CHIPS.map'), composeSrc.indexOf('</ScrollView>'));
    h.ok(!chipBlock.includes('onContinue'), 'a chip never takes the forward move');
  });

  await h.test('compose: the field is never live-highlighted while it is typed', () => {
    h.ok(/<TextInput/.test(composeSrc), 'the prompt is a plain field');
    h.ok(!composeSrc.includes('WhimProse'), 'a prompt is only marked up after submission (Whim Syntax rule 6)');
  });

  await h.test('clarify: the submitted prompt is echoed as the user’s own words, upright and unmarked', () => {
    h.ok(!clarifySrc.includes('WhimProse'), 'a standalone echoed block is never re-lexed by the shared renderer (no double-marking)');
    h.ok(/color:\s*SHELL_COLORS\.yours/.test(clarifySrc), 'the echo is coloured `yours`');
    h.ok(/fontFamily:\s*FONT_FAMILY\.sansRegular/.test(clarifySrc), 'the echo is upright Instrument Sans, never Newsreader italic');
    h.ok(clarifySrc.includes('COPY.clarifyHelper'), 'the step says it can be skipped');
    h.ok(/\{!loading && <PrimaryAction step="clarify" enabled editing=\{editing\} palette/.test(clarifySrc), 'no validation gate: the action is live with zero answers, once it is shown at all');
  });

  await h.test('plan: rows are tappable into an inline editor, wired through onChangeRow', () => {
    h.ok(/onPress=\{\(\) => startEditing\(index, row\.text\)\}/.test(planSrc), 'tapping a row starts editing it in place');
    h.ok(/onChangeRow: \(index: number, text: string\) => void/.test(planSrc), 'edits commit through an index-keyed onChangeRow prop, not a navigation callback');
    h.ok(!/onEditRow|reopenCompose/.test(planSrc), 'the old reopen-compose wiring is gone');
    h.ok(/<TextInput/.test(planSrc), 'the editing row renders a real text field, not a read-only card');
    h.ok(planSrc.includes('COPY.planRowSave') && planSrc.includes('COPY.cancel'), 'the edit mode offers save and cancel, from the copy table');
    h.ok(planSrc.includes('planHeadline(editing)') && planSrc.includes('COPY.planSubhead') && planSrc.includes('COPY.planFooter'), 'headline, subhead and footer all come from the copy table');
    h.ok(!/generateApp|rewritePrompt|fetch\(/.test(planSrc), 'the approval screen never sends a request itself');
  });

  // ── C1: the edit flow reads as editing, on every gated step ─────────────────────────────────
  // The branch is copy functions, not inline ternaries, precisely so it is greppable: a step that
  // silently regressed back to one un-branched string would still typecheck and still render
  // something, so the requirement can only be pinned at the source level (the `orb-menu.suite.ts`
  // idiom for a claim that lives in JSX rather than in pure logic).

  await h.test('edit flow: every gated step calls the editing-aware copy functions, never a bare literal', () => {
    h.ok(composeSrc.includes('composeHeadline(editing)'), 'compose branches its headline');
    h.ok(composeSrc.includes('composePlaceholder(editing)'), 'and its field placeholder');
    h.ok(planSrc.includes('planHeadline(editing)'), 'plan branches its headline');
    h.ok(planSrc.includes('workingPlanPhrase(editing)'), 'and its working-line phrase');
    h.ok(
      /\{!loading && <PrimaryAction step="plan" enabled editing=\{editing\}/.test(planSrc),
      'plan\'s primary action is told whether it is editing, so Build it can become Make the change',
    );
  });

  await h.test('edit flow: the primary action does not render at all while a gated step is loading', () => {
    // A disabled button under a skeleton is noise — there is nothing to confirm/approve yet, so
    // the whole control is absent, not merely greyed out. `WorkingLine` is the only liveness
    // element under either skeleton.
    const rendersUnconditionally = (src: string): boolean => src.split('\n').some((line) => line.trim().startsWith('<PrimaryAction'));
    h.ok(!rendersUnconditionally(clarifySrc), 'clarify never renders it unconditionally');
    h.ok(!rendersUnconditionally(planSrc), 'nor does plan');
  });

  await h.test('edit flow: every gated step renders the shared eyebrow, scoped to editing', () => {
    for (const [name, src] of [['compose', composeSrc], ['clarify', clarifySrc], ['plan', planSrc]] as const) {
      h.ok(src.includes('EditingEyebrow'), `${name} renders the shared eyebrow component`);
      h.ok(/editing && editingName != null/.test(src), `${name} only shows it while editing`);
    }
  });

  await h.test('edit flow: the clarify loading state renders the skeleton and a WorkingLine, no numbered headline', () => {
    h.ok(clarifySrc.includes('ClarifyQuestionsSkeleton'), 'the loading clarify screen shows the shared skeleton');
    h.ok(clarifySrc.includes('<WorkingLine phrase={COPY.workingClarify}'), 'and the shared liveness line, with its own phrase');
    h.ok(/\{!loading && \(\s*<Text style=\{\[TYPE_SCALE\.stepTitle/.test(clarifySrc), 'the counted headline is withheld until the count is known');
  });

  await h.test('edit flow: the plan loading state renders a WorkingLine under its row skeleton', () => {
    h.ok(planSrc.includes('<WorkingLine phrase={workingPlanPhrase(editing)}'), 'the plan skeleton gets the same liveness line, editing-aware');
  });

  await h.test('build: no raw log, no token text, no diagnostic internals', () => {
    h.ok(!/\.kind\b/.test(buildSrc), 'never references a diagnostic kind');
    h.ok(!/\.symbol\b/.test(buildSrc), 'never references a diagnostic symbol');
    h.ok(!/token/i.test(buildSrc), 'never renders token text');
    h.ok(!/log|terminal/i.test(buildSrc), 'no log or terminal panel');
  });

  // build-liveness B1/B3 replaced the single "quiet for Ns" heartbeat (and its `buildActivityLine`/
  // `buildQuietLine`/`quietSecondsSince` API) with a three-clock liveness derivation that tells
  // thinking from hanging — see `run-signals.suite.ts` for the copy/derivation coverage. This
  // screen's own remaining claim is architectural: it derives everything from props each render
  // and holds no state of its own.
  await h.test('build: liveness is derived per render, from the props, through the shared helpers', () => {
    h.ok(/livenessOf\(signals, now\)/.test(buildSrc), 'the liveness state is derived from the attempt’s signals and the render’s own now');
    h.ok(/buildLivenessLine\(liveness, signals, now\)/.test(buildSrc), 'and its phrase comes from the one liveness-copy function');
    h.ok(!/buildActivityLine|buildQuietLine|quietSecondsSince|HEARTBEAT_QUIET_MS/.test(buildSrc), 'the retired single-heartbeat API is gone');
    h.ok(!/journal|Store|useState|useRef/.test(buildSrc), 'the screen holds no state of its own and never reads a store');
  });

  await h.test('build: a details affordance opens the attempt’s timeline', () => {
    h.ok(/onShowDetails\?: \(\) => void/.test(buildSrc), 'activation is a callback the caller owns');
    h.ok(/onPress=\{onShowDetails\}/.test(buildSrc), 'the affordance is wired to it');
    h.ok(buildSrc.includes('COPY.buildDetails') && /accessibilityRole="button"/.test(buildSrc), 'it is a labelled button from the copy table');
  });

  await h.test('build: arriving text is never faded in or typed in per character', () => {
    h.ok(!/Animated|Easing|typewriter|fadeIn/i.test(buildSrc), 'the build screen holds no animation at all');
    h.ok(buildSrc.includes('COPY.buildLeaveRunning') && buildSrc.includes('onLeaveRunning'), 'it offers Leave it running');
    h.ok(/onCancel\(\)/.test(buildSrc) && buildSrc.includes('hardwareBackPress'), 'hardware back is the separate cancel contract');
  });

  await h.test('done: Open it and Back to your apps are two distinct destinations', () => {
    h.ok(doneSrc.includes('onPress={onOpen}') && doneSrc.includes('onPress={onBackToApps}'), 'the two actions call two different callbacks');
    h.ok(doneSrc.includes('COPY.doneOpen') && doneSrc.includes('COPY.doneBackToApps') && doneSrc.includes('readyTitle('), 'the done copy is the table’s');
    h.ok(doneSrc.includes('<AppTile'), 'the delivered app’s own tile is shown, in its own colour');
  });

  await h.test('skeletons: geometry is imported, breathe is the only motion, emptiness gets none', () => {
    h.ok(skeletonSrc.includes('APP_TILE_SIZE') && skeletonSrc.includes('APP_TILE_RADIUS'), 'tile geometry comes from the component’s exported constants');
    h.ok(/width: APP_TILE_SIZE, height: APP_TILE_SIZE/.test(skeletonSrc), 'and is used directly, never restated as a literal');
    h.ok(skeletonSrc.includes('MOTION.breathe') && !/shimmer|gradient/i.test(skeletonSrc), 'breathe is the only loading motion');
    h.ok(/if \(count <= 0\) return null;/.test(skeletonSrc), 'an empty grid gets an empty state, never a skeleton');
    h.ok(planSrc.includes('PLAN_ROW_MIN_HEIGHT') && /SKELETON_ROW_WIDTHS/.test(planSrc), 'plan-row skeletons reuse the row’s own height with varying widths');
  });

  await h.test('flow screens: every string they show exists in the copy table', () => {
    const keys = [
      'flowContinue', 'composeHeadline', 'composeHeadlineEdit', 'composeHelper',
      'composePlaceholderEdit', 'composeChipsEyebrow', 'composeChipTimer', 'composeChipTracker',
      'composeChipDice', 'clarifyHelper', 'workingClarify', 'planHeadline', 'planHeadlineEdit',
      'planSubhead', 'planFooter', 'planBuild', 'planBuildEdit', 'workingPlan', 'workingPlanEdit',
      'buildTitle', 'buildTitleEdit', 'buildSubtitle', 'buildStepReading', 'buildStepWriting',
      'buildStepChecking', 'buildStepInstalling', 'buildLeaveRunning', 'buildDetails', 'doneBody',
      'doneOpen', 'doneBackToApps', 'homeComposerPlaceholder', 'homeTitle', 'homeSubtitle',
      'promptServerUnconfigured', 'promptOpenSettings', 'failureTitle', 'failureRephrase', 'failureBack',
      'failureDismiss',
    ] as const;
    for (const key of keys) {
      h.ok(typeof COPY[key] === 'string' && COPY[key].length > 0, `COPY.${key} must be a non-empty string`);
    }
  });
}
