/** The Reanimated double's own contract (`native-reanimated.tsx`), which the shell-motion suites
 *  (design-system-v1 chain-22) lean on: value animations are recorded with their delays and land at
 *  their end, `interpolate` follows Reanimated's extrapolation modes, `useAnimatedReaction` reacts
 *  synchronously, `measure` reports a set rect, and Animated views log the layout animations they
 *  enter and exit with — enough for a Reduce Motion pair test to tell a component that handles the
 *  setting from one that doesn't. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import type { View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  interpolate,
  measure,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Harness } from './harness';
import { accessibilitySettings, emitAccessibility } from './native-host';
import { animations, cancelAnimation, cancelled, elapse, elapseSprings, emitNativeEvent, holdAnimations, useEvent, isLayoutAnimation, layoutAnimations, makeMutable, measuredRect, onUi, playedUnder, viewTagOf, type LayoutAnimation } from './native-reanimated';
import { hostType, renderScreen, unmountScreen } from './react-screen';
import { useTokens } from '../../ui/tokens';
import { springConfig, staggerDelay, timingOf } from '../../ui/tokens-pure';

const act = (fn: () => void) => TestRenderer.act(async () => { fn(); });

/** A row of a set's first appearance that handles Reduce Motion: it rises in, staggered, and under
 *  the setting cross-fades in place instead (§4.5), marked so the root config doesn't skip it. */
function CarefulRow({ index }: { index: number }) {
  const t = useTokens();
  const entering = t.reduceMotion
    ? FadeIn.duration(timingOf('fadeIn').duration).reduceMotion(ReduceMotion.Never)
    : FadeIn.springify().delay(staggerDelay(index, false));
  return <Animated.View entering={entering} />;
}

/** The same row, written without a thought for Reduce Motion. */
function CarelessRow({ index }: { index: number }) {
  return <Animated.View entering={FadeIn.springify().delay(staggerDelay(index, false))} />;
}

type Row = (props: { index: number }) => React.ReactElement;

/** A screen that follows the phone's settings and shows a three-row set once `rows` is set. */
function RowSet({ Row, rows }: { Row: Row; rows: boolean }) {
  useTokens();
  return rows ? <>{[0, 1, 2].map((i) => <Row key={i} index={i} />)}</> : null;
}

/** What each row of a three-row set plays as it enters, with the phone's Reduce Motion as given
 *  before the set appears. */
async function enteringPlayed(Row: Row, reduceMotion: boolean): Promise<(LayoutAnimation | null)[]> {
  accessibilitySettings.reduceMotion = reduceMotion;
  const tree = await renderScreen(<RowSet Row={Row} rows={false} />);
  try {
    await act(() => emitAccessibility('reduceMotionChanged', reduceMotion));
    layoutAnimations.splice(0);
    await act(() => tree.update(<RowSet Row={Row} rows />));
    return layoutAnimations.filter((e) => e.phase === 'entering').map((e) => playedUnder(e.animation, reduceMotion));
  } finally {
    accessibilitySettings.reduceMotion = false;
    await act(() => emitAccessibility('reduceMotionChanged', false));
    await unmountScreen(tree);
  }
}

/** The pair test a moment with a cross-fade reduced form makes: with the setting off every row plays
 *  a staggered entrance; with it on every row plays a `fade-in` cross-fade, at once. */
async function reducedFormHolds(Row: Row): Promise<boolean> {
  const full = await enteringPlayed(Row, false);
  const reduced = await enteringPlayed(Row, true);
  const staggered = full.length === 3 && full.every((a, i) => a?.config.delay === staggerDelay(i, false));
  const crossFade = reduced.length === 3 && reduced.every((a) => a?.preset === 'FadeIn' && a.config.duration === timingOf('fadeIn').duration && a.config.delay === undefined && a.config.springify === undefined);
  return staggered && crossFade;
}

/** A view whose reaction to `tick`, and whose handler for native `onScroll` events, each measure it. */
function MeasuringProbe({ tick, widths }: Readonly<{ tick: { readonly value: number }; widths: (number | null)[] }>) {
  const ref = useAnimatedRef<View>();
  const width = () => measure(ref)?.width ?? null;
  useAnimatedReaction(() => tick.value, (now) => { if (now > 0) widths.push(width()); });
  const handler = useEvent(() => { widths.push(width()); }, ['onScroll']);
  React.useEffect(() => {
    const viewTag = 7001;
    handler.workletEventHandler.registerForEvents(viewTag);
    return () => handler.workletEventHandler.unregisterFromEvents(viewTag);
  }, [handler]);
  return <Animated.View ref={ref} />;
}

function Faded({ value }: { value: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ opacity: value.value }));
  return <Animated.View style={style} />;
}

export async function runNativeReanimatedTests(h: Harness): Promise<void> {
  await h.test('reanimated double: a held timing moves along its curve as time elapses and lands at its end; a value made outside React is a shared value too', async () => {
    const value = makeMutable(0);
    const release = holdAnimations();
    try {
      value.value = withTiming(10, { duration: 100, easing: Easing.linear });
      elapse(50);
      h.eq(value.value, 5, 'half way through a straight timing, half way there');
      elapse(49);
      h.eq(value.value, 9.9, 'a millisecond before its end, nearly there');
      elapse(1);
      h.eq(value.value, 10, 'at its end it lands');
      value.value = withTiming(0, { duration: 100 });
      elapse(25);
      h.eq(value.value, 10 - 10 * 0.125, 'with no curve given, Reanimated’s default in-out quad: an eighth of the way at a quarter of the time');
      // cubic-bezier(0.2, 0, 0, 1) at t = ½: x = 3·¼·½·0.2 + ⅛ = 0.2 of the time, y = 3·½·¼ + ⅛ = ½ of the way.
      const from = value.value;
      value.value = withTiming(5, { duration: 100, easing: Easing.bezier(0.2, 0, 0, 1) });
      elapse(20);
      h.ok(Math.abs(value.value - (from + (5 - from) / 2)) < 1e-6, `a bezier timing follows its curve: half way there at a fifth of the time (${value.value})`);
    } finally {
      release();
    }
    h.eq(value.value, 5, 'released, the last timing lands');
  });

  await h.test('reanimated double: a held spring stays put while timings elapse; elapseSprings moves it by its physics to rest, and a spring assigned midway sets out from there with its velocity', async () => {
    const smooth = springConfig('smooth');
    // Critically damped (ζ = 1): x(t) = 1 − (1 + ωt)·e^(−ωt) from 0 to 1, ω = √(k/m).
    const omega = Math.sqrt(smooth.stiffness / smooth.mass);
    const closedForm = (ms: number) => 1 - (1 + (omega * ms) / 1000) * Math.exp((-omega * ms) / 1000);
    const value = makeMutable(0);
    const ends: (boolean | undefined)[] = [];
    const release = holdAnimations();
    try {
      value.value = withSpring(1, smooth, (finished) => ends.push(finished));
      elapse(100);
      h.eq(value.value, 0, 'a plain elapse leaves a held spring where it set out');
      elapseSprings(100);
      h.ok(Math.abs(value.value - closedForm(100)) < 0.01, `100 ms in, where the closed form puts it (${value.value.toFixed(3)} vs ${closedForm(100).toFixed(3)})`);
      const there = value.value;
      // Two springs from rest at `there`, to compare against: one on toward 2, one back to 0.
      const restOn = makeMutable(there);
      const restBack = makeMutable(there);
      restOn.value = withSpring(2, smooth);
      restBack.value = withSpring(0, smooth);
      value.value = withSpring(2, smooth);
      h.eq(value.value, there, 'a spring assigned midway starts from where the value is');
      h.eq(ends, [false], 'and the one it cut short hears it did not finish');
      elapseSprings(5);
      h.ok(value.value > restOn.value + 0.01, `on toward a further target, it keeps the velocity it took over: ahead of one from rest (${value.value.toFixed(4)} vs ${restOn.value.toFixed(4)})`);
      value.value = withSpring(0, smooth);
      const turned = value.value;
      const restTurned = makeMutable(turned);
      restTurned.value = withSpring(0, smooth);
      elapseSprings(5);
      h.ok(Math.abs(value.value - restTurned.value) < 1e-9, `turned back, the velocity that would carry it away is dropped (spring.ts:189-197): it moves as one from rest (${value.value} vs ${restTurned.value})`);
      elapseSprings(3000);
      h.eq([value.value, restBack.value], [0, 0], 'at rest it lands on its target');
    } finally {
      release();
    }
  });

  /** The time, in ms, the energy of a critically damped spring of `config` set out at rest is down
   *  to Reanimated 4.6's 6e-9 of its start (springUtils.ts:384-394), whatever the distance: with
   *  u = ωt, x = −(1+u)e^(−u)·d and v = ω²t·e^(−u)·d, so E/E₀ = e^(−2u)((1+u)² + u²) (m·ω² = k). */
  const settleMs = (config: { mass: number; stiffness: number }) => {
    const omega = Math.sqrt(config.stiffness / config.mass);
    const share = (u: number) => Math.exp(-2 * u) * ((1 + u) ** 2 + u ** 2);
    let [lo, hi] = [0, 100];
    for (let i = 0; i < 100; i++) [lo, hi] = share((lo + hi) / 2) > 6e-9 ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2];
    return (hi / omega) * 1000;
  };
  /** How many ms a held spring from `from` to `to` runs before it lands, and what its callback heard. */
  const runToRest = (from: number, to: number, config: { mass: number; stiffness: number; damping: number; energyThreshold?: number }) => {
    const value = makeMutable(from);
    const heard: (boolean | undefined)[] = [];
    const release = holdAnimations();
    let ms = 0;
    try {
      value.value = withSpring(to, config, (finished) => heard.push(finished));
      while (heard.length === 0 && ms < 5000) {
        elapseSprings(1);
        ms += 1;
      }
    } finally {
      release();
    }
    return { ms, heard, at: value.value };
  };
  const FRAME_MS = 1000 / 60;

  await h.test('reanimated double: a spring ends as Reanimated 4.6’s does, once its energy is down to a share of what it set out with — the same time over 1 point or 400', async () => {
    const smooth = springConfig('smooth');
    const expected = settleMs(smooth);
    const unit = runToRest(0, 1, smooth);
    h.ok(unit.ms >= expected && unit.ms - expected <= FRAME_MS, `0 → 1 on smooth ends within a frame after its energy is spent (${unit.ms} ms; the energy rule says ${expected.toFixed(1)} ms)`);
    h.eq([unit.heard, unit.at], [[true], 1], 'its callback hears it finished, and the value rests exactly on its target');
    const points = runToRest(0, 400, smooth);
    h.ok(Math.abs(points.ms - unit.ms) <= 1, `0 → 400 points ends when 0 → 1 does: the rule is relative (${points.ms} vs ${unit.ms} ms)`);
    const loose = runToRest(0, 1, { ...smooth, energyThreshold: 1e-3 });
    h.ok(loose.ms < unit.ms - 100, `a config’s own energyThreshold ends it sooner (${loose.ms} ms)`);
  });

  await h.test('reanimated double: a spring re-aimed at the same target while it runs carries on and ends when it would have; one toward where the value already is ends at once', async () => {
    const smooth = springConfig('smooth');
    const whole = runToRest(0, 1, smooth).ms;
    const value = makeMutable(0);
    const heard: string[] = [];
    const release = holdAnimations();
    let ms = 0;
    try {
      value.value = withSpring(1, smooth, (finished) => heard.push(`first ${finished}`));
      elapseSprings(300);
      ms = 300;
      value.value = withSpring(1, smooth, (finished) => heard.push(`again ${finished}`));
      while (heard.length < 2 && ms < 5000) {
        elapseSprings(1);
        ms += 1;
      }
      h.eq(heard, ['first false', 'again true'], 'the first hears it was cut short, the second that it finished');
      h.ok(Math.abs(ms - whole) <= 1, `it ends when the uninterrupted spring would (${ms} vs ${whole} ms), not a fresh spring’s settling time later`);
      value.value = withSpring(1, smooth, (finished) => heard.push(`spring there ${finished}`));
      value.value = withTiming(1, { duration: 300 }, (finished) => heard.push(`timing there ${finished}`));
      h.eq(heard.slice(2), ['spring there true', 'timing there true'], 'a spring or a timing toward where it already is finishes as it is assigned, held or not (valueSetter.ts:36-43)');
    } finally {
      release();
    }
  });

  await h.test('reanimated double: the callbacks inside withDelay and withSequence hear how the animation ended — landing, cut short by an assignment, by cancelAnimation, or by the unmount', async () => {
    const heard: string[] = [];
    const note = (name: string) => (finished?: boolean) => heard.push(`${name} ${finished}`);
    const value = makeMutable(0);
    value.value = withDelay(100, withSpring(1, undefined, note('delayed')));
    h.eq(heard, ['delayed true'], 'landing, a delayed spring’s callback hears it finished (delay.ts:100-104)');
    heard.splice(0);
    value.value = withSequence(withTiming(2, undefined, note('first')), withDelay(50, withTiming(3, undefined, note('second'))));
    h.eq(heard, ['first true', 'second true'], 'landing, a sequence calls each part’s callback, in order (sequence.ts:113-115)');
    heard.splice(0);
    const release = holdAnimations();
    try {
      value.value = withDelay(100, withSpring(0, undefined, note('delayed')));
      h.eq(heard, [], 'held, nothing has ended');
      value.value = withSequence(withTiming(1, undefined, note('first')), withTiming(2, undefined, note('second')));
      h.eq(heard, ['delayed false'], 'cut short by an assignment, the delayed spring hears it did not finish');
      cancelAnimation(value);
      h.eq(heard, ['delayed false', 'first false', 'second false'], 'cancelled, every part of the sequence that had not ended hears so, in order (sequence.ts:93-105)');
    } finally {
      release();
    }
    h.eq(heard.length, 3, 'and the release lands none of them');
  });

  await h.test('reanimated double: a component’s shared value cancels its animation as it unmounts, so a held one released after never lands', async () => {
    let shown!: SharedValue<number>;
    function Probe() {
      shown = useSharedValue(0);
      return <Faded value={shown} />;
    }
    const heard: (boolean | undefined)[] = [];
    const tree = await renderScreen(<Probe />);
    const release = holdAnimations();
    try {
      await act(() => { shown.value = withDelay(40, withSpring(1, springConfig('smooth'), (finished) => heard.push(finished))); });
      await unmountScreen(tree);
      h.eq(heard, [false], 'unmounted, its callback hears it did not finish (hook/useSharedValue.ts:36-40)');
    } finally {
      release();
    }
    h.eq([heard, shown.value], [[false], 0], 'released, it does not land');
  });

  await h.test('reanimated double: an animated style taken off a view leaves what the UI thread last set on it, until a style sets that property again', async () => {
    const opacity = makeMutable(1);
    function Fading({ attached, plain }: { attached: boolean; plain?: { opacity: number } }) {
      const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
      return <Animated.View style={[attached ? fade : null, plain]} />;
    }
    const seen = (tree: TestRenderer.ReactTestRenderer) => Object.assign({}, ...[tree.root.findAll((n) => hostType(n) === 'Animated.View')[0].props.style].flat(Infinity)).opacity;
    const tree = await renderScreen(<Fading attached />);
    try {
      await act(() => tree.update(<Fading attached={false} />));
      h.eq(seen(tree), 1, 'taken off at 1, it stays 1');
      await act(() => tree.update(<Fading attached />));
      await act(() => {
        opacity.value = 0.25;
        tree.update(<Fading attached={false} />);
      });
      h.eq(seen(tree), 0.25, 'moved to 0.25 by the UI thread as React takes it off, before React drew that value, the view stays at 0.25');
      await act(() => tree.update(<Fading attached={false} plain={{ opacity: 1 }} />));
      h.eq(seen(tree), 1, 'a style that sets it again wins');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('reanimated double: cancelAnimation stops a held timing where it stands, names the value it ran on, and the release no longer lands it', async () => {
    const value = makeMutable(0);
    const release = holdAnimations();
    try {
      value.value = withTiming(10, { duration: 100, easing: Easing.linear });
      elapse(30);
      cancelAnimation(value);
      h.ok(cancelled.values.includes(value), 'the cancel names the value it ran on');
      h.eq(value.value, 3, 'cancelled, the value stays where the timing had brought it');
      elapse(100);
      h.eq(value.value, 3, 'and time moves it no further');
    } finally {
      release();
    }
    h.eq(value.value, 3, 'released, the cancelled timing does not land');
  });

  await h.test('reanimated double: withDelay is recorded with its delay and lands at its end, or waits while held', async () => {
    let opacity!: SharedValue<number>;
    function Probe() {
      opacity = useSharedValue(0);
      return <Faded value={opacity} />;
    }
    const tree = await renderScreen(<Probe />);
    const shown = () => tree.root.findAll((n) => hostType(n) === 'Animated.View')[0].props.style.opacity;
    try {
      animations.splice(0);
      await act(() => { opacity.value = withDelay(staggerDelay(2, false), withTiming(1, { duration: 160 })); });
      h.eq(animations.map((a) => a.kind === 'delay' && [a.delay, a.animation.kind]), [[staggerDelay(2, false), 'timing']], 'one delayed timing, with the third item’s delay');
      h.eq(shown(), 1, 'the view settles where the animation ends');
      const release = holdAnimations();
      await act(() => { opacity.value = withDelay(30, withTiming(0.5)); });
      h.eq(shown(), 1, 'a held animation has not moved the view yet');
      await act(release);
      h.eq(shown(), 0.5, 'released, it lands');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('reanimated double: interpolate maps between points and extrapolates as Reanimated does', async () => {
    h.eq(interpolate(0.25, [0, 1], [0, 8]), 2, 'inside the range, linear');
    h.eq(interpolate(1.5, [0, 1, 2], [0, 10, 0]), 5, 'on the second segment');
    h.eq(interpolate(2, [0, 1], [0, 8]), 16, 'past the range it extends by default');
    h.eq(interpolate(2, [0, 1], [0, 8], Extrapolation.CLAMP), 8, 'clamped at the last output');
    h.eq(interpolate(-3, [0, 1], [0, 8], Extrapolation.IDENTITY), -3, 'identity returns the input');
    h.eq(interpolate(-1, [0, 1], [0, 8], { extrapolateLeft: Extrapolation.CLAMP }), 0, 'a left-only clamp');
    h.eq(interpolate(2, [0, 1], [0, 8], { extrapolateLeft: Extrapolation.CLAMP }), 16, 'leaves the right side extending');
  });

  await h.test('reanimated double: useAnimatedReaction runs at mount, then synchronously on each change, until unmounted', async () => {
    const seen: [number, number | null][] = [];
    let progress!: SharedValue<number>;
    function Probe() {
      progress = useSharedValue(0);
      useAnimatedReaction(() => Math.round(progress.value * 10), (now, before) => { seen.push([now, before]); });
      return null;
    }
    const tree = await renderScreen(<Probe />);
    h.eq(seen, [[0, null]], 'one run at mount, with no previous result');
    progress.value = 0.5;
    h.eq(seen, [[0, null], [5, 0]], 'an assignment reacts before the next statement, with the previous result');
    progress.value = withTiming(1);
    h.eq(seen.at(-1), [10, 5], 'an animation reacts with where it lands');
    await unmountScreen(tree);
    progress.value = 0;
    h.eq(seen.length, 3, 'nothing reacts once the component is gone');
  });

  await h.test('reanimated double: measure on the UI thread reports the set rect for a mounted view and null once it goes; on the JS thread it answers null', async () => {
    let ref!: ReturnType<typeof useAnimatedRef<View>>;
    function Probe() {
      ref = useAnimatedRef<View>();
      return <Animated.View ref={ref} />;
    }
    const before = { ...measuredRect };
    const tree = await renderScreen(<Probe />, { createNodeMock: () => ({}) });
    try {
      h.eq(measure(ref), null, 'called on the JS thread, it answers null (measure.native.ts:35-37)');
      h.eq(onUi(() => measure(ref)), measuredRect, 'in a worklet, the default rect');
      Object.assign(measuredRect, { pageX: 24, pageY: 300, width: 96, height: 96 });
      h.eq(onUi(() => measure(ref)), { x: 0, y: 0, width: 96, height: 96, pageX: 24, pageY: 300 }, 'the rect the test set');
    } finally {
      await unmountScreen(tree);
      Object.assign(measuredRect, before);
    }
    h.eq(onUi(() => measure(ref)), null, 'an unmounted view measures null');
  });

  await h.test('reanimated double: a reaction and a native event’s handler run on the UI thread, where measure measures', async () => {
    const widths: (number | null)[] = [];
    const probe = { tick: makeMutable(0) };
    const tree = await renderScreen(<MeasuringProbe tick={probe.tick} widths={widths} />, { createNodeMock: () => ({}) });
    try {
      probe.tick.value = 1;
      emitNativeEvent('onScroll', {});
      h.eq(widths, [measuredRect.width, measuredRect.width], 'the reaction and the event handler each measure the view');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('reanimated double: a ref never put on a view answers null when read and throws when measured on a UI frame, as on Android', async () => {
    let ref!: ReturnType<typeof useAnimatedRef<View>>;
    function Probe() {
      ref = useAnimatedRef<View>();
      return <Animated.View />;
    }
    const tree = await renderScreen(<Probe />, { createNodeMock: () => ({}) });
    try {
      h.eq(ref() as unknown, null, 'read with no view, it answers null');
      await h.throws(() => onUi(() => measure(ref)), 'expected an Object', 'measuring it on the UI thread throws');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('reanimated double: a style measuring a view gets null when a render runs it (the JS thread) and the rect when a shared value does (a UI frame)', async () => {
    let ref!: ReturnType<typeof useAnimatedRef<View>>;
    let value!: ReturnType<typeof useSharedValue<number>>;
    const widths: (number | null)[] = [];
    function Probe(_: Readonly<{ pass: number }>) {
      ref = useAnimatedRef<View>();
      value = useSharedValue(0);
      const style = useAnimatedStyle(() => {
        widths.push(value.value >= 0 ? (measure(ref)?.width ?? null) : null);
        return {};
      });
      return <Animated.View ref={ref} style={style} />;
    }
    const tree = await renderScreen(<Probe pass={0} />, { createNodeMock: () => ({}) });
    try {
      await TestRenderer.act(async () => { value.value = 1; });
      const framed = widths.length;
      await TestRenderer.act(async () => tree.update(<Probe pass={1} />));
      h.eq([widths[0], widths[framed - 1], widths[framed]], [null, measuredRect.width, null], 'null as it mounts, the view’s width on a UI frame, null again on the re-render’s own run');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('reanimated double: Animated views log their entering and exiting animations with every builder call', async () => {
    layoutAnimations.splice(0);
    function Probe({ leaving }: { leaving: boolean }) {
      return (
        <Animated.ScrollView>
          <Animated.Text entering={FadeIn.springify().duration(300).delay(30)}>Tea</Animated.Text>
          <Animated.View layout={LinearTransition.springify()} exiting={leaving ? FadeOut.duration(120) : FadeOut} />
        </Animated.ScrollView>
      );
    }
    const tree = await renderScreen(<Probe leaving={false} />);
    h.eq(['Animated.ScrollView', 'Animated.Text', 'Animated.View'].map((name) => tree.root.findAll((n) => hostType(n) === name).length), [1, 1, 1], 'each renders as its own host element');
    h.eq(layoutAnimations.map((e) => [e.phase, e.component, e.animation.preset, e.animation.config]), [['entering', 'Animated.Text', 'FadeIn', { springify: true, duration: 300, delay: 30 }]], 'the entering animation, logged at mount');
    h.eq(layoutAnimations[0].animation.calls.map((c) => c.name), ['springify', 'duration', 'delay'], 'its builder calls, in order');
    const view = tree.root.findAll((n) => hostType(n) === 'Animated.View')[0];
    h.eq([view.props.layout.preset, view.props.layout.config], ['LinearTransition', { springify: true }], 'the layout transition, readable as the prop');
    const tag = viewTagOf(view);
    await act(() => tree.update(<Probe leaving />));
    h.eq(viewTagOf(tree.root.findAll((n) => hostType(n) === 'Animated.View')[0]), tag, 're-rendered, it is the same native view');
    await unmountScreen(tree);
    h.eq(layoutAnimations.slice(1).map((e) => [e.phase, e.component, e.animation.preset, e.animation.config]), [['exiting', 'Animated.View', 'FadeOut', { duration: 120 }]], 'the exiting animation it last had, logged as it unmounts');
    h.eq([FadeIn, FadeOut].map((preset) => isLayoutAnimation(preset) && preset.calls.length), [0, 0], 'building never changes the preset');
    const again = await renderScreen(<Probe leaving={false} />);
    h.ok(viewTagOf(again.root.findAll((n) => hostType(n) === 'Animated.View')[0]) !== tag, 'mounted again, it is a new native view');
    await unmountScreen(again);
  });

  await h.test('reanimated double: under Reduce Motion an unmarked layout animation does not play; one marked Never does', async () => {
    h.eq(playedUnder(FadeIn.springify(), false)?.preset, 'FadeIn', 'with the setting off it plays');
    h.eq(playedUnder(FadeIn.springify(), true), null, 'with it on, the root config skips it: the view lands at once');
    h.eq(playedUnder(FadeIn.reduceMotion(ReduceMotion.Never), true)?.preset, 'FadeIn', 'marked Never, it plays anyway');
    h.eq(playedUnder(FadeIn.reduceMotion(ReduceMotion.Always), false), null, 'marked Always, it never plays');
    h.eq(playedUnder(undefined, false), null, 'no animation plays nothing');
  });

  await h.test('reanimated double: a Reduce Motion pair test passes a row that handles the setting and catches one that sets entering regardless', async () => {
    h.ok(await reducedFormHolds(CarefulRow), 'the careful row rises staggered, and cross-fades in place under Reduce Motion');
    h.ok(!(await reducedFormHolds(CarelessRow)), 'the careless row’s entrance is skipped under Reduce Motion, so it has no cross-fade: caught');
  });
}
