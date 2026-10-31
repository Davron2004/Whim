/**
 * SettingsScreen — common settings first (design-system-v1 task 14.3; spec app-launcher "Settings
 * puts common settings first and diagnostics under Advanced"; system.md §9 Settings). Pushed on
 * the native stack, whose header carries the large title and the back control.
 *
 * In order: "AI features" (opens the consent screen in review mode on the stack), "Language" (the
 * legal language, one tap to the other), About (privacy policy, terms of use, support, reporting a
 * problem, version) and "Advanced" (error details, this phone's ID, the server). No Highlighting
 * and no Reduce Motion switch: the phone's own settings rule motion.
 */
import React from 'react';
import { Linking, ScrollView } from 'react-native';
import { LAYOUT, SPACE } from '../../design/tokens';
import { GroupedRow, GroupedSection } from '../ui/GroupedList';
import { useTokens } from '../ui/tokens';
import { makeStyles } from '../ui/tokens-pure';
import { COPY, legalLanguageName } from './copy';
import { RELEASE } from './release-config';
import { otherLegalLanguage, privacyPolicyUrl, termsUrl, type LegalLanguage } from './legal-language';
import { useSystemBack } from './use-system-back';

export interface SettingsScreenProps {
  /** Leaves Settings for Home: system back, and the stack's header back through the same handler. */
  onBack: () => void;
  /** Pushes AI features: the consent screen in review mode. */
  onOpenAIFeatures: () => void;
  /** The active legal language: the About links open its pages, and Language names it. */
  legalLanguage: LegalLanguage;
  /** Language was tapped: the launcher persists the other language and re-renders in it. */
  onLegalLanguageChange: (language: LegalLanguage) => void;
  /** The installed version and build (`settings-sections#versionLabel`); the row is left out
   *  without one. */
  version?: string;
  /** Pushes the Report screen for a problem with no particular app. */
  onReportProblem: () => void;
  /** Pushes Advanced. */
  onOpenAdvanced: () => void;
}

const styles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  content: { paddingHorizontal: LAYOUT.gutter, paddingTop: SPACE[4], paddingBottom: SPACE[8] },
}));

export default function SettingsScreen({
  onBack,
  onOpenAIFeatures,
  legalLanguage,
  onLegalLanguageChange,
  version,
  onReportProblem,
  onOpenAdvanced,
}: Readonly<SettingsScreenProps>) {
  const t = useTokens();
  const s = styles(t);
  useSystemBack(onBack);
  return (
    <ScrollView style={s.root} contentContainerStyle={s.content} contentInsetAdjustmentBehavior="automatic">
      <GroupedSection>
        <GroupedRow title={COPY.settingsAISectionTitle} subtitle={COPY.settingsAISubtitle} trailing={{ kind: 'chevron' }} onPress={onOpenAIFeatures} />
        <GroupedRow
          title={COPY.settingsLanguageTitle}
          subtitle={COPY.settingsLanguageSubtitle}
          trailing={{ kind: 'value', text: legalLanguageName(legalLanguage) }}
          onPress={() => onLegalLanguageChange(otherLegalLanguage(legalLanguage))}
        />
      </GroupedSection>
      <GroupedSection header={COPY.settingsAboutSectionTitle}>
        <GroupedRow title={COPY.privacyPolicyLabel} trailing={{ kind: 'external' }} onPress={() => Linking.openURL(privacyPolicyUrl(legalLanguage))} />
        <GroupedRow title={COPY.termsOfUseLabel} trailing={{ kind: 'external' }} onPress={() => Linking.openURL(termsUrl(legalLanguage))} />
        <GroupedRow title={COPY.supportLabel} trailing={{ kind: 'external' }} onPress={() => Linking.openURL(RELEASE.supportUrl)} />
        <GroupedRow title={COPY.settingsReportProblem} trailing={{ kind: 'chevron' }} onPress={onReportProblem} />
        {version !== undefined && <GroupedRow title={COPY.settingsVersionTitle} trailing={{ kind: 'value', text: version }} />}
      </GroupedSection>
      <GroupedSection>
        <GroupedRow title={COPY.settingsAdvancedSectionTitle} trailing={{ kind: 'chevron' }} onPress={onOpenAdvanced} />
      </GroupedSection>
    </ScrollView>
  );
}
