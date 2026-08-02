/**
 * flow-chrome — the three pieces every gated step of the `2a` flow shares (shell-redesign-v2,
 * group D): the back link, the three-bar step indicator, and the bottom primary action.
 *
 * Kept in one module so compose, clarify and plan cannot drift on the rule that matters:
 * "Forward movement SHALL be gated by an explicit primary action... A busy primary action SHALL
 * always keep plain words — a bare spinner with no label SHALL NOT ship" (`prompt-flow` spec).
 * The label itself comes from `prompt-flow.ts#primaryActionLabel`, so the words are decided once.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import { primaryActionLabel, type FlowStep } from './prompt-flow';
import type { ShellPalette } from './theme';

/** The gated steps, in order — the step indicator's three bars. */
const INDICATOR_STEPS: readonly FlowStep[] = ['compose', 'clarify', 'plan'];

export interface FlowHeaderProps {
  step: FlowStep;
  palette: ShellPalette;
  /** Immediate, never busy: backward movement has no in-flight state. */
  onBack: () => void;
}

export function FlowHeader({ step, palette, onBack }: Readonly<FlowHeaderProps>) {
  const reached = INDICATOR_STEPS.indexOf(step);
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={10}>
        <Text style={[TYPE_SCALE.caption, { color: palette.textMuted }]}>{COPY.backLabel}</Text>
      </TouchableOpacity>
      <View style={styles.bars}>
        {INDICATOR_STEPS.map((s, i) => (
          <View
            key={s}
            style={[styles.bar, { backgroundColor: i <= reached ? palette.accent : palette.cardBorder }]}
          />
        ))}
      </View>
    </View>
  );
}

export interface PrimaryActionProps {
  step: FlowStep;
  busy: boolean;
  /** False greys the control out — an unusable action never pretends otherwise. */
  enabled: boolean;
  palette: ShellPalette;
  onPress: () => void;
}

/** The busy action keeps its full size, colour and words — it only softens, so nothing moves. */
const BUSY_OPACITY = 0.6;

export function PrimaryAction({ step, busy, enabled, palette, onPress }: Readonly<PrimaryActionProps>) {
  const label = primaryActionLabel(step, busy);
  const live = enabled && !busy;
  const opacity = busy ? BUSY_OPACITY : 1;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!live}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.primary,
        { backgroundColor: enabled ? palette.accent : palette.card, borderColor: palette.cardBorder, opacity },
      ]}
    >
      <Text style={[TYPE_SCALE.bodyEmphatic, { color: enabled ? palette.onAccent : palette.textMuted }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  bars: { flexDirection: 'row', gap: 5 },
  bar: { width: 18, height: 3, borderRadius: 2 },
  primary: {
    height: 54,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
