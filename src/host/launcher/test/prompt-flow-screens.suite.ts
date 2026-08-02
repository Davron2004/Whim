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
  reopenCompose,
  stepAfterClarifyExchange,
  withAnswer,
  withDelivering,
  withPlan,
  withStage,
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
  return clarifyStep(composedFlow(), acceptClarifyQuestions(QUESTIONS));
}

function plannedFlow(rows?: { label: string; text: string }[]): PlanScreen {
  const pending = planStep(clarifiedFlow());
  return withPlan(pending, { rewrittenPrompt: 'a brew timer', ...(rows ? { plan: rows } : {}) });
}

export async function runPromptFlowScreensTests(h: Harness): Promise<void> {
  // ── the five steps, in order ────────────────────────────────────────────────────────────────

  await h.test('flow: compose → clarify carries the user’s own words and asks nothing yet', () => {
    const clarify = clarifyStep(composedFlow('make me a dice roller'), acceptClarifyQuestions(QUESTIONS));
    h.eq(clarify.kind, 'clarify', 'the step after compose is clarify');
    h.eq(clarify.text, 'make me a dice roller', 'the submitted prompt is carried verbatim');
    h.eq(clarify.answers, {}, 'no question is answered for the user');
    h.eq(clarify.questions.length, 2, 'both questions reach the step');
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
    h.eq(primaryActionLabel('plan', pending.loading), COPY.flowBusy, 'the action keeps plain words while it waits');
    const live = withPlan(pending, { rewrittenPrompt: 'a brew timer', plan: [{ label: 'What it is', text: 'A brew timer.' }] });
    h.eq(live.loading, false, 'the arrived response clears the loading state');
    h.eq(live.rewritten, 'a brew timer', 'the rewritten prompt is what generation will be asked for');
    h.eq(primaryActionLabel('plan', live.loading), COPY.planBuild, 'the action reads Build it once the plan is there');
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

  await h.test('flow: tapping a plan row re-opens compose prefilled with that row’s text', () => {
    const plan = plannedFlow([{ label: 'The screen', text: 'A big countdown.' }]);
    const back = reopenCompose(plan, plan.rows[0]);
    h.eq(back.kind, 'compose', 'a row tap lands on compose');
    h.eq(back.text, 'A big countdown.', 'prefilled with that row’s text — nothing fancier');
    h.eq(back.editing?.id, EDITED.id, 'still scoped to the app being re-prompted');
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

  await h.test('flow: every busy primary action keeps plain words', () => {
    h.eq(primaryActionLabel('compose', false), COPY.flowContinue, 'compose reads Continue');
    h.eq(primaryActionLabel('clarify', false), COPY.flowContinue, 'clarify reads Continue');
    h.eq(primaryActionLabel('plan', false), COPY.planBuild, 'plan reads Build it');
    for (const step of ['compose', 'clarify', 'plan'] as const) {
      h.eq(primaryActionLabel(step, true), COPY.flowBusy, `${step} reads One moment while its request is in flight`);
    }
    h.eq(COPY.flowBusy, 'One moment', 'the busy label is words, not a spinner');
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

  await h.test('clarify: the submitted prompt is echoed as the user’s own words', () => {
    h.ok(/storedPrompt=\{prompt\}/.test(clarifySrc), 'the echo resolves through the `yours` class, never a paraphrase');
    h.ok(clarifySrc.includes('COPY.clarifyHelper'), 'the step says it can be skipped');
    h.ok(/<PrimaryAction step="clarify" busy=\{busy\} enabled palette/.test(clarifySrc), 'no validation gate: the action is live with zero answers');
  });

  await h.test('plan: rows are tappable and the step carries the approval copy', () => {
    h.ok(/onPress=\{\(\) => onEditRow\(row\)\}/.test(planSrc), 'every row is tappable');
    h.ok(planSrc.includes('COPY.planHeadline') && planSrc.includes('COPY.planSubhead') && planSrc.includes('COPY.planFooter'), 'headline, subhead and footer all come from the copy table');
    h.ok(!/generateApp|rewritePrompt|fetch\(/.test(planSrc), 'the approval screen never sends a request itself');
  });

  await h.test('build: no raw log, no token text, no diagnostic internals', () => {
    h.ok(!/\.kind\b/.test(buildSrc), 'never references a diagnostic kind');
    h.ok(!/\.symbol\b/.test(buildSrc), 'never references a diagnostic symbol');
    h.ok(!/token/i.test(buildSrc), 'never renders token text');
    h.ok(!/log|terminal/i.test(buildSrc), 'no log or terminal panel');
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
      'flowBusy', 'flowContinue', 'composeHeadline', 'composeHelper', 'composeChipsEyebrow',
      'composeChipTimer', 'composeChipTracker', 'composeChipDice', 'clarifyHelper', 'planHeadline',
      'planSubhead', 'planFooter', 'planBuild', 'buildTitle', 'buildSubtitle', 'buildStepReading',
      'buildStepWriting', 'buildStepChecking', 'buildStepInstalling', 'buildLeaveRunning',
      'doneBody', 'doneOpen', 'doneBackToApps', 'homeComposerPlaceholder', 'homeTitle', 'homeSubtitle',
      'promptServerUnconfigured', 'promptOpenSettings', 'failureTitle', 'failureRephrase', 'failureDismiss',
    ] as const;
    for (const key of keys) {
      h.ok(typeof COPY[key] === 'string' && COPY[key].length > 0, `COPY.${key} must be a non-empty string`);
    }
  });
}
