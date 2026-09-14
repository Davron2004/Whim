/**
 * ConsentScreen — the AI-data consent gate (design D5; spec ai-data-consent). A full screen,
 * never a sheet: the disclosure has a list, a link and two outcomes, and a swipeable sheet reads
 * as chrome you can dismiss — the wrong signal for a permission (design D5).
 *
 * Ask mode opens in place of a data-sending action the user just took, with no current consent
 * grant; its own hardware back declines, same as `Not now`. Review mode opens from Settings' AI
 * features row and shows the IDENTICAL disclosure, with only its bottom actions keyed off whether
 * consent is currently on. `onClose` is the one "leave without an explicit grant/revoke" callback,
 * shared by hardware back, ask mode's `Not now`, and review mode's safe large `Keep AI features
 * on` button — all three mean the same thing: nothing changes, land wherever this instance's
 * caller decided.
 */
import React, { useEffect } from 'react';
import { BackHandler, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import { RELEASE } from './release-config';
import { SHELL_PALETTE } from './theme';

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
   *  `Not now`, and review mode's safe large `Keep AI features on` button. */
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

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

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

      {mode === 'ask' && (
        <>
          <TouchableOpacity
            onPress={onAgree}
            accessibilityRole="button"
            style={[styles.primary, { backgroundColor: p.accent }]}
          >
            <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.consentAgree}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} accessibilityRole="button" style={styles.plainAction}>
            <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{COPY.consentDecline}</Text>
          </TouchableOpacity>
        </>
      )}

      {mode === 'review' && consentOn && (
        <>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            style={[styles.primary, { backgroundColor: p.text }]}
          >
            <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.consentReviewKeepOn}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onTurnOff} accessibilityRole="button" style={styles.plainAction}>
            <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{COPY.consentReviewTurnOff}</Text>
          </TouchableOpacity>
        </>
      )}

      {mode === 'review' && !consentOn && (
        <TouchableOpacity
          onPress={onAgree}
          accessibilityRole="button"
          style={[styles.primary, styles.primaryLast, { backgroundColor: p.accent }]}
        >
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.consentReviewTurnOn}</Text>
        </TouchableOpacity>
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
  primaryLast: { marginBottom: SPACING.lg },
  plainAction: {
    height: 46,
    marginBottom: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
