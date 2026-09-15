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
 */
import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import { consentScreenActions, type ConsentScreenAction } from './consent-screen-actions';
import { RELEASE } from './release-config';
import { SHELL_PALETTE } from './theme';
import { useSystemBack } from './use-system-back';

/** `consentScreenActions`' row → this component's own label and press handler — the one place
 *  the table's abstract action ids meet real copy and callbacks. */
function actionLabel(action: ConsentScreenAction): string {
  switch (action) {
    case 'agree':
      return COPY.consentAgree;
    case 'decline':
      return COPY.consentDecline;
    case 'keepOn':
      return COPY.consentReviewKeepOn;
    case 'turnOff':
      return COPY.consentReviewTurnOff;
    case 'turnOn':
      return COPY.consentReviewTurnOn;
  }
}

export interface ConsentScreenProps {
  mode: 'ask' | 'review';
  /** Ask mode only: the stored grant was for an earlier consent version (spec "A policy change
   *  asks again") — shown as one line above the disclosure. */
  outdated?: boolean;
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
  outdated = false,
  consentOn = false,
  onAgree,
  onTurnOff,
  onClose,
}: Readonly<ConsentScreenProps>) {
  const p = SHELL_PALETTE;
  useSystemBack(onClose);

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

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {mode === 'ask' && outdated && (
          <Text style={[TYPE_SCALE.body, styles.outdated, { color: p.danger }]}>{COPY.consentOutdatedLine}</Text>
        )}
        <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{COPY.consentTitle}</Text>
        <Text style={[TYPE_SCALE.body, styles.lead, { color: p.text }]}>{COPY.consentLead}</Text>

        <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: p.textMuted }]}>
          {COPY.consentWhatSentTitle}
        </Text>
        <Text style={[TYPE_SCALE.body, styles.item, { color: p.text }]}>{COPY.consentWhatSentRequest}</Text>
        <Text style={[TYPE_SCALE.body, styles.item, { color: p.text }]}>{COPY.consentWhatSentEdit}</Text>
        <Text style={[TYPE_SCALE.body, styles.item, { color: p.text }]}>{COPY.consentWhatSentDevice}</Text>

        <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: p.textMuted }]}>
          {COPY.consentWhatNeverSentTitle}
        </Text>
        <Text style={[TYPE_SCALE.body, styles.item, { color: p.text }]}>{COPY.consentWhatNeverSent}</Text>

        <Text style={[TYPE_SCALE.caption, styles.footnote, { color: p.textMuted }]}>{COPY.consentFootnote}</Text>

        <TouchableOpacity
          onPress={() => Linking.openURL(RELEASE.privacyPolicyUrl)}
          hitSlop={10}
          style={styles.privacyLink}
        >
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.accent }]}>{COPY.privacyPolicyLabel}</Text>
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
            <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{actionLabel(row.action)}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            key={row.action}
            onPress={row.action === 'decline' || row.action === 'keepOn' ? onClose : pressHandlerFor(row.action)}
            accessibilityRole="button"
            style={styles.plainAction}
          >
            <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{actionLabel(row.action)}</Text>
          </TouchableOpacity>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl, paddingBottom: SPACING.xl },
  outdated: { marginBottom: SPACING.sm },
  lead: { marginTop: SPACING.sm },
  sectionTitle: { marginTop: SPACING.lg, marginBottom: SPACING.xs },
  item: { marginTop: SPACING.xs },
  footnote: { marginTop: SPACING.lg },
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
