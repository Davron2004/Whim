/**
 * PlanStep — the approval gate before generation (`prompt-flow` spec "The plan step is the
 * approval gate before generation"). Nothing is generated until `Build it` is taken.
 *
 * The plan renders as labelled rows when the rewrite response carried them and as one unlabelled
 * row when it carried only a rewritten string (`prompt-flow.ts#planRowsFrom`). Tapping a row
 * edits it INLINE, in place on this step: the card becomes a text field with save/cancel
 * affordances, and saving commits through `onChangeRow` — nothing navigates away, so every other
 * row, the original prompt and the clarify answers stay exactly as they were
 * (`prompt-flow.ts#updatePlanRow`). Only one row is ever editable at a time. No SDK-specific or
 * engineering-internal detail appears here: the rows are the model's own plain words, rendered
 * through the shared Whim Syntax renderer when not being edited.
 */

import React, { useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import WhimProse from '../ui/whim-prose/WhimProse';
import { COPY, planHeadline, workingPlanPhrase } from './copy';
import { BreathingView } from './flow-skeletons';
import { EditingEyebrow, FlowHeader, PrimaryAction } from './flow-chrome';
import { WorkingLine } from './flow-working';
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
  /** When the in-flight rewrite request started, for `WorkingLine`'s clock. Only read while
   *  `loading`. */
  startedAt?: number;
  /** Scopes the screen to a re-prompt (C1) — present together with `editingName`. */
  editing: boolean;
  editingName?: string;
  /** Commits an inline edit of the row at `index` to `text` — `prompt-flow.ts#updatePlanRow`. */
  onChangeRow: (index: number, text: string) => void;
  onBuild: () => void;
  /** Immediate: back lands on the clarify step it came from, or compose when that step was skipped.
   *  While a row is being edited, back cancels the edit instead of leaving the step. */
  onBack: () => void;
}

export default function PlanStep({
  rows,
  loading,
  startedAt,
  editing,
  editingName,
  onChangeRow,
  onBuild,
  onBack,
}: Readonly<PlanStepProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);

  // Only one row is ever editable at a time: `editingIndex` names it, `draft` is its in-progress
  // text. Indexed rather than keyed by `label:text` because two rows can carry identical text —
  // the row's position is the one identity that survives that (`updatePlanRow` uses the same key).
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editingIndex != null) {
        setEditingIndex(null);
        return true;
      }
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack, editingIndex]);

  const startEditing = (index: number, text: string) => {
    setEditingIndex(index);
    setDraft(text);
  };

  const cancelEditing = () => setEditingIndex(null);

  const canSave = draft.trim().length > 0;

  const saveEditing = () => {
    if (editingIndex == null || !canSave) return; // whitespace-only save is a no-op, same gate ComposeStep uses
    onChangeRow(editingIndex, draft);
    setEditingIndex(null);
  };

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <FlowHeader step="plan" palette={p} onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {editing && editingName != null && <EditingEyebrow name={editingName} palette={p} />}
        <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{planHeadline(editing)}</Text>
        <Text style={[TYPE_SCALE.caption, styles.subhead, { color: p.textMuted }]}>{COPY.planSubhead}</Text>

        {loading ? (
          <>
            <PlanRowsSkeleton color={p.card} />
            <WorkingLine phrase={workingPlanPhrase(editing)} startedAt={startedAt ?? Date.now()} />
          </>
        ) : (
          rows.map((row, index) => {
            const key = `${index}:${row.label}`;
            if (editingIndex === index) {
              return (
                <View
                  key={key}
                  style={[styles.row, styles.rowEditing, { backgroundColor: p.card, borderColor: p.accent }]}
                >
                  {row.label.length > 0 && (
                    <Text style={[TYPE_SCALE.eyebrow, { color: p.textMuted }]}>{row.label}</Text>
                  )}
                  <TextInput
                    value={draft}
                    onChangeText={setDraft}
                    style={[TYPE_SCALE.body, styles.rowInput, { color: p.text }]}
                    multiline
                    autoFocus
                    textAlignVertical="top"
                  />
                  <View style={styles.rowActions}>
                    <TouchableOpacity onPress={cancelEditing} hitSlop={10}>
                      <Text style={[TYPE_SCALE.controlLabel, { color: p.textMuted }]}>{COPY.cancel}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={saveEditing} disabled={!canSave} hitSlop={10}>
                      <Text
                        style={[TYPE_SCALE.controlLabel, { color: canSave ? p.accent : p.textMuted }]}
                      >
                        {COPY.planRowSave}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }
            return (
              <TouchableOpacity
                key={key}
                onPress={() => startEditing(index, row.text)}
                style={[styles.row, { backgroundColor: p.card, borderColor: p.cardBorder }]}
              >
                {row.label.length > 0 && (
                  <Text style={[TYPE_SCALE.eyebrow, { color: p.textMuted }]}>{row.label}</Text>
                )}
                <WhimProse text={row.text} style={[TYPE_SCALE.body, styles.rowText, { color: p.text }]} />
              </TouchableOpacity>
            );
          })
        )}

        <Text style={[TYPE_SCALE.caption, styles.footer, { color: p.textMuted }]}>{COPY.planFooter}</Text>
      </ScrollView>

      {/* A disabled button under a skeleton is noise — there is nothing to approve yet. The
          action mounts once the rewrite response has landed; `WorkingLine` is the only liveness
          element while loading. */}
      {!loading && <PrimaryAction step="plan" enabled editing={editing} palette={p} onPress={onBuild} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // paddingTop 26: design `Whim Mobile.dc.html:474` — no SPACING counterpart (ruling R9).
  content: { paddingHorizontal: SPACING.lg, paddingTop: 26, paddingBottom: SPACING.xl },
  subhead: { marginTop: SPACING.xs, marginBottom: SPACING.md },
  row: {
    minHeight: PLAN_ROW_MIN_HEIGHT,
    borderWidth: 1,
    borderRadius: PLAN_ROW_RADIUS,
    padding: SPACING.md,
    marginBottom: PLAN_ROW_GAP,
  },
  rowEditing: { borderWidth: 2 },
  rowText: { marginTop: SPACING.xs },
  rowInput: {
    marginTop: SPACING.xs,
    minHeight: PLAN_ROW_MIN_HEIGHT - SPACING.xl,
    padding: 0,
  },
  rowActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: SPACING.md,
    marginTop: SPACING.sm,
  },
  footer: { marginTop: SPACING.md },
  skeletonRow: {
    height: PLAN_ROW_MIN_HEIGHT,
    borderRadius: PLAN_ROW_RADIUS,
    marginBottom: PLAN_ROW_GAP,
  },
});
