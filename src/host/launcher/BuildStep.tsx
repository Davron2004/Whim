/**
 * BuildStep — generation progress without internals (`prompt-flow` spec "Generation progress is
 * shown without exposing internals").
 *
 * Four named steps derived from `stage` events, one plain-words sentence for the current action,
 * the attempt's derived activity signals, and nothing else: no raw `token` text, no
 * `diagnostic.kind`/`symbol`, no log or terminal panel.
 * Arriving text is never faded in or typed in per character — this screen holds no animation at
 * all, which is how that stays true. The elapsed clock, the output-size counter and the stall
 * heartbeat move by re-render on the shell's tick (design D6/D8): they are computed from `signals`
 * and `now` on every render, and this screen never reads the run journal itself.
 *
 * `Leave it running` returns to the shell WITHOUT cancelling the run (the shell keeps delivering
 * it). Hardware back is the separate, older contract — navigating away from the progress screen
 * aborts the request and installs nothing — so the two actions are deliberately not the same call.
 */

import React, { useEffect } from 'react';
import { BackHandler, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SHELL_COLORS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY, buildActivityLine, buildQuietLine } from './copy';
import {
  BUILD_STEPS,
  buildProgressFraction,
  buildStepStatuses,
  currentActionSentence,
  elapsedLabel,
  quietSecondsSince,
  type RunSignals,
  type Stage,
} from './prompt-flow';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

/** A step that has not started is dimmed rather than hidden — the whole list is legible from the
 *  first frame, so nothing appears or moves as the run progresses. */
const NOT_STARTED_OPACITY = 0.35;
const TRANSPARENT = 'transparent';

export interface BuildStepProps {
  /** The only event field that ever reaches this screen. */
  stage: Stage | null;
  /** The stream produced its record and delivery is running — the last named step. */
  delivering: boolean;
  /** The live attempt's in-memory liveness state, or `null` when the shell has none for this
   *  screen. Derived values are computed from it and `now` per render — the screen never reads the
   *  run journal. */
  signals: RunSignals | null;
  /** The render's own clock reading, moved by the shell's tick. */
  now: number;
  /** Returns to the shell; the run keeps going and its result is still delivered. */
  onLeaveRunning: () => void;
  /** Hardware back: aborts the in-flight request, installing and updating nothing. */
  onCancel: () => void;
  /** Activating the details affordance: the caller shows this attempt's run timeline, reading it
   *  once on open — never per render and never per tick. */
  onShowDetails?: () => void;
}

export default function BuildStep({
  stage,
  delivering,
  signals,
  now,
  onLeaveRunning,
  onCancel,
  onShowDetails,
}: Readonly<BuildStepProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);
  const statuses = buildStepStatuses(stage, delivering);
  const pct = buildProgressFraction(stage, delivering);
  const quietSeconds = signals === null ? null : quietSecondsSince(signals.lastArrivalAt, now);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => sub.remove();
  }, [onCancel]);

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={styles.content}>
        <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{COPY.buildTitle}</Text>
        <Text style={[TYPE_SCALE.caption, styles.subtitle, { color: p.textMuted }]}>{COPY.buildSubtitle}</Text>

        <View style={[styles.progressTrack, { backgroundColor: SHELL_COLORS.border }]}>
          <View style={[styles.progressFill, { backgroundColor: p.accent, width: `${pct * 100}%` }]} />
        </View>

        <Text style={[TYPE_SCALE.body, styles.current, { color: p.text }]}>
          {currentActionSentence(stage, delivering)}
        </Text>

        {signals !== null && (
          <Text style={[TYPE_SCALE.caption, styles.activity, { color: p.textMuted }]}>
            {buildActivityLine(elapsedLabel(signals.startedAt, now), signals.aggregates.chars)}
          </Text>
        )}

        {quietSeconds !== null && (
          <Text style={[TYPE_SCALE.caption, styles.quiet, { color: p.textMuted }]}>
            {buildQuietLine(quietSeconds)}
          </Text>
        )}

        <View style={styles.steps}>
          {BUILD_STEPS.map((label, i) => {
            const status = statuses[i];
            const reached = status !== 'todo';
            const markerBorder = reached ? p.accent : p.cardBorder;
            const markerFill = status === 'passed' ? p.accent : TRANSPARENT;
            const labelOpacity = reached ? 1 : NOT_STARTED_OPACITY;
            return (
              <View key={label} style={styles.step}>
                <View style={[styles.marker, { borderColor: markerBorder, backgroundColor: markerFill }]}>
                  {status === 'passed' && <Text style={[styles.tick, { color: p.onAccent }]}>{'✓'}</Text>}
                </View>
                <Text style={[TYPE_SCALE.body, { color: p.text, opacity: labelOpacity }]}>{label}</Text>
              </View>
            );
          })}
        </View>

        <TouchableOpacity onPress={onShowDetails} accessibilityRole="button" style={styles.details}>
          <Text style={[TYPE_SCALE.caption, { color: p.textMuted }]}>{COPY.buildDetails}</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={onLeaveRunning}
        accessibilityRole="button"
        style={[styles.leave, { backgroundColor: p.bg, borderColor: p.cardBorder }]}
      >
        <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{COPY.buildLeaveRunning}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl },
  subtitle: { marginTop: SPACING.xs },
  // The 4px track and its fill (design html:500). 20/4/2 have no `SPACING`/`RADIUS` counterpart and
  // get no one-off token (ruling R9) — rounding them to the nearest scale value would itself be the
  // conformance defect.
  progressTrack: { marginTop: 20, height: 4, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%' },
  current: { marginTop: SPACING.xl },
  activity: { marginTop: SPACING.xs },
  quiet: { marginTop: SPACING.xs },
  steps: { marginTop: SPACING.lg, gap: SPACING.sm },
  details: { marginTop: SPACING.lg, alignSelf: 'flex-start' },
  step: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: { fontSize: 10, fontWeight: '700' },
  leave: {
    height: 46,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
