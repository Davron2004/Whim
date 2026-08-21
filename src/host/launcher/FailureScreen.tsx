// ─────────────────────────────────────────────────────────────────────────────
// FailureScreen — failure shown honestly, never as a crash (design `3b`, obs-v1 design D7,
// spec "Failure is shown honestly, never as a crash").
// ─────────────────────────────────────────────────────────────────────────────
// A full-screen sibling of the other launcher screens: `shellPalette(theme)`, own hardware-back
// binding (routed to `onDismiss`), every string from `copy.ts`. HINT-ONLY BY CONSTRUCTION: this
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
import { shellPalette, type ShellPalette } from './theme';
import { useTheme } from './theme-context';

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
  /** The primary action: re-run the stored prompt when `retryable`, otherwise return to the
   *  prompt screen with the user's text preserved. */
  onRephrase: () => void;
  /** Dismisses the failure screen (back to home). */
  onDismiss: () => void;
}

/** The attempt row's bar height (design html:311) — below the spacing scale's smallest step. */
const ATTEMPT_BAR_HEIGHT = 5;
/** The checklist row's ring/mark icon (design html:321). */
const ROW_ICON_SIZE = 18;
const ROW_ICON_BORDER = 1.5;
/** Alpha suffixes composing the design's tinted panel out of the outcome hue (RN 8-digit hex). */
const PANEL_FILL_ALPHA = '14';
const PANEL_BORDER_ALPHA = '3d';

function segmentColor(segment: AttemptSegment, p: ShellPalette): string {
  if (segment === 'spent') return p.danger;
  return segment === 'current' ? p.accent : p.cardBorder;
}

/** A row's ring, fill and mark (design html:943). `wait` is an outline with no mark. */
function rowIcon(kind: FailureRowKind, p: ShellPalette): { ring: string; fill: string; mark: string } {
  if (kind === 'done') return { ring: STATUS_COLORS.done, fill: STATUS_COLORS.done, mark: '✓' };
  if (kind === 'bad') return { ring: p.danger, fill: p.danger, mark: '!' };
  return { ring: STATUS_COLORS.waiting, fill: 'transparent', mark: '' };
}

export default function FailureScreen({
  reason,
  diagnostics,
  observedRepairAttempts,
  hasWorkingVersion = false,
  recovered = false,
  retryable = false,
  onRephrase,
  onDismiss,
}: Readonly<FailureScreenProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [onDismiss]);

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
                  style={[styles.attemptBar, { backgroundColor: segmentColor(segment, p) }]}
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
            const icon = rowIcon(row.kind, p);
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
      <TouchableOpacity
        onPress={onDismiss}
        accessibilityRole="button"
        style={[styles.action, styles.actionLast, { backgroundColor: p.bg, borderColor: p.cardBorder }]}
      >
        <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{COPY.failureDismiss}</Text>
      </TouchableOpacity>
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
