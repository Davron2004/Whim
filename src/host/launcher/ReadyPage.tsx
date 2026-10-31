/**
 * ReadyPage — the making sheet's last page when a run delivers with the sheet open (system.md §9
 * Ready; `prompt-flow` "The Ready page opens the app or returns home"): the app's 96 pt tile, its
 * name, the person's words, "It's on your home screen." (after a change, which put nothing new
 * there, "It opens with your change."), `Open it` in the app's own tint and `Done`.
 * The app does not run until it is opened: there is no preview. Android back is the sheet's close,
 * which is `Done`, so the page registers nothing with the sheet.
 *
 * M10 (system.md §4.4): the page mounts as the delivery lands, in place of the Making page, so it
 * carries the moment itself. The Making page's ember travels on `morph` from where it is drawn to the
 * tile's place (`TravelLayer`; at once when the page was not reached from Making), in the light it
 * had there, which it keeps as it flares (1 → 1.18 → 1, `spark`), so it never brightens or dims at the
 * hand-off;
 * once the flare has reached its peak it settles into the tile, which rises from 0.6 to 1 on
 * `spark` as the ember fades out over it. The name, the words and the buttons fade in 80 ms apart
 * from then; text only fades, it never moves (§4.3 rule 8). Done, Open it or closing the sheet by any
 * route mid-way shows the end at once (Done and Open it still act), so the sheet never leaves on a
 * frame of the moment. Under Reduce Motion, read as the delivery lands, nothing travels: the ember
 * cross-fades into the whole tile over `fade-in`, with no flare and no rise, and everything else fades
 * in with it.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { LAYOUT, SPACE } from '../../design/tokens';
import { TilePlate } from '../ui/AppTile';
import { TILE_SIDE } from '../ui/AppTile-geometry';
import { haptics } from '../haptics';
import { Button } from '../ui/Button';
import { Ember, emberFrom, RESTING_ACTIVITY, type EmberLight, type EmberProps } from '../ui/Ember';
import { timing } from '../ui/motion';
import { useSheetLeaving } from '../ui/Sheet';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { useTravelTarget } from '../ui/TravelLayer';
import { makeStyles, READY_RISE_FROM, READY_STAGGER_MS, springConfig, springReachMs } from '../ui/tokens-pure';
import type { InstalledApp } from './app-index';
import { COPY, quotedWords } from './copy';
import KeyboardShell from './KeyboardShell';
import { tileOf } from './tile-identity';

export interface ReadyPageProps {
  /** The delivered app: its tile, its name and its tint. */
  app: InstalledApp;
  /** The person's words, quoted under the name. */
  words: string;
  /** The run changed an app already on the home screen, rather than making one. */
  changed: boolean;
  /** Opens the app from its tile. */
  onOpen: () => void;
  /** Back to Home; nothing is launched. */
  onDone: () => void;
}

// A spring config as a module constant: a worklet never calls `springConfig` (motion.ts).
const SPARK = springConfig('spark');
/** M10: the ember settles into the tile once its flare has covered 95% of its way to the peak. */
const SETTLE_AFTER = springReachMs('spark', 0.95);

const styles = makeStyles(() => ({
  content: { paddingHorizontal: LAYOUT.gutter, paddingTop: SPACE[8], paddingBottom: SPACE[4], alignItems: 'center' as const, gap: SPACE[2] },
  hero: { width: TILE_SIDE.hero, height: TILE_SIDE.hero },
  name: { marginTop: SPACE[5] },
  words: { alignItems: 'center' as const, gap: SPACE[2] },
  centered: { textAlign: 'center' as const },
  footer: { paddingHorizontal: LAYOUT.gutter, paddingTop: LAYOUT.actionAreaTop, paddingBottom: LAYOUT.actionAreaBottom, gap: SPACE[3] },
}));

interface ReadyMotion {
  /** 0 → 1 as the ember settles into the tile (past 1 while `spark` overshoots). */
  arrived: SharedValue<number>;
  /** The name, the words and the buttons: each 0 → 1 as it fades in. */
  shown: readonly [SharedValue<number>, SharedValue<number>, SharedValue<number>];
  /** Reduce Motion as the delivery landed. */
  reduced: boolean;
  /** Changes once, to play the ember's flare. */
  spark: number;
  /** The tile is wholly there: the ember has gone. */
  settled: boolean;
  /** Shows the end at once (Done, Open it). */
  finish: () => void;
}

/** M10's timeline, started once the ember has `landed` on the tile's place, unless it was ended first. */
function useReadyMotion(reduceMotion: boolean, landed: boolean): ReadyMotion {
  const [reduced] = useState(reduceMotion);
  const [spark, setSpark] = useState(0);
  const [settled, setSettled] = useState(false);
  const arrived = useSharedValue(0);
  const shown = [useSharedValue(0), useSharedValue(0), useSharedValue(0)] as const;
  const ended = useRef(false);
  // Once the tile is wholly there the ember is wholly gone, so it leaves: overshoot or not.
  useAnimatedReaction(
    () => arrived.value >= 1,
    (whole, before) => {
      if (whole && !before) scheduleOnRN(setSettled, true);
    },
  );
  useEffect(() => {
    if (!landed || ended.current) return;
    if (reduced) {
      arrived.value = withTiming(1, timing('fadeIn', true));
      for (const value of shown) value.value = withTiming(1, timing('fadeIn', true));
      return;
    }
    setSpark(1);
    arrived.value = withDelay(SETTLE_AFTER, withSpring(1, SPARK));
    shown.forEach((value, i) => {
      value.value = withDelay(SETTLE_AFTER + i * READY_STAGGER_MS, withTiming(1, timing('fadeIn')));
    });
    // Played once, as the ember lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landed]);
  const finish = () => {
    ended.current = true;
    arrived.value = 1;
    for (const value of shown) value.value = 1;
  };
  return { arrived, shown, reduced, spark, settled, finish };
}

/** The ember's light: the one it was handed from the Making page, else the still, fully lit mark. */
const lightOf = (light: EmberLight | null): Pick<EmberProps, 'state' | 'activity' | 'flicker' | 'from'> =>
  light === null ? { state: 'working', activity: RESTING_ACTIVITY } : emberFrom(light);

export default function ReadyPage({ app, words, changed, onOpen, onDone }: Readonly<ReadyPageProps>) {
  const t = useTokens();
  const s = styles(t);
  const tile = tileOf(app);
  const travel = useTravelTarget('ember', (light) => <Ember size={96} {...lightOf(light)} />, t.reduceMotion);
  const { arrived, shown, reduced, spark, settled, finish: showEnd } = useReadyMotion(t.reduceMotion, travel.landed);
  const finish = () => {
    travel.land();
    showEnd();
  };
  // The page mounts as the delivery lands: that frame is the one the success confirms (§5, rule 7).
  useEffect(() => {
    haptics.play('success');
  }, []);
  const leaving = useSheetLeaving();
  useEffect(() => {
    if (leaving) finish();
    // Ends the moment as the sheet starts to leave.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);
  const tileIn = useAnimatedStyle(() => ({
    opacity: Math.min(1, arrived.value),
    transform: [{ scale: reduced ? 1 : READY_RISE_FROM + (1 - READY_RISE_FROM) * arrived.value }],
  }));
  const emberOut = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, arrived.value) }));
  const nameIn = useAnimatedStyle(() => ({ opacity: shown[0].value }));
  const wordsIn = useAnimatedStyle(() => ({ opacity: shown[1].value }));
  const actionsIn = useAnimatedStyle(() => ({ opacity: shown[2].value }));
  return (
    <KeyboardShell
      host="sheet"
      contentContainerStyle={s.content}
      footer={
        <Animated.View style={[s.footer, actionsIn]}>
          <Button
            label={COPY.readyOpen}
            variant="tint"
            tint={tile.tint}
            onPress={() => {
              finish();
              onOpen();
            }}
          />
          <Button
            label={COPY.readyDone}
            variant="plain"
            onPress={() => {
              finish();
              onDone();
            }}
          />
        </Animated.View>
      }
    >
      <View ref={travel.ref} collapsable={false} style={s.hero}>
        <Animated.View style={tileIn}>
          <TilePlate size="hero" state="ready" tint={tile.tint} glyph={tile.icon} />
        </Animated.View>
        {settled ? null : (
          <Animated.View style={[StyleSheet.absoluteFill, emberOut]} pointerEvents="none">
            {travel.travelling ? null : <Ember size={96} {...lightOf(travel.light)} spark={spark} />}
          </Animated.View>
        )}
      </View>
      <Animated.View style={[s.name, nameIn]}>
        <Text type="title1" style={s.centered}>
          {app.name}
        </Text>
      </Animated.View>
      <Animated.View style={[s.words, wordsIn]}>
        <Text type="title3" italic style={s.centered}>{quotedWords(words)}</Text>
        <Text type="callout" color="text-2" style={s.centered}>
          {changed ? COPY.readyChanged : COPY.readyOnHome}
        </Text>
      </Animated.View>
    </KeyboardShell>
  );
}
