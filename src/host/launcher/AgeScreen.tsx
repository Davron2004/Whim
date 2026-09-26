/**
 * AgeScreen — the store age check ahead of the terms step (legal-surface-v2 design D11; spec
 * store-age-signals "The launcher checks the store's age signal before the terms step").
 *
 * While the store is asked (no `held`) it shows only the flow's working line and a `Back` action:
 * the check asks nothing of the user, and on iPhone the system may show its own age-range sheet
 * over it. When the store held
 * the user, the message says why, and that the apps on the phone keep working: for a minor without
 * a parent's approval (`minor-not-approved`), that a parent can approve Whim through the store;
 * for a user under 13 (`under-13`), that Whim's AI features are for people 13 and over. The AI
 * features stay off because the flow stops here. `Back` and system back share `onClose`, which
 * stores nothing.
 *
 * Every string comes from the active legal language's table (`LEGAL_COPY`), with the same one-tap
 * language switch as the terms step (spec legal-text-localization).
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { LEGAL_COPY } from './copy';
import { WorkingLine } from './flow-working';
import LegalLanguageSwitch from './LegalLanguageSwitch';
import type { LegalLanguage } from './legal-language';
import type { AgeHold } from './age-check';
import { SHELL_PALETTE } from './theme';
import { useSystemBack } from './use-system-back';

export interface AgeScreenProps {
  /** The active legal language: this screen's copy. */
  language: LegalLanguage;
  /** The language switch was tapped: the launcher persists the choice and re-renders in it. */
  onLanguageChange: (language: LegalLanguage) => void;
  /** Why the store held the user, which picks the message; absent while the check is running. */
  held?: AgeHold;
  /** Leaves the flow without storing anything: `Back` and system back. */
  onClose: () => void;
}

export default function AgeScreen({ language, onLanguageChange, held, onClose }: Readonly<AgeScreenProps>) {
  const p = SHELL_PALETTE;
  useSystemBack(onClose);
  const copy = LEGAL_COPY[language];
  const blocked = held !== undefined;
  const under13 = held === 'under-13';

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* No clock: the store answers, or is given up on, within the 3-second deadline. */}
        {!blocked && <WorkingLine phrase={copy.ageChecking} startedAt={0} clock={false} />}
        {blocked && (
          <>
            <LegalLanguageSwitch language={language} onChange={onLanguageChange} />
            <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{under13 ? copy.ageUnder13Title : copy.ageBlockedTitle}</Text>
            <Text style={[TYPE_SCALE.body, styles.lead, { color: p.text }]}>{under13 ? copy.ageUnder13Body : copy.ageBlockedBody}</Text>
          </>
        )}
      </ScrollView>

      {blocked ? (
        <TouchableOpacity onPress={onClose} accessibilityRole="button" style={[styles.primary, { backgroundColor: p.accent }]}>
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{copy.ageBack}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={onClose} accessibilityRole="button" style={styles.plainAction}>
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{copy.ageBack}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// The terms step's spacing and bottom actions, so stepping from one to the other moves only the words.
const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl, paddingBottom: SPACING.xl },
  lead: { marginTop: SPACING.sm },
  primary: {
    height: 52,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    marginBottom: SPACING.lg,
    borderRadius: RADIUS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plainAction: {
    height: 46,
    marginBottom: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
