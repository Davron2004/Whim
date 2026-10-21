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
import { animations, cancelled, elapse, holdAnimations, isStep, type Animation, type Step } from './native-reanimated';
import { hostType, renderScreen, textOf, unmountScreen } from './react-screen';
import { Notice } from '../../ui/Notice';
import { Skeleton, SkeletonBlock } from '../../ui/Skeleton';
import { AmbientLight, Ember } from '../../ui/Ember';
import { TilePlate } from '../../ui/AppTile';
import { ambientOpacity, flickerOffset } from '../../ui/tokens-pure';
import MakingPage from '../MakingPage';
import Orb from '../Orb';
import type { FlickerPulse } from '../home-live';
import type { RunSignals } from '../prompt-flow';
import { createRunLight, lightArrived } from '../run-light';
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

/** §4.6's flicker: its amplitude per unit of `ã`, and how long after an arrival it lasts. */
function flickerDoc() {
  const m = doc(/Flicker amplitude `([\d.]+)·ã`, only while a token arrived in the last (\d+) ms; timing from token\s+arrivals, never a timer/, '§4.6 flicker');
  return { amplitude: +m[1], windowMs: +m[2] };
}

const noop = () => {};
/** A run that is writing: a token a moment ago. */
const WRITING: RunSignals = { startedAt: 0, aggregates: { chars: 10, tokens: 3 }, lastTokenAt: 1_000, lastThinkingAt: null, lastFrameAt: 1_000 };

/** The body of the ember `ember` draws: the faded layer holding the flame's gradient (centred low). */
const emberBody = (ember: Node): Node =>
  ember.find((v) => hostType(v) === 'Animated.View' && style(v).opacity !== undefined && v.findAll((n) => hostType(n) === 'RadialGradient' && n.props.cy === '74%').length === 1);

/** The five lights M20 flickers (system.md §4.4), each drawn for a run streaming at `activity` with
 *  the run's pulse, and the view whose opacity is that light. */
const LIGHTS: { name: string; draw: (activity: number, pulse?: FlickerPulse) => React.ReactElement; light: (tree: TestRenderer.ReactTestRenderer) => Node }[] = [
  {
    name: 'the making ember',
    draw: (activity, pulse) => <MakingPage name="Tea timer" changing={false} words="A tea timer" stage="generate" delivering={false} stepSince={0} signals={WRITING} now={1_500} activity={activity} flicker={pulse} onStop={noop} />,
    light: (tree) => emberBody(tree.root.findByType(Ember)),
  },
  {
    name: 'the making ambient light',
    draw: (activity, pulse) => <MakingPage name="Tea timer" changing={false} words="A tea timer" stage="generate" delivering={false} stepSince={0} signals={WRITING} now={1_500} activity={activity} flicker={pulse} onStop={noop} />,
    light: (tree) => tree.root.findByType(AmbientLight).find((v) => hostType(v) === 'Animated.View'),
  },
  {
    name: 'a ghost tile’s ember',
    draw: (activity, pulse) => <TilePlate size="grid" state="making" tint="rose" glyph="coffee" activity={activity} flicker={pulse} />,
    light: (tree) => emberBody(tree.root.findByType(Ember)),
  },
  {
    name: 'a changing tile’s ring',
    draw: (activity, pulse) => <TilePlate size="grid" state="changing" tint="rose" glyph="coffee" activity={activity} flicker={pulse} />,
    light: (tree) => tree.root.find((v) => hostType(v) === 'Animated.View' && style(v).position === 'absolute' && v.findAll((n) => hostType(n) === 'Path' && n.props.stroke === COLORS.light.ember).length === 1),
  },
  {
    name: 'the orb',
    draw: (activity, pulse) => <Orb appId="flicker" state="changing" activity={activity} flicker={pulse} onOpen={noop} />,
    light: (tree) => emberBody(tree.root.findByType(Ember)),
  },
];

const opacityOf = (node: Node): number => style(node).opacity as number;

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

  await h.test('Ember: the halo is drawn whole — its circle lies inside the drawing, so no edge of it is cut flat — at every size', async () => {
    for (const size of [20, 24, 48, 96, 128] as const) {
      const tree = await renderScreen(<Ember size={size} state="working" activity={1} />);
      try {
        const halo = all(tree, 'Circle')[0];
        const svg = all(tree, 'Svg').find((v) => v.findAll((n) => hostType(n) === 'Circle').length > 0)!;
        const [x, y, w, hh] = String(svg.props.viewBox).split(' ').map(Number);
        const { cx, cy, r } = halo.props as { cx: number; cy: number; r: number };
        h.ok(cx - r >= x && cy - r >= y && cx + r <= x + w && cy + r <= y + hh, `at ${size} the halo circle (${cx - r}..${cx + r} × ${cy - r}..${cy + r}) fits the viewBox ${svg.props.viewBox}`);
      } finally { await unmountScreen(tree); }
    }
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

  await h.test('honest light: the flicker moves a light by 0.06·ã of the pulse, ã clamped to 0–1, and not at all when off', () => {
    const { amplitude } = flickerDoc();
    for (const a of [0, 0.25, 1]) {
      for (const pulse of [1, -1, 0.5]) h.ok(Math.abs(flickerOffset(true, a, pulse) - amplitude * a * pulse) < 1e-12, `ã ${a}, pulse ${pulse}: ${amplitude}·ã·pulse`);
    }
    h.eq([flickerOffset(true, 1.7, 1), flickerOffset(true, -0.3, 1), flickerOffset(true, Number.NaN, 1)], [amplitude, 0, 0], 'ã past full is full; below none or unknown is none');
    h.eq(flickerOffset(false, 1, 1), 0, 'a light that does not flicker (stuck, Reduce Motion) moves not at all');
  });

  await h.test('honest light: each arrival kicks the run’s pulse, alternating, between half and full height; it is gone 500 ms after the last one; arrivals within a frame kick once', async () => {
    const { windowMs } = flickerDoc();
    const run = createRunLight();
    const release = holdAnimations();
    try {
      const kicks: number[] = [];
      for (let i = 0; i < 6; i++) {
        lightArrived(run, 10_000 + i * 40);
        kicks.push(run.pulse.value);
      }
      h.ok(kicks.every((k) => Math.abs(k) >= 0.5 && Math.abs(k) <= 1), `every kick between half and full height: ${kicks.map((k) => k.toFixed(2)).join(', ')}`);
      h.ok(kicks.every((k, i) => i === 0 || Math.sign(k) === -Math.sign(kicks[i - 1])), 'each kick the other way from the one before');
      const last = run.pulse.value;
      lightArrived(run, 10_000 + 5 * 40 + 5);
      h.eq(run.pulse.value, last, 'an arrival 5 ms after the last kicks nothing more');
      elapse(windowMs - 1);
      h.ok(run.pulse.value !== 0, `${windowMs - 1} ms after the last arrival the pulse still stands`);
      elapse(2);
      h.eq(run.pulse.value, 0, `${windowMs + 1} ms after it, it is gone`);
    } finally {
      release();
    }
    h.eq(createRunLight().pulse.value, 0, 'a run with no arrival has no pulse at all');
  });

  await h.test('honest light: an arrival flickers every light of the run (making ember, ambient light, ghost tile, changing ring, orb) by 0.06·ã of the same pulse, until 500 ms pass with no other', async () => {
    const { amplitude, windowMs } = flickerDoc();
    for (const { name, draw, light } of LIGHTS) {
      const run = createRunLight();
      const tree = await renderScreen(draw(1, run.pulse));
      const release = holdAnimations();
      try {
        const rest = opacityOf(light(tree));
        await act(() => lightArrived(run, 10_000));
        const moved = opacityOf(light(tree)) - rest;
        h.ok(Math.abs(moved - amplitude * run.pulse.value) < 1e-9 && moved !== 0, `${name}: moved ${moved.toFixed(4)}, ${amplitude}·1·pulse`);
        await act(() => elapse(windowMs - 1));
        h.ok(opacityOf(light(tree)) !== rest, `${name}: still flickering ${windowMs - 1} ms after the arrival`);
        await act(() => elapse(2));
        h.eq(opacityOf(light(tree)), rest, `${name}: still again ${windowMs + 1} ms after it`);
      } finally {
        await act(release);
        await unmountScreen(tree);
      }
    }
  });

  await h.test('honest light: without an arrival nothing flickers, however high the sampled activity — each light rests at the intensity its activity gives', async () => {
    const light = honestLight();
    for (const { name, draw, light: lit } of LIGHTS) {
      const run = createRunLight();
      // The ambient light's opacity carries the activity through its own curve; every other light is the intensity itself.
      const resting = (a: number) => (name === 'the making ambient light' ? ambientOpacity(a) : light.base + light.gain * a);
      const tree = await renderScreen(draw(1, run.pulse));
      try {
        for (const activity of [0.2, 1]) {
          await act(() => tree.update(draw(activity, run.pulse)));
          h.ok(Math.abs(opacityOf(lit(tree)) - resting(activity)) < 1e-9, `${name} at sampled activity ${activity}: ${opacityOf(lit(tree))}, no flicker`);
        }
        h.eq(run.pulse.value, 0, `${name}: the run’s pulse never moved`);
      } finally {
        await unmountScreen(tree);
      }
    }
  });

  await h.test('honest light under Reduce Motion: an arrival kicks the pulse but moves no light', async () => {
    const { windowMs } = flickerDoc();
    accessibilitySettings.reduceMotion = true;
    try {
      for (const { name, draw, light } of LIGHTS) {
        const run = createRunLight();
        const tree = await renderScreen(draw(1, run.pulse));
        const release = holdAnimations();
        try {
          const rest = opacityOf(light(tree));
          await act(() => lightArrived(run, 10_000));
          h.ok(run.pulse.value !== 0, `${name}: the arrival did kick the pulse`);
          h.eq(opacityOf(light(tree)), rest, `${name}: but the light does not move`);
          await act(() => elapse(windowMs + 1));
          h.eq(opacityOf(light(tree)), rest, `${name}: nor after`);
        } finally {
          await act(release);
          await unmountScreen(tree);
        }
      }
    } finally {
      await resetPhone();
    }
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
