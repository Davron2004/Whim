/**
 * TermsScreen — the terms step (legal-surface-v2 design D5; spec terms-acceptance "Terms are
 * accepted in their own step before the consent screen"). A full screen, laid out like the consent
 * screen it precedes: a title, a short lead, a link to the terms of use, then `Accept` and
 * `Not now` at the bottom.
 *
 * It opens in place of a data-sending action taken without a current terms acceptance. `Accept`
 * records the acceptance and continues the flow; `Not now` and system back share `onClose`, which
 * grants nothing. It says nothing about data — what is sent, to whom and why belongs to the
 * consent screen alone (Play's prominent-disclosure rule).
 *
 * Every string comes from the active legal language's table (`LEGAL_COPY`), and the link opens
 * that language's terms page. The switch above the title offers the other language in one tap
 * (spec legal-text-localization). An acceptance of another terms version swaps the lead for the
 * updated-terms line (spec "Terms acceptance is versioned apart from consent").
 */
import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { LEGAL_COPY } from './copy';
import LegalLanguageSwitch from './LegalLanguageSwitch';
import { termsUrl, type LegalLanguage } from './legal-language';
import { SHELL_PALETTE } from './theme';
import { useSystemBack } from './use-system-back';

export interface TermsScreenProps {
  /** The active legal language: this screen's copy and its terms link. */
  language: LegalLanguage;
  /** The language switch was tapped: the launcher persists the choice and re-renders in it. */
  onLanguageChange: (language: LegalLanguage) => void;
  /** The stored acceptance is of another terms version: the updated-terms line replaces the lead. */
  outdated?: boolean;
  /** Records the acceptance and continues the flow. */
  onAccept: () => void;
  /** Leaves without accepting anything: `Not now` and system back. */
  onClose: () => void;
}

export default function TermsScreen({
  language,
  onLanguageChange,
  outdated = false,
  onAccept,
  onClose,
}: Readonly<TermsScreenProps>) {
  const p = SHELL_PALETTE;
  useSystemBack(onClose);
  const copy = LEGAL_COPY[language];

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <LegalLanguageSwitch language={language} onChange={onLanguageChange} />
        <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{copy.termsTitle}</Text>
        <Text style={[TYPE_SCALE.body, styles.lead, { color: p.text }]}>
          {outdated ? copy.termsUpdatedLine : copy.termsLead}
        </Text>
        <TouchableOpacity
          onPress={() => Linking.openURL(termsUrl(language))}
          accessibilityRole="link"
          hitSlop={10}
          style={styles.link}
        >
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.accent }]}>{copy.termsLabel}</Text>
        </TouchableOpacity>
      </ScrollView>

      <TouchableOpacity
        onPress={onAccept}
        accessibilityRole="button"
        style={[styles.primary, { backgroundColor: p.accent }]}
      >
        <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{copy.termsAccept}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onClose} accessibilityRole="button" style={styles.plainAction}>
        <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{copy.termsDecline}</Text>
      </TouchableOpacity>
    </View>
  );
}

// The same spacing and bottom actions as `ConsentScreen.tsx`, so stepping from one to the other
// moves only the words.
const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl, paddingBottom: SPACING.xl },
  lead: { marginTop: SPACING.sm },
  link: { marginTop: SPACING.lg, alignSelf: 'flex-start' },
  primary: {
    height: 52,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
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
