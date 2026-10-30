/**
 * FailurePage — the making sheet's page for a run that didn't work (system.md §9 Didn't work, §8
 * failure kinds; `prompt-flow` "Failure is shown by kind, honestly, never as a crash" and "Details
 * of a run are reachable from its tile and its failure").
 *
 * The 96 pt ember out; "Couldn't make this"; one sentence and the actions chosen by the failure's
 * kind (`failure-kind.ts`); a refusal's notice with its window, or the offline notice while a lost
 * connection waits for the phone to be back online; a group saying what is safe ("Your other apps
 * are untouched", or "Your current version still works" when changing) over a collapsed "What
 * happened", whose rows are each their own element to a screen reader; and Discard in the body.
 *
 * HINT-ONLY BY CONSTRUCTION: the props carry the reason and `{hint}`s, never a diagnostic's `kind`,
 * `symbol` or `message`, and the timeline's rows come from `run-timeline-view.ts`, which can produce
 * nothing else. Leaving is the sheet's close (Android back included), which leaves the attempt as
 * it is, so the page registers nothing with the sheet.
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { LAYOUT, SPACE } from '../../design/tokens';
import { haptics } from '../haptics';
import { Button } from '../ui/Button';
import { Ember } from '../ui/Ember';
import { GroupedRow, GroupedSection } from '../ui/GroupedList';
import { Notice } from '../ui/Notice';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { makeStyles } from '../ui/tokens-pure';
import { COPY } from './copy';
import { failureActions, failureSentence, type FailureKind, type FailureMove } from './failure-kind';
import { FlowNoticeBlock } from './FlowNoticeBlock';
import KeyboardShell from './KeyboardShell';
import type { FlowNotice } from './prompt-flow';
import type { RunJournalEntry } from './run-journal';
import { runTimelineRows } from './run-timeline-view';
import { useRetryGate } from './refusal-window';
import { openWhimUpdate } from './UpdateRequiredScreen';

/** A live failure's one confirmation (§5 "Making failed", rule 7). Each live transition onto the
 *  Failure page makes a fresh one (`announceFailure`) and every later update of that screen carries
 *  it unchanged; the page plays it the first time it shows and never again, so neither a re-render
 *  nor a remount of the same failure (the sheet re-keys its pages by run) replays it. A page reopened
 *  from its tile has none: a tapped sheet plays nothing. */
export interface FailureAnnouncement {
  readonly moment: 'failure';
}

export const announceFailure = (): FailureAnnouncement => ({ moment: 'failure' });

/** The announcements already played, held weakly: a spent one goes with the screen that carried it. */
const announced = new WeakSet<FailureAnnouncement>();

export interface FailurePageProps {
  kind: FailureKind;
  /** The terminal event's reason, or the phone's own sentence for an error. */
  reason: string;
  /** Hint-only diagnostic detail — never `kind`/`symbol`/`message`. */
  diagnostics: readonly { hint: string }[];
  /** Whether describing the app differently could get past this failure. */
  rephraseHelps: boolean;
  /** A change to an installed app: its current version is what is safe. */
  changing: boolean;
  /** The attempt's run journal, read once by the caller. `null` when there was none to read. */
  journal?: readonly RunJournalEntry[] | null;
  /** An attempt was started: "What happened" stays, with its empty note when the journal is gone. */
  attemptStarted?: boolean;
  /** A refused Try again's notice: its window holds Try again. */
  notice?: FlowNotice;
  /** The phone is known to be offline: a lost connection's Try again waits for it. */
  offline?: boolean;
  /** The developer-diagnostics gate's verdict, decided by the caller (decision #60(c)). */
  devMode?: boolean;
  /** Describe the app again, with the words kept. */
  onChange: () => void;
  /** Run the same attempt again; absent when there is no attempt left to run. */
  onRetry?: () => void;
  /** Discard the attempt; absent when there is none to discard. */
  onDismiss?: () => void;
  /** "Not now" on a run only a newer Whim can finish: leave the page, the attempt kept. */
  onNotNow?: () => void;
  /** Set only when this failure just replaced a live run's page: the failure haptic it plays once. */
  announce?: FailureAnnouncement;
}

const styles = makeStyles(() => ({
  content: { paddingHorizontal: LAYOUT.gutter, paddingBottom: SPACE[4], gap: SPACE[5] },
  header: { alignItems: 'center' as const, gap: SPACE[2] },
  centered: { textAlign: 'center' as const },
  title: { textAlign: 'center' as const, marginTop: SPACE[3] },
  discard: { alignItems: 'center' as const },
  footer: { paddingHorizontal: LAYOUT.gutter, paddingTop: LAYOUT.actionAreaTop, paddingBottom: LAYOUT.actionAreaBottom, gap: SPACE[3] },
}));

/** "What happened" as rows: the run's timeline, then any hint it does not already hold; the empty
 *  note when an attempt ran but nothing of it was recorded. */
function whatHappened(props: Readonly<FailurePageProps>, shown: string | null): readonly { key: string; text: string }[] {
  const timeline = runTimelineRows(props.journal ?? [], props.devMode ?? false, shown ?? undefined, true);
  const hints = props.diagnostics
    .filter((d) => !timeline.some((row) => row.text === d.hint))
    .map((d, i) => ({ key: `extra-hint:${i}`, text: d.hint }));
  const rows = [...timeline, ...hints];
  return rows.length === 0 ? [{ key: 'empty', text: COPY.timelineEmpty }] : rows;
}

export default function FailurePage(props: Readonly<FailurePageProps>) {
  const { kind, reason, rephraseHelps, changing, journal = null, attemptStarted = false, notice, offline = false, onChange, onRetry, onDismiss, onNotNow, announce } = props;
  const s = styles(useTokens());
  const [open, setOpen] = useState(false);
  // The frame the page first shows a live failure is the one the failure confirms.
  useEffect(() => {
    if (announce == null || announced.has(announce)) return;
    announced.add(announce);
    haptics.play('failure');
  }, [announce]);
  const gated = useRetryGate(notice?.retryAt);
  const sentence = failureSentence(kind, { reason, rephraseHelps });
  const rows = whatHappened(props, sentence ?? notice?.hint ?? null);
  // A journal whose only news is the sentence above adds nothing; with neither a journal nor an
  // attempt there is no run to speak of.
  const timelineAddsNothing = journal != null && journal.length > 0 && rows.length === 1 && rows[0].key === 'empty';
  const showWhatHappened = (journal != null || attemptStarted || props.diagnostics.length > 0) && !timelineAddsNothing;
  const moves: Readonly<Record<FailureMove, (() => unknown) | undefined>> = { change: onChange, retry: onRetry, update: openWhimUpdate, 'not-now': onNotNow };
  const waiting = kind === 'connection' && offline;
  return (
    <KeyboardShell
      host="sheet"
      contentContainerStyle={s.content}
      footer={
        <View style={s.footer}>
          {failureActions(kind, rephraseHelps, onRetry !== undefined).map((action) => (
            <Button
              key={action.move}
              label={action.label}
              variant={action.variant}
              haptic={action.move === 'retry' ? 'handoff' : undefined}
              disabled={action.move === 'retry' && (gated || waiting)}
              onPress={() => moves[action.move]?.()}
            />
          ))}
        </View>
      }
    >
      <View style={s.header}>
        <Ember size={96} state="out" />
        <Text type="title1" style={s.title}>
          {COPY.failureTitle}
        </Text>
        {sentence !== null ? (
          <Text color="text-2" style={s.centered}>
            {sentence}
          </Text>
        ) : null}
      </View>
      {notice ? <FlowNoticeBlock notice={notice} /> : null}
      {waiting ? <Notice message={COPY.failureOfflineNotice} /> : null}
      <GroupedSection on="sheet">
        <GroupedRow icon="circle-check" title={changing ? COPY.failureCurrentVersionWorks : COPY.failureOtherAppsUntouched} />
        {showWhatHappened ? (
          <GroupedRow icon="clock" title={COPY.timelineTitle} trailing={{ kind: 'chevron', expanded: open }} onPress={() => setOpen((was) => !was)} />
        ) : null}
        {showWhatHappened && open ? rows.map((row) => <GroupedRow key={row.key} title={row.text} />) : null}
      </GroupedSection>
      {onDismiss ? (
        <View style={s.discard}>
          <Button label={COPY.actionDiscard} variant="danger" size="medium" icon="trash-2" onPress={onDismiss} />
        </View>
      ) : null}
    </KeyboardShell>
  );
}
