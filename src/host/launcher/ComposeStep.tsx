/**
 * ComposeStep — step one of the `2a` flow (`prompt-flow` spec "The prompt flow is a five-step
 * machine"). The headline, the prompt field, the helper line, the suggestion chips and the bottom
 * primary action.
 *
 * Two rules this screen exists to hold: the field is NEVER live-highlighted (Whim Syntax rule 6 —
 * a prompt is marked up only after submission, so nothing here renders through `WhimProse`), and a
 * suggestion chip FILLS the prompt without advancing the flow. Purely presentational: the clarify
 * request lives in `LauncherRoot`.
 */

import React, { useEffect } from 'react';
import { BackHandler, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY, composeHeadline, composePlaceholder } from './copy';
import { EditingEyebrow, FlowHeader, PrimaryAction } from './flow-chrome';
import { SHELL_PALETTE } from './theme';

/** The three "Or start from" suggestions, verbatim from the copy table. */
const CHIPS: readonly string[] = [COPY.composeChipTimer, COPY.composeChipTracker, COPY.composeChipDice];

export interface ComposeStepProps {
  text: string;
  /** The effective server's last probe/retry failed (server-connectivity, design.md decision 7).
   *  Advisory only — never gates the field or the primary action. Compose opens only once AI-data
   *  consent is granted, and a server address always exists (an override or the compiled-in
   *  default), so there is no separate "no address configured" notice any more (prompt-flow "The
   *  compose entry point shows a server-unreachable notice without blocking generation"). */
  serverUnreachable?: boolean;
  /** Scopes the screen to a re-prompt (C1: "the edit flow reads as editing, on every step") —
   *  present together with `editingName`, the app's current display name for the eyebrow line. */
  editing: boolean;
  editingName?: string;
  onChangeText: (text: string) => void;
  onContinue: () => void;
  /** Immediate: back from compose is a return to the home grid. Tapping Continue moves straight
   *  to the clarify step's own loading state (C2) — compose never has a busy state of its own. */
  onBack: () => void;
}

export default function ComposeStep({
  text,
  serverUnreachable,
  editing,
  editingName,
  onChangeText,
  onContinue,
  onBack,
}: Readonly<ComposeStepProps>) {
  const p = SHELL_PALETTE;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const trimmed = text.trim();

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <FlowHeader step="compose" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {editing && editingName != null && <EditingEyebrow name={editingName} />}
        <Text style={[TYPE_SCALE.headline, { color: p.text }]}>{composeHeadline(editing)}</Text>

        {/* Advisory only (spec "does not gate submission"): compose opens only once AI-data
            consent is granted, so there is nothing else to configure — this is the one notice the
            step can show. Neither the field's `editable` nor the primary action's `enabled` below
            reads this prop. */}
        {serverUnreachable && (
          <View style={[styles.notice, { backgroundColor: p.card, borderColor: p.cardBorder }]}>
            <Text style={[TYPE_SCALE.body, { color: p.text }]}>{COPY.promptServerUnreachable}</Text>
          </View>
        )}

        <TextInput
          value={text}
          onChangeText={onChangeText}
          placeholder={composePlaceholder(editing)}
          placeholderTextColor={p.textMuted}
          style={[TYPE_SCALE.body, styles.field, { color: p.text, backgroundColor: p.card, borderColor: p.cardBorder }]}
          multiline
          autoFocus
          textAlignVertical="top"
        />

        <Text style={[TYPE_SCALE.caption, styles.helper, { color: p.textMuted }]}>{COPY.composeHelper}</Text>

        {!editing && (
          <>
            <Text style={[TYPE_SCALE.eyebrow, styles.eyebrow, { color: p.textMuted }]}>
              {COPY.composeChipsEyebrow}
            </Text>
            {CHIPS.map((chip) => (
              <TouchableOpacity
                key={chip}
                onPress={() => onChangeText(chip)}
                style={[styles.chip, { backgroundColor: p.bg, borderColor: p.cardBorder }]}
              >
                <Text style={[TYPE_SCALE.body, { color: p.text }]}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}
      </ScrollView>

      {/* Compose has no busy state of its own: tapping Continue moves synchronously to the
          clarify step's own loading screen (C2), so this action is never anything but live. */}
      <PrimaryAction
        step="compose"
        enabled={trimmed.length > 0}
        onPress={onContinue}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl, paddingBottom: SPACING.xl },
  notice: { borderWidth: 1, borderRadius: RADIUS.card, padding: SPACING.md, marginTop: SPACING.md },
  field: {
    minHeight: 96,
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderRadius: RADIUS.card,
  },
  helper: { marginTop: SPACING.sm },
  eyebrow: { marginTop: SPACING.xl, marginBottom: SPACING.sm },
  chip: {
    borderWidth: 1,
    borderRadius: RADIUS.field,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
  },
});
