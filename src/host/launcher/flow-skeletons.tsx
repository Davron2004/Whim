/**
 * flow-skeletons — the shell's loading placeholders (`sdk-design-system` spec "Loading skeletons
 * derive their geometry from exported component constants"; design D9).
 *
 * Two rules, both enforced by construction here: `breathe` is the ONLY loading motion (no shimmer
 * sweep, no travelling gradient), and every dimension is imported from the real component's
 * exported size constants — a literal in a skeleton style is the defect, because the layout would
 * jump when the real thing arrives. A skeleton is drawn only where the thing is genuinely coming
 * AND its shape is already known. (Home's own skeleton is `HomeSkeleton.tsx`, on the shell primitives.)
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleProp, ViewStyle } from 'react-native';
import { MOTION } from '../../sdk/theme';

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
