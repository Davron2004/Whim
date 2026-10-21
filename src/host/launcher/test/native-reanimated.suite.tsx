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
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Harness } from './harness';
import { accessibilitySettings, emitAccessibility } from './native-host';
import { animations, elapse, holdAnimations, isLayoutAnimation, layoutAnimations, makeMutable, measuredRect, playedUnder, type LayoutAnimation } from './native-reanimated';
import { hostType, renderScreen, unmountScreen } from './react-screen';
import { useTokens } from '../../ui/tokens';
import { staggerDelay, timingOf } from '../../ui/tokens-pure';

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
      value.value = withTiming(5, { duration: 100, easing: Easing.bezier(0.2, 0, 0, 1) });
      let refused = false;
      try { elapse(10); } catch (error) { refused = error instanceof Error && error.message.includes('bezier'); }
      h.ok(refused, 'a bezier curve it cannot follow part way is refused, not guessed');
    } finally {
      release();
    }
    h.eq(value.value, 5, 'released, the last timing lands');
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

  await h.test('reanimated double: measure reports the set rect for a mounted view and null once it goes', async () => {
    let ref!: ReturnType<typeof useAnimatedRef<View>>;
    function Probe() {
      ref = useAnimatedRef<View>();
      return <Animated.View ref={ref} />;
    }
    const before = { ...measuredRect };
    const tree = await renderScreen(<Probe />, { createNodeMock: () => ({}) });
    try {
      h.eq(measure(ref), measuredRect, 'the default rect');
      Object.assign(measuredRect, { pageX: 24, pageY: 300, width: 96, height: 96 });
      h.eq(measure(ref), { x: 0, y: 0, width: 96, height: 96, pageX: 24, pageY: 300 }, 'the rect the test set');
    } finally {
      await unmountScreen(tree);
      Object.assign(measuredRect, before);
    }
    h.eq(measure(ref), null, 'an unmounted view measures null');
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
    await act(() => tree.update(<Probe leaving />));
    await unmountScreen(tree);
    h.eq(layoutAnimations.slice(1).map((e) => [e.phase, e.component, e.animation.preset, e.animation.config]), [['exiting', 'Animated.View', 'FadeOut', { duration: 120 }]], 'the exiting animation it last had, logged as it unmounts');
    h.eq([FadeIn, FadeOut].map((preset) => isLayoutAnimation(preset) && preset.calls.length), [0, 0], 'building never changes the preset');
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
