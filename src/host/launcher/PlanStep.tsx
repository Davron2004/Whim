/**
 * PlanStep — the approval gate before generation (`prompt-flow` spec "The plan step is the
 * approval gate before generation"). Nothing is generated until `Build it` is taken.
 *
 * The plan renders as labelled rows when the rewrite response carried them and as one unlabelled
 * row when it carried only a rewritten string (`prompt-flow.ts#planRowsFrom`). Tapping a row
 * re-opens the composer prefilled with that row's text — nothing fancier. No SDK-specific or
 * engineering-internal detail appears here: the rows are the model's own plain words, rendered
 * through the shared Whim Syntax renderer.
 */

import React, { useEffect } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import WhimProse from '../ui/whim-prose/WhimProse';
import { COPY } from './copy';
import { BreathingView } from './flow-skeletons';
import { FlowHeader, PrimaryAction } from './flow-chrome';
import type { FlowPlanRow } from './prompt-flow';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

/** Row geometry, exported so the loading skeleton imports it rather than restating any value
 *  (`sdk-design-system` "Loading skeletons derive their geometry from exported component
 *  constants") — the skeleton and the real row therefore occupy identical space. */
export const PLAN_ROW_MIN_HEIGHT = 74;
export const PLAN_ROW_RADIUS = RADIUS.card;
export const PLAN_ROW_GAP = SPACING.sm;

/** Deliberately irregular: identical bars read as a progress bar (design D9). */
const SKELETON_ROW_WIDTHS: readonly `${number}%`[] = ['100%', '84%', '92%', '68%'];

/**
 * The plan's loading state — shown only while the rows are genuinely coming and their shape is
 * already known. Geometry is the constants above, never a literal, so the skeleton and the real
 * rows occupy identical space and nothing jumps when they swap.
 */
function PlanRowsSkeleton({ color }: Readonly<{ color: string }>) {
  return (
    <View accessibilityRole="progressbar">
      {SKELETON_ROW_WIDTHS.map((width, i) => (
        <BreathingView
          key={width + String(i)}
          delayMs={i * 150}
          style={[styles.skeletonRow, { width, backgroundColor: color }]}
        />
      ))}
    </View>
  );
}

export interface PlanStepProps {
  rows: readonly FlowPlanRow[];
  /** The rewrite response has not arrived yet: skeleton rows, and the action stays busy. */
  loading: boolean;
  onEditRow: (row: FlowPlanRow) => void;
  onBuild: () => void;
  /** Immediate: back lands on the clarify step it came from, or compose when that step was skipped. */
  onBack: () => void;
}

export default function PlanStep({ rows, loading, onEditRow, onBuild, onBack }: Readonly<PlanStepProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <FlowHeader step="plan" palette={p} onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[TYPE_SCALE.screenTitle, { color: p.text }]}>{COPY.planHeadline}</Text>
        <Text style={[TYPE_SCALE.caption, styles.subhead, { color: p.textMuted }]}>{COPY.planSubhead}</Text>

        {loading ? (
          <PlanRowsSkeleton color={p.card} />
        ) : (
          rows.map((row) => (
            <TouchableOpacity
              key={`${row.label}:${row.text}`}
              onPress={() => onEditRow(row)}
              style={[styles.row, { backgroundColor: p.card, borderColor: p.cardBorder }]}
            >
              {row.label.length > 0 && (
                <Text style={[TYPE_SCALE.eyebrow, { color: p.textMuted }]}>{row.label}</Text>
              )}
              <WhimProse text={row.text} style={[TYPE_SCALE.body, styles.rowText, { color: p.text }]} />
            </TouchableOpacity>
          ))
        )}

        <Text style={[TYPE_SCALE.caption, styles.footer, { color: p.textMuted }]}>{COPY.planFooter}</Text>
      </ScrollView>

      <PrimaryAction step="plan" busy={loading} enabled={!loading} palette={p} onPress={onBuild} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },
  subhead: { marginTop: SPACING.xs, marginBottom: SPACING.md },
  row: {
    minHeight: PLAN_ROW_MIN_HEIGHT,
    borderWidth: 1,
    borderRadius: PLAN_ROW_RADIUS,
    padding: SPACING.md,
    marginBottom: PLAN_ROW_GAP,
  },
  rowText: { marginTop: SPACING.xs },
  footer: { marginTop: SPACING.md },
  skeletonRow: {
    height: PLAN_ROW_MIN_HEIGHT,
    borderRadius: PLAN_ROW_RADIUS,
    marginBottom: PLAN_ROW_GAP,
  },
});
