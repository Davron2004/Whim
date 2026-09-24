/**
 * LegalLanguageSwitch — the one-tap switch to the other legal language, shown above the title of
 * the terms step and the consent screen (legal-surface-v2 design D6; spec legal-text-localization
 * "Legal text is French first on a French-language phone, with an express choice of English").
 * Its label is written in the language it offers ("Continue in English" on a French screen), so
 * the screen reader reads it in that language too.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { SPACING, TYPE_SCALE } from '../../sdk/theme';
import { LEGAL_COPY } from './copy';
import { otherLegalLanguage, type LegalLanguage } from './legal-language';
import { SHELL_PALETTE } from './theme';

export default function LegalLanguageSwitch({
  language,
  onChange,
}: Readonly<{ language: LegalLanguage; onChange: (language: LegalLanguage) => void }>) {
  const other = otherLegalLanguage(language);
  return (
    <TouchableOpacity onPress={() => onChange(other)} accessibilityRole="button" hitSlop={10} style={styles.switch}>
      <Text accessibilityLanguage={other} style={[TYPE_SCALE.bodyEmphatic, { color: SHELL_PALETTE.accent }]}>
        {LEGAL_COPY[language].legalLanguageSwitch}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  switch: { alignSelf: 'flex-end', marginBottom: SPACING.md },
});
