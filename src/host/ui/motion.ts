/**
 * motion — the shell's Reanimated helpers over the token springs and timings (system.md §4;
 * app-launcher "Shell motion runs on Reanimated with the named springs"). Every animation here
 * starts from the shared value's presentation value and retargets a running one; none blocks
 * input.
 */

import {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { PRESS_SCALE, REDUCED_PRESS, springConfig, timingOf, type PressKind, type ShellTokens, type TimingName } from './tokens-pure';

/** A token timing as Reanimated config. A reduced-motion replacement passes `reduced`, so the root
 *  `ReducedMotionConfig` doesn't skip the very fade that stands in for the motion. */
export function timing(name: TimingName, reduced = false) {
  const { duration, bezier } = timingOf(name);
  return {
    duration,
    easing: Easing.bezier(...bezier),
    ...(reduced ? { reduceMotion: ReduceMotion.Never } : {}),
  };
}

/** M1 Press: on touch-down scale to the kind's press scale with `instant`, release with `snappy`;
 *  under Reduce Motion, opacity 0.7 over 100 ms instead (§4.3 rule 5, §4.5). Spread `pressIn` and
 *  `pressOut` onto the Pressable and `style` onto the Animated.View it scales. */
export function usePressFeedback(kind: PressKind, t: Pick<ShellTokens, 'reduceMotion'>) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: opacity.value }));
  const reduced = { duration: REDUCED_PRESS.duration, reduceMotion: ReduceMotion.Never };
  return {
    style,
    pressIn: () => {
      if (t.reduceMotion) opacity.value = withTiming(REDUCED_PRESS.opacity, reduced);
      else scale.value = withSpring(PRESS_SCALE[kind], springConfig('instant'));
    },
    // Release restores both, so a setting changed mid-press never leaves a control dimmed or shrunk.
    pressOut: () => {
      opacity.value = withTiming(1, reduced);
      scale.value = t.reduceMotion ? withTiming(1, reduced) : withSpring(1, springConfig('snappy'));
    },
  };
}
