/**
 * Skeleton — a promise of content (system.md §7.1, M19): `fill-strong` blocks in the exact geometry
 * and count of what they stand in for (the real component exports those constants; pass them to
 * `SkeletonBlock`). Nothing shows for the first 300 ms of a local load; then the whole group
 * breathes between 0.34 and 0.72 over 1.9 s, or sits still at 0.6 under Reduce Motion. To a
 * screen reader the group is one busy element named by `label`; the blocks are hidden.
 */

import React, { useEffect } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTokens } from './tokens';
import { SKELETON } from './tokens-pure';

export interface SkeletonProps {
  /** What is loading, for screen readers ("Loading your apps"). */
  label: string;
  children: React.ReactNode;
  /** Layout of the group (the same as the content it stands in for). */
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ label, children, style }: Readonly<SkeletonProps>) {
  const t = useTokens();
  const opacity = useSharedValue(0);
  useEffect(() => {
    const now = { duration: 0, reduceMotion: ReduceMotion.Never };
    if (t.reduceMotion) {
      opacity.value = withDelay(SKELETON.delay, withTiming(SKELETON.reduced, now));
    } else {
      const half = { duration: SKELETON.halfCycle };
      const breathe = withRepeat(withSequence(withTiming(SKELETON.to, half), withTiming(SKELETON.from, half)), -1);
      opacity.value = withDelay(SKELETON.delay, withSequence(withTiming(SKELETON.from, now), breathe));
    }
    return () => cancelAnimation(opacity);
  }, [opacity, t.reduceMotion]);
  const breath = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[style, breath]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
    >
      {children}
    </Animated.View>
  );
}

export interface SkeletonBlockProps {
  width: DimensionValue;
  height: number;
  /** Corner radius; default 0. */
  radius?: number;
}

/** One `fill-strong` block of a skeleton. */
export function SkeletonBlock({ width, height, radius = 0 }: Readonly<SkeletonBlockProps>) {
  const t = useTokens();
  return (
    <View
      style={{ width, height, borderRadius: radius, backgroundColor: t.colors['fill-strong'] }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    />
  );
}
