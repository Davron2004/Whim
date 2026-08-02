/**
 * BuildStep — generation progress without internals (`prompt-flow` spec "Generation progress is
 * shown without exposing internals").
 *
 * Four named steps derived from `stage` events, one plain-words sentence for the current action,
 * and nothing else: no raw `token` text, no `diagnostic.kind`/`symbol`, no log or terminal panel.
 * Arriving text is never faded in or typed in per character — this screen holds no animation at
 * all, which is how that stays true.
 *
 * `Leave it running` returns to the shell WITHOUT cancelling the run (the shell keeps delivering
 * it). Hardware back is the separate, older contract — navigating away from the progress screen
 * aborts the request and installs nothing — so the two actions are deliberately not the same call.
 */

import React, { useEffect } from 'react';
import { BackHandler, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import { BUILD_STEPS, buildStepStatuses, currentActionSentence, type Stage } from './prompt-flow';
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
  /** Returns to the shell; the run keeps going and its result is still delivered. */
  onLeaveRunning: () => void;
  /** Hardware back: aborts the in-flight request, installing and updating nothing. */
  onCancel: () => void;
}

export default function BuildStep({ stage, delivering, onLeaveRunning, onCancel }: Readonly<BuildStepProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);
  const statuses = buildStepStatuses(stage, delivering);

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
        <Text style={[TYPE_SCALE.screenTitle, { color: p.text }]}>{COPY.buildTitle}</Text>
        <Text style={[TYPE_SCALE.caption, styles.subtitle, { color: p.textMuted }]}>{COPY.buildSubtitle}</Text>

        <Text style={[TYPE_SCALE.body, styles.current, { color: p.text }]}>
          {currentActionSentence(stage, delivering)}
        </Text>

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
  current: { marginTop: SPACING.xl },
  steps: { marginTop: SPACING.lg, gap: SPACING.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
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
