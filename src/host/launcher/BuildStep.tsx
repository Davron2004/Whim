/**
 * BuildStep — generation progress without internals (`prompt-flow` spec "Generation progress is
 * shown without exposing internals"; build-liveness B3).
 *
 * Four named steps derived from `stage` events, one plain-words sentence for the current action,
 * the attempt's derived LIVENESS — thinking distinguished from hanging (the reported bug: "'quiet
 * for x s' is misleading ... we need to differentiate thinking from hanging") — and nothing else:
 * no raw `token`/`thinking` text, no `diagnostic.kind`/`symbol`, no log or terminal panel.
 * Arriving text is never faded in or typed in per character — this screen holds no animation at
 * all, which is how that stays true. The liveness line moves by re-render on the shell's tick
 * (design D6/D8) via `WorkingLine`'s own internal timer: `livenessOf`/`buildLivenessLine` are
 * computed from `signals` and `now` on every render, and this screen never reads the run journal
 * itself.
 *
 * `Leave it running` returns to the shell WITHOUT cancelling the run (the shell keeps delivering
 * it). Hardware back does NOT cancel either (bug fix: it used to abort the run outright, dropping
 * the user on compose with no interrupted tile, because this screen's own `hardwareBackPress`
 * listener — re-registered every liveness tick — ran ahead of the details sheet's). This screen no
 * longer decides what back means at all: it only forwards the press, once, to the caller's `onBack`
 * — which closes the details sheet if it is open, or otherwise defers to the SAME action as
 * `Leave it running` (`LauncherRoot.tsx`'s build-screen `onBack`, `prompt-flow.ts#buildBackAction`).
 * Cancellation is reachable only from other explicit affordances (a ghost tile's own Cancel), never
 * from this screen's back handling.
 */

import React, { useEffect } from 'react';
import { BackHandler, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SHELL_COLORS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { buildLivenessLine, buildTitle, COPY } from './copy';
import { EditingEyebrow } from './flow-chrome';
import { WorkingLine } from './flow-working';
import {
  BUILD_STEPS,
  buildProgressFraction,
  buildStepStatuses,
  currentActionSentence,
  livenessOf,
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
  /** This attempt is re-prompting an installed app rather than making a new one (C1/B3): swaps
   *  `COPY.buildTitle` for `COPY.buildTitleEdit` and shows the shared `EditingEyebrow` above it. */
  editing?: boolean;
  /** The app being changed, for the eyebrow's "Changing <name>" line. Only read while `editing`. */
  editingName?: string;
  /** Returns to the shell; the run keeps going and its result is still delivered. */
  onLeaveRunning: () => void;
  /** Hardware back: the caller decides what this means (close the details sheet if it is open,
   *  otherwise leave the run running) — this screen only forwards the press. MUST be a stable
   *  identity (the caller's `useCallback`), so the listener below registers once per mount rather
   *  than once per liveness tick — the exact bug this contract replaces. */
  onBack: () => void;
  /** Activating the details affordance: the caller shows this attempt's run timeline, reading it
   *  once on open — never per render and never per tick. */
  onShowDetails?: () => void;
}

export default function BuildStep({
  stage,
  delivering,
  signals,
  now,
  editing = false,
  editingName,
  onLeaveRunning,
  onBack,
  onShowDetails,
}: Readonly<BuildStepProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);
  const statuses = buildStepStatuses(stage, delivering);
  const pct = buildProgressFraction(stage, delivering);
  const liveness = signals === null ? null : livenessOf(signals, now);
  const livenessTone = liveness === 'stalled' ? 'stalled' : 'accent';

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={styles.content}>
        {editing && editingName != null && <EditingEyebrow name={editingName} palette={p} />}
        <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{buildTitle(editing)}</Text>
        <Text style={[TYPE_SCALE.caption, styles.subtitle, { color: p.textMuted }]}>{COPY.buildSubtitle}</Text>

        <View style={[styles.progressTrack, { backgroundColor: SHELL_COLORS.border }]}>
          <View style={[styles.progressFill, { backgroundColor: p.accent, width: `${pct * 100}%` }]} />
        </View>

        <Text style={[TYPE_SCALE.body, styles.current, { color: p.text }]}>
          {currentActionSentence(stage, delivering)}
        </Text>

        {signals !== null && liveness !== null && (
          <WorkingLine
            phrase={buildLivenessLine(liveness, signals, now)}
            startedAt={signals.startedAt}
            tone={livenessTone}
            clock={false}
          />
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
