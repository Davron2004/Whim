/**
 * MakingPage — the making sheet's third page (system.md §9 Making, §7.1 Step list, §8 making-time
 * lines; `prompt-flow` "The Making page shows honest progress without internals").
 *
 * The 128 pt ember with its ambient light behind the header, following this run's stream; "Making
 * <name>" (or "Changing <name>"); the person's words; one line (the place in line, the stall, or the
 * time line); the four steps with the elapsed time on the current one and, after a repair, the
 * "Fixing a problem" row the marker moves down to; and Stop, until delivery starts. Nothing here shows a token's text, a
 * diagnostic, the transport or an output counter: the page reads only the run's own page state and
 * signals, through `making-progress.ts`. Leaving is the sheet's close (and Android back, which the
 * sheet delivers as its close); neither stops the run, so the page registers nothing with the sheet.
 *
 * M9 (system.md §4.4): reached from Make it, the ember travels from the button to this page's 128
 * on `morph` (`TravelLayer`) as the plan fades out under the page, and everything here but the ember
 * (its light, the words, the steps, Stop) fades in on `fade-in`: text only fades, it never moves.
 * Under Reduce Motion nothing travels: the whole page, its ember too, cross-fades in. A close mid-way
 * shows the end at once. On a repair the marker moves down from its step to the "Fixing a problem"
 * row on `snappy` (at once under Reduce Motion, fading in there). The ember is where the Ready page's
 * ember travels from as the delivery lands, in the light it is drawn in then (M10).
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Text as RNText, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { LAYOUT, SPACE } from '../../design/tokens';
import { Button } from '../ui/Button';
import { AmbientLight, Ember, type EmberLight, type EmberLightRef } from '../ui/Ember';
import { Icon } from '../ui/Icon';
import { timing } from '../ui/motion';
import { useSheetLeaving } from '../ui/Sheet';
import { Text, wrappingType } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { useTravelSource, useTravelTarget } from '../ui/TravelLayer';
import { emberSize, makeStyles, MAX_FONT_SCALE, springConfig } from '../ui/tokens-pure';
import { COPY, makingTitle, quotedWords } from './copy';
import type { FlickerPulse } from './home-live';
import KeyboardShell from './KeyboardShell';
import { makingProgress, type MakingRow } from './making-progress';
import type { RunSignals, Stage } from './prompt-flow';

/** A step's mark: the 20 pt ring, the 8 pt dot inside it while current. */
const STEP_MARK = { ring: 20, dot: 8, border: 1.5 } as const;
/** The ambient light reaches past the sheet's sides and above the ember, up past the page's top edge,
 *  where it fades into the sheet (`cut`) rather than being clipped flat. */
const AMBIENT = { overhang: 60, height: 340, lift: 110 } as const;

export interface MakingPageProps {
  /** What is being made: the attempt's name, or the app being changed. */
  name: string;
  changing: boolean;
  /** The person's words, quoted under the headline. */
  words: string;
  stage: Stage | null;
  delivering: boolean;
  queuedPosition?: number;
  repairAttempt?: number;
  stepSince?: number;
  /** This run's own signals, or `null` when the shell holds none for it. */
  signals: RunSignals | null;
  /** The render's clock reading, moved by the shell's tick. */
  now: number;
  /** This run's sampled stream activity, 0–1. */
  activity: number;
  /** This run's arrival pulse: the ember and its light flicker with it (system.md §4.6). */
  flicker?: FlickerPulse;
  /** Ends the run at once; it stays on Home as a stopped tile. Not offered once `delivering`:
   *  the stream has ended and the app is being put on the home screen, so delivery wins. */
  onStop: () => void;
}

const styles = makeStyles((t) => ({
  content: { paddingHorizontal: LAYOUT.gutter, paddingBottom: SPACE[4] },
  header: { alignItems: 'center' as const, gap: SPACE[2] },
  words: { alignSelf: 'stretch' as const, alignItems: 'center' as const, gap: SPACE[2] },
  ambient: { position: 'absolute' as const, top: -AMBIENT.lift },
  centered: { textAlign: 'center' as const },
  title: { textAlign: 'center' as const, marginTop: SPACE[3] },
  steps: { marginTop: SPACE[8], gap: SPACE[3] },
  step: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[3] },
  stepLabel: { flex: 1 },
  /** The marker, drawn once over the step list and moved to its row. */
  marker: { position: 'absolute' as const, top: 0, start: 0 },
  /** The current step's label: `body` at 600 (§7.1 Step list). */
  currentLabel: { fontWeight: '600' as const },
  ring: {
    width: STEP_MARK.ring,
    height: STEP_MARK.ring,
    borderRadius: STEP_MARK.ring / 2,
    borderWidth: STEP_MARK.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  dot: { width: STEP_MARK.dot, height: STEP_MARK.dot, borderRadius: STEP_MARK.dot / 2, backgroundColor: t.colors.ember },
  footer: { paddingHorizontal: LAYOUT.gutter, paddingTop: LAYOUT.actionAreaTop, paddingBottom: LAYOUT.actionAreaBottom },
}));

/** What a screen reader hears for a row's state. */
const ROW_STATE_LABEL: Readonly<Record<MakingRow['state'], string>> = {
  done: COPY.makingStepDone,
  current: COPY.makingStepCurrent,
  waiting: COPY.makingStepWaiting,
};

/** How a row draws its mark: its own, the marker in place (before the list is laid out), or an empty
 *  slot the marker is drawn over (the current row's, and the row it is moving down from). */
type MarkDrawn = 'own' | 'marker' | 'slot';

/** A row's mark: done's check, a waiting row's empty ring, the marker, or the marker's slot. */
function StepMark({ state, drawn }: Readonly<{ state: MakingRow['state']; drawn: MarkDrawn }>) {
  const t = useTokens();
  const s = styles(t);
  if (drawn === 'marker') return <Marker />;
  if (drawn === 'slot') return <View style={{ width: STEP_MARK.ring, height: STEP_MARK.ring }} />;
  if (state === 'done') return <Icon name="circle-check" size={STEP_MARK.ring} color={t.colors.text} />;
  return <View style={[s.ring, { borderColor: t.colors['text-2'] }]} />;
}

/** The current-step marker: the 8 pt `ember` dot in its 20 pt `ember` ring. */
function Marker() {
  const t = useTokens();
  const s = styles(t);
  return (
    <View style={[s.ring, { borderColor: t.colors.ember }]}>
      <View style={s.dot} />
    </View>
  );
}

/** One row of the step list, one element to a screen reader: "Writing the app, now, 0:41". */
function StepRow({ row, mark, onLayout }: Readonly<{ row: MakingRow; mark: MarkDrawn; onLayout: (event: LayoutChangeEvent) => void }>) {
  const t = useTokens();
  const s = styles(t);
  const current = row.state === 'current';
  const label = [row.label, ROW_STATE_LABEL[row.state], row.elapsed].filter((part) => part !== undefined).join(', ');
  return (
    <View style={s.step} accessible accessibilityLabel={label} onLayout={onLayout}>
      <StepMark state={row.state} drawn={mark} />
      <RNText
        style={[s.stepLabel, { ...wrappingType('body'), color: current ? t.colors.text : t.colors['text-2'] }, current ? s.currentLabel : null]}
        maxFontSizeMultiplier={MAX_FONT_SCALE}
      >
        {row.label}
      </RNText>
      {row.elapsed ? (
        <Text type="callout" color="text-2" tabular>
          {row.elapsed}
        </Text>
      ) : null}
    </View>
  );
}

// A spring config as a module constant: a worklet never calls `springConfig` (motion.ts).
const SNAPPY = springConfig('snappy');

/** Where a row is laid out in the step list: its top and its height. */
interface RowPlace {
  readonly y: number;
  readonly height: number;
}

/** The step list with its one marker (§7.1 Step list): drawn in the current row until the list is laid
 *  out, then over that row's mark slot. It moves down to the repair row on `snappy` (under Reduce Motion it is there
 *  at once, fading in), and to any other row at once; until the row it goes to is laid out it stays
 *  on the row it was on, so it is never drawn nowhere. */
function StepList({ rows, reduced }: Readonly<{ rows: readonly MakingRow[]; reduced: boolean }>) {
  const t = useTokens();
  const s = styles(t);
  const current = rows.find((row) => row.state === 'current')?.key ?? null;
  const [places, setPlaces] = useState<Readonly<Record<string, RowPlace>>>({});
  const [at, setAt] = useState<string | null>(null);
  const y = useSharedValue(0);
  const seen = useSharedValue(0);
  useEffect(() => {
    const place = current === null ? undefined : places[current];
    if (current === null) {
      seen.value = 0;
      setAt(null);
      return;
    }
    if (place === undefined) return;
    const to = place.y + (place.height - STEP_MARK.ring) / 2;
    const toRepair = current === 'repair' && at !== null;
    if (toRepair && !reduced) {
      y.value = withSpring(to, SNAPPY);
    } else {
      y.value = to;
      if (toRepair && at !== 'repair') {
        seen.value = 0;
        seen.value = withTiming(1, timing('fadeIn', true));
      }
    }
    if (at === null) seen.value = 1;
    if (at !== current) setAt(current);
    // `at` is where it was drawn: read, not a reason to move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, places, reduced]);
  const marker = useAnimatedStyle(() => ({ opacity: seen.value, transform: [{ translateY: y.value }] }));
  const markOf = (key: string): MarkDrawn => {
    if (at === null) return key === current ? 'marker' : 'own';
    return key === current || key === at ? 'slot' : 'own';
  };
  const placed = (key: string) => (event: LayoutChangeEvent) => {
    const { y: top, height } = event.nativeEvent.layout;
    setPlaces((was) => (was[key]?.y === top && was[key]?.height === height ? was : { ...was, [key]: { y: top, height } }));
  };
  return (
    <View style={s.steps}>
      {rows.map((row) => (
        <StepRow key={row.key} row={row} mark={markOf(row.key)} onLayout={placed(row.key)} />
      ))}
      {current === null && at === null ? null : (
        <Animated.View style={[s.marker, marker]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Marker />
        </Animated.View>
      )}
    </View>
  );
}

export default function MakingPage({
  name,
  changing,
  words,
  stage,
  delivering,
  queuedPosition,
  repairAttempt,
  stepSince,
  signals,
  now,
  activity,
  flicker,
  onStop,
}: Readonly<MakingPageProps>) {
  const t = useTokens();
  const s = styles(t);
  const { width } = useWindowDimensions();
  const progress = makingProgress({ stage, delivering, queuedPosition, repairAttempt, stepSince }, signals, now, activity);
  const ambientWidth = width + 2 * AMBIENT.overhang;
  const ember = progress.ember;
  const emberSide = emberSize(128, t);
  // M9: the ember from Make it lands here. The light it hands on to Ready is this page's own.
  const arrival = useTravelTarget('make-it', () => <Ember size={128} state={ember.state} activity={ember.activity} flicker={flicker} />, t.reduceMotion);
  const light: EmberLightRef = useRef<(() => EmberLight) | null>(null);
  const source = useTravelSource('ember', light);
  const reduced = useRef(t.reduceMotion).current;
  const shown = useSharedValue(arrival.arrived ? 0 : 1);
  // Before the page's first frame, so it fades in from the frame the ember sets out.
  useLayoutEffect(() => {
    if (arrival.arrived) shown.value = withTiming(1, timing('fadeIn', reduced));
    // Fades in once, as the page mounts from Make it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const leaving = useSheetLeaving();
  useEffect(() => {
    if (!leaving) return;
    arrival.land();
    shown.value = 1;
    // Ends the moment as the sheet starts to leave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  const fadeIn = useAnimatedStyle(() => ({ opacity: shown.value }));
  // Under Reduce Motion nothing travels, so the ember cross-fades in with the rest.
  const emberIn = arrival.arrived && reduced ? fadeIn : null;
  return (
    <KeyboardShell
      host="sheet"
      contentContainerStyle={s.content}
      footer={
        delivering ? undefined : (
          <Animated.View style={[s.footer, fadeIn]}>
            <Button label={COPY.actionStop} variant="plain" onPress={onStop} />
          </Animated.View>
        )
      }
    >
      <View style={s.header}>
        <Animated.View style={[s.ambient, { width: ambientWidth }, fadeIn]} pointerEvents="none">
          <AmbientLight width={ambientWidth} height={AMBIENT.height} cut={{ at: AMBIENT.lift, backdrop: t.colors.sheet }} activity={ember.state === 'stuck' ? 0 : ember.activity} flicker={flicker} />
        </Animated.View>
        <View ref={arrival.ref} collapsable={false} style={{ width: emberSide, height: emberSide }}>
          <View ref={source.ref} collapsable={false} style={{ width: emberSide, height: emberSide }}>
            {arrival.travelling ? null : (
              <Animated.View style={[source.hidden, emberIn]}>
                <Ember size={128} state={ember.state} activity={ember.activity} flicker={flicker} lightRef={light} />
              </Animated.View>
            )}
          </View>
        </View>
        <Animated.View style={[s.words, fadeIn]}>
          <Text type="title1" style={s.title}>
            {makingTitle(name, changing)}
          </Text>
          <Text type="title3" italic style={s.centered}>{quotedWords(words)}</Text>
          <Text type="callout" color="text-2" style={s.centered}>
            {progress.line}
          </Text>
        </Animated.View>
      </View>
      <Animated.View style={fadeIn}>
        <StepList rows={progress.rows} reduced={t.reduceMotion} />
      </Animated.View>
    </KeyboardShell>
  );
}
