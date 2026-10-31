/**
 * AppTile — an app's tile and the grid cell around it (system.md §3.2 Tiles, §7.1 App tile;
 * app-launcher "A tile is a tinted squircle with one glyph", "Tiles show their state"; design-
 * system-v1 tasks 11.4 and 15.1).
 *
 * `TilePlate` is the squircle alone, at any of the four sizes: a superellipse (one SVG path on both
 * platforms) in the tint's light value in both schemes with a white glyph at half its size, a 1.5 pt
 * inner rim in dark mode and a 1 pt `border` outline with Increase Contrast. In the states without
 * an app's own look it carries the ember instead of the glyph: `ember-soft` while it is made (the
 * ember following the stream, or still and dim while it waits), a `fill` plate with the ember out
 * when it did not work, plus the alert badge on a failure and the glowing ring around an app that is
 * being changed. The glyph and the ember are hidden from screen readers.
 *
 * `AppTile` is the whole cell: plate, name under it (two lines, then ellipsis, in a block as many
 * lines tall as the longest name of its row, which the caller works out from `onLabelLines`), the
 * line that states the state, and the touch area (at least 64 × 84). Its label is the name plus the state ("Pour
 * Timer, making") with a hint for what a double tap does. A long-press of 350 ms plays the haptic
 * and reports the cell's rect (from the top-left of the app's root), which the context menu anchors to; the caller
 * owns the menu and passes `lifted` while it is open. The cell also carries the grid's moments: rising
 * in (M17), leaving and coming back (M18), reflowing as a layout transition, and a delivered ghost
 * turning into the tile (M4, drawn by the plate).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadingTransition,
  LinearTransition,
  ReduceMotion,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Path } from 'react-native-svg';
import { ON_PLATE, SPACE, TILE_RIM, TINTS, type TintName } from '../../design/tokens';
import { squirclePath } from '../../design/icons/squircle';
import { mixHex } from '../../design/tints';
import { haptics } from '../haptics';
import { COPY } from '../launcher/copy';
import type { TileGlyph } from '../launcher/tile-identity';
import type { FlickerPulse } from '../launcher/home-live';
import { Ember, lightTo, useFlicker } from './Ember';
import { Icon } from './Icon';
import type { MenuAnchor } from './ContextMenu';
import { timing, usePressFeedback } from './motion';
import { drawsName, GRID, TILE, TILE_SIDE, listRowPadding, type GridLayout, type TileSize } from './AppTile-geometry';
import { stateLine, tileAccessibilityHint, tileAccessibilityLabel, tileLook, type StateLine, type TileState } from './AppTile-states';
import { useSheetAnchor, type PlaceRef } from './SheetAnchor';
import { Text } from './Text';
import { useTokens } from './tokens';
import {
  emberLook,
  flickerOffset,
  makeStyles,
  PRESS_RETENTION,
  springConfig,
  springReachMs,
  timingOf,
  type EmberSize,
  type EmberState,
  type ShellTokens,
} from './tokens-pure';

/** How long a press must hold before it is a long-press (M12). */
export const LONG_PRESS_MS = 350;
/** The lifted tile's scale while its menu is open (M12). */
const LIFT_SCALE = 1.06;
/** The ring around a tile being changed: 2 pt, 3 pt outside the plate. */
const RING = { width: 2, gap: 3 } as const;
/** The badge sits this far past the plate's top-trailing corner. */
const BADGE_OUTSET = SPACE[1];
/** A busy tile (opening, copying) is dimmed, not shadowed: Android draws no `shadow*`. */
const BUSY_OPACITY = 0.7;
/** M17: a tile of the grid's first appearance rises this far as it fades in. */
const RISE = 8;
/** M18: a deleted tile shrinks to this as it fades out, and has gone once it is this faint. */
const LEAVE_SCALE = 0.8;
const GONE = 0.02;
/** M4: the glyph fades in from this scale. */
const GLYPH_FROM = 0.9;
/** M4: the circle that reveals the tint never scales to nothing (its content counter-scales by 1/scale). */
const REVEAL_MIN = 0.01;

// Spring configs as module constants: a worklet never calls `springConfig` (motion.ts).
const SMOOTH = springConfig('smooth');
const MORPH = springConfig('morph');

/** M18: when a tile leaves or comes back, its neighbours reflow on `smooth`, a Reanimated layout
 *  transition (system.md §4.3 rule 4); under Reduce Motion they cross-fade in place instead, over the
 *  160 ms `fade-in`, which the root `ReducedMotionConfig` must not skip. */
export const REFLOW = LinearTransition.springify().mass(SMOOTH.mass).stiffness(SMOOTH.stiffness).damping(SMOOTH.damping);
export const REFLOW_REDUCED = FadingTransition.duration(timingOf('fadeIn').duration).reduceMotion(ReduceMotion.Never);
const reflowOf = (reflows: boolean, reduced: boolean) => {
  if (!reflows) return undefined;
  return reduced ? REFLOW_REDUCED : REFLOW;
};

/** A leaving tile (M18) takes no touch and a screen reader skips it. */
const LEAVING = { pointerEvents: 'none', accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' } as const;
const STAYING = { pointerEvents: 'auto', accessibilityElementsHidden: false, importantForAccessibility: 'auto' } as const;
/** M18: a tile an Undo brings back once it had gone plays the delete back — its neighbours reflow
 *  out of its way first (on `smooth`), then it grows in where they made room. */
const RETURN_AFTER = springReachMs('smooth', 0.95);

/** The states a delivery turns from a ghost into the app's tile (M4). */
const GHOSTS: ReadonlySet<TileState> = new Set<TileState>(['making', 'queued']);

/** The ember a plate of this side carries. */
function emberFor(side: number): EmberSize {
  if (side >= TILE_SIDE.hero) return 48;
  return side >= TILE_SIDE.grid ? 24 : 20;
}

export interface TilePlateProps {
  size: TileSize;
  state: TileState;
  tint: TintName;
  glyph: TileGlyph;
  /** The stream's activity, 0–1, for the ember or ring of a tile being made or changed. */
  activity?: number;
  /** That stream's arrival pulse: the ember or ring flickers with it (system.md §4.6). */
  flicker?: FlickerPulse;
  /** That stream stalled (no bytes for 40 s): the ember or ring is stuck, dim and still. */
  stuck?: boolean;
  /** Tokens captured at one moment, in place of the phone's live ones, for the plate itself (fill,
   *  rim, outline, ring, badge): an open app's opening plate keeps the settings the app opened with.
   *  Omitted, the plate follows the phone. The ember of a plate being made always follows the phone. */
  tokens?: ShellTokens;
  /** M4: the ghost state this plate is turning from into its tint, the app just delivered with the
   *  grid in view: over that ghost's plate a circle of the tint fills the squircle from the centre on
   *  `morph`, the ghost's ember flares (`spark`) and goes out, the glyph fades in from 0.9. Under
   *  Reduce Motion the tint plate cross-fades in. `onArrived` once it rests; clearing it shows the
   *  tile at once (opening finishes it). */
  arrival?: TileState | null;
  onArrived?: () => void;
  /** Draws no ember: a sheet's own ember stands in for it (M5). Default true. */
  ember?: boolean;
  /** The view its ember is drawn in, for a sheet's ember to land on (M5). */
  emberPlace?: PlaceRef;
}

const plateStyles = makeStyles((t) => ({
  centre: { ...StyleSheet.absoluteFill, alignItems: 'center' as const, justifyContent: 'center' as const },
  ring: { position: 'absolute' as const },
  badge: {
    position: 'absolute' as const,
    top: -BADGE_OUTSET,
    end: -BADGE_OUTSET,
    width: TILE.badge,
    height: TILE.badge,
    borderRadius: TILE.badge / 2,
    backgroundColor: t.colors.bg,
  },
}));

/** The ember a plate in `state` carries, if any (none where it is not `drawn`): a waiting one, or one
 *  whose stream stalled, is stuck. */
function plateEmber(state: TileState, stuck: boolean, drawn: boolean): EmberState | undefined {
  if (!drawn) return undefined;
  const { ember } = tileLook(state);
  if (ember === 'waiting' || (ember === 'working' && stuck)) return 'stuck';
  return ember;
}

/** What fills the plate in `state`. */
function plateFill(t: ShellTokens, state: TileState, tint: TintName): string {
  const { plate } = tileLook(state);
  if (plate === 'tint') return TINTS[tint].light;
  return plate === 'ember-soft' ? t.colors['ember-soft'] : t.colors.fill;
}

/** The squircle itself: its fill, the dark-mode inner rim and the Increase Contrast outline. */
function PlateShape({ side, fill, rim, outline }: Readonly<{ side: number; fill: string; rim: string | null; outline: string | null }>) {
  return (
    <Svg width={side} height={side} viewBox={`0 0 ${side} ${side}`}>
      <Path d={squirclePath(side)} fill={fill} />
      {rim ? <Path d={squirclePath(side - TILE_RIM.width)} fill="none" stroke={rim} strokeWidth={TILE_RIM.width} transform={`translate(${TILE_RIM.width / 2} ${TILE_RIM.width / 2})`} /> : null}
      {outline ? <Path d={squirclePath(side - 1)} fill="none" stroke={outline} strokeWidth={1} transform="translate(0.5 0.5)" /> : null}
    </Svg>
  );
}

interface ArrivalProps {
  side: number;
  /** 0 → 1 as the tile arrives. */
  progress: SharedValue<number>;
  reduced: boolean;
  /** The tint plate the circle reveals. */
  plate: React.ReactNode;
  glyph: React.ReactNode;
  centre: object;
}

/** M4's tint and glyph. The reveal is transform-only: a circle as wide as the plate's diagonal, which
 *  clips what it holds, scales up from the centre while the tint plate inside it scales by the inverse,
 *  so the plate stays put and only the circle's edge moves. Under Reduce Motion the circle is whole and
 *  fades in. */
function Arrival({ side, progress, reduced, plate, glyph, centre }: Readonly<ArrivalProps>) {
  const diagonal = side * Math.SQRT2;
  const inset = (side - diagonal) / 2;
  const circle = useAnimatedStyle(() =>
    reduced ? { opacity: progress.value } : { transform: [{ scale: Math.max(REVEAL_MIN, progress.value) }] },
  );
  const counter = useAnimatedStyle(() => ({ transform: [{ scale: reduced ? 1 : 1 / Math.max(REVEAL_MIN, progress.value) }] }));
  const glyphIn = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: reduced ? 1 : GLYPH_FROM + (1 - GLYPH_FROM) * progress.value }],
  }));
  const circleBox = { position: 'absolute' as const, top: inset, start: inset, width: diagonal, height: diagonal, borderRadius: diagonal / 2, overflow: 'hidden' as const };
  const plateBox = { position: 'absolute' as const, top: -inset, start: -inset, width: side, height: side };
  return (
    <>
      <Animated.View style={[circleBox, circle]} pointerEvents="none">
        <Animated.View style={[plateBox, counter]}>{plate}</Animated.View>
      </Animated.View>
      <Animated.View style={[centre, glyphIn]} pointerEvents="none">
        {glyph}
      </Animated.View>
    </>
  );
}

/** M4: how far a tile has arrived from the ghost state `from`, 0 → 1 on `morph` (under Reduce Motion
 *  the fade-in), calling `onArrived` once it rests; with `from` null nothing arrives, and an arrival
 *  cut short ends where it is. Reduce Motion is read as the tile starts to arrive. */
function useArrival(from: TileState | null, reduced: boolean, onArrived: (() => void) | undefined): SharedValue<number> {
  const progress = useSharedValue(0);
  const arrivedRef = useRef(onArrived);
  arrivedRef.current = onArrived;
  const running = useRef(false);
  useEffect(() => {
    if (from === null) {
      // Finished, or cut short: ready from nothing for the next time.
      if (running.current) progress.value = 0;
      running.current = false;
      return;
    }
    running.current = true;
    const arrived = () => arrivedRef.current?.();
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(arrived);
    };
    progress.value = reduced ? withTiming(1, timing('fadeIn', true), done) : withSpring(1, MORPH, done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, progress]);
  return progress;
}

interface PlateBaseProps {
  side: number;
  /** The plate the tile is in. */
  plate: React.ReactNode;
  /** M4: the ghost's plate it is arriving from, and how far it has come; null at rest. */
  arriving: { ghost: React.ReactNode; progress: SharedValue<number>; reduced: boolean } | null;
  glyph: React.ReactNode;
  centre: object;
}

/** The plate under everything else: the tile's own, or while it arrives the ghost's with the tint
 *  coming in over it. */
function PlateBase({ side, plate, arriving, glyph, centre }: Readonly<PlateBaseProps>) {
  if (arriving === null) return <>{plate}</>;
  return (
    <>
      {arriving.ghost}
      <Arrival side={side} progress={arriving.progress} reduced={arriving.reduced} plate={plate} glyph={glyph} centre={centre} />
    </>
  );
}

/** The plate's middle: its glyph, or the ember of a plate without one. While the tile arrives
 *  (`arriving`, its progress) the ember goes out as the tint comes in. */
function PlateCentre({ centre, arriving, children }: Readonly<{ centre: object; arriving: SharedValue<number> | null; children: React.ReactNode }>) {
  const out = useAnimatedStyle(() => ({ opacity: 1 - (arriving?.value ?? 0) }));
  return <Animated.View style={arriving ? [centre, out] : centre}>{children}</Animated.View>;
}

/** How many arrivals this plate has finished. Its middle is drawn afresh after each: Reanimated
 *  leaves what a detached animated style last set on the native view, so the ember's fade-out would
 *  otherwise keep the glyph that follows it unseen. */
function useArrivalsDone(from: TileState | null): number {
  const [seen, setSeen] = useState(from);
  const [done, setDone] = useState(0);
  if (seen !== from) {
    setSeen(from);
    if (from === null) setDone((n) => n + 1);
  }
  return done;
}

export function TilePlate({ size, state, tint, glyph, activity = 0, flicker, stuck = false, tokens, arrival = null, onArrived, ember = true, emberPlace }: Readonly<TilePlateProps>) {
  const live = useTokens();
  const t = tokens ?? live;
  const s = plateStyles(t);
  const side = TILE_SIDE[size];
  const look = tileLook(state);
  const onTint = look.plate === 'tint';
  const ringSide = side + 2 * (RING.gap + RING.width);
  const rim = t.scheme === 'dark' && onTint ? mixHex(TINTS[tint].dark, TINTS[tint].light, TILE_RIM.mix) : null;
  const outline = t.increaseContrast ? t.colors.border : null;

  // M4: while the tile arrives, the ghost's plate and ember stay under the tint filling in; the
  // ember is the same one the ghost carried, so it goes on from the light it had.
  const from = onTint ? arrival : null;
  const reduced = t.reduceMotion;
  const progress = useArrival(from, reduced, onArrived);
  const arrivals = useArrivalsDone(from);

  // The ring is the change's light: working, it follows the stream and flickers; stuck, dim and
  // still; under Reduce Motion a still intensity per state.
  const ringState = stuck ? 'stuck' : 'working';
  const ringTarget = emberLook(ringState, t.reduceMotion ? 1 : activity).body;
  const intensity = useSharedValue(ringTarget);
  useEffect(() => {
    intensity.value = lightTo(ringTarget, ringState, t);
  }, [intensity, ringState, ringTarget, t]);
  const { on, smoothed, pulse } = useFlicker(activity, look.ring && !stuck, flicker);
  const ringGlow = useAnimatedStyle(() => ({ opacity: intensity.value + flickerOffset(on, smoothed.value, pulse.value) }));
  const emberState = plateEmber(from ?? state, stuck, ember);
  const ringBox = { top: -(RING.gap + RING.width), start: -(RING.gap + RING.width), width: ringSide, height: ringSide };
  const glyphIcon = <Icon name={glyph} size={side * TILE.glyph} color={ON_PLATE} stroke={TILE.glyphStroke} />;

  const plate = <PlateShape side={side} fill={plateFill(t, state, tint)} rim={rim} outline={outline} />;
  const arriving = from === null ? null : { ghost: <PlateShape side={side} fill={plateFill(t, from, tint)} rim={null} outline={outline} />, progress, reduced };

  // The centre keeps its place and key among the plate's layers through an arrival, so its ember is
  // the ghost's own all the way; it is drawn afresh once the arrival has ended.
  return (
    <View style={{ width: side, height: side }} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <PlateBase key="plate" side={side} plate={plate} arriving={arriving} glyph={glyphIcon} centre={s.centre} />
      <PlateCentre key={`centre-${arrivals}`} centre={s.centre} arriving={arriving?.progress ?? null}>
        {onTint && arriving === null ? glyphIcon : null}
        {emberState ? (
          <View ref={emberPlace} collapsable={false}>
            <Ember size={emberFor(side)} state={emberState} activity={activity} flicker={flicker} spark={arriving ? 1 : 0} />
          </View>
        ) : null}
      </PlateCentre>
      {look.ring ? (
        <Animated.View key="ring" style={[s.ring, ringBox, ringGlow]} pointerEvents="none">
          <Svg width={ringSide} height={ringSide} viewBox={`0 0 ${ringSide} ${ringSide}`}>
            <Path d={squirclePath(ringSide - RING.width)} fill="none" stroke={t.colors.ember} strokeWidth={RING.width} transform={`translate(${RING.width / 2} ${RING.width / 2})`} />
          </Svg>
        </Animated.View>
      ) : null}
      {look.badge ? (
        <View key="badge" style={s.badge}>
          <Icon name="circle-alert" size={TILE.badge} color={t.colors.danger} />
        </View>
      ) : null}
    </View>
  );
}

export interface AppTileProps {
  /** The grid's cell geometry for this screen width and text size (`gridLayout`). */
  layout: GridLayout;
  /** The app's full name, or the name of the attempt. */
  name: string;
  state: TileState;
  tint: TintName;
  glyph: TileGlyph;
  /** "Example" on a seeded app, "Copy" on a copy, "2 didn't work" on the collapsed cell. */
  example?: boolean;
  copy?: boolean;
  count?: number;
  activity?: number;
  flicker?: FlickerPulse;
  stuck?: boolean;
  /** An operation on this app is running: the tile is dimmed and reads busy. */
  busy?: boolean;
  /** Its menu is open: the tile is lifted. */
  lifted?: boolean;
  /** On the grid, how many lines tall the name block is: the most any name in the row took
   *  (`rowLabelLines`), so the state lines of a row sit level. Default one. */
  labelLines?: number;
  /** On the grid, after each layout of the name, the lines it took. */
  onLabelLines?: (lines: number) => void;
  onPress: () => void;
  /** After the 350 ms hold, with the cell's rect from the top-left of the app's root (`MenuAnchor`). */
  onLongPress: (anchor: MenuAnchor) => void;
  /** M17, the grid's first appearance: `hold` keeps the tile out of sight until the grid shows; a
   *  number rises it 8 pt as it fades in on `smooth` after that many ms (`staggerDelay`), then calls
   *  `onRisen`; `done` (the default) shows it in place, at once if it was still rising: a touch
   *  finishes it. Under Reduce Motion it is there at once. */
  entrance?: TileEntrance;
  onRisen?: () => void;
  /** M18: `leaving` (Delete) shrinks the tile to 0.8 as it fades out on `smooth`; `returning` (an
   *  Undo once it had gone) plays that back from nothing; `shown` (the default) holds it, and brings
   *  a tile still leaving back from wherever it is. `onPresenceSettled` once a leave or a return
   *  rests. A leaving tile takes no touch and is hidden from screen readers. Under Reduce Motion
   *  both happen at once. */
  presence?: TilePresence;
  onPresenceSettled?: () => void;
  /** Whether a change of its place in the grid moves it there (M18's reflow; a cross-fade under Reduce
   *  Motion). Off, it is simply there: Home holds it off while its grid is still being laid out. On
   *  by default. */
  reflows?: boolean;
  /** The names its plate is registered under as a place (`SheetAnchor`): a run's, whose making sheet
   *  shrinks into it as it closes and grows out of it as it opens (M5); an app's, which grows out of
   *  it as it opens and goes back into it as it closes (M2, M3). */
  anchor?: string | readonly string[];
}

export type TileEntrance = 'hold' | number | 'done';
export type TilePresence = 'shown' | 'leaving' | 'returning';

const cellStyles = makeStyles((t) => ({
  column: { alignItems: 'center' as const, paddingHorizontal: GRID.labelSidePadding },
  label: { marginTop: GRID.labelGap, textAlign: 'center' as const, alignSelf: 'stretch' as const },
  /** The name block of a cell with no name: its row's lines all the same, so its state line sits level. */
  nameless: { marginTop: GRID.labelGap },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[3], paddingHorizontal: listRowPadding(t.largeText) },
  texts: { flex: 1 },
  /** A list row centres its plate on the text beside it; a grid cell holds every plate on one line. */
  touchGrid: { justifyContent: 'flex-start' as const },
  touchList: { justifyContent: 'center' as const },
  lifted: { boxShadow: t.shadows.floating },
}));

/** M17: how far a tile has risen with the grid's first appearance (`AppTileProps.entrance`). */
function useEntrance(entrance: TileEntrance, reduceMotion: boolean, onRisen: (() => void) | undefined): SharedValue<number> {
  const rise = useSharedValue(entrance === 'done' ? 1 : 0);
  const rising = useRef(entrance !== 'done');
  const risenRef = useRef(onRisen);
  risenRef.current = onRisen;
  useEffect(() => {
    if (entrance === 'hold' || !rising.current) return;
    const risen = () => {
      rising.current = false;
      risenRef.current?.();
    };
    if (typeof entrance === 'number' && !reduceMotion) {
      const done = (finished?: boolean) => {
        'worklet';
        if (finished) scheduleOnRN(risen);
      };
      rise.value = withDelay(entrance, withSpring(1, SMOOTH, done));
      return;
    }
    rise.value = 1;
    if (typeof entrance === 'number') risen();
    else rising.current = false;
  }, [entrance, rise, reduceMotion]);
  return rise;
}

/** M18: how much of a tile is there, 1 shown → 0 gone (`AppTileProps.presence`). */
function usePresence(presence: TilePresence, reduceMotion: boolean, onSettled: (() => void) | undefined): SharedValue<number> {
  const shown = useSharedValue(presence === 'returning' && !reduceMotion ? 0 : 1);
  const leaving = useSharedValue(false);
  const presenceWas = useRef<TilePresence>('shown');
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;
  const settled = useRef(() => settledRef.current?.()).current;
  // A leaving tile has gone once it can no longer be seen: the tail of its spring would only hold
  // its neighbours' reflow back.
  useAnimatedReaction(
    () => leaving.value && shown.value <= GONE,
    (gone, before) => {
      if (gone && !before) scheduleOnRN(settled);
    },
  );
  useEffect(() => {
    const was = presenceWas.current;
    presenceWas.current = presence;
    // A return that has come to rest is simply shown.
    if (was === presence || (was === 'returning' && presence === 'shown')) return;
    const target = presence === 'leaving' ? 0 : 1;
    if (reduceMotion) {
      shown.value = target;
      settled();
      return;
    }
    leaving.value = presence === 'leaving';
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(settled);
    };
    // From wherever it is: an Undo while the tile still leaves turns it back from where it is drawn
    // (Reanimated 4.6 drops a velocity that points away from the new target, so it sets out from
    // rest); one that comes once it had gone waits for its neighbours to make room.
    const spring = withSpring(target, SMOOTH, presence === 'leaving' ? undefined : done);
    shown.value = was === 'shown' && presence === 'returning' ? withDelay(RETURN_AFTER, spring) : spring;
  }, [presence, shown, leaving, settled, reduceMotion]);
  return shown;
}

/** M4: the ghost state a tile is arriving from — set as a ghost turns ready while the tile is in
 *  view — and what ends the arrival (it came to rest, or the tile was opened). */
function useDelivery(state: TileState): [TileState | null, () => void] {
  const [seenState, setSeenState] = useState(state);
  const [arrival, setArrival] = useState<TileState | null>(null);
  if (seenState !== state) {
    setSeenState(state);
    setArrival(GHOSTS.has(seenState) && state === 'ready' ? seenState : null);
  }
  return [arrival, () => setArrival(null)];
}

export function AppTile({
  layout,
  name,
  state,
  tint,
  glyph,
  example,
  copy,
  count,
  activity,
  flicker,
  stuck,
  busy = false,
  lifted = false,
  labelLines = 1,
  onLabelLines,
  onPress,
  onLongPress,
  entrance = 'done',
  onRisen,
  presence = 'shown',
  onPresenceSettled,
  reflows = true,
  anchor,
}: Readonly<AppTileProps>) {
  const t = useTokens();
  const s = cellStyles(t);
  const press = usePressFeedback('chip', t);
  const ref = useRef<View>(null);
  const line: StateLine | null = stateLine(state, { example, copy, count });

  const lift = useSharedValue(1);
  useEffect(() => {
    if (t.reduceMotion) lift.value = 1;
    else lift.value = withSpring(lifted ? LIFT_SCALE : 1, springConfig('snappy'));
  }, [lifted, lift, t.reduceMotion]);

  const rise = useEntrance(entrance, t.reduceMotion, onRisen);
  const shown = usePresence(presence, t.reduceMotion, onPresenceSettled);
  const cellMotion = useAnimatedStyle(() => ({
    opacity: rise.value * shown.value,
    transform: [{ translateY: (1 - rise.value) * RISE }, { scale: lift.value * (LEAVE_SCALE + (1 - LEAVE_SCALE) * shown.value) }],
  }));

  const [arrival, arrived] = useDelivery(state);

  const openMenu = () => {
    haptics.play('long-press');
    // `measure`'s page offsets run from the top of the app's root, which fills the window, as a
    // `Modal`'s do. Android's `measureInWindow` runs from below the status bar and would put the menu
    // that much too high.
    ref.current?.measure((_x, _y, width, height, pageX, pageY) => onLongPress({ x: pageX, y: pageY, width, height }));
  };

  const inList = layout.kind === 'list';
  const size: TileSize = inList ? 'menu' : 'grid';
  const tap = () => {
    // Opening finishes an arrival still under way.
    arrived();
    onPress();
  };
  const place = useSheetAnchor(anchor, {
    radius: TILE.corner * TILE_SIDE[size],
    face: <TilePlate size={size} state={state} tint={tint} glyph={glyph} activity={activity} flicker={flicker} stuck={stuck} ember={false} />,
    onPress: tap,
  });
  const frame = inList
    ? { minHeight: layout.rowHeight, width: '100%' as const }
    : { minHeight: layout.cellHeight, width: layout.columnWidth };
  // Only the plate carries the lift's shadow, with the plate's own corner: the cell around it is not a shape.
  const plate = (
    <View ref={place.ref} collapsable={false} onLayout={place.onLayout} style={lifted ? [s.lifted, { borderRadius: TILE.corner * TILE_SIDE[size] }] : null}>
      <TilePlate size={size} state={state} tint={tint} glyph={glyph} activity={activity} flicker={flicker} stuck={stuck} arrival={arrival} onArrived={arrived} emberPlace={place.ember} />
    </View>
  );
  const lines = line ? (
    <Text type="caption" color={line.color} numberOfLines={1} style={inList ? undefined : s.label}>
      {line.text}
    </Text>
  ) : null;

  return (
    <Animated.View style={[frame, cellMotion]} layout={reflowOf(reflows, t.reduceMotion)} {...(presence === 'leaving' ? LEAVING : STAYING)}>
      <Pressable
        ref={ref}
        onPress={tap}
        onLongPress={openMenu}
        delayLongPress={LONG_PRESS_MS}
        onPressIn={() => {
          haptics.prepare('long-press');
          press.pressIn();
        }}
        onPressOut={press.pressOut}
        pressRetentionOffset={PRESS_RETENTION}
        accessibilityRole="button"
        accessibilityLabel={tileAccessibilityLabel(name, line)}
        accessibilityHint={tileAccessibilityHint(state)}
        accessibilityState={{ busy }}
        accessibilityActions={[{ name: 'longpress', label: COPY.tileMenuAction }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress') openMenu();
        }}
        style={[inList ? s.touchList : s.touchGrid, { minHeight: frame.minHeight }]}
      >
        <Animated.View style={[press.style, busy ? { opacity: BUSY_OPACITY } : null]}>
          {inList ? (
            <View style={s.row}>
              {plate}
              <View style={s.texts}>
                {drawsName(name) ? <Text type="body">{name}</Text> : null}
                {lines}
              </View>
            </View>
          ) : (
            <View style={s.column}>
              {plate}
              {drawsName(name) ? (
                <Text
                  type="caption"
                  numberOfLines={GRID.labelLines}
                  style={[s.label, { minHeight: labelLines * layout.labelLine }]}
                  onTextLayout={(event) => onLabelLines?.(event.nativeEvent.lines.length)}
                >
                  {name}
                </Text>
              ) : (
                <View style={[s.nameless, { height: labelLines * layout.labelLine }]} />
              )}
              {lines}
            </View>
          )}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
