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
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { LEGAL_COPY, type LegalCopyTable } from './copy';
import { disclosureOf } from './consent-disclosure';
import { consentScreenActions, type ConsentScreenAction } from './consent-screen-actions';
import LegalLanguageSwitch from './LegalLanguageSwitch';
import { privacyPolicyUrl, type LegalLanguage } from './legal-language';
import { SHELL_PALETTE } from './theme';
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

function SectionTitle({ text }: Readonly<{ text: string }>) {
  return <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: SHELL_PALETTE.textMuted }]}>{text}</Text>;
}

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
  const p = SHELL_PALETTE;
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
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <ScrollView style={[styles.scroll, { borderBottomColor: p.cardBorder }]} contentContainerStyle={styles.content}>
        <LegalLanguageSwitch language={language} onChange={onLanguageChange} />
        <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{copy.consentTitle}</Text>
        <Text style={[TYPE_SCALE.body, styles.lead, { color: p.text }]}>{copy.consentLead}</Text>

        {sections.map((section) => (
          <View key={section.title}>
            <SectionTitle text={section.title} />
            {section.bullets?.map((item) => (
              <View key={item} style={styles.bulletRow}>
                <Text style={[TYPE_SCALE.body, styles.bullet, { color: p.textMuted }]}>•</Text>
                <Text style={[TYPE_SCALE.body, styles.bulletText, { color: p.text }]}>{item}</Text>
              </View>
            ))}
            {section.body ? <Text style={[TYPE_SCALE.body, styles.item, { color: p.text }]}>{section.body}</Text> : null}
          </View>
        ))}

        <Text style={[TYPE_SCALE.body, styles.askFirst, { color: p.text }]}>{closing[0]}</Text>
        <Text style={[TYPE_SCALE.caption, styles.footnote, { color: p.textMuted }]}>{closing[1]}</Text>

        <TouchableOpacity
          onPress={() => Linking.openURL(privacyPolicyUrl(language))}
          hitSlop={10}
          style={styles.privacyLink}
        >
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.accent }]}>{copy.privacyPolicyLabel}</Text>
        </TouchableOpacity>
      </ScrollView>

      {actions.map((row) =>
        row.kind === 'primary' ? (
          <TouchableOpacity
            key={row.action}
            onPress={row.action === 'decline' || row.action === 'keepOn' ? onClose : pressHandlerFor(row.action)}
            accessibilityRole="button"
            // `keepOn` is review mode's safe choice (design D5) — it keeps the SAME behaviour as
            // hardware back, so its button reads visually distinct from the accent-coloured agree
            // actions, never the CTA colour a grant uses.
            style={[styles.primary, { backgroundColor: row.action === 'keepOn' ? p.text : p.accent }]}
          >
            <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{actionLabel(row.action, copy)}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            key={row.action}
            onPress={row.action === 'decline' || row.action === 'keepOn' ? onClose : pressHandlerFor(row.action)}
            accessibilityRole="button"
            style={styles.plainAction}
          >
            <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{actionLabel(row.action, copy)}</Text>
          </TouchableOpacity>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // The disclosure scrolls under the pinned actions; a hairline marks where it is cut off.
  scroll: { borderBottomWidth: StyleSheet.hairlineWidth },
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl, paddingBottom: SPACING.xl },
  lead: { marginTop: SPACING.sm },
  sectionTitle: { marginTop: SPACING.lg, marginBottom: SPACING.xs },
  item: { marginTop: SPACING.xs },
  bulletRow: { flexDirection: 'row', marginTop: SPACING.xs },
  bullet: { width: SPACING.md },
  bulletText: { flex: 1 },
  askFirst: { marginTop: SPACING.lg },
  footnote: { marginTop: SPACING.sm },
  privacyLink: { marginTop: SPACING.sm },
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
