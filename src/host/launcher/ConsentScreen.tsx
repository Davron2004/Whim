/**
 * ConsentScreen — the AI-data consent gate (design D5; spec ai-data-consent). A full screen,
 * never a sheet: the disclosure has a list, a link and two outcomes, and a swipeable sheet reads
 * as chrome you can dismiss — the wrong signal for a permission (design D5).
 *
 * Ask mode opens in place of a data-sending action the user just took, with no current consent
 * grant; its own hardware back declines, same as `Not now`. Review mode opens from Settings' AI
 * features row and shows the IDENTICAL disclosure, with only its bottom actions keyed off whether
 * consent is currently on. `onClose` is the one "leave without an explicit grant/revoke" callback,
 * shared by hardware back, ask mode's `Not now`, review mode with consent on's safe large `Keep AI
 * features on` button, and review mode with consent off's own plain-text `Not now` beneath its
 * agree button — the last of these exists because hardware back declines only on Android, and
 * without a visible non-granting exit an iOS reviewer who declines has no way off this screen
 * short of agreeing (spec ai-data-consent "any other exit SHALL grant nothing"). All of them mean
 * the same thing: nothing changes, land wherever this instance's caller decided.
 *
 * Every string comes from the active legal language's table (`LEGAL_COPY`), in the order spec
 * ai-data-consent "The disclosure names what is sent…" lists, and the privacy link opens that
 * language's policy. An outdated grant adds, above the title, the outdated line and the what's-new
 * line written for the grant's version (spec "Consent grants are versioned").
 */
import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { consentWhatsNewText, LEGAL_COPY, type LegalCopyTable } from './copy';
import { consentScreenActions, type ConsentScreenAction } from './consent-screen-actions';
import { activeLegalLanguage, privacyPolicyUrl } from './legal-language';
import { SHELL_PALETTE } from './theme';
import { useSystemBack } from './use-system-back';

/** `consentScreenActions`' row → this component's own label and press handler — the one place
 *  the table's abstract action ids meet real copy and callbacks. */
function actionLabel(action: ConsentScreenAction, copy: LegalCopyTable): string {
  switch (action) {
    case 'agree':
      return copy.consentAgree;
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

/** The line above the title in ask mode: the outdated line when the stored grant is outdated,
 *  else the permission line when a `consent_required` refusal opened the screen, else none. */
function noticeLine(copy: LegalCopyTable, outdated: boolean, refused: boolean): string | undefined {
  if (outdated) return copy.consentOutdatedLine;
  return refused ? copy.permissionRequiredLine : undefined;
}

function SectionTitle({ text }: Readonly<{ text: string }>) {
  return <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: SHELL_PALETTE.textMuted }]}>{text}</Text>;
}

export interface ConsentScreenProps {
  mode: 'ask' | 'review';
  /** Ask mode only: the version of the stored grant when it is outdated (spec "Consent grants are
   *  versioned") — shows the outdated line and that version's what's-new line above the title. */
  outdatedFrom?: number;
  /** Ask mode only: a `consent_required` refusal opened this screen (request-envelope) — shown as
   *  one line above the disclosure, unless the outdated line already explains it. */
  refused?: boolean;
  /** Review mode only: whether a current grant exists right now — decides which action set
   *  renders (spec "Settings shows consent and can review or turn it off"). */
  consentOn?: boolean;
  /** Ask mode: grants and runs the continuation that opened this screen. Review mode with consent
   *  off: grants and returns to Settings. */
  onAgree: () => void;
  /** Review mode with consent on, only: the plain-text action that deletes the grant and returns
   *  to Settings. */
  onTurnOff?: () => void;
  /** Leaves without granting or revoking anything: hardware back in both modes, ask mode's
   *  `Not now`, review mode with consent on's safe large `Keep AI features on` button, and review
   *  mode with consent off's own plain-text `Not now`. */
  onClose: () => void;
}

export default function ConsentScreen({
  mode,
  outdatedFrom,
  refused = false,
  consentOn = false,
  onAgree,
  onTurnOff,
  onClose,
}: Readonly<ConsentScreenProps>) {
  const p = SHELL_PALETTE;
  useSystemBack(onClose);
  const language = activeLegalLanguage();
  const copy = LEGAL_COPY[language];

  /** `agree`/`turnOn` grant and `turnOff` also deletes an existing grant — neither is `onClose`,
   *  so the JSX below routes those three through this helper. `decline`/`keepOn` leave without
   *  granting or revoking anything, same as hardware back: their `onPress` binds `onClose`
   *  DIRECTLY, inline, rather than through this function (design D8 "bound" — the scanner requires
   *  the identifier passed to `useSystemBack` to appear inside an `on[A-Z]…={…}` attribute in this
   *  file itself, not through a same-file indirection). */
  function pressHandlerFor(action: ConsentScreenAction): () => void {
    if (action === 'agree' || action === 'turnOn') return onAgree;
    if (action === 'decline' || action === 'keepOn') return onClose;
    return onTurnOff ?? onClose;
  }

  const actions = consentScreenActions(mode === 'ask' ? { kind: 'ask' } : { kind: 'review', consentOn });
  const grantVersion = mode === 'ask' ? outdatedFrom : undefined;
  const notice = mode === 'ask' ? noticeLine(copy, grantVersion !== undefined, refused) : undefined;
  const whatsNew = grantVersion === undefined ? undefined : consentWhatsNewText(language, grantVersion);
  const sent = [copy.consentSentRequest, copy.consentSentEdit, copy.consentSentDevice, copy.consentSentErrors];

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {notice !== undefined && (
          <View style={[styles.notice, whatsNew !== undefined && styles.noticeWithWhatsNew]}>
            <Text style={[TYPE_SCALE.body, { color: p.danger }]}>{notice}</Text>
            {whatsNew !== undefined && (
              <Text style={[TYPE_SCALE.body, styles.whatsNew, { color: p.text }]}>{whatsNew}</Text>
            )}
          </View>
        )}
        <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{copy.consentTitle}</Text>
        <Text style={[TYPE_SCALE.body, styles.lead, { color: p.text }]}>{copy.consentLead}</Text>

        <SectionTitle text={copy.consentSentTitle} />
        {sent.map((item) => (
          <View key={item} style={styles.bulletRow}>
            <Text style={[TYPE_SCALE.body, styles.bullet, { color: p.textMuted }]}>•</Text>
            <Text style={[TYPE_SCALE.body, styles.bulletText, { color: p.text }]}>{item}</Text>
          </View>
        ))}

        <SectionTitle text={copy.consentWhyTitle} />
        <Text style={[TYPE_SCALE.body, styles.item, { color: p.text }]}>{copy.consentWhy}</Text>

        <SectionTitle text={copy.consentWhoTitle} />
        <Text style={[TYPE_SCALE.body, styles.item, { color: p.text }]}>
          {`${copy.consentWho} ${copy.consentWhoPlatform} ${copy.consentWhoAuthorities}`}
        </Text>

        <SectionTitle text={copy.consentStaysTitle} />
        <Text style={[TYPE_SCALE.body, styles.item, { color: p.text }]}>{copy.consentStays}</Text>

        <SectionTitle text={copy.consentNeverTitle} />
        <Text style={[TYPE_SCALE.body, styles.item, { color: p.text }]}>{copy.consentNever}</Text>

        <Text style={[TYPE_SCALE.body, styles.askFirst, { color: p.text }]}>{copy.consentAskFirst}</Text>
        <Text style={[TYPE_SCALE.caption, styles.footnote, { color: p.textMuted }]}>{copy.consentFootnote}</Text>

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
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl, paddingBottom: SPACING.xl },
  notice: { marginBottom: SPACING.sm },
  // The what's-new line is a full paragraph, so the pair keeps a section's worth of air above the
  // title rather than the single line's tighter gap.
  noticeWithWhatsNew: { marginBottom: SPACING.lg },
  whatsNew: { marginTop: SPACING.xs },
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
