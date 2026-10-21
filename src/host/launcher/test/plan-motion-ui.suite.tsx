/** The plan page's moments (system.md §4.4), each with its Reduce Motion pair (§4.5): M8 the plan
 *  arrives — the questions fade in over their skeleton, the rows rise 8 pt staggered the first time
 *  they land, and an answered question scrolled past collapses as a layout transition; M25 a tapped
 *  row grows into its text area while Save and Cancel fade in, and Cancel shrinks the same view back.
 *  What the page shows is `flow-screens-ui.suite.tsx`. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { ClarifyQuestion } from '@whim/contract';
import { Harness } from './harness';
import { COPY, planMakeHeader } from '../copy';
import { describeStep, planStep, updatePlanRow, withPlan, withQuestions, type FlowQuestion, type PlanScreen } from '../prompt-flow';
import { PlanPage } from '../PlanPage';
import { springConfig, staggerDelay, timingOf } from '../../ui/tokens-pure';
import { StyleSheet, accessibilitySettings, emitAccessibility } from './native-host';
import { animations, holdAnimations, isStep, layoutAnimations, playedUnder, ReduceMotion, viewTagOf, type Animation, type LayoutAnimation } from './native-reanimated';
import { button, hostType, press, renderScreen, textOf, unmountScreen } from './react-screen';

type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;
type Style = Record<string, unknown>;
const flat = (node: Node): Style => (StyleSheet.flatten(node.props.style) ?? {}) as Style;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const noop = () => {};

const SMOOTH = springConfig('smooth');
const FADE_IN = timingOf('fadeIn');

const ask = (q: unknown): FlowQuestion => ClarifyQuestion.parse(q);
const ALERT = ask({ id: 'alert', question: 'How should it tell you?', options: ['Sound', 'Buzz'], select: 'one', other: false });
const EXTRAS = ask({ id: 'extras', question: 'What goes in it?', options: ['Honey', 'Lemon', 'Milk'], select: 'many', other: false });
const ROWS = [
  { label: 'Timer', text: 'Counts down' },
  { label: 'Alert', text: 'Buzzes at zero' },
  { label: 'Steep', text: 'Remembers each tea' },
  { label: 'History', text: 'Keeps the last brews' },
  { label: 'Sound', text: 'Picks a chime' },
  { label: 'Theme', text: 'Follows the phone' },
  { label: 'Share', text: 'Sends a brew to a friend' },
];
const ROW_TEXTS = ROWS.map((row) => row.text);

/** The page as Continue opens it: the questions and the rows both on their way. */
const opened = (): PlanScreen => planStep(describeStep(undefined, 'A tea timer'));
const asked = (questions: FlowQuestion[] = [ALERT, EXTRAS]) => withQuestions(opened(), questions);
const landed = (questions: FlowQuestion[] = [ALERT, EXTRAS]) => withPlan(asked(questions), { rewrittenPrompt: 'A tea timer', plan: ROWS });

const page = (screen: PlanScreen) => (
  <PlanPage screen={screen} onBack={noop} onAnswer={noop} onChangeRow={noop} onMake={noop} onTryAgain={noop} onMakeInstead={noop} />
);
const show = (tree: Tree, screen: PlanScreen) => TestRenderer.act(async () => tree.update(page(screen)));
const run = (fn: () => void) => TestRenderer.act(async () => { fn(); });

/** The phone's Reduce Motion, as the OS reports it to a running app. */
async function reduceMotion(on: boolean): Promise<void> {
  accessibilitySettings.reduceMotion = on;
  await TestRenderer.act(async () => emitAccessibility('reduceMotionChanged', on));
}

/** The nearest animated view holding `node`. */
function frameOf(node: Node): Node {
  let up: Node | null = node.parent;
  while (up && hostType(up) !== 'Animated.View') up = up.parent;
  if (!up) throw new Error(`"${textOf(node)}" sits in no animated view`);
  return up;
}
/** A plan row's own animated frame: the view that rises with M8 and grows with M25. */
const rowFrame = (tree: Tree, text: string): Node => {
  const row = tree.root.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityHint === COPY.planRowEditHint && textOf(n).includes(text))[0];
  if (row) return frameOf(row);
  const field = tree.root.findAll((n) => hostType(n) === 'TextInput' && n.props.value === text)[0];
  if (!field) throw new Error(`no plan row "${text}"`);
  return tree.root.findAll((n) => hostType(n) === 'Animated.View' && n.findAll((m) => m === field).length === 1 && n.findAll((m) => hostType(m) === 'TextInput').length === 1).at(-1)!;
};
/** A question's animated block: the view that fades in with M8 and collapses with it. */
const questionFrame = (tree: Tree, question: FlowQuestion): Node => {
  const text = tree.root.findAll((n) => hostType(n) === 'Text' && textOf(n) === question.question)[0];
  if (text) return frameOf(text);
  const folded = tree.root.findAll((n) => hostType(n) === 'Pressable' && String(n.props.accessibilityLabel).startsWith(`${question.question}, `))[0];
  if (!folded) throw new Error(`no question "${question.question}"`);
  return frameOf(folded);
};
/** How many skeletons named `label` are showing. */
const skeletons = (tree: Tree, label: string) => tree.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'progressbar' && n.props.accessibilityLabel === label).length;
/** Where an animated view is drawn: its opacity and how far it sits below its place. */
function drawn(node: Node) {
  const style = flat(node);
  const transform = (style.transform as Record<string, number>[] | undefined) ?? [];
  return { opacity: (style.opacity as number | undefined) ?? 1, y: transform.find((step) => 'translateY' in step)?.translateY ?? 0 };
}
const atRest = (node: Node) => same(drawn(node), { opacity: 1, y: 0 });

const isSmoothTo = (a: Animation, to: number) => a.kind === 'spring' && a.to === to && same(a.config, SMOOTH);
const isFadeInTo = (a: Animation, to: number, reduced: boolean) =>
  a.kind === 'timing' && a.to === to && same(a.config, { duration: FADE_IN.duration, easing: { bezier: FADE_IN.bezier }, ...(reduced ? { reduceMotion: ReduceMotion.Never } : {}) });
/** The rises assigned since the log was cleared: each delayed `smooth` spring to 0, its delay. */
const rises = () => animations.flatMap((a) => (a.kind === 'delay' && isSmoothTo(a.animation, 0) ? [a.delay] : []));
/** The fades assigned since the log was cleared: each delayed `fade-in` to 1, its delay. */
const fades = () => animations.flatMap((a) => (a.kind === 'delay' && isFadeInTo(a.animation, 1, false) ? [a.delay] : []));

/** `smooth` as a layout transition: Reanimated's spring mode with the token's physics. */
const isSmoothReflow = (layout: unknown): boolean => {
  const l = layout as LayoutAnimation | undefined;
  return l?.preset === 'LinearTransition' && l.config.springify === true && same({ mass: l.config.mass, stiffness: l.config.stiffness, damping: l.config.damping }, SMOOTH);
};
/** §4.5's reduced reflow: a cross-fade in place over `fade-in`, which the root ReducedMotionConfig must not skip. */
const isReducedReflow = (layout: unknown): boolean => {
  const l = layout as LayoutAnimation | undefined;
  return l?.preset === 'FadingTransition' && l.config.duration === FADE_IN.duration && playedUnder(l, true) !== null;
};
/** `fade-in` as an entering animation: the token's duration and curve. */
const isFadeInEntering = (entering: unknown): boolean => {
  const l = entering as LayoutAnimation | undefined;
  return l?.preset === 'FadeIn' && l.config.duration === FADE_IN.duration && same(l.config.easing, { bezier: FADE_IN.bezier });
};
/** Every view in `root` an `entering` animation plays on. */
const enteringIn = (root: Node) => root.findAll((n) => hostType(n) === 'Animated.View' && n.props.entering !== undefined);

/** The plan in the loading page, landed while animations are held; resolves the release. */
async function arrive(tree: Tree, screen = landed()): Promise<() => void> {
  animations.splice(0);
  const release = holdAnimations();
  await show(tree, screen);
  return release;
}

export async function runPlanMotionUiTests(h: Harness): Promise<void> {
  // ── M8 plan arrives ────────────────────────────────────────────────────────

  await h.test('M8: questions landing over their skeleton fade in on the fade-in token, and the plan below them moves on smooth', async () => {
    const tree = await renderScreen(page(opened()));
    try {
      h.eq(skeletons(tree, COPY.workingClarify), 1, 'the questions start as their skeleton');
      layoutAnimations.splice(0);
      await show(tree, asked());
      h.eq(skeletons(tree, COPY.workingClarify), 0, 'the skeleton has gone');
      for (const q of [ALERT, EXTRAS]) h.ok(isFadeInEntering(questionFrame(tree, q).props.entering), `"${q.question}" fades in on fade-in`);
      h.eq(layoutAnimations.filter((e) => e.phase === 'entering' && isFadeInEntering(e.animation)).length, 2, 'and both played as they mounted');
      const header = tree.root.find((n) => hostType(n) === 'Text' && textOf(n) === planMakeHeader(false));
      h.ok(isSmoothReflow(frameOf(header).props.layout), 'the plan section the questions push down moves on smooth, a layout transition');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('M8: rows landing rise 8 pt on smooth as they fade in on fade-in, each after the stagger token’s delay for its place', async () => {
    const tree = await renderScreen(page(asked()));
    try {
      const release = await arrive(tree);
      const frames = ROW_TEXTS.map((text) => rowFrame(tree, text));
      h.ok(frames.every((f) => same(drawn(f), { opacity: 0, y: 8 })), 'held at their first frame, every row is unseen 8 pt below its place');
      const delays = ROW_TEXTS.map((_, i) => staggerDelay(i, false));
      h.eq(rises(), delays, 'each rises on smooth after its stagger delay, in order, the later rows together');
      h.eq(fades(), delays, 'and fades in on fade-in with it');
      h.ok(new Set(delays).size > 1, 'the stagger spreads the rows out');
      await run(release);
      h.ok(ROW_TEXTS.every((text) => atRest(rowFrame(tree, text))), 'released, every row rests in its place');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('M8: the rise plays the first time only — the page re-drawn, an answer changed or a row saved replays nothing, and a page opened on its plan shows it at rest', async () => {
    const tree = await renderScreen(page(asked()));
    try {
      const release = await arrive(tree);
      await run(release);
      animations.splice(0);
      layoutAnimations.splice(0);
      const answered = { ...landed(), answers: { ...landed().answers, alert: { choices: ['Buzz'], other: '', decide: false } } };
      await show(tree, landed());
      await show(tree, answered);
      await show(tree, updatePlanRow(answered, 2, 'Remembers each tea and its time'));
      h.eq(rises().length + fades().length, 0, 're-drawn, answered and with a row rewritten, no row rises again');
      h.eq(layoutAnimations.length, 0, 'and no question fades in again');
      h.ok(ROW_TEXTS.filter((_, i) => i !== 2).every((text) => atRest(rowFrame(tree, text))) && atRest(rowFrame(tree, 'Remembers each tea and its time')), 'every row stays where it rests');
    } finally {
      await unmountScreen(tree);
    }
    animations.splice(0);
    layoutAnimations.splice(0);
    const reopened = await renderScreen(page(landed()));
    try {
      h.eq(rises().length + fades().length, 0, 'reopened on a plan already there, nothing rises');
      h.ok(ROW_TEXTS.every((text) => atRest(rowFrame(reopened, text))), 'its rows are at rest from the first frame');
      h.eq(layoutAnimations.filter((e) => e.phase === 'entering').length, 0, 'and its questions are simply there');
    } finally {
      await unmountScreen(reopened);
    }
  });

  await h.test('M8 under Reduce Motion: the plan cross-fades in — every row fades in on fade-in at once, unmoved and unstaggered, as do the questions', async () => {
    const tree = await renderScreen(page(opened()));
    try {
      await reduceMotion(true);
      layoutAnimations.splice(0);
      await show(tree, asked());
      for (const q of [ALERT, EXTRAS]) {
        const entering = questionFrame(tree, q).props.entering;
        h.ok(isFadeInEntering(entering) && playedUnder(entering, true) !== null, `"${q.question}" still fades in: the root ReducedMotionConfig does not skip it`);
      }
      const release = await arrive(tree);
      h.ok(ROW_TEXTS.every((text) => same(drawn(rowFrame(tree, text)), { opacity: 0, y: 0 })), 'held at the first frame, every row is unseen in its own place');
      h.eq(rises(), [], 'no row rises');
      h.eq(animations.filter((a) => a.kind === 'delay').length, 0, 'none waits: the stagger goes');
      h.eq(animations.filter((a) => isFadeInTo(a, 1, true)).length, ROWS.length, 'each fades in on fade-in, marked to play under Reduce Motion');
      await run(release);
      h.ok(ROW_TEXTS.every((text) => atRest(rowFrame(tree, text))), 'and rests in its place');
    } finally {
      await reduceMotion(false);
      await unmountScreen(tree);
    }
  });

  await h.test('M8: an answered question scrolled past collapses as a smooth layout transition of the block that stays, and reopening it retargets the same block', async () => {
    const answered = { ...landed(), answers: { ...landed().answers, alert: { choices: ['Buzz'], other: '', decide: false } } };
    const tree = await renderScreen(page(answered));
    try {
      const open = questionFrame(tree, ALERT);
      const view = viewTagOf(open);
      h.ok(isSmoothReflow(open.props.layout), 'the question’s block changes size as a smooth layout transition');
      await TestRenderer.act(async () => open.props.onLayout({ nativeEvent: { layout: { x: 0, y: 100, width: 350, height: 90 } } }));
      const scroll = tree.root.find((n) => hostType(n) === 'ScrollView');
      layoutAnimations.splice(0);
      await TestRenderer.act(async () => scroll.props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 200 } } }));
      h.ok(!textOf(tree.root).includes(ALERT.question), 'scrolled past, the answered question is one line');
      h.ok(viewTagOf(questionFrame(tree, ALERT)) === view, 'drawn by the same block, which collapses from where it is');
      await press(button(tree, `${ALERT.question}, Buzz`));
      h.ok(textOf(tree.root).includes(ALERT.question), 'tapped, it reopens');
      h.ok(viewTagOf(questionFrame(tree, ALERT)) === view, 'still the same block, so the reopen retargets its collapse in flight rather than starting over');
      h.eq(layoutAnimations.length, 0, 'neither fold nor reopen plays the arrival’s fade again');
      h.ok(ROW_TEXTS.every((text) => isSmoothReflow(rowFrame(tree, text).props.layout)), 'the rows below move with it on smooth');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('M8 under Reduce Motion: a question collapsing cross-fades in place over fade-in', async () => {
    const tree = await renderScreen(page(landed()));
    try {
      await reduceMotion(true);
      h.ok([ALERT, EXTRAS].every((q) => isReducedReflow(questionFrame(tree, q).props.layout)), 'each question’s block cross-fades');
    } finally {
      await reduceMotion(false);
      await unmountScreen(tree);
    }
  });

  // ── M25 edit a plan row ────────────────────────────────────────────────────

  await h.test('M25: a tapped row grows into its text area as a smooth layout transition while Save and Cancel fade in on fade-in; its words never fade', async () => {
    const tree = await renderScreen(page(landed()));
    try {
      const frame = rowFrame(tree, ROWS[1].text);
      const view = viewTagOf(frame);
      h.ok(isSmoothReflow(frame.props.layout), 'the row changes size as a smooth layout transition');
      layoutAnimations.splice(0);
      await press(button(tree, `${ROWS[1].label}, ${ROWS[1].text}`));
      const editing = rowFrame(tree, ROWS[1].text);
      h.ok(viewTagOf(editing) === view, 'the row that grows is the row that was tapped, not a new view put in its place');
      h.ok(isSmoothReflow(editing.props.layout), 'and it grows on smooth');
      const fading = enteringIn(editing);
      h.eq(fading.length, 1, 'one part of the grown row fades in');
      h.ok(isFadeInEntering(fading[0]?.props.entering), 'on the fade-in token');
      h.eq(fading[0] ? [COPY.cancel, COPY.planRowSave].every((label) => textOf(fading[0]).includes(label)) : false, true, 'and it holds Save and Cancel');
      h.eq(fading[0]?.findAll((n) => hostType(n) === 'TextInput').length, 0, 'the text area and its words are there at once, never faded in');
      h.ok(atRest(editing), 'the row itself neither fades nor moves');
      h.eq(layoutAnimations.filter((e) => e.phase === 'entering').length, 1, 'only that one entering animation played');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('M25: Cancel, even before the growth ends, shrinks the same row back from where it is; Save does too', async () => {
    const tree = await renderScreen(page(landed()));
    try {
      const view = viewTagOf(rowFrame(tree, ROWS[0].text));
      const release = holdAnimations();
      await press(button(tree, `${ROWS[0].label}, ${ROWS[0].text}`));
      layoutAnimations.splice(0);
      await press(button(tree, COPY.cancel));
      release();
      const back = rowFrame(tree, ROWS[0].text);
      h.ok(!tree.root.findAll((n) => hostType(n) === 'TextInput').length, 'Cancel closes the text area');
      h.ok(viewTagOf(back) === view, 'the row the growth ran on is the row that shrinks back: its layout transition retargets from the frame on screen');
      h.ok(isSmoothReflow(back.props.layout), 'on smooth');
      h.eq(layoutAnimations.filter((e) => e.phase === 'entering').length, 0, 'nothing in the row plays an arrival again');
      await press(button(tree, `${ROWS[0].label}, ${ROWS[0].text}`));
      await press(button(tree, COPY.planRowSave));
      h.ok(viewTagOf(rowFrame(tree, ROWS[0].text)) === view, 'Save shrinks the same row too');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('M25 under Reduce Motion: the row is a text area at once, with Save and Cancel, and is a row again at once', async () => {
    const tree = await renderScreen(page(landed()));
    try {
      await reduceMotion(true);
      h.eq(rowFrame(tree, ROWS[1].text).props.layout, undefined, 'the row carries no layout transition');
      animations.splice(0);
      layoutAnimations.splice(0);
      await press(button(tree, `${ROWS[1].label}, ${ROWS[1].text}`));
      const editing = rowFrame(tree, ROWS[1].text);
      h.eq(editing.props.layout, undefined, 'it grows at once');
      h.eq(enteringIn(editing).length, 0, 'Save and Cancel are there at once');
      h.ok(button(tree, COPY.planRowSave) !== undefined && button(tree, COPY.cancel) !== undefined, 'both shown');
      h.eq(animations.filter(isStep).length + layoutAnimations.length, 0, 'nothing animates');
      await press(button(tree, COPY.cancel));
      h.eq(rowFrame(tree, ROWS[1].text).props.layout, undefined, 'and shrinks back at once');
    } finally {
      await reduceMotion(false);
      await unmountScreen(tree);
    }
  });
}
