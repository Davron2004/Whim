/**
 * flow-chrome — the pieces every gated step of the `2a` flow shares (shell-redesign-v2, group D):
 * the back link, the three-bar step indicator, the bottom primary action, and the refusal notice
 * that sits above it.
 *
 * Kept in one module so compose, clarify and plan cannot drift on the rule that matters:
 * "Forward movement SHALL be gated by an explicit primary action... A busy primary action SHALL
 * always keep plain words — a bare spinner with no label SHALL NOT ship" (`prompt-flow` spec).
 * The label itself comes from `prompt-flow.ts#primaryActionLabel`, so the words are decided once.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY, editingEyebrow } from './copy';
import { primaryActionLabel, type FlowNotice, type FlowStep } from './prompt-flow';
import ServiceNotice from './ServiceNotice';
import { SHELL_PALETTE } from './theme';

/** The gated steps, in order — the step indicator's three bars. */
const INDICATOR_STEPS: readonly FlowStep[] = ['compose', 'clarify', 'plan'];

/**
 * The header's own space below its back link, so content scrolled beneath it never touches the
 * link. A screen's content starts that much less far down, keeping the design's gap above its
 * headline (the `content.paddingTop` each step cites) the same.
 */
export const FLOW_HEADER_GAP = SPACING.sm;

export interface FlowHeaderProps {
  step: FlowStep;
  /** Immediate, never busy: backward movement has no in-flight state. */
  onBack: () => void;
}

export function FlowHeader({ step, onBack }: Readonly<FlowHeaderProps>) {
  const reached = INDICATOR_STEPS.indexOf(step);
  return (
    <BackHeader onBack={onBack}>
      <View style={styles.bars}>
        {INDICATOR_STEPS.map((s, i) => (
          <View
            key={s}
            style={[styles.bar, { backgroundColor: i <= reached ? SHELL_PALETTE.accent : SHELL_PALETTE.cardBorder }]}
          />
        ))}
      </View>
    </BackHeader>
  );
}

/** The flow's header row: the back link, and whatever sits at its right (the step bars). Settings
 *  shares it, so every screen with a back link has the same one in the same place. */
export function BackHeader({ onBack, children }: Readonly<{ onBack: () => void; children?: React.ReactNode }>) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={16}>
        <Text style={[TYPE_SCALE.controlLabel, { color: SHELL_PALETTE.textMuted }]}>{COPY.backLabel}</Text>
      </TouchableOpacity>
      {children}
    </View>
  );
}

export interface PrimaryActionProps {
  step: FlowStep;
  /** False greys the control out — an unusable action never pretends otherwise. */
  enabled: boolean;
  /** Swaps the plan step's label to the edit flow's own words (C1). Every other step's label is
   *  unbranched, so an absent value is the same as `false`. */
  editing?: boolean;
  onPress: () => void;
}

export function PrimaryAction({ step, enabled, editing = false, onPress }: Readonly<PrimaryActionProps>) {
  const label = primaryActionLabel(step, editing);
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.primary,
        { backgroundColor: enabled ? SHELL_PALETTE.accent : SHELL_PALETTE.card, borderColor: SHELL_PALETTE.cardBorder },
      ]}
    >
      <Text style={[TYPE_SCALE.bodyEmphatic, { color: enabled ? SHELL_PALETTE.onAccent : SHELL_PALETTE.textMuted }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/** A step's refusal notice, when it has one, above the step's primary action and a sibling gap
 *  clear of it. */
export function StepNotice({ notice }: Readonly<{ notice?: FlowNotice }>) {
  if (notice == null) return null;
  return (
    <View style={styles.stepNotice}>
      <ServiceNotice hint={notice.hint} retryAt={notice.retryAt} tone={notice.tone} />
    </View>
  );
}

export interface EditingEyebrowProps {
  /** The app being changed, in its current display name. */
  name: string;
}

/**
 * "Changing <app name>" — the one line every gated step of the edit flow shares (C1: "the edit
 * flow reads as editing, on every step"), so a re-prompt can never again read like the new-app
 * flow (the reported bug: asked "what kind of app am I adding it to" while adding a section to an
 * existing one). Rendered only when the screen has `editing`; callers own that check.
 *
 * `BuildStep.tsx` is out of this change's boundary — another task places this component there.
 */
export function EditingEyebrow({ name }: Readonly<EditingEyebrowProps>) {
  return (
    <Text style={[TYPE_SCALE.eyebrow, styles.editingEyebrow, { color: SHELL_PALETTE.textMuted }]}>
      {editingEyebrow(name)}
    </Text>
  );
}

const styles = StyleSheet.create({
  editingEyebrow: { marginBottom: SPACING.xs },
  // design README "Spacing": `sm 12` between siblings — the notice and the action it sits above.
  stepNotice: { marginBottom: SPACING.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    // design `Whim Mobile.dc.html:412,438,470` is `padding:16px 22px 0`, with the whole gap above
    // each headline the step's own `content.paddingTop` (34/28/26). `FLOW_HEADER_GAP` of that gap
    // moves into the header, so scrolled content stops short of the back link.
    paddingTop: SPACING.md,
    paddingBottom: FLOW_HEADER_GAP,
  },
  bars: { flexDirection: 'row', gap: 5 },
  bar: { width: 18, height: 3, borderRadius: 2 },
  primary: {
    height: 52, // design `Whim Mobile.dc.html:428,460,488` — matches DoneStep's pair (ruling R19/R22)
    marginHorizontal: SPACING.lg,
    marginBottom: 24, // design `Whim Mobile.dc.html:427,459,487` — no SPACING counterpart (ruling R9)
    borderRadius: RADIUS.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
