// ─────────────────────────────────────────────────────────────────────────────
// FailureScreen — failure shown honestly, never as a crash (design `3b`, obs-v1 design D7,
// spec "Failure is shown honestly, never as a crash").
// ─────────────────────────────────────────────────────────────────────────────
// A full-screen sibling of the other launcher screens: `SHELL_PALETTE`, own hardware-back
// binding (routed to `onBack`, the NON-destructive exit — the hardware gesture must never delete
// an attempt), every string from `copy.ts`. HINT-ONLY BY CONSTRUCTION: this
// component's props carry `reason` (the terminal event's or the client error's plain-English
// summary) and a list of `{hint: string}` — never a `Diagnostic`'s `kind`/`symbol`/`message`.
// "Rephrase" returns to the prompt screen with the user's text preserved (the caller re-opens
// `PromptScreen` with `initialText` set to that same text — this screen only signals the intent).
//
// Design `3b` (`docs/design/reference/Whim Mobile.dc.html:306–333`), terminal state RP[5]: a
// title in the run's outcome hue, the sub-line, the attempt row, and a bordered panel of
// checklist rows. Styled from the v2 tokens ALONE — no hex, no numeric font-size or radius
// literal — the suite scans this file for all three. The design's tinted panel fills (html:999)
// have no token of their own, so they are composed as a low-alpha wash of the outcome hue itself,
// the idiom `HistoryScreen.tsx` already uses for its current-version dot ring.
import React, { useEffect } from 'react';
import { BackHandler, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, STATUS_COLORS, TYPE_SCALE } from '../../sdk/theme';
import {
  COPY,
  attemptSegments,
  attemptsUsedLabel,
  failureChecklistRows,
  type AttemptSegment,
  type FailureRowKind,
} from './copy';
import RunTimeline from './RunTimeline';
import type { RunJournalEntry } from './run-journal';
import { SHELL_PALETTE } from './theme';

export interface FailureScreenProps {
  /** The terminal `failure` event's `reason`, or a plain-English client/stream-error summary. */
  reason: string;
  /** Hint-only diagnostic detail — never `kind`/`symbol`/`message`. */
  diagnostics: readonly { hint: string }[];
  /**
   * How many repair attempts the device OBSERVED go past on the stream. Absent (or zero) hides
   * the attempt row entirely — a count is never invented for a run that never reached repair.
   */
  observedRepairAttempts?: number;
  /**
   * Whether the app already has a working version installed. Absent (or false) omits the
   * reassurance row — there is nothing honest to reassure about.
   */
  hasWorkingVersion?: boolean;
  /** True when a repair recovered the run; the title and panel take the success hue instead. */
  recovered?: boolean;
  /**
   * The screen was hydrated from a persisted pending-build record rather than a live stream, so
   * its primary action re-runs the stored prompt instead of reopening the composer, and takes the
   * retry label (`prompt-flow` "Failure screens hydrate from the persisted failure payload").
   * Absent = the live shape, unchanged.
   */
  retryable?: boolean;
  /**
   * The failed attempt's run journal, read ONCE by the caller for the record being shown. `null`
   * (or absent) when there was none to read — the what-happened section then falls back to its
   * empty note, and NOTHING else about this screen changes: the state, the reason and the
   * checklist all come from the pending-build record, never from the journal
   * (`generation-run-journal` "A journal is never a second source of truth").
   */
  journal?: readonly RunJournalEntry[] | null;
  /**
   * Whether a generation attempt was ever STARTED for this failure. A clarify or rewrite failure
   * fails before any attempt exists, so there is no run to have a what-happened section about —
   * absent (or false) omits the section entirely rather than heading an empty note. True with a
   * `null` journal is the different, genuinely-degraded case (an attempt ran, its journal is gone),
   * where the section stays and falls back to its empty note.
   */
  attemptStarted?: boolean;
  /** The developer-diagnostics gate's verdict, decided by the caller (decision #60(c)). */
  devMode?: boolean;
  /** The primary action: re-run the stored prompt when `retryable`, otherwise return to the
   *  prompt screen with the user's text preserved. */
  onRephrase: () => void;
  /** Leaves the failure screen for the launcher, destroying NOTHING — the attempt, its ghost tile
   *  and its run journal all survive. Also what the hardware back gesture performs. */
  onBack: () => void;
  /** Discards the attempt: the pending-build record and its run journal are deleted. Destructive,
   *  and labelled as such (`COPY.failureDismiss`) — never as plain navigation. ABSENT when there
   *  is no attempt to discard (a clarify or rewrite failure, which fails before any record
   *  exists): the button is then not rendered at all, rather than offered as a no-op. */
  onDismiss?: () => void;
}

/** The attempt row's bar height (design html:311) — below the spacing scale's smallest step. */
const ATTEMPT_BAR_HEIGHT = 5;
/** The checklist row's ring/mark icon (design html:321). */
const ROW_ICON_SIZE = 18;
const ROW_ICON_BORDER = 1.5;
/** How tall the what-happened section may grow before its list scrolls inside itself. */
const TIMELINE_MAX_HEIGHT = 180;
/** Alpha suffixes composing the design's tinted panel out of the outcome hue (RN 8-digit hex). */
const PANEL_FILL_ALPHA = '14';
const PANEL_BORDER_ALPHA = '3d';

function segmentColor(segment: AttemptSegment): string {
  if (segment === 'spent') return SHELL_PALETTE.danger;
  return segment === 'current' ? SHELL_PALETTE.accent : SHELL_PALETTE.cardBorder;
}

/** A row's ring, fill and mark (design html:943). `wait` is an outline with no mark. */
function rowIcon(kind: FailureRowKind): { ring: string; fill: string; mark: string } {
  if (kind === 'done') return { ring: STATUS_COLORS.done, fill: STATUS_COLORS.done, mark: '✓' };
  if (kind === 'bad') return { ring: SHELL_PALETTE.danger, fill: SHELL_PALETTE.danger, mark: '!' };
  return { ring: STATUS_COLORS.waiting, fill: 'transparent', mark: '' };
}

export default function FailureScreen({
  reason,
  diagnostics,
  observedRepairAttempts,
  hasWorkingVersion = false,
  recovered = false,
  retryable = false,
  journal = null,
  attemptStarted = false,
  devMode = false,
  onRephrase,
  onBack,
  onDismiss,
}: Readonly<FailureScreenProps>) {
  const p = SHELL_PALETTE;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const outcome = recovered ? STATUS_COLORS.done : p.danger;
  const rows = failureChecklistRows({ diagnostics, hasWorkingVersion });
  const attempts = observedRepairAttempts ?? 0;

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={styles.content}>
        <Text style={[TYPE_SCALE.stepTitle, { color: outcome }]}>
          {recovered ? COPY.failureRecoveredTitle : COPY.failureTitle}
        </Text>
        <Text style={[TYPE_SCALE.body, styles.reason, { color: p.textMuted }]}>{reason}</Text>

        {attempts > 0 && (
          <View style={styles.attempts}>
            <View style={styles.attemptBars}>
              {attemptSegments(attempts).map((segment, index) => (
                <View
                  key={`${index}:${segment}`}
                  style={[styles.attemptBar, { backgroundColor: segmentColor(segment) }]}
                />
              ))}
            </View>
            <Text style={[TYPE_SCALE.eyebrow, styles.attemptLabel, { color: p.textMuted }]}>
              {attemptsUsedLabel(attempts)}
            </Text>
          </View>
        )}

        <View
          style={[
            styles.panel,
            { backgroundColor: outcome + PANEL_FILL_ALPHA, borderColor: outcome + PANEL_BORDER_ALPHA },
          ]}
        >
          {rows.map((row, index) => {
            const icon = rowIcon(row.kind);
            return (
              <View key={`${index}:${row.kind}`} style={styles.row}>
                <View style={[styles.rowIcon, { borderColor: icon.ring, backgroundColor: icon.fill }]}>
                  <Text style={[TYPE_SCALE.kindBadge, styles.rowMark, { color: p.onAccent }]}>{icon.mark}</Text>
                </View>
                <Text
                  style={[TYPE_SCALE.body, styles.rowText, { color: row.kind === 'wait' ? p.textMuted : p.text }]}
                >
                  {row.text}
                </Text>
              </View>
            );
          })}
        </View>

        {/* The what-happened timeline, IN ADDITION to the checklist above and never in place of
            it: the checklist says what to do next, this says what the attempt actually did. Shown
            only when there is a run to speak of — a failure that never started an attempt gets no
            heading and no empty note, because "nothing was recorded" would be answering a question
            the user never had. */}
        {(journal != null || attemptStarted) && (
          <View style={styles.timeline}>
            <RunTimeline entries={journal} devMode={devMode} />
          </View>
        )}
      </View>

      <TouchableOpacity
        onPress={onRephrase}
        accessibilityRole="button"
        style={[styles.action, { backgroundColor: p.text, borderColor: p.text }]}
      >
        <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>
          {retryable ? COPY.screenErrorRetry : COPY.failureRephrase}
        </Text>
      </TouchableOpacity>
      {/* The exits, in the order their consequences deserve: leaving is the ordinary way out and
          reads as plain navigation; discarding deletes the attempt and its journal, so it takes
          the danger hue and says what it does. Back is always here and always the last thing
          standing — when there is no attempt to discard the discard button is absent entirely,
          never a destructively-labelled no-op. */}
      <TouchableOpacity
        onPress={onBack}
        accessibilityRole="button"
        style={[styles.action, onDismiss == null ? styles.actionLast : null, { backgroundColor: p.bg, borderColor: p.cardBorder }]}
      >
        <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.text }]}>{COPY.failureBack}</Text>
      </TouchableOpacity>
      {onDismiss != null && (
        <TouchableOpacity
          onPress={onDismiss}
          accessibilityRole="button"
          style={[styles.action, styles.actionLast, { backgroundColor: p.bg, borderColor: p.danger }]}
        >
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.danger }]}>{COPY.failureDismiss}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg },
  reason: { marginTop: SPACING.xs },
  attempts: { marginTop: SPACING.lg },
  attemptBars: { flexDirection: 'row', gap: SPACING.xs },
  attemptBar: { flex: 1, height: ATTEMPT_BAR_HEIGHT, borderRadius: RADIUS.chip },
  attemptLabel: { marginTop: SPACING.xs },
  panel: {
    flex: 1,
    marginTop: SPACING.lg,
    borderRadius: RADIUS.tile,
    borderWidth: StyleSheet.hairlineWidth,
    padding: SPACING.md,
    gap: SPACING.sm,
    overflow: 'hidden',
  },
  // The section is bounded so a long run scrolls inside it rather than pushing the checklist —
  // the screen's primary content — off the screen. No `SPACING` value is a section height.
  timeline: { marginTop: SPACING.lg, maxHeight: TIMELINE_MAX_HEIGHT },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm },
  rowIcon: {
    width: ROW_ICON_SIZE,
    height: ROW_ICON_SIZE,
    borderRadius: RADIUS.chip,
    borderWidth: ROW_ICON_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMark: { letterSpacing: 0 },
  rowText: { flex: 1 },
  action: {
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  actionLast: { marginBottom: SPACING.lg },
});
