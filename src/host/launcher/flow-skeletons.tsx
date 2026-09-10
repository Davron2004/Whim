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
import { MOTION, RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
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

/** A clarify pill's real rendered height (`ClarifyStep.tsx`'s `styles.pill`): two `SPACING.xs`
 *  vertical paddings plus the control label's own line height — read by `styles.clarifyPill`
 *  two lines down, so the skeleton pill occupies identical space, and nowhere else. */
const CLARIFY_PILL_HEIGHT = SPACING.xs * 2 + TYPE_SCALE.controlLabel.lineHeight;

/** Two question groups' worth of skeleton, deliberately irregular so identical bars never read as
 *  a progress indicator (design D9, same rule `PlanRowsSkeleton` follows). Each group is one
 *  headline-height bar (the question text) over a row of three pill-shaped blocks (the answer
 *  options) — geometry borrowed from the real step's own tokens, never a restated literal. */
const CLARIFY_GROUP_BAR_WIDTHS: readonly `${number}%`[] = ['62%', '48%'];
const CLARIFY_PILL_WIDTHS: readonly number[] = [84, 112, 72];

export interface ClarifyQuestionsSkeletonProps {
  color: string;
}

/**
 * The clarify step's loading state (C2): shown only while the exchange is genuinely in flight and
 * the shape it will render — at most a few short questions, each a row of pills — is already
 * known. Two groups is a representative count, not a claim about how many questions are actually
 * coming; the real questions replace it in full once `withQuestions` fills the screen.
 */
export function ClarifyQuestionsSkeleton({ color }: Readonly<ClarifyQuestionsSkeletonProps>) {
  return (
    <View accessibilityRole="progressbar">
      {CLARIFY_GROUP_BAR_WIDTHS.map((barWidth, i) => (
        <View key={barWidth + String(i)} style={i > 0 ? styles.clarifyGroup : undefined}>
          <BreathingView delayMs={i * 150} style={[styles.clarifyBar, { width: barWidth, backgroundColor: color }]} />
          <View style={styles.clarifyPillRow}>
            {CLARIFY_PILL_WIDTHS.map((width, j) => (
              <BreathingView
                key={width}
                delayMs={i * 150 + j * 80}
                style={[styles.clarifyPill, { width, backgroundColor: color }]}
              />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: APP_TILE_SIZE, height: APP_TILE_SIZE, borderRadius: APP_TILE_RADIUS },
  // The vertical gap between groups matches `ClarifyStep.tsx`'s own `question: { marginTop:
  // SPACING.lg }` — the same token, read directly, rather than a second exported constant for a
  // single spacing value.
  clarifyGroup: { marginTop: SPACING.lg },
  clarifyBar: { height: TYPE_SCALE.bodyEmphatic.lineHeight, borderRadius: 4 },
  clarifyPillRow: { flexDirection: 'row', gap: SPACING.xs, marginTop: SPACING.sm },
  clarifyPill: { height: CLARIFY_PILL_HEIGHT, borderRadius: RADIUS.chip },
});
