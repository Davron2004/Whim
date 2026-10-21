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
 * The ember is where the Ready page's ember travels from as the delivery lands (`TravelLayer`).
 */
import React from 'react';
import { Text as RNText, useWindowDimensions, View } from 'react-native';
import { LAYOUT, SPACE } from '../../design/tokens';
import { Button } from '../ui/Button';
import { AmbientLight, Ember } from '../ui/Ember';
import { Icon } from '../ui/Icon';
import { Text, wrappingType } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { useTravelSource } from '../ui/TravelLayer';
import { makeStyles, MAX_FONT_SCALE } from '../ui/tokens-pure';
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
  ambient: { position: 'absolute' as const, top: -AMBIENT.lift },
  centered: { textAlign: 'center' as const },
  title: { textAlign: 'center' as const, marginTop: SPACE[3] },
  steps: { marginTop: SPACE[8], gap: SPACE[3] },
  step: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[3] },
  stepLabel: { flex: 1 },
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

function StepMark({ state }: Readonly<{ state: MakingRow['state'] }>) {
  const t = useTokens();
  const s = styles(t);
  if (state === 'done') return <Icon name="circle-check" size={STEP_MARK.ring} color={t.colors.text} />;
  const ring = { borderColor: state === 'current' ? t.colors.ember : t.colors['text-2'] };
  return <View style={[s.ring, ring]}>{state === 'current' ? <View style={s.dot} /> : null}</View>;
}

/** One row of the step list, one element to a screen reader: "Writing the app, now, 0:41". */
function StepRow({ row }: Readonly<{ row: MakingRow }>) {
  const t = useTokens();
  const s = styles(t);
  const current = row.state === 'current';
  const label = [row.label, ROW_STATE_LABEL[row.state], row.elapsed].filter((part) => part !== undefined).join(', ');
  return (
    <View style={s.step} accessible accessibilityLabel={label}>
      <StepMark state={row.state} />
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
  const emberPlace = useTravelSource('ember');
  return (
    <KeyboardShell
      host="sheet"
      contentContainerStyle={s.content}
      footer={
        delivering ? undefined : (
          <View style={s.footer}>
            <Button label={COPY.actionStop} variant="plain" onPress={onStop} />
          </View>
        )
      }
    >
      <View style={s.header}>
        <View style={[s.ambient, { width: ambientWidth }]} pointerEvents="none">
          <AmbientLight width={ambientWidth} height={AMBIENT.height} cut={{ at: AMBIENT.lift, backdrop: t.colors.sheet }} activity={progress.ember.state === 'stuck' ? 0 : progress.ember.activity} flicker={flicker} />
        </View>
        <View ref={emberPlace} collapsable={false}>
          <Ember size={128} state={progress.ember.state} activity={progress.ember.activity} flicker={flicker} />
        </View>
        <Text type="title1" style={s.title}>
          {makingTitle(name, changing)}
        </Text>
        <Text type="title3" italic style={s.centered}>{quotedWords(words)}</Text>
        <Text type="callout" color="text-2" style={s.centered}>
          {progress.line}
        </Text>
      </View>
      <View style={s.steps}>
        {progress.rows.map((row) => (
          <StepRow key={row.key} row={row} />
        ))}
      </View>
    </KeyboardShell>
  );
}
