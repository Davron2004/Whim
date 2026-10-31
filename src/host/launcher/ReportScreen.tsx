/**
 * ReportScreen — reporting a problem (design D13/D14; spec content-reporting; system.md §9 Report a
 * problem). Pushed on the native stack from History (the version the user is on) and from Settings
 * (no particular app); over a running app the same form sits in `ReportSheet` until the Whim sheet
 * pushes it on its own small stack.
 *
 * "What went wrong?" chips, a note, the "Include what I asked for" switch, the code line, "What gets
 * sent" collapsed (a preview rendered from the SAME `ReportRequest` value Send posts), and the line
 * naming the phone ID and who receives the report (AnyCognition, or the user's own server, beta-1
 * D20) with the privacy link. Send report (`Sending…` while in flight) and Cancel are pinned under
 * the scrolling draft, so the note's keyboard never hides Send; a failed send is a notice at the end
 * of the scroll, above them. Sent: a check and a thank-you that names no company on the user's own
 * server (#153), and Done. Opening sends nothing; leaving discards the draft.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import type { ReportReason, ReportRequest } from '@whim/contract';
import { LAYOUT, SPACE } from '../../design/tokens';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { GroupedRow, GroupedSection } from '../ui/GroupedList';
import { Icon } from '../ui/Icon';
import { Notice } from '../ui/Notice';
import { Text } from '../ui/Text';
import { TextArea } from '../ui/TextField';
import { useTokens } from '../ui/tokens';
import { buttonMetrics, makeStyles } from '../ui/tokens-pure';
import type { InstalledApp } from './app-index';
import type { StoreAccess } from './store-access';
import { buildReportRequest, reportDraftFor, reportLogFields, reportPreview } from './report-payload';
import type { ReportDraft, ReportPreviewRow } from './report-payload';
import { sendReport } from './generation-client';
import type { ClientOptions } from './generation-client';
import { REFUSAL_RULES, refusalText, retryAtOf, retryLine, serviceRefusalOf } from './service-refusal';
import { fallbackNotice, terminalFallbackOf } from './wire-fallback';
import type { ServiceRefusal } from './service-refusal';
import { sendDisabled as computeSendDisabled, sendFailureOutcome, settleSend } from './report-send';
import type { ReportPhase, SendOutcome } from './report-send';
import { useNoticeWindowClear, useRetryGate } from './ServiceNotice';
import SheetModal from './SheetModal';
import KeyboardShell from './KeyboardShell';
import { COPY, reportCodeLine, reportCodeSizeLabel, reportRecipientLine, reportThanksLine } from './copy';
import { RELEASE } from './release-config';
import { sameServer, serverLabel } from './server-address';
import { privacyPolicyUrl, type LegalLanguage } from './legal-language';
import { useSystemBack } from './use-system-back';

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

/** This form's own refusal notice — the shape `LauncherRoot.tsx`'s private `noticeFrom` keeps for
 *  the flow (design D12), kept as a second small copy: the form carries no `prompt-flow.ts` screen
 *  to hang a `FlowNotice` on. */
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

/** How a send ended: settled on the form (sent, refused, failed), or the update screen asked for. */
type SendResult = { readonly kind: 'settled'; readonly outcome: SendOutcome<ReportNotice> } | { readonly kind: 'update'; readonly notice?: string };

/** Posts `request` and says how it ended, logging each outcome with its status (never content). */
async function sendClassified(options: ClientOptions, request: ReportRequest): Promise<SendResult> {
  try {
    await sendReport(options, request);
    log.debug(CHANNELS.gen, 'report sent', { ...reportLogFields(request, '202') });
    return { kind: 'settled', outcome: { kind: 'sent' } };
  } catch (err) {
    // A reply this build can't use whose fallback is `update` opens the update screen with its
    // notice, as an `update_required` refusal does (beta-1 D16); a `fail` one is an ordinary
    // failed send below.
    const fallback = terminalFallbackOf(err);
    if (fallback?.kind === 'update') {
      log.warn(CHANNELS.gen, 'report refused', { ...reportLogFields(request, 'update_required') });
      return { kind: 'update', notice: fallbackNotice(fallback) };
    }
    const refusal = serviceRefusalOf(err);
    if (refusal) {
      log.warn(CHANNELS.gen, 'report refused', { ...reportLogFields(request, refusal.code) });
      if (REFUSAL_RULES[refusal.code].opens === 'update') return { kind: 'update' };
      return { kind: 'settled', outcome: { kind: 'refused', notice: reportNoticeFrom(refusal) } };
    }
    // The real HTTP status when the server answered with one (a 400/500 is not "network" — that
    // word is reserved for a genuine transport-level failure, spec "Offline").
    log.warn(CHANNELS.gen, 'report failed', { ...reportLogFields(request, sendFailureOutcome(err)) });
    return { kind: 'settled', outcome: { kind: 'failed', notice: { hint: COPY.reportSendFailedGeneric, tone: 'neutral' } } };
  }
}

function formatLocalTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
}

export interface ReportScreenProps {
  /** The app being reported, or `null` for a problem with no particular app (Settings). */
  app: InstalledApp | null;
  access: StoreAccess;
  /** Plain `ClientOptions` — sending a report needs no AI-data consent (design D3). */
  options: ClientOptions;
  /** Leaves the report: Cancel, Done, Close after a failed load, and system back. */
  onLeave: () => void;
  /** A send refused `update_required`, or answered with an `update` fallback: the host opens the
   *  update screen in place of the report, showing the fallback's `notice` when it has one. */
  onUpdateRequired: (notice?: string) => void;
  /** The active legal language: the privacy link opens its policy page. */
  legalLanguage: LegalLanguage;
}

const styles = makeStyles((t) => ({
  content: { paddingHorizontal: LAYOUT.gutter, paddingTop: SPACE[4], paddingBottom: SPACE[6] },
  sheetContent: { paddingBottom: SPACE[4] },
  title: { marginBottom: SPACE[4] },
  sectionHeader: { marginBottom: SPACE[2] },
  chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACE[2], marginBottom: LAYOUT.gapBetweenGroups },
  noteBlock: { gap: LAYOUT.gapBetweenGroups },
  note: { marginBottom: LAYOUT.gapBetweenGroups },
  line: { marginBottom: LAYOUT.gapBetweenGroups },
  preview: { gap: SPACE[3], paddingHorizontal: SPACE[4], marginBottom: LAYOUT.gapBetweenGroups },
  previewRow: { gap: SPACE[1] },
  previewHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  footer: { gap: SPACE[2] },
  // A plain button's label sits inside its capsule's padding: pulled out by it, the link lines up
  // with the text above.
  privacy: { alignSelf: 'flex-start' as const, marginTop: SPACE[1], marginBottom: SPACE[4], marginLeft: -buttonMetrics('small').paddingHorizontal },
  actions: { paddingHorizontal: LAYOUT.gutter, paddingBottom: LAYOUT.actionAreaBottom, gap: SPACE[2] },
  done: { flex: 1, paddingHorizontal: LAYOUT.gutter, justifyContent: 'center' as const, gap: SPACE[4] },
  check: { alignSelf: 'flex-start' as const },
  bg: { backgroundColor: t.colors.bg },
}));

/** The form both presentations share. `host` says who pads for the keyboard: a pushed screen pads
 *  itself, a sheet's host pads around it. Mounted once per report: a new report is a new mount. */
function ReportForm({
  app,
  access,
  options,
  onLeave,
  onUpdateRequired,
  legalLanguage,
  host,
  title,
}: Readonly<ReportScreenProps & { host: 'screen' | 'sheet'; title?: string }>) {
  const t = useTokens();
  const s = styles(t);
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [phase, setPhase] = useState<ReportPhase>('draft');
  const [notice, setNotice] = useState<ReportNotice | null>(null);
  // The note and the include switch under it: the block kept in view while the note is focused,
  // so the pinned Send never cuts the switch in half.
  const noteBlock = useRef<View>(null);
  // Leaving mid-send drops the answer: nothing left on screen to show it.
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const gated = useRetryGate(notice?.retryAt);
  // A sender-landing (`neutral`) notice clears the instant its retry window ends (design D12).
  useNoticeWindowClear(notice ?? undefined, () => {
    setNotice((prev) => (prev === notice ? null : prev));
  });

  useEffect(() => {
    reportDraftFor(app, access).then((d) => {
      if (live.current) setDraft(d);
    }, () => {
      if (!live.current) return;
      setLoadFailed(true);
      log.warn(CHANNELS.gen, 'report draft load failed', { outcome: 'failed' });
    });
  }, [app, access]);

  // Send posts to `options.baseUrl`, so that is the recipient the form names.
  const ownServer = sameServer(options.baseUrl, RELEASE.serverUrl) ? undefined : serverLabel(options.baseUrl);
  const request = draft ? buildReportRequest(draft) : null;

  const settle = (outcome: SendOutcome<ReportNotice>) => {
    const settled = settleSend<ReportNotice>(outcome);
    setPhase(settled.phase);
    setNotice(settled.notice);
  };

  const handleSend = async () => {
    if (!request) return;
    setPhase('sending');
    setNotice(null);
    const result = await sendClassified(options, request);
    if (!live.current) return;
    if (result.kind === 'update') onUpdateRequired(result.notice);
    else settle(result.outcome);
  };

  if (loadFailed) {
    return (
      <View style={s.done}>
        <Notice message={COPY.reportDraftLoadFailed} tone="danger" />
        <Button label={COPY.reportDraftClose} variant="ink" onPress={onLeave} />
      </View>
    );
  }
  if (draft === null) return null;
  if (phase === 'thanks') return <ReportThanks ownServer={ownServer} inSheet={host === 'sheet'} onDone={onLeave} />;

  const sendDisabled = computeSendDisabled(request, phase, gated);
  return (
    <KeyboardShell
      host={host}
      style={host === 'screen' ? s.bg : undefined}
      contentContainerStyle={[s.content, host === 'sheet' && s.sheetContent]}
      footer={
        <View style={[s.actions, s.footer]}>
          <Button
            label={COPY.reportSend}
            variant="ink"
            busy={phase === 'sending' ? COPY.reportSendBusy : undefined}
            disabled={phase !== 'sending' && sendDisabled}
            onPress={handleSend}
          />
          <Button label={COPY.cancel} variant="plain" onPress={onLeave} />
        </View>
      }
    >
      {title !== undefined && (
        <Text type="title2" style={s.title}>
          {title}
        </Text>
      )}
      <Text type="footnote" color="text-2" header accessibilityRole="header" style={s.sectionHeader}>
        {COPY.reportReasonEyebrow}
      </Text>
      <View style={s.chips} accessibilityRole="radiogroup">
        {REASONS.map((reason) => (
          <Chip
            key={reason}
            label={REASON_LABEL[reason]}
            selected={draft.reason === reason}
            onPress={() => setDraft({ ...draft, reason })}
          />
        ))}
      </View>

      <View ref={noteBlock} style={[s.noteBlock, draft.prompt === undefined && s.note]}>
        <TextArea
          revealTarget={noteBlock}
          value={draft.note}
          onChangeText={(text) => setDraft({ ...draft, note: text })}
          placeholder={COPY.reportNotePlaceholder}
          accessibilityLabel={COPY.reportFieldNote}
          maxLength={1000}
        />
        {draft.prompt !== undefined && (
          <GroupedSection>
            <GroupedRow
              title={COPY.reportIncludePrompt}
              trailing={{ kind: 'switch', value: draft.promptIncluded, onValueChange: (on) => setDraft({ ...draft, promptIncluded: on }) }}
            />
          </GroupedSection>
        )}
      </View>
      {app !== null && (
        <Text type="footnote" color="text-2" style={s.line}>
          {draft.source === undefined ? COPY.reportNoCodeDisclosure : reportCodeLine(ownServer)}
        </Text>
      )}

      {request && <ReportPreview request={request} />}

      <Text type="footnote" color="text-2">
        {reportRecipientLine(ownServer)}
      </Text>
      <View style={s.privacy}>
        <Button label={COPY.privacyPolicyLabel} variant="plain" size="small" onPress={() => Linking.openURL(privacyPolicyUrl(legalLanguage))} />
      </View>
      {notice && (
        <Notice
          message={notice.hint}
          tone={notice.tone}
          countdown={notice.retryAt !== undefined ? retryLine(notice.retryAt, Date.now(), formatLocalTime) : undefined}
        />
      )}
    </KeyboardShell>
  );
}

/** The sent state: a check and the thank-you, naming no company on the user's own server (#153). */
function ReportThanks({ ownServer, inSheet, onDone }: Readonly<{ ownServer?: string; inSheet: boolean; onDone: () => void }>) {
  const t = useTokens();
  const s = styles(t);
  return (
    <View style={[s.done, inSheet && s.sheetContent]}>
      <View style={s.check}>
        <Icon name="circle-check" size={48} color={t.colors.text} />
      </View>
      <Text type="title2" accessibilityRole="alert">
        {reportThanksLine(ownServer)}
      </Text>
      <Button label={COPY.reportThanksDone} variant="ink" onPress={onDone} />
    </View>
  );
}

/** "What gets sent", collapsed until asked: the rows of the exact body Send posts. */
function ReportPreview({ request }: Readonly<{ request: ReportRequest }>) {
  const t = useTokens();
  const s = styles(t);
  const [open, setOpen] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  return (
    <>
      <GroupedSection>
        <GroupedRow
          title={COPY.reportPreviewTitle}
          trailing={{ kind: 'chevron' }}
          onPress={() => setOpen((was) => !was)}
          accessibilityHint={open ? COPY.reportShowLess : COPY.reportShowMore}
        />
      </GroupedSection>
      {open && (
        <View style={s.preview}>
          {reportPreview(request).map((row) => (
            <PreviewRow
              key={row.field}
              label={PREVIEW_LABEL[row.field]}
              // The reason row previews the chip's label ("Doesn't work", not "broken") — the enum
              // value itself is only what is transmitted, never what the user reads.
              value={row.field === 'reason' ? REASON_LABEL[row.value as ReportReason] : row.value}
              collapsedToSize={row.field === 'source'}
              expandable={expandableRow(row.field, promptExpanded, sourceExpanded, setPromptExpanded, setSourceExpanded)}
            />
          ))}
        </View>
      )}
    </>
  );
}

/** Only the `prompt` and `source` preview rows expand (design D14), each on its own. */
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

function PreviewRow({
  label,
  value,
  collapsedToSize,
  expandable,
}: Readonly<{
  label: string;
  value: string;
  /** Shows a character count until expanded (the code); the prompt shows its first lines. */
  collapsedToSize: boolean;
  expandable?: { expanded: boolean; onToggle: () => void };
}>) {
  const t = useTokens();
  const s = styles(t);
  const expanded = expandable?.expanded ?? false;
  const shown = collapsedToSize && !expanded ? reportCodeSizeLabel(value.length) : value;
  return (
    <View style={s.previewRow}>
      <View style={s.previewHeader}>
        <Text type="footnote" color="text-2" header>
          {label}
        </Text>
        {expandable && (
          <Button label={expanded ? COPY.reportShowLess : COPY.reportShowMore} variant="plain" size="small" onPress={expandable.onToggle} />
        )}
      </View>
      <Text type={collapsedToSize ? 'footnote' : 'body'} numberOfLines={expandable && !collapsedToSize && !expanded ? 3 : undefined}>
        {shown}
      </Text>
    </View>
  );
}

/** The Report screen on the native stack. System back leaves, as the stack's header back does. */
export default function ReportScreen(props: Readonly<ReportScreenProps>) {
  useSystemBack(props.onLeave);
  return <ReportForm {...props} host="screen" />;
}

/** The report over a running app, in a sheet that keeps the app running underneath: `app == null`
 *  closes it, and each opening starts a fresh draft. */
export function ReportSheet({ app, onClose, ...rest }: Readonly<Omit<ReportScreenProps, 'onLeave'> & { onClose: () => void }>) {
  return (
    <SheetModal visible={app != null} onClose={onClose}>
      {app && <ReportForm key={app.id} {...rest} app={app} onLeave={onClose} host="sheet" title={COPY.reportSheetTitle} />}
    </SheetModal>
  );
}
