/**
 * ReportSheet — the report sheet three entry points share (design D13/D14; spec
 * `content-reporting`). Reason pills, an optional note, the include-prompt switch,
 * a preview rendered from the SAME `ReportRequest` value Send posts, the phone-ID-and-AnyCognition
 * line plus a privacy-policy link, Send (`One moment` while in flight) and Cancel, the thanks
 * state, and inline failures through the shared `ServiceNotice`/`useRetryGate`. Send, Cancel and
 * the notice are pinned below the scrolling draft, so the note's keyboard never hides Send.
 *
 * `app == null` closes the sheet: `SheetModal` stays mounted (so its rise animation survives a
 * close/reopen, the same contract `RunDetailsSheet.tsx` keeps) but the draft, phase and notice are
 * all cleared — closing sends nothing and discards the draft (spec "Closing the sheet sends
 * nothing"). Reopening for any app (the same one or a different one) loads a fresh draft through
 * `reportDraftFor`.
 */
import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { FONT_FAMILY, RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import type { InstalledApp } from './app-index';
import type { StoreAccess } from './store-access';
import type { ReportReason } from '@whim/contract';
import { buildReportRequest, reportDraftFor, reportLogFields, reportPreview } from './report-payload';
import type { ReportDraft, ReportPreviewRow } from './report-payload';
import { sendReport } from './generation-client';
import type { ClientOptions } from './generation-client';
import { REFUSAL_RULES, refusalText, retryAtOf, serviceRefusalOf } from './service-refusal';
import { fallbackNotice, terminalFallbackOf } from './wire-fallback';
import type { ServiceRefusal } from './service-refusal';
import { sendDisabled as computeSendDisabled, sendFailureOutcome, settleSend } from './report-send';
import ServiceNotice, { useNoticeWindowClear, useRetryGate } from './ServiceNotice';
import SheetModal from './SheetModal';
import KeyboardShell, { KeyboardTextInput } from './KeyboardShell';
import { COPY, reportCodeSizeLabel } from './copy';
import { privacyPolicyUrl, type LegalLanguage } from './legal-language';
import { SHELL_PALETTE } from './theme';

const REASONS: readonly ReportReason[] = ['broken', 'wrong_result', 'hard_to_use', 'harmful', 'offensive', 'other'];

const REASON_LABEL: Record<ReportReason, string> = {
  offensive: COPY.reportReasonOffensive,
  harmful: COPY.reportReasonHarmful,
  broken: COPY.reportReasonBroken,
  wrong_result: COPY.reportReasonWrongResult,
  hard_to_use: COPY.reportReasonHardToUse,
  other: COPY.reportReasonOther,
};

const PREVIEW_LABEL: Record<ReportPreviewRow['field'], string> = {
  reason: COPY.reportFieldReason,
  note: COPY.reportFieldNote,
  appName: COPY.reportFieldAppName,
  prompt: COPY.reportFieldPrompt,
  source: COPY.reportFieldSource,
};

/** This sheet's own refusal notice — the same shape `LauncherRoot.tsx`'s private `noticeFrom`
 *  keeps for the five-step flow (design D12), kept as a second small copy rather than an import:
 *  the sheet carries no `prompt-flow.ts` screen to hang a `FlowNotice` on (service-notice handoff
 *  "For chain-5 and later chains"). */
interface ReportNotice {
  readonly hint: string;
  readonly tone: 'danger' | 'neutral';
  readonly retryAt?: number;
}

function reportNoticeFrom(refusal: ServiceRefusal): ReportNotice {
  const retryAt = retryAtOf(refusal, Date.now());
  return {
    hint: refusal.code === 'payload_too_large' ? COPY.reportTooLarge : refusalText(refusal),
    tone: REFUSAL_RULES[refusal.code].tone,
    ...(retryAt !== undefined ? { retryAt } : {}),
  };
}

type Phase = 'draft' | 'sending' | 'thanks';

export interface ReportSheetProps {
  /** The app being reported, or `null` while the sheet is closed. */
  app: InstalledApp | null;
  access: StoreAccess;
  /** Plain `ClientOptions` — sending a report needs no AI-data consent (design D3). */
  options: ClientOptions;
  onClose: () => void;
  /** A send refused `update_required`, or answered with an `update` fallback: the host opens the
   *  update screen in place of the sheet (request-envelope D5), showing the fallback's `notice` when
   *  it has one, and closing the sheet discards the draft as any close does. */
  onUpdateRequired: (notice?: string) => void;
  /** The active legal language: the privacy link opens its policy page. */
  legalLanguage: LegalLanguage;
}

export default function ReportSheet({ app, access, options, onClose, onUpdateRequired, legalLanguage }: Readonly<ReportSheetProps>) {
  const p = SHELL_PALETTE;
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [phase, setPhase] = useState<Phase>('draft');
  const [notice, setNotice] = useState<ReportNotice | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const gated = useRetryGate(notice?.retryAt);
  // A sender-landing (`neutral`-tone) notice clears the instant its retry window ends (design
  // D12), the same rule `LauncherRoot.tsx`'s flow screens follow — closing the sheet already
  // clears it for free via the effect below.
  useNoticeWindowClear(notice ?? undefined, () => {
    setNotice((prev) => (prev === notice ? null : prev));
  });

  useEffect(() => {
    if (!app) {
      setDraft(null);
      setPhase('draft');
      setNotice(null);
      setPromptExpanded(false);
      setSourceExpanded(false);
      return undefined;
    }
    let cancelled = false;
    reportDraftFor(app, access).then((d) => {
      if (!cancelled) setDraft(d);
    });
    return () => {
      cancelled = true;
    };
  }, [app, access]);

  const request = draft ? buildReportRequest(draft) : null;
  const rows = request ? reportPreview(request) : [];

  const handleClose = () => {
    if (phase === 'sending') return; // a send in flight owns this press
    onClose();
  };

  const handleSend = async () => {
    if (!draft || !request) return;
    setPhase('sending');
    setNotice(null);
    try {
      await sendReport(options, request);
      log.debug(CHANNELS.gen, 'report sent', { ...reportLogFields(request, '202') });
      const settled = settleSend<ReportNotice>({ kind: 'sent' });
      setPhase(settled.phase);
      setNotice(settled.notice);
    } catch (err) {
      // A reply this build can't use whose fallback is `update` opens the update screen with its
      // notice, as an `update_required` refusal does (beta-1 D16); a `fail` one is an ordinary
      // failed send below.
      const fallback = terminalFallbackOf(err);
      if (fallback?.kind === 'update') {
        log.warn(CHANNELS.gen, 'report refused', { ...reportLogFields(request, 'update_required') });
        onUpdateRequired(fallbackNotice(fallback));
        return;
      }
      const refusal = serviceRefusalOf(err);
      if (refusal) {
        log.warn(CHANNELS.gen, 'report refused', { ...reportLogFields(request, refusal.code) });
        if (REFUSAL_RULES[refusal.code].opens === 'update') {
          onUpdateRequired();
          return;
        }
        const settled = settleSend<ReportNotice>({ kind: 'refused', notice: reportNoticeFrom(refusal) });
        setPhase(settled.phase);
        setNotice(settled.notice);
      } else {
        // The real HTTP status when the server answered with one (a 400/500 is not "network" —
        // that word is reserved for a genuine transport-level failure, spec "Offline").
        log.warn(CHANNELS.gen, 'report failed', { ...reportLogFields(request, sendFailureOutcome(err)) });
        const settled = settleSend<ReportNotice>({
          kind: 'failed',
          notice: { hint: COPY.reportSendFailedGeneric, tone: 'neutral' },
        });
        setPhase(settled.phase);
        setNotice(settled.notice);
      }
    }
  };

  const sendDisabled = computeSendDisabled(request, phase, gated);

  return (
    <SheetModal visible={app != null} onClose={handleClose}>
      {draft && phase === 'thanks' && (
        <View style={styles.thanks}>
          <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{COPY.reportThanksTitle}</Text>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            style={[styles.primary, { backgroundColor: p.accent }]}
          >
            <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.reportThanksDone}</Text>
          </TouchableOpacity>
        </View>
      )}
      {draft && phase !== 'thanks' && (
        <KeyboardShell
          host="sheet"
          footer={
            <>
              {notice && <ServiceNotice hint={notice.hint} retryAt={notice.retryAt} tone={notice.tone} />}
              <TouchableOpacity
                onPress={handleSend}
                disabled={sendDisabled}
                accessibilityRole="button"
                accessibilityState={{ disabled: sendDisabled }}
                style={[styles.primary, sendDisabled && styles.primaryDisabled, { backgroundColor: p.accent }]}
              >
                <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>
                  {phase === 'sending' ? COPY.reportSendBusy : COPY.reportSend}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClose} accessibilityRole="button" style={styles.plainAction}>
                <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{COPY.cancel}</Text>
              </TouchableOpacity>
            </>
          }
        >
          <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{COPY.reportSheetTitle}</Text>

          <Text style={[TYPE_SCALE.eyebrow, styles.eyebrow, { color: p.textMuted }]}>{COPY.reportReasonEyebrow}</Text>
          <View style={styles.pillRow}>
            {REASONS.map((reason) => {
              const selected = draft.reason === reason;
              return (
                <TouchableOpacity
                  key={reason}
                  onPress={() => setDraft({ ...draft, reason })}
                  // An answer pill, picked the way the clarify step's are (design 2a,
                  // `Whim Mobile.dc.html:889`): the accent, fill and edge.
                  style={[styles.pill, { borderColor: selected ? p.accent : p.cardBorder, backgroundColor: selected ? p.accent : p.bg }]}
                >
                  <Text style={[TYPE_SCALE.caption, { color: selected ? p.onAccent : p.textMuted }]}>
                    {REASON_LABEL[reason]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <KeyboardTextInput
            value={draft.note}
            onChangeText={(text) => setDraft({ ...draft, note: text })}
            placeholder={COPY.reportNotePlaceholder}
            placeholderTextColor={p.textMuted}
            maxLength={1000}
            multiline
            // Its own background, as every launcher field has: without one Android draws its default
            // field underline inside the border.
            style={[TYPE_SCALE.body, styles.noteInput, { color: p.text, borderColor: p.cardBorder, backgroundColor: p.card }]}
          />

          {draft.prompt !== undefined && (
            <SwitchRow
              label={COPY.reportIncludePrompt}
              value={draft.promptIncluded}
              onChange={(v) => setDraft({ ...draft, promptIncluded: v })}
            />
          )}
          <Text style={[TYPE_SCALE.caption, styles.disclosure, { color: p.textMuted }]}>
            {draft.source === undefined ? COPY.reportNoCodeDisclosure : COPY.reportCodeDisclosure}
          </Text>

          {request && (
            <>
              <Text style={[TYPE_SCALE.eyebrow, styles.eyebrow, { color: p.textMuted }]}>{COPY.reportPreviewTitle}</Text>
              <View style={[styles.previewCard, { borderColor: p.cardBorder }]}>
                {rows.map((row) => {
                  const expandable = expandableRow(row.field, promptExpanded, sourceExpanded, setPromptExpanded, setSourceExpanded);
                  return (
                    <PreviewRow
                      key={row.field}
                      label={PREVIEW_LABEL[row.field]}
                      // The reason row previews the PILL's label ("Doesn't work", not "broken") — the
                      // enum value itself is only what `reportPreview`/`buildReportRequest` transmit,
                      // never what the user reads.
                      value={row.field === 'reason' ? REASON_LABEL[row.value as ReportReason] : row.value}
                      mono={row.field === 'source'}
                      collapsedToSize={row.field === 'source'}
                      expanded={expandable?.expanded ?? false}
                      onToggle={expandable?.onToggle}
                    />
                  );
                })}
              </View>
            </>
          )}

          <Text style={[TYPE_SCALE.caption, styles.deviceIdLine, { color: p.textMuted }]}>{COPY.reportDeviceIdLine}</Text>
          <TouchableOpacity onPress={() => Linking.openURL(privacyPolicyUrl(legalLanguage))} hitSlop={10} style={styles.privacyLink}>
            <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.accent }]}>{COPY.privacyPolicyLabel}</Text>
          </TouchableOpacity>
        </KeyboardShell>
      )}
    </SheetModal>
  );
}

/** Only the `prompt` and `source` preview rows expand (design D14); `reason`/`note`/`appName`
 *  render as-is. Each of the two owns its own expand state — the prompt and the code can be
 *  expanded independently. */
function expandableRow(
  field: ReportPreviewRow['field'],
  promptExpanded: boolean,
  sourceExpanded: boolean,
  setPromptExpanded: (fn: (e: boolean) => boolean) => void,
  setSourceExpanded: (fn: (e: boolean) => boolean) => void,
): { expanded: boolean; onToggle: () => void } | undefined {
  if (field === 'prompt') return { expanded: promptExpanded, onToggle: () => setPromptExpanded((e) => !e) };
  if (field === 'source') return { expanded: sourceExpanded, onToggle: () => setSourceExpanded((e) => !e) };
  return undefined;
}

function SwitchRow({ label, value, onChange }: Readonly<{ label: string; value: boolean; onChange: (v: boolean) => void }>) {
  const p = SHELL_PALETTE;
  return (
    <View style={styles.switchRow}>
      <Text style={[TYPE_SCALE.body, { color: p.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: p.cardBorder, true: p.accent }} thumbColor={p.onAccent} />
    </View>
  );
}

function PreviewRow({
  label,
  value,
  mono = false,
  collapsedToSize = false,
  expanded = false,
  onToggle,
}: Readonly<{
  label: string;
  value: string;
  mono?: boolean;
  /** Shows a character-count summary until expanded (the code row); the prompt row instead shows
   *  its own full text, truncated to a few lines until expanded. */
  collapsedToSize?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}>) {
  const p = SHELL_PALETTE;
  const displayValue = collapsedToSize && !expanded ? reportCodeSizeLabel(value.length) : value;
  const truncate = onToggle !== undefined && !collapsedToSize && !expanded;
  return (
    <View style={styles.previewRow}>
      <View style={styles.previewRowHeader}>
        <Text style={[TYPE_SCALE.caption, { color: p.textMuted }]}>{label}</Text>
        {onToggle && (
          <TouchableOpacity onPress={onToggle} hitSlop={8}>
            <Text style={[TYPE_SCALE.caption, { color: p.accent }]}>
              {expanded ? COPY.reportShowLess : COPY.reportShowMore}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      <Text
        style={[mono ? styles.previewMono : TYPE_SCALE.body, { color: p.text }]}
        numberOfLines={truncate ? 3 : undefined}
      >
        {displayValue}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { marginTop: SPACING.md, marginBottom: SPACING.xs },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  pill: { borderRadius: RADIUS.chip, borderWidth: 1, paddingHorizontal: SPACING.sm, paddingVertical: 6 },
  noteInput: {
    borderWidth: 1,
    borderRadius: RADIUS.field,
    padding: SPACING.sm,
    marginTop: SPACING.md,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SPACING.sm },
  disclosure: { marginTop: SPACING.md },
  previewCard: { borderWidth: 1, borderRadius: RADIUS.card, padding: SPACING.md, gap: SPACING.sm },
  previewRow: { gap: 2 },
  previewRowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // No TYPE_SCALE role exists for an expanded code preview (a one-off on this screen); the family
  // is still the reserved mono token, only the size/line-height are a cited literal.
  previewMono: { fontFamily: FONT_FAMILY.monoRegular, fontSize: 12, lineHeight: 16 },
  deviceIdLine: { marginTop: SPACING.md },
  privacyLink: { marginTop: SPACING.xs },
  primary: { height: 52, borderRadius: RADIUS.card, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.lg },
  primaryDisabled: { opacity: 0.5 },
  plainAction: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: SPACING.xs },
  thanks: { paddingVertical: SPACING.xl, alignItems: 'stretch' },
});
