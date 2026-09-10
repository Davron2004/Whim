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
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SPACING, TYPE_SCALE } from '../../sdk/theme';
import { BreathingView } from './flow-skeletons';
import { RUN_SIGNAL_TICK_MS, workingLineText } from './prompt-flow';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

export interface WorkingLineProps {
  /** The plain-words phrase describing what is happening right now (`COPY.workingClarify`,
   *  `workingPlanPhrase(editing)`). Never changes for the life of one screen. */
  phrase: string;
  /** When this wait started — `workingLineText`'s clock reads from here, not from mount time, so
   *  re-mounting the line (e.g. a re-render) never resets an already-running wait. */
  startedAt: number;
  /** The dot's colour role. Defaults to the accent — the same "something is alive" role the step
   *  indicator's reached bars use. */
  tone?: 'accent' | 'muted';
}

const DOT_SIZE = 8;

/** The one loading motion this line uses — `BreathingView`'s `MOTION.breathe` cycle, the same one
 *  every other skeleton in the flow breathes on. */
export function WorkingLine({ phrase, startedAt, tone = 'accent' }: Readonly<WorkingLineProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), RUN_SIGNAL_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const dotColor = tone === 'muted' ? p.textMuted : p.accent;

  return (
    <View style={styles.row}>
      <BreathingView style={[styles.dot, { backgroundColor: dotColor }]} />
      <Text style={[TYPE_SCALE.caption, { color: p.textMuted }]}>{workingLineText(phrase, startedAt, now)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.md },
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: DOT_SIZE / 2 },
});
