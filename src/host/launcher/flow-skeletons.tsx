/**
 * flow-skeletons — the shell's loading placeholders (`sdk-design-system` spec "Loading skeletons
 * derive their geometry from exported component constants"; design D9).
 *
 * Two rules, both enforced by construction here: `breathe` is the ONLY loading motion (no shimmer
 * sweep, no travelling gradient), and every dimension is imported from the real component's
 * exported size constants — a literal in a skeleton style is the defect, because the layout would
 * jump when the real thing arrives. A skeleton is drawn only where the thing is genuinely coming
 * AND its shape is already known: `HomeGridSkeleton` renders nothing for a count of zero, since an
 * empty grid gets an empty-state affordance, never a skeleton.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { MOTION } from '../../sdk/theme';
import { APP_TILE_RADIUS, APP_TILE_SIZE } from './app-tile';

export interface BreathingViewProps {
  style?: StyleProp<ViewStyle>;
  /** Staggers a row/tile against its neighbours; the cycle itself is identical for all of them. */
  delayMs?: number;
}

/** One `breathe`-animated block: opacity `MOTION.breathe.opacityFrom` → `opacityTo` over its
 *  duration, ease-in-out, forever. The one motion a skeleton is allowed. */
export function BreathingView({ style, delayMs = 0 }: Readonly<BreathingViewProps>) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const half = MOTION.breathe.durationMs / 2;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, { toValue: 1, duration: half, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(progress, { toValue: 0, duration: half, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    const timer = setTimeout(() => loop.start(), delayMs);
    return () => {
      clearTimeout(timer);
      loop.stop();
    };
  }, [progress, delayMs]);

  const opacity = useMemo(
    () => progress.interpolate({ inputRange: [0, 1], outputRange: [MOTION.breathe.opacityFrom, MOTION.breathe.opacityTo] }),
    [progress],
  );

  return <Animated.View style={[style, { opacity }]} />;
}

export interface HomeGridSkeletonProps {
  /** How many tiles are known to be coming. Zero renders nothing at all. */
  count: number;
  columns: number;
  gap: number;
  color: string;
}

/** The home grid's loading state: the EXACT tile geometry and the known count, so the grid does
 *  not move when the real tiles land. */
export function HomeGridSkeleton({ count, columns, gap, color }: Readonly<HomeGridSkeletonProps>) {
  if (count <= 0) return null;
  return (
    <View style={[styles.grid, { gap }]} accessibilityRole="progressbar">
      {Array.from({ length: count }, (_, i) => (
        <BreathingView
          key={`tile-${i}`}
          delayMs={(i % columns) * 120}
          style={[styles.tile, { backgroundColor: color }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: APP_TILE_SIZE, height: APP_TILE_SIZE, borderRadius: APP_TILE_RADIUS },
});
