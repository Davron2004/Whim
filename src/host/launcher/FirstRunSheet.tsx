/**
 * FirstRunSheet — the first data-sending action's ask, as one large sheet (system.md §9 First run;
 * design-system-v1 task 16.2). It replaces the full-screen terms step and consent screen in
 * presentation only: whatever has changed since the person last agreed, then "Before Whim makes apps
 * for you", a lead sentence, three summary rows (what's
 * sent, what stays on the phone, what we never do), a Privacy policy row, "Full details" (the whole
 * consent disclosure, expanding in place) and a Language row, whose value is the one-tap switch to
 * the other language, named in that language (spec legal-text-localization); then the terms checkbox row, unticked,
 * with the Terms link beside it and outside its hit area; and two actions on purpose (GDPR art.
 * 7(2)): `Agree to send descriptions` (`ink`, enabled once the terms are ticked) and `Not now`.
 *
 * Both acts are recorded by the caller, each with its own version: the terms acceptance (when it was
 * due) and the consent grant (when it was). Nothing is sent before `onAgree`; `onClose` (Not now,
 * close, scrim, drag, Android back) grants and accepts nothing. Neither act is pre-selected: the box
 * starts unticked every time the sheet opens, and ticking it records nothing by itself.
 *
 * The first layer (the lead and the three rows) names what is sent, who gets it and what for, what
 * stays on the phone and what Whim never does; "Full details" is the whole disclosure, one tap away
 * before either act.
 *
 * Every string comes from the active legal language's table (`LEGAL_COPY`) and the links open that
 * language's pages (spec legal-text-localization).
 */
import React, { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { LAYOUT, RADII, SPACE } from '../../design/tokens';
import { Button } from '../ui/Button';
import { GroupedRow, GroupedSection, ROW } from '../ui/GroupedList';
import { Icon } from '../ui/Icon';
import { Notice } from '../ui/Notice';
import { Sheet } from '../ui/Sheet';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { makeStyles, PRESS_RETENTION } from '../ui/tokens-pure';
import { consentWhatsNewText, firstRunSentText, LEGAL_COPY } from './copy';
import { disclosureOf } from './consent-disclosure';
import KeyboardShell from './KeyboardShell';
import { otherLegalLanguage, privacyPolicyUrl, termsUrl, type LegalLanguage } from './legal-language';

export interface FirstRunSheetProps {
  visible: boolean;
  language: LegalLanguage;
  /** The language row was tapped: the shell persists the choice and re-renders in it. */
  onLanguageChange: (language: LegalLanguage) => void;
  /** The terms of use are not accepted at the current version: the sheet shows the terms row, and
   *  `Agree to send descriptions` stays disabled until it is ticked. */
  termsDue: boolean;
  /** The consent grant is not current (or a refusal asked again): the action reads `Agree to send
   *  descriptions` and records it. When only the terms are due the action continues, agreeing to
   *  nothing new, and no grant is recorded. */
  consentDue: boolean;
  /** The stored terms acceptance is of another version: the updated-terms line heads the sheet. */
  termsOutdated?: boolean;
  /** The stored consent grant's version, when that grant is outdated: its outdated line and the
   *  what's-new line written for it head the sheet. */
  outdatedFrom?: number;
  /** A `consent_required` refusal opened the sheet: the permission line heads it. */
  refused?: boolean;
  /** Records the acceptance (when due) and the grant, and runs the action the person started. */
  onAgree: () => void;
  /** Every way out that grants and accepts nothing. */
  onClose: () => void;
  /** The sheet has finished closing (`Sheet`'s `onClosed`): the next sheet may be presented. */
  onClosed?: () => void;
}

const BOX = 24;

const styles = makeStyles((t) => ({
  content: { paddingHorizontal: LAYOUT.gutter, paddingBottom: SPACE[4], gap: SPACE[4] },
  notice: { gap: SPACE[1] },
  details: { gap: SPACE[3], paddingHorizontal: LAYOUT.listRowPaddingHorizontal, paddingBottom: SPACE[4] },
  bullet: { flexDirection: 'row' as const, gap: SPACE[2] },
  bulletText: { flex: 1 },
  detailsRow: { minHeight: ROW.minHeight, flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[3], paddingVertical: ROW.paddingVertical, paddingHorizontal: ROW.paddingHorizontal },
  detailsTitle: { flex: 1 },
  termsLine: { flexDirection: 'row' as const, alignItems: 'center' as const, backgroundColor: t.colors['sheet-group'], borderRadius: RADII.lg.radius, borderCurve: 'continuous' as const },
  termsCheck: { flex: 1, minHeight: LAYOUT.listRowMinHeight, flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[3], paddingHorizontal: LAYOUT.listRowPaddingHorizontal },
  // A target of its own beside the checkbox row, never a `hitSlop` that would reach into it.
  termsLink: { minWidth: t.touchTarget, minHeight: t.touchTarget, alignItems: 'center' as const, justifyContent: 'center' as const },
  box: { width: BOX, height: BOX, borderRadius: RADII.sm.radius, borderWidth: 2, alignItems: 'center' as const, justifyContent: 'center' as const },
  footer: { paddingHorizontal: LAYOUT.gutter, paddingTop: LAYOUT.actionAreaTop, paddingBottom: LAYOUT.actionAreaBottom, gap: SPACE[1] },
}));

/** The whole consent disclosure, in the order the spec lists it: the consent screen's own lead
 *  first, then its sections. The sheet's lead above is shorter, so nothing repeats while it is folded. */
function Disclosure({ language }: Readonly<{ language: LegalLanguage }>) {
  const s = styles(useTokens());
  const { sections, closing } = disclosureOf(LEGAL_COPY[language]);
  return (
    <View style={s.details}>
      <Text color="text-2">{LEGAL_COPY[language].consentLead}</Text>
      {sections.map((section) => (
        <View key={section.title} style={s.notice}>
          <Text type="footnote" header color="text-2">
            {section.title}
          </Text>
          {section.bullets?.map((bullet) => (
            <View key={bullet} style={s.bullet}>
              <Text color="text-2">•</Text>
              <View style={s.bulletText}>
                <Text>{bullet}</Text>
              </View>
            </View>
          ))}
          {section.body ? <Text>{section.body}</Text> : null}
        </View>
      ))}
      {closing.map((paragraph) => (
        <Text key={paragraph} color="text-2">
          {paragraph}
        </Text>
      ))}
    </View>
  );
}

/** The "Full details" row: a list row whose chevron points down while the disclosure is open, and
 *  says so to a screen reader. `GroupedRow` has no expanded state, and `GroupedSection` takes any row. */
function DetailsRow({ title, expanded, onPress }: Readonly<{ title: string; expanded: boolean; onPress: () => void }>) {
  const t = useTokens();
  const s = styles(t);
  return (
    <Pressable
      onPress={onPress}
      pressRetentionOffset={PRESS_RETENTION}
      style={({ pressed }) => [s.detailsRow, pressed ? { backgroundColor: t.colors.fill } : null]}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ expanded }}
    >
      <View style={s.detailsTitle}>
        <Text>{title}</Text>
      </View>
      <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={ROW.trailingIcon} color={t.colors['text-2']} />
    </Pressable>
  );
}

/** The checkbox row for the terms, and the link to read them beside it — a separate control, so
 *  opening the terms never ticks the box. */
function TermsRow({ language, accepted, onToggle }: Readonly<{ language: LegalLanguage; accepted: boolean; onToggle: () => void }>) {
  const t = useTokens();
  const s = styles(t);
  const copy = LEGAL_COPY[language];
  const boxLook = accepted ? { borderColor: t.colors.ink, backgroundColor: t.colors.ink } : { borderColor: t.colors['text-2'], backgroundColor: 'transparent' };
  return (
    <View style={s.termsLine}>
      <Pressable
        onPress={onToggle}
        pressRetentionOffset={PRESS_RETENTION}
        style={s.termsCheck}
        accessibilityRole="checkbox"
        accessibilityLabel={copy.firstRunTermsCheck}
        accessibilityState={{ checked: accepted }}
      >
        <View style={[s.box, boxLook]}>
          {accepted ? <Icon name="check" size={16} color={t.colors['on-ink']} /> : null}
        </View>
        <Text>{copy.firstRunTermsCheck}</Text>
      </Pressable>
      <Pressable
        onPress={() => Linking.openURL(termsUrl(language))}
        pressRetentionOffset={PRESS_RETENTION}
        style={s.termsLink}
        accessibilityRole="link"
        accessibilityLabel={copy.termsLabel}
      >
        <Icon name="external-link" size={20} color={t.colors['text-2']} />
      </Pressable>
    </View>
  );
}

/** The line above the title when there is something to say first: why the sheet is back, or what changed. */
function leadLines(language: LegalLanguage, { termsOutdated, outdatedFrom, refused }: Pick<FirstRunSheetProps, 'termsOutdated' | 'outdatedFrom' | 'refused'>): string[] {
  const copy = LEGAL_COPY[language];
  const lines: string[] = [];
  if (refused) lines.push(copy.permissionRequiredLine);
  if (termsOutdated) lines.push(copy.termsUpdatedLine);
  if (outdatedFrom !== undefined) {
    lines.push(copy.consentOutdatedLine);
    const whatsNew = consentWhatsNewText(language, outdatedFrom);
    if (whatsNew !== undefined) lines.push(whatsNew);
  }
  return lines;
}

function FirstRunBody(props: Readonly<Omit<FirstRunSheetProps, 'visible'>>) {
  const { language, onLanguageChange, termsDue, consentDue, onAgree, onClose } = props;
  const t = useTokens();
  const s = styles(t);
  const copy = LEGAL_COPY[language];
  const [accepted, setAccepted] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const lines = leadLines(language, props);
  return (
    <KeyboardShell
      host="sheet"
      contentContainerStyle={s.content}
      footer={
        <View style={s.footer}>
          <Button label={consentDue ? copy.consentAgree : copy.firstRunContinue} variant="ink" disabled={termsDue && !accepted} onPress={onAgree} />
          <Button label={copy.consentDecline} variant="plain" onPress={onClose} />
        </View>
      }
    >
      {lines.map((line) => (
        <Notice key={line} message={line} />
      ))}
      <Text type="title2">{copy.consentTitle}</Text>
      <Text color="text-2">{copy.firstRunLead}</Text>
      <GroupedSection on="sheet">
        <GroupedRow icon="arrow-up" title={copy.firstRunSentTitle} subtitle={firstRunSentText(copy)} />
        <GroupedRow icon="phone" title={copy.firstRunStaysTitle} subtitle={copy.firstRunStays} />
        <GroupedRow icon="lock" title={copy.firstRunNeverTitle} subtitle={copy.firstRunNever} />
      </GroupedSection>
      <GroupedSection on="sheet">
        <GroupedRow title={copy.privacyPolicyLabel} trailing={{ kind: 'external' }} onPress={() => Linking.openURL(privacyPolicyUrl(language))} />
        <DetailsRow title={copy.firstRunDetails} expanded={expanded} onPress={() => setExpanded((open) => !open)} />
      </GroupedSection>
      {expanded ? <Disclosure language={language} /> : null}
      <GroupedSection on="sheet">
        <GroupedRow title={copy.firstRunLanguage} trailing={{ kind: 'value', text: copy.legalLanguageSwitch }} onPress={() => onLanguageChange(otherLegalLanguage(language))} />
      </GroupedSection>
      {termsDue ? <TermsRow language={language} accepted={accepted} onToggle={() => setAccepted((on) => !on)} /> : null}
    </KeyboardShell>
  );
}

export function FirstRunSheet({ visible, onClosed, ...body }: Readonly<FirstRunSheetProps>) {
  return (
    <Sheet visible={visible} onClose={body.onClose} onClosed={onClosed} detent="large">
      <FirstRunBody {...body} />
    </Sheet>
  );
}
