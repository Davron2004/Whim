/**
 * ConsentScreen — the AI features review, pushed on the native stack from Settings (design D5; spec
 * ai-data-consent "Settings shows consent and can review or turn it off"). A full screen, not a
 * sheet: the disclosure has a list, a link and two outcomes. The first ask for consent is the
 * first-run sheet (`FirstRunSheet.tsx`), which shows this same disclosure under "Full details".
 *
 * With consent on, the large button keeps it on and a plain-text action turns it off; with consent
 * off, the large button turns it on and `Not now` leaves. `onClose` is the one "leave without an
 * explicit grant/revoke" callback, shared by hardware back, `Keep AI features on` and `Not now` —
 * all of them mean the same thing: nothing changes, land back on Settings (spec ai-data-consent "any
 * other exit SHALL grant nothing").
 *
 * Every string comes from the active legal language's table (`LEGAL_COPY`), in the order spec
 * ai-data-consent "The disclosure names what is sent…" lists, and the privacy link opens that
 * language's policy. The switch at the top offers the other language in one tap (spec
 * legal-text-localization).
 */
import React from 'react';
import { Linking, ScrollView, TouchableOpacity, View } from 'react-native';
import { LAYOUT, SPACE, TYPE_SCALE } from '../../design/tokens';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { hitSlopFor, makeStyles, type ButtonVariant } from '../ui/tokens-pure';
import { LEGAL_COPY, type LegalCopyTable } from './copy';
import { disclosureOf } from './consent-disclosure';
import { consentScreenActions, type ConsentActionRow, type ConsentScreenAction } from './consent-screen-actions';
import LegalLanguageSwitch from './LegalLanguageSwitch';
import { privacyPolicyUrl, type LegalLanguage } from './legal-language';
import { useSystemBack } from './use-system-back';

/** `consentScreenActions`' row → this component's own label and press handler — the one place
 *  the table's abstract action ids meet real copy and callbacks. */
function actionLabel(action: ConsentScreenAction, copy: LegalCopyTable): string {
  switch (action) {
    case 'decline':
      return copy.consentDecline;
    case 'keepOn':
      return copy.consentReviewKeepOn;
    case 'turnOff':
      return copy.consentReviewTurnOff;
    case 'turnOn':
      return copy.consentReviewTurnOn;
  }
}

/** A row's button: the large one is `ink` only when it grants; `keepOn`, review mode's safe choice
 *  (design D5), does what hardware back does, so it never wears the granting action's fill. */
function actionVariant(row: ConsentActionRow): ButtonVariant {
  if (row.kind === 'plain') return 'plain';
  return row.grants ? 'ink' : 'secondary';
}

const styles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.colors.bg },
  content: { paddingHorizontal: LAYOUT.gutter, paddingTop: SPACE[2], paddingBottom: LAYOUT.gapBetweenGroups, gap: LAYOUT.gapInGroup },
  section: { gap: SPACE[1], marginTop: SPACE[3] },
  bullet: { flexDirection: 'row' as const, gap: SPACE[2] },
  bulletText: { flex: 1 },
  privacyLink: { alignSelf: 'flex-start' as const },
  footer: { paddingHorizontal: LAYOUT.gutter, paddingTop: LAYOUT.actionAreaTop, paddingBottom: LAYOUT.actionAreaBottom, gap: SPACE[3] },
}));

export interface ConsentScreenProps {
  /** The active legal language: this screen's copy and its privacy link. */
  language: LegalLanguage;
  /** The language switch was tapped: the launcher persists the choice and re-renders in it. */
  onLanguageChange: (language: LegalLanguage) => void;
  /** Whether a current grant exists right now — decides which action set renders (spec "Settings
   *  shows consent and can review or turn it off"). */
  consentOn?: boolean;
  /** With consent off: grants and returns to Settings. */
  onAgree: () => void;
  /** With consent on, only: the plain-text action that deletes the grant and returns to Settings. */
  onTurnOff?: () => void;
  /** Leaves without granting or revoking anything: hardware back, `Keep AI features on` and `Not now`. */
  onClose: () => void;
}

export default function ConsentScreen({
  language,
  onLanguageChange,
  consentOn = false,
  onAgree,
  onTurnOff,
  onClose,
}: Readonly<ConsentScreenProps>) {
  const t = useTokens();
  const s = styles(t);
  useSystemBack(onClose);
  const copy = LEGAL_COPY[language];

  /** `turnOn` grants and `turnOff` deletes the grant — neither is `onClose`, so the JSX below
   *  routes those through this helper. `decline`/`keepOn` leave without granting or revoking
   *  anything, same as hardware back: their `onPress` binds `onClose` DIRECTLY, inline, rather than
   *  through this function (design D8 "bound" — the scanner requires the identifier passed to
   *  `useSystemBack` to appear inside an `on[A-Z]…={…}` attribute in this file itself, not through
   *  a same-file indirection). */
  function pressHandlerFor(action: ConsentScreenAction): () => void {
    if (action === 'turnOn') return onAgree;
    return onTurnOff ?? onClose;
  }

  const actions = consentScreenActions({ consentOn });
  const { sections, closing } = disclosureOf(copy);

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.content}>
        <LegalLanguageSwitch language={language} onChange={onLanguageChange} />
        <Text type="title1">{copy.consentTitle}</Text>
        <Text>{copy.consentLead}</Text>

        {sections.map((section) => (
          <View key={section.title} style={s.section}>
            <Text type="footnote" header color="text-2">
              {section.title}
            </Text>
            {section.bullets?.map((item) => (
              <View key={item} style={s.bullet}>
                <Text color="text-2">•</Text>
                <View style={s.bulletText}>
                  <Text>{item}</Text>
                </View>
              </View>
            ))}
            {section.body ? <Text>{section.body}</Text> : null}
          </View>
        ))}

        <Text>{closing[0]}</Text>
        <Text type="footnote" color="text-2">
          {closing[1]}
        </Text>

        <TouchableOpacity
          onPress={() => Linking.openURL(privacyPolicyUrl(language))}
          hitSlop={hitSlopFor(TYPE_SCALE.headline.lineHeight, t)}
          style={s.privacyLink}
        >
          <Text type="headline">{copy.privacyPolicyLabel}</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={s.footer}>
        {actions.map((row) => (
          <Button
            key={row.action}
            label={actionLabel(row.action, copy)}
            variant={actionVariant(row)}
            onPress={row.action === 'decline' || row.action === 'keepOn' ? onClose : pressHandlerFor(row.action)}
          />
        ))}
      </View>
    </View>
  );
}
