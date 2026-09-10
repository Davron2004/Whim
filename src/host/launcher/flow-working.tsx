/**
 * flow-working — `WorkingLine`, the one honest liveness indicator for every wait in the prompt
 * flow (C3: "one honest liveness indicator for every wait in the flow").
 *
 * A breathing dot that moves on a TIMER, never on network activity — it is the "this has not
 * hung" signal, not a progress claim (the same discipline `buildProgressFraction`'s doc comment
 * states for the build screen's bar: nothing here is smoothed to look busier than the request
 * actually is). The phrase itself never rotates or animates; a rotating phrase reads as theatre.
 * Past five seconds a plain `m:ss` clock appears beside it (`prompt-flow.ts#workingLineText`), so
 * a wait that is taking a while says so in the user's own units instead of staying silent.
 *
 * `clock` (build-liveness B3) turns that own clock OFF: the build screen's liveness line already
 * carries its own time reading where one applies (`buildLivenessLine`'s `· m:ss`/`· Ns` suffixes,
 * derived from the three `RunSignals` clocks rather than a single wait's start), so appending a
 * SECOND, differently-sourced clock here would either duplicate it or, worse, disagree with it.
 * `tone: 'stalled'` (`STATUS_COLORS.waiting`, no breathing) is the one state where movement itself
 * would be the lie: a still grey dot IS the message once nothing has arrived in a while.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SPACING, STATUS_COLORS, TYPE_SCALE } from '../../sdk/theme';
import { BreathingView } from './flow-skeletons';
import { RUN_SIGNAL_TICK_MS, workingLineText } from './prompt-flow';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

export interface WorkingLineProps {
  /** The plain-words phrase describing what is happening right now (`COPY.workingClarify`,
   *  `workingPlanPhrase(editing)`, `buildLivenessLine(liveness, signals, now)`). Never changes for
   *  the life of one screen UNLESS the caller recomputes it itself, the way the build screen's
   *  liveness phrase does on every render. */
  phrase: string;
  /** When this wait started — `workingLineText`'s clock reads from here, not from mount time, so
   *  re-mounting the line (e.g. a re-render) never resets an already-running wait. Meaningless
   *  while `clock` is `false`. */
  startedAt: number;
  /** The dot's colour role. Defaults to the accent — the same "something is alive" role the step
   *  indicator's reached bars use. `stalled` is the reserved grey (`STATUS_COLORS.waiting`) AND
   *  turns the breathing off — the only tone that renders a plain, still `View` in its place. */
  tone?: 'accent' | 'stalled';
  /** Whether this line appends its OWN `· m:ss` clock suffix (`workingLineText`). Defaults `true`
   *  — every pre-existing call site (`ClarifyStep`/`PlanStep`) keeps ticking its own clock exactly
   *  as before. `false` renders `phrase` verbatim, no suffix, no internal ticking timer: the
   *  caller's own re-render cadence is what moves the text in that mode. */
  clock?: boolean;
}

const DOT_SIZE = 8;

/** The one loading motion this line uses — `BreathingView`'s `MOTION.breathe` cycle, the same one
 *  every other skeleton in the flow breathes on. `tone: 'stalled'` is the one exception: it never
 *  breathes at all. */
export function WorkingLine({ phrase, startedAt, tone = 'accent', clock = true }: Readonly<WorkingLineProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!clock) return undefined;
    const timer = setInterval(() => setNow(Date.now()), RUN_SIGNAL_TICK_MS);
    return () => clearInterval(timer);
  }, [clock]);

  const TONE_COLOR: Record<NonNullable<WorkingLineProps['tone']>, string> = {
    stalled: STATUS_COLORS.waiting,
    accent: p.accent,
  };
  const dotColor = TONE_COLOR[tone];
  const text = clock ? workingLineText(phrase, startedAt, now) : phrase;

  return (
    <View style={styles.row}>
      {tone === 'stalled' ? (
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
      ) : (
        <BreathingView style={[styles.dot, { backgroundColor: dotColor }]} />
      )}
      <Text style={[TYPE_SCALE.caption, { color: p.textMuted }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.md },
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
});
