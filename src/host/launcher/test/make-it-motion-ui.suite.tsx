/** M9 Make it (system.md §4.4) with its Reduce Motion pair (§4.5): the making ember sets out from the
 *  Make it button, as large as fits in it, and travels on morph to the Making page's 128 (`TravelLayer`)
 *  as the plan fades out under the Making page and its words and steps fade in, text only fading; a
 *  close mid-way ends it. On a repair the Making page's marker moves down to the repair row on snappy.
 *  The ember's travel on to Ready is `ready-motion-ui.suite.tsx`. */
import fs from 'node:fs';
import path from 'node:path';
import React, { useState } from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import { describeStep, planStep, withPlan, withQuestions, type PlanScreen, type Stage } from '../prompt-flow';
import { MAKE_IT_EMBER, PlanPage } from '../PlanPage';
import MakingPage from '../MakingPage';
import { MakingSheet } from '../MakingSheet';
import { useTokens } from '../../ui/tokens';
import { LAYOUT } from '../../../design/tokens';
import { ambientOpacity, springConfig, timingOf } from '../../ui/tokens-pure';
import { StyleSheet, accessibilitySettings, emitAccessibility } from './native-host';
import { animations, elapseSprings, holdAnimations, isStep, measuring, ReduceMotion } from './native-reanimated';
import { button, hostType, press, renderScreen, textOf, unmountScreen } from './react-screen';

type Tree = TestRenderer.ReactTestRenderer;
type Node = TestRenderer.ReactTestInstance;
type Style = Record<string, unknown>;
type Rect = { x: number; y: number; width: number; height: number; pageX: number; pageY: number };
const flat = (node: Node): Style => (StyleSheet.flatten(node.props.style) ?? {}) as Style;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const run = (fn: () => void) => TestRenderer.act(async () => { fn(); });

const MORPH = springConfig('morph');
const SNAPPY = springConfig('snappy');
const FADE_IN = timingOf('fadeIn');
const FADE_OUT = timingOf('fadeOut');

const NAME = 'Tea Timer';
const WORDS = 'A tea timer';
const SCREEN: PlanScreen = withPlan(withQuestions(planStep(describeStep(undefined, WORDS)), []), {
  rewrittenPrompt: WORDS,
  plan: [{ label: 'Timer', text: 'Counts down' }],
});

/** Where Make it's ember place, the Making page's 128 and the sheet's travel layer are drawn: the
 *  place centred on a 52 high button at (16, 700), 368 wide. */
const BUTTON = { pageX: 16, pageY: 700, width: 368, height: LAYOUT.buttonHeight.large };
const SOURCE: Rect = { x: 0, y: 0, width: MAKE_IT_EMBER, height: MAKE_IT_EMBER, pageX: BUTTON.pageX + (BUTTON.width - MAKE_IT_EMBER) / 2, pageY: BUTTON.pageY + (BUTTON.height - MAKE_IT_EMBER) / 2 };
const TARGET: Rect = { x: 0, y: 0, width: 128, height: 128, pageX: 136, pageY: 120 };
const LAYER: Rect = { x: 0, y: 0, width: 400, height: 800, pageX: 0, pageY: 10 };

/** Every host view's ref holds its element, so `measure` can tell the places apart. */
const nodeMock = (element: React.ReactElement) => ({ element });
function placeOf(node: unknown): Rect | undefined {
  const { props } = (node as { element: React.ReactElement<Record<string, unknown>> }).element;
  if (props.pointerEvents === 'none' && props.collapsable === false) return LAYER;
  const style = (StyleSheet.flatten(props.style) ?? {}) as Style;
  if (style.width === MAKE_IT_EMBER && style.height === MAKE_IT_EMBER) return SOURCE;
  if (style.width === 128 && style.height === 128) return TARGET;
  return undefined;
}

/** The making sheet on the plan page; Make it turns it to the Making page. */
function Flow() {
  useTokens();
  const [making, setMaking] = useState(false);
  const [open, setOpen] = useState(true);
  const node = making ? (
    <MakingPage name={NAME} changing={false} words={WORDS} stage={null} delivering={false} signals={null} now={0} activity={0} onStop={() => {}} />
  ) : (
    <PlanPage screen={SCREEN} onBack={() => {}} onAnswer={() => {}} onChangeRow={() => {}} onMake={() => setMaking(true)} onTryAgain={() => {}} onMakeInstead={() => {}} />
  );
  return <MakingSheet content={open ? { key: 'run:tea', node } : null} onClose={() => setOpen(false)} />;
}

/** The phone's Reduce Motion, as the OS reports it to a running app. */
async function reduceMotion(on: boolean): Promise<void> {
  accessibilitySettings.reduceMotion = on;
  await TestRenderer.act(async () => emitAccessibility('reduceMotionChanged', on));
}

/** The plan page in the making sheet (Reduce Motion `reduced`), then Make it tapped with motion held
 *  at its first frame: the UI thread's, unless `uiFrame` is false (then only what the JS thread drew
 *  as the Making page mounted, before anything was measured). */
async function makeIt(reduced = false, uiFrame = true): Promise<{ tree: Tree; release: () => void }> {
  measuring.rectOf = placeOf;
  const tree = await renderScreen(<Flow />, { createNodeMock: nodeMock });
  await reduceMotion(reduced);
  animations.splice(0);
  const release = holdAnimations();
  await press(button(tree, COPY.planBuild));
  if (uiFrame) await run(() => elapseSprings(0));
  return { tree, release };
}
async function leave(tree: Tree, release: () => void): Promise<void> {
  await run(release);
  await reduceMotion(false);
  await unmountScreen(tree);
  measuring.rectOf = null;
}

/** How a node is drawn: every view above it fades and moves it. */
function seen(node: Node) {
  let opacity = 1;
  let scale = 1;
  let moved = false;
  for (let up: Node | null = node; up; up = up.parent) {
    if (typeof up.type !== 'string') continue;
    const style = flat(up);
    opacity *= (style.opacity as number | undefined) ?? 1;
    for (const step of (style.transform as Record<string, number>[] | undefined) ?? []) {
      if ('scale' in step) scale *= step.scale;
      if (('translateX' in step && step.translateX !== 0) || ('translateY' in step && step.translateY !== 0)) moved = true;
    }
  }
  return { opacity, scale, moved };
}
function inside(node: Node, ancestor: Node): boolean {
  for (let up: Node | null = node; up; up = up.parent) if (up === ancestor) return true;
  return false;
}
const embers = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'RadialGradient' && n.props.cy === '74%');
const seenEmbers = (tree: Tree) => embers(tree).filter((ember) => seen(ember).opacity > 0);
/** The travelling element as the layer draws it. */
function flying(tree: Tree) {
  const views = tree.root.findAll((n) => hostType(n) === 'Animated.View' && ((flat(n).transform as Style[] | undefined) ?? []).some((step) => 'translateX' in step));
  if (views.length === 0) return null;
  const style = flat(views[0]);
  const at = Object.assign({}, ...(style.transform as Record<string, number>[])) as Record<string, number>;
  return { opacity: style.opacity as number, x: at.translateX, y: at.translateY, scale: at.scale, node: views[0] };
}
const centre = (from: Rect, to: Rect, p: number) => ({
  x: from.pageX + from.width / 2 + (to.pageX + to.width / 2 - from.pageX - from.width / 2) * p - LAYER.pageX,
  y: from.pageY + from.height / 2 + (to.pageY + to.height / 2 - from.pageY - from.height / 2) * p - LAYER.pageY,
});
const progressOf = (scale: number) => (scale - SOURCE.width / TARGET.width) / (1 - SOURCE.width / TARGET.width);
const travels = () => animations.filter((a) => isStep(a) && a.kind === 'spring' && a.to === 1 && same(a.config, MORPH));
const timed = (to: number, t: { duration: number; bezier: readonly number[] }, reduced: boolean) =>
  animations.filter((a) => isStep(a) && a.kind === 'timing' && a.to === to && same(a.config, { duration: t.duration, easing: { bezier: t.bezier }, ...(reduced ? { reduceMotion: ReduceMotion.Never } : {}) })).length;
const making = (tree: Tree) => tree.root.findAllByType(MakingPage)[0];
const plan = (tree: Tree) => tree.root.findAllByType(PlanPage)[0];
const textIn = (page: Node, text: string) => page.findAll((n) => hostType(n) === 'Text' && textOf(n) === text)[0];
/** The Making page's words, steps and Stop, and its light, in that order. */
function makingParts(tree: Tree) {
  const page = making(tree);
  const texts = [`Making ${NAME}`, `“${WORDS}”`, COPY.buildStepReading, COPY.actionStop].map((text) => textIn(page, text));
  const light = page.findAll((n) => hostType(n) === 'RadialGradient' && n.props.rx === '50%')[0];
  return [...texts, light];
}

export async function runMakeItMotionUiTests(h: Harness): Promise<void> {
  await h.test('M9: Make it sends one ember from the button, as large as fits in it (48 in the 52 button), on morph to the Making page’s 128, scaled uniformly; only it is seen on the way, the Making page’s own once it lands', async () => {
    const row = fs.readFileSync(path.join(process.cwd(), 'docs/design/system.md'), 'utf8').split('\n').find((line) => line.startsWith('| M9 Make it |'));
    const size = Number(/sets out from Make it at (\d+) \(or the button's height, if less\)/.exec(row ?? '')?.[1]);
    h.eq(MAKE_IT_EMBER, Math.min(size, LAYOUT.buttonHeight.large), `the place is system.md’s M9 size (${size}), or the button’s height where that is less`);
    const { tree, release } = await makeIt();
    try {
      h.eq(travels().length, 1, 'one travel, on the morph spring');
      const start = flying(tree)!;
      const at = centre(SOURCE, TARGET, 0);
      h.ok(start !== null && close(start.x + TARGET.width / 2, at.x) && close(start.y + TARGET.height / 2, at.y), 'it sets out over the centre of Make it’s place, measured on the frame');
      h.eq([start.scale, start.opacity], [MAKE_IT_EMBER / 128, 1], `at the place’s size: ${MAKE_IT_EMBER} of the 128`);
      h.ok(seenEmbers(tree).length === 1 && inside(seenEmbers(tree)[0], start.node), 'one ember seen, the travelling one: the Making page’s own waits unseen');
      await run(() => elapseSprings(120));
      const mid = flying(tree)!;
      const p = progressOf(mid.scale);
      const there = centre(SOURCE, TARGET, p);
      h.ok(p > 0.05 && p < 0.95 && close(mid.x + TARGET.width / 2, there.x) && close(mid.y + TARGET.height / 2, there.y), `on its way, between the two places (${p.toFixed(2)})`);
      h.eq(seenEmbers(tree).length, 1, 'still one ember seen');
      await run(() => elapseSprings(3000));
      h.ok(flying(tree) === null, 'landed, the layer draws nothing');
      h.ok(seenEmbers(tree).length === 1 && inside(seenEmbers(tree)[0], making(tree)), 'one ember seen, the Making page’s own');
    } finally { await leave(tree, release); }
  });

  await h.test('M9: as the travel sets out, one ember is seen on every frame — at Make it until the layer has measured where to draw the travelling one, then only that one', async () => {
    const { tree, release } = await makeIt(false, false);
    try {
      h.ok(travels().length === 1 && flying(tree) === null, 'the travel has set out, and the layer, not yet measured, draws nothing');
      h.ok(seenEmbers(tree).length === 1 && inside(seenEmbers(tree)[0], plan(tree)), 'so the ember is seen at Make it');
      await run(() => elapseSprings(0));
      const start = flying(tree)!;
      h.ok(seenEmbers(tree).length === 1 && inside(seenEmbers(tree)[0], start.node), 'from the first frame the layer draws it, only the travelling ember');
    } finally { await leave(tree, release); }
    const idle = await renderScreen(<Flow />, { createNodeMock: nodeMock });
    try {
      h.eq(seenEmbers(idle).length, 0, 'before Make it is taken, no ember is seen on the plan page');
    } finally { await unmountScreen(idle); }
  });

  await h.test('M9: the plan fades out on fade-out under the Making page as its light, words, steps and Stop fade in on fade-in; no text moves, and the travelling ember is not faded', async () => {
    const { tree, release } = await makeIt();
    try {
      const planned = [COPY.planBuild, `“${WORDS}”`].map((text) => seen(textIn(plan(tree), text)));
      h.ok(planned.every((one) => one.opacity === 1 && !one.moved && one.scale === 1), 'on the first frame the plan is still whole, in place');
      h.eq(timed(0, FADE_OUT, false), 1, 'one fade-out takes the plan');
      h.ok(makingParts(tree).every((part) => same(seen(part), { opacity: 0, scale: 1, moved: false })), 'the Making page’s light, words, steps and Stop start unseen, in place');
      h.ok(timed(1, FADE_IN, false) >= 1, 'and fade in on fade-in');
      h.eq(flying(tree)!.opacity, 1, 'the travelling ember is whole');
      await run(release);
      h.eq(makingParts(tree).map((part) => seen(part)), [1, 1, 1, 1, ambientOpacity(0)].map((opacity) => ({ opacity, scale: 1, moved: false })), 'faded in, every one is whole in its place, the light at its own opacity');
      h.eq(plan(tree), undefined, 'and the plan, faded out with the ember landed, has gone');
    } finally { await leave(tree, release); }
  });

  await h.test('M9 under Reduce Motion (pair): off, the ember travels and the Making page’s own waits; on, nothing travels — the whole Making page, its ember too, cross-fades in over the plan fading out', async () => {
    const play = async (on: boolean) => {
      const { tree, release } = await makeIt(on);
      try {
        const own = embers(tree).filter((ember) => inside(ember, making(tree)));
        return {
          travels: travels().length,
          flying: flying(tree) !== null,
          own: own.map((ember) => seen(ember).opacity),
          planOut: timed(0, FADE_OUT, on),
          makingIn: timed(1, FADE_IN, on) > 0,
          plainFades: timed(1, FADE_IN, !on) + timed(0, FADE_OUT, !on),
        };
      } finally { await leave(tree, release); }
    };
    h.eq(await play(false), { travels: 1, flying: true, own: [], planOut: 1, makingIn: true, plainFades: 0 }, 'off: one travel; the Making page draws no ember of its own until it lands');
    h.eq(await play(true), { travels: 0, flying: false, own: [0], planOut: 1, makingIn: true, plainFades: 0 }, 'on: no travel; the Making page’s own ember starts unseen and fades in with the page, every fade the reduced one the root ReducedMotionConfig plays');
  });

  await h.test('M9: the plan page leaving under the Making page gives up its step back at once — no back control, and Android back is the sheet’s close again', async () => {
    const { tree, release } = await makeIt();
    try {
      h.ok(plan(tree) !== undefined, 'the plan is still there, fading');
      h.eq(tree.root.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === COPY.backLabel).length, 0, 'the sheet’s back control has gone with the plan’s step back');
    } finally { await leave(tree, release); }
  });

  await h.test('M9: closing the sheet mid-travel ends the moment at once — the ember on the Making page, nothing travelling, everything whole', async () => {
    const { tree, release } = await makeIt();
    try {
      await run(() => elapseSprings(60));
      h.ok(flying(tree) !== null, 'mid-travel');
      await press(button(tree, COPY.sheetClose));
      h.eq(flying(tree), null, 'nothing travels');
      h.ok(seenEmbers(tree).length === 1 && inside(seenEmbers(tree)[0], making(tree)), 'the Making page’s own ember is the one seen');
      h.ok(makingParts(tree).slice(0, 4).every((part) => seen(part).opacity === 1), 'its words, steps and Stop whole');
    } finally { await leave(tree, release); }
  });

  // ── The marker moves down to the repair row (§7.1 Step list) ───────────────

  /** The Making page at stage `stage`, after `repairAttempt` repairs. */
  const page = (stage: Stage, repairAttempt?: number) => (
    <MakingPage name={NAME} changing={false} words={WORDS} stage={stage} delivering={false} repairAttempt={repairAttempt} signals={null} now={0} activity={0} onStop={() => {}} />
  );
  /** The step rows, as a screen reader reads each. */
  const rows = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'View' && typeof n.props.accessibilityLabel === 'string' && typeof n.props.onLayout === 'function');
  /** Lays out every row 44 high, 12 apart, as Yoga would. */
  const layOut = (tree: Tree) => run(() => rows(tree).forEach((row, i) => row.props.onLayout({ nativeEvent: { layout: { x: 0, y: i * 56, width: 300, height: 44 } } })));
  /** The marker: the ember ring with its dot, drawn over the list. */
  const marker = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'Animated.View' && flat(n).position === 'absolute' && n.findAll((m) => hostType(m) === 'View' && (flat(m).width === 8)).length === 1)[0];
  const markerAt = (tree: Tree) => {
    const style = flat(marker(tree));
    return { y: Object.assign({}, ...((style.transform as Style[] | undefined) ?? [])).translateY as number, opacity: style.opacity as number };
  };
  /** The y the marker sits at on row `i`: the 20 pt ring centred in the 44 row. */
  const rowMarkY = (i: number) => i * 56 + (44 - 20) / 2;

  await h.test('Step list: on a repair the marker moves down from the check to the new "Fixing a problem" row on snappy, staying on the check until that row is laid out', async () => {
    const tree = await renderScreen(page('check'), { createNodeMock: nodeMock });
    const release = holdAnimations();
    try {
      await layOut(tree);
      h.eq(markerAt(tree), { y: rowMarkY(2), opacity: 1 }, 'on the check, the third row');
      animations.splice(0);
      await TestRenderer.act(async () => tree.update(page('repair', 1)));
      h.eq(markerAt(tree).y, rowMarkY(2), 'the repair row not yet laid out, the marker stays on the check');
      await layOut(tree);
      const moves = animations.filter((a) => isStep(a) && a.kind === 'spring' && same(a.config, SNAPPY));
      h.eq(moves.map((a) => (a as { to: unknown }).to), [rowMarkY(3)], 'one move on snappy, to the repair row under the check');
      await run(() => elapseSprings(30));
      const mid = markerAt(tree);
      h.ok(mid.y > rowMarkY(2) && mid.y < rowMarkY(3) && mid.opacity === 1, `on its way down, seen (${mid.y.toFixed(1)})`);
      await run(() => elapseSprings(3000));
      h.eq(markerAt(tree), { y: rowMarkY(3), opacity: 1 }, 'on the repair row');
    } finally { await run(release); await unmountScreen(tree); }
  });

  await h.test('Step list under Reduce Motion (pair): off, the marker springs down to the repair row; on, it is there at once, fading in on the reduced fade-in', async () => {
    const play = async (on: boolean) => {
      const tree = await renderScreen(page('check'), { createNodeMock: nodeMock });
      await reduceMotion(on);
      const release = holdAnimations();
      try {
        await layOut(tree);
        animations.splice(0);
        await TestRenderer.act(async () => tree.update(page('repair', 1)));
        await layOut(tree);
        return {
          springs: animations.filter((a) => isStep(a) && a.kind === 'spring' && same(a.config, SNAPPY)).length,
          fades: timed(1, FADE_IN, true),
          at: markerAt(tree),
        };
      } finally {
        await run(release);
        await reduceMotion(false);
        await unmountScreen(tree);
      }
    };
    h.eq(await play(false), { springs: 1, fades: 0, at: { y: rowMarkY(2), opacity: 1 } }, 'off: a snappy move, still at the check on its first frame');
    h.eq(await play(true), { springs: 0, fades: 1, at: { y: rowMarkY(3), opacity: 0 } }, 'on: on the repair row at once, fading in from unseen');
  });
}
