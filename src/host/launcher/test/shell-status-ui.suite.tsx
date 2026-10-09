/** The shell's status primitives (design-system-v1 chain-10; system.md §3.3, §4.4–§4.6, §7.1):
 *  Notice, Skeleton, Ember and AmbientLight. Numbers that define the honest light, the breathe and
 *  the reduced forms are read from system.md itself; motion is read from what each primitive asks
 *  Reanimated for. */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { accessibilitySettings, setColorScheme, StyleSheet, windowMetrics } from './native-host';
import { animations, cancelled, isStep, type Animation, type Step } from './native-reanimated';
import { hostType, renderScreen, textOf, unmountScreen } from './react-screen';
import { Notice } from '../../ui/Notice';
import { Skeleton, SkeletonBlock } from '../../ui/Skeleton';
import { AmbientLight, Ember } from '../../ui/Ember';
import { COLORS, SPRINGS, TIMINGS } from '../../../design/tokens';
import { ICON_PATHS } from '../../../design/icons/paths';
import { EMBER_PATH } from '../../../design/icons/ember';

type Node = TestRenderer.ReactTestInstance;
type Style = Record<string, unknown>;

const SYSTEM_MD = fs.readFileSync(path.join(process.cwd(), 'docs/design/system.md'), 'utf8');

const act = (fn: () => void) => TestRenderer.act(async () => { fn(); });
const style = (node: Node): Style => StyleSheet.flatten(node.props.style) as Style;
const all = (tree: TestRenderer.ReactTestRenderer, name: string) => tree.root.findAll((n) => hostType(n) === name);
const one = (tree: TestRenderer.ReactTestRenderer, name: string): Node => {
  const found = all(tree, name);
  if (found.length !== 1) throw new Error(`Expected one ${name}, got ${found.length}`);
  return found[0];
};

function doc(pattern: RegExp, what: string): RegExpExecArray {
  const m = pattern.exec(SYSTEM_MD);
  if (!m) throw new Error(`system.md no longer states ${what}`);
  return m;
}

/** §4.6's honest light: intensity base and gain, the smoothing response, the stuck level and ease. */
function honestLight() {
  const intensity = doc(/`I = ([\d.]+) \+ ([\d.]+)·ã`, `ã` = `a` smoothed by a critically damped spring, response ([\d.]+) s/, '§4.6 intensity');
  const stuck = doc(/`I` eases to ([\d.]+) over ([\d.]+) s and holds still/, '§4.6 stuck');
  return { base: +intensity[1], gain: +intensity[2], response: +intensity[3], stuck: +stuck[1], stuckMs: +stuck[2] * 1000 };
}

/** Where an animation comes to rest and every spring/timing it is made of, depth first. */
function leaves(a: Animation): Step[] {
  if (isStep(a)) return [a];
  if (a.kind === 'sequence') return a.animations.flatMap(leaves);
  return leaves(a.animation);
}

/** Hidden from VoiceOver and TalkBack, drawing included. */
const hidden = (node: Node) =>
  node.props.accessible === false && node.props.accessibilityElementsHidden === true && node.props.importantForAccessibility === 'no-hide-descendants';

async function resetPhone(): Promise<void> {
  await act(() => setColorScheme('light'));
  accessibilitySettings.reduceMotion = false;
  windowMetrics.fontScale = 1;
}

export async function runShellStatusUiTests(h: Harness): Promise<void> {
  await h.test('Notice: neutral is fill with info, danger is danger-soft with circle-alert and an alert to screen readers', async () => {
    const neutral = await renderScreen(<Notice message="Whim's server is busy." />);
    const block = all(neutral, 'View').find((v) => v.props.accessible === true)!;
    h.eq([style(block).backgroundColor, block.props.accessibilityRole, block.props.accessibilityLabel], [COLORS.light.fill, 'text', "Whim's server is busy."], 'a neutral notice');
    h.eq(all(neutral, 'Path').map((p) => p.props.d), [ICON_PATHS.info], 'with info');
    await unmountScreen(neutral);
    const danger = await renderScreen(<Notice tone="danger" message="Couldn't reach Whim." countdown="Trying again in 0:12" />);
    const alert = all(danger, 'View').find((v) => v.props.accessible === true)!;
    h.eq([style(alert).backgroundColor, alert.props.accessibilityRole], [COLORS.light['danger-soft'], 'alert'], 'a danger notice is an alert on danger-soft');
    h.eq(all(danger, 'Path').map((p) => [p.props.d, p.props.stroke]), [[ICON_PATHS['circle-alert'], COLORS.light['danger-text']]], 'with circle-alert in danger-text');
    h.eq(alert.props.accessibilityLabel, "Couldn't reach Whim. Trying again in 0:12", 'the countdown is read with the message');
    const countdown = all(danger, 'Text').find((t) => textOf(t) === 'Trying again in 0:12')!;
    h.eq(style(countdown).fontVariant, ['tabular-nums'], 'the countdown ticks in tabular figures');
    await unmountScreen(danger);
  });

  await h.test('Skeleton: nothing for 300 ms, then the group breathes as the breathe timing says; blocks are fill-strong', async () => {
    const breathe = doc(/\| `breathe` \| (\d+) ms cycle, opacity ([\d.]+)–([\d.]+), after (\d+) ms \|/, '§4.2 breathe');
    const [cycle, from, to, delay] = breathe.slice(1).map(Number);
    animations.splice(0);
    const tree = await renderScreen(
      <Skeleton label="Loading your apps">
        <SkeletonBlock width={64} height={64} radius={14} />
        <SkeletonBlock width="60%" height={12} />
      </Skeleton>,
    );
    const group = one(tree, 'Animated.View');
    h.eq([group.props.accessibilityRole, group.props.accessibilityLabel, group.props.accessibilityState], ['progressbar', 'Loading your apps', { busy: true }], 'one busy element to screen readers');
    const blocks = all(tree, 'View');
    h.eq(blocks.map((b) => [style(b).width, style(b).height, style(b).backgroundColor]), [[64, 64, COLORS.light['fill-strong']], ['60%', 12, COLORS.light['fill-strong']]], 'blocks in the geometry given, fill-strong');
    h.ok(blocks.every(hidden), 'blocks are hidden from screen readers');
    const start = animations.at(-1);
    h.eq(start?.kind === 'delay' ? start.delay : undefined, delay, `the first thing it does is wait ${delay} ms`);
    const steps = start ? leaves(start).map((a) => [a.to, (a.config as Style).duration]) : [];
    h.eq(steps, [[from, 0], [to, cycle / 2], [from, cycle / 2]], `then breathes ${from}–${to} over ${cycle} ms`);
    const repeat = start?.kind === 'delay' && start.animation.kind === 'sequence' ? start.animation.animations[1] : undefined;
    h.eq(repeat?.kind === 'repeat' ? repeat.count : undefined, -1, 'for as long as it shows');
    const before = cancelled.count;
    await unmountScreen(tree);
    h.eq(cancelled.count, before + 1, 'the breathe stops when the skeleton goes');
  });

  await h.test('Skeleton under Reduce Motion sits still at the documented opacity after the same wait', async () => {
    const still = Number(doc(/skeletons sit at ([\d.]+)/, '§4.5 skeletons')[1]);
    accessibilitySettings.reduceMotion = true;
    animations.splice(0);
    const tree = await renderScreen(<Skeleton label="Loading"><SkeletonBlock width={10} height={10} /></Skeleton>);
    const start = animations.filter((a) => a.kind === 'delay').at(-1);
    h.eq(start ? leaves(start).map((a) => [a.to, (a.config as Style).reduceMotion]) : [], [[still, 'never']], `one step to ${still}, nothing repeating`);
    h.eq(style(one(tree, 'Animated.View')).opacity, still, `and it rests at ${still}`);
    await unmountScreen(tree);
    await resetPhone();
  });

  await h.test('Ember working: intensity follows activity through the critically damped 0.6 s spring', async () => {
    const light = honestLight();
    const tree = await renderScreen(<Ember size={48} state="working" activity={0} />);
    // The body is the faded layer holding the flame's gradient (centred low, at 74%).
    const holdsFlameGradient = (v: Node) => v.findAll((n) => hostType(n) === 'RadialGradient' && n.props.cy === '74%').length === 1;
    const body = () => all(tree, 'Animated.View').find((v) => style(v).opacity !== undefined && holdsFlameGradient(v))!;
    h.ok(Math.abs((style(body()).opacity as number) - light.base) < 1e-9, `idle intensity ${light.base}`);
    animations.splice(0);
    await TestRenderer.act(async () => tree.update(<Ember size={48} state="working" activity={0.5} />));
    const spring = animations.filter(isStep).find((a) => a.kind === 'spring' && Math.abs((a.to as number) - (light.base + light.gain * 0.5)) < 1e-9);
    h.ok(spring !== undefined, `half activity aims at ${light.base + light.gain * 0.5}`);
    const { mass, stiffness, damping } = (spring?.config ?? {}) as { mass: number; stiffness: number; damping: number };
    h.ok(Math.abs(Math.sqrt(stiffness / mass) - (2 * Math.PI) / light.response) < 1e-9, `response ${light.response} s`);
    h.ok(Math.abs(damping / (2 * Math.sqrt(stiffness * mass)) - 1) < 1e-9, 'critically damped');
    await unmountScreen(tree);
  });

  await h.test('Ember stuck dims to 35% over 1.5 s and holds still; out is the 1.5 pt text-2 outline alone', async () => {
    const light = honestLight();
    const tree = await renderScreen(<Ember size={96} state="working" activity={1} />);
    animations.splice(0);
    await TestRenderer.act(async () => tree.update(<Ember size={96} state="stuck" activity={1} />));
    const dim = animations.filter(isStep).find((a) => a.kind === 'timing' && a.to === light.stuck);
    h.eq((dim?.config as Style | undefined)?.duration, light.stuckMs, `eases to ${light.stuck} over ${light.stuckMs} ms`);
    h.eq(animations.some((a) => a.kind === 'repeat'), false, 'nothing loops');
    h.ok(all(tree, 'Path').some((p) => p.props.fill === COLORS.light['fill-strong']), 'the dim body sits on a fill-strong silhouette');
    animations.splice(0);
    await TestRenderer.act(async () => tree.update(<Ember size={96} state="out" />));
    h.ok(animations.filter(isStep).filter((a) => a.kind === 'timing').every((a) => a.to === 0 && (a.config as Style).duration === TIMINGS.fadeOut), 'the light fades out over fade-out');
    const outline = all(tree, 'Path').filter((p) => p.props.fill === 'none');
    h.eq(outline.length, 1, 'one outline');
    const width = (outline[0].props.strokeWidth * 96) / 48;
    h.eq([outline[0].props.d, outline[0].props.stroke, Math.round(width * 1000) / 1000], [EMBER_PATH, COLORS.light['text-2'], 1.5], 'the silhouette outlined 1.5 pt in text-2');
    await unmountScreen(tree);
  });

  await h.test('Ember: the 128 mark drops to 64 from 135% text; every ember is hidden from screen readers', async () => {
    const drop = doc(/128 drops to (\d+) from (\d+)% text/, '§3.3 large-text size');
    windowMetrics.fontScale = Number(drop[2]) / 100 - 0.01;
    const normal = await renderScreen(<Ember size={128} state="working" />);
    h.eq(style(all(normal, 'Animated.View')[0]).width, 128, 'full size below 135%');
    h.ok(hidden(all(normal, 'Animated.View')[0]), 'hidden from screen readers');
    await unmountScreen(normal);
    windowMetrics.fontScale = Number(drop[2]) / 100;
    const large = await renderScreen(<Ember size={128} state="working" />);
    h.eq(style(all(large, 'Animated.View')[0]).width, Number(drop[1]), `${drop[1]} from ${drop[2]}%`);
    await unmountScreen(large);
    const small = await renderScreen(<Ember size={48} state="working" />);
    h.eq(style(all(small, 'Animated.View')[0]).width, 48, 'other sizes keep their size');
    await unmountScreen(small);
    await resetPhone();
  });

  await h.test('Ember spark: a new value plays one flare on the spark spring; the first value and Reduce Motion play none', async () => {
    const peak = Number(doc(/Ember flares \(1 → ([\d.]+) → 1\)/, 'M10 flare')[1]);
    const spark = { mass: 1, stiffness: SPRINGS.spark.stiffness, damping: SPRINGS.spark.damping };
    animations.splice(0);
    const tree = await renderScreen(<Ember size={96} state="working" activity={1} spark={0} />);
    h.eq(animations.filter((a) => a.kind === 'sequence'), [], 'mounting with a spark value plays nothing');
    await TestRenderer.act(async () => tree.update(<Ember size={96} state="working" activity={1} spark={1} />));
    const flare = animations.filter((a) => a.kind === 'sequence');
    h.eq(flare.length === 1 ? leaves(flare[0]).map((a) => [a.to, a.config]) : flare, [[peak, spark], [1, spark]], `1 → ${peak} → 1 on spark`);
    await unmountScreen(tree);
    accessibilitySettings.reduceMotion = true;
    const reduced = await renderScreen(<Ember size={96} state="working" spark={0} />);
    animations.splice(0);
    await TestRenderer.act(async () => reduced.update(<Ember size={96} state="working" spark={1} />));
    h.eq(animations.filter((a) => a.kind === 'sequence'), [], 'no flare under Reduce Motion');
    await unmountScreen(reduced);
    await resetPhone();
  });

  await h.test('under Reduce Motion the ember is a still intensity per state, cross-faded', async () => {
    accessibilitySettings.reduceMotion = true;
    const quiet = await renderScreen(<Ember size={48} state="working" activity={0.1} />);
    const busy = await renderScreen(<Ember size={48} state="working" activity={0.9} />);
    const opacities = (tree: TestRenderer.ReactTestRenderer) => all(tree, 'Animated.View').map((v) => style(v).opacity);
    h.eq(opacities(quiet), opacities(busy), 'the stream no longer moves the light');
    animations.splice(0);
    await TestRenderer.act(async () => quiet.update(<Ember size={48} state="stuck" activity={0.1} />));
    h.ok(animations.length > 0 && animations.every((a) => a.kind === 'timing' && (a.config as Style).duration === TIMINGS.fadeIn && (a.config as Style).reduceMotion === 'never'), 'a state change cross-fades over fade-in');
    await unmountScreen(quiet);
    await unmountScreen(busy);
    await resetPhone();
  });

  await h.test('AmbientLight grows with activity on the same smoothing, never blocks touches, and is hidden', async () => {
    const tree = await renderScreen(<AmbientLight width={360} height={220} activity={0} />);
    const layer = one(tree, 'Animated.View');
    const idle = style(layer).opacity as number;
    h.ok(hidden(layer) && layer.props.pointerEvents === 'none', 'decorative and touch-transparent');
    animations.splice(0);
    await TestRenderer.act(async () => tree.update(<AmbientLight width={360} height={220} activity={1} />));
    const rise = animations.filter(isStep).find((a) => a.kind === 'spring');
    h.ok(rise !== undefined && (rise.to as number) > idle, `brighter when the stream is busy (${idle} → ${rise?.to})`);
    await unmountScreen(tree);
  });
}
