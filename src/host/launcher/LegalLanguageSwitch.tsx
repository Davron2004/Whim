/**
 * LegalLanguageSwitch — the one-tap switch to the other legal language, shown above the title of
 * the terms step and the consent screen (legal-surface-v2 design D6; spec legal-text-localization
 * "Legal text is French first on a French-language phone, with an express choice of English").
 * Its label is written in the language it offers ("Continue in English" on a French screen), so
 * the screen reader reads it in that language too.
 */
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { SPACE, TYPE_SCALE } from '../../design/tokens';
import { useTokens } from '../ui/tokens';
import { hitSlopFor, makeStyles, MAX_FONT_SCALE, typeStyle } from '../ui/tokens-pure';
import { LEGAL_COPY } from './copy';
import { otherLegalLanguage, type LegalLanguage } from './legal-language';

const styles = makeStyles((t) => ({
  switch: { alignSelf: 'flex-end' as const, marginBottom: SPACE[4] },
  // A plain text action (system.md §7.1 Button `plain`: `text` 600), its own words in the language it offers.
  label: { ...typeStyle('headline'), color: t.colors.text },
}));

export default function LegalLanguageSwitch({
  language,
  onChange,
}: Readonly<{ language: LegalLanguage; onChange: (language: LegalLanguage) => void }>) {
  const t = useTokens();
  const s = styles(t);
  const other = otherLegalLanguage(language);
  return (
    <TouchableOpacity onPress={() => onChange(other)} accessibilityRole="button" hitSlop={hitSlopFor(TYPE_SCALE.headline.lineHeight, t)} style={s.switch}>
      <Text accessibilityLanguage={other} style={s.label} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {LEGAL_COPY[language].legalLanguageSwitch}
      </Text>
    </TouchableOpacity>
  );
}
