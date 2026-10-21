/**
 * AgeScreen — the store age check ahead of the terms step (legal-surface-v2 design D11; spec
 * store-age-signals "The launcher checks the store's age signal before the terms step").
 *
 * The check itself asks nothing of the user and shows nothing (the shell keeps Home as it is, and on
 * iPhone the system may show its own age-range sheet): this screen exists only for the answer that
 * stops the flow. When the store held
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
import { ScrollView, View } from 'react-native';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { LEGAL_COPY } from './copy';
import { fullScreenStyles } from './full-screen-styles';
import LegalLanguageSwitch from './LegalLanguageSwitch';
import type { LegalLanguage } from './legal-language';
import type { AgeHold } from './age-check';
import { useSystemBack } from './use-system-back';

export interface AgeScreenProps {
  /** The active legal language: this screen's copy. */
  language: LegalLanguage;
  /** The language switch was tapped: the launcher persists the choice and re-renders in it. */
  onLanguageChange: (language: LegalLanguage) => void;
  /** Why the store held the user, which picks the message. */
  held: AgeHold;
  /** Leaves the flow without storing anything: `Back` and system back. */
  onClose: () => void;
}

export default function AgeScreen({ language, onLanguageChange, held, onClose }: Readonly<AgeScreenProps>) {
  const s = fullScreenStyles(useTokens());
  useSystemBack(onClose);
  const copy = LEGAL_COPY[language];
  const under13 = held === 'under-13';

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.content}>
        <LegalLanguageSwitch language={language} onChange={onLanguageChange} />
        <Text type="title1">{under13 ? copy.ageUnder13Title : copy.ageBlockedTitle}</Text>
        <Text>{under13 ? copy.ageUnder13Body : copy.ageBlockedBody}</Text>
      </ScrollView>
      <View style={s.footer}>
        <Button label={copy.ageBack} variant="ink" onPress={onClose} />
      </View>
    </View>
  );
}
