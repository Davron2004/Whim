/**
 * Sheet — the shell's one presentation container (system.md §7.1 Sheet, §4.3 rule 6, M11; design-
 * system-v1 task 11.1). A `sheet` card rising from the bottom edge over a scrim, in its own
 * full-window `Modal` so it layers above a WebView and the orb and dims both system bars. It takes
 * its turn with the shell's other overlays (`OverlayModal`): shown while another sheet or a menu is
 * still on screen, it rises once that one has gone.
 *
 * - Grabber (36 × 5 `fill-strong`, 6 pt from the top, always), an optional `title2` title 12 pt
 *   under it, a close `x` trailing on both platforms, and, on a page that steps back, a back control
 *   leading in the same row (`useSheetBack` with `control`), so no page needs a row of its own for
 *   it. Both glyphs follow the text size to 1.5 times 24. Detents: `fit` (content height, to 92% of
 *   the window) and `large` (92%; the making flow); in `large` the page body fills the card, so its
 *   footer sits at the bottom.
 * - Opens from off-screen with `smooth`; a tapped close leaves the same way. The scrim's opacity
 *   follows the card's position, so a drag fades it with the finger.
 * - Drag from the grabber or the header: 1:1 after 10 pt of slop, rubber-banding at 0.55 above the
 *   open position. Release projects the position with the release velocity
 *   (`current + (v/1000)·0.998/(1−0.998)`); it closes when the projected end passes half the card's
 *   height and the release velocity doesn't point back, handing that velocity to `fling`, else it
 *   springs back with `fling`. Position alone never closes it. Crossing the commit point plays the
 *   `commit` haptic once per crossing, on that frame.
 * - Closes by scrim, close, Android back (and a hardware Escape, which Android delivers as back),
 *   the screen reader's escape gesture, or a drag. `onClose` must close it (`visible` false). Android
 *   back is the exception a page may take over (`useSheetBack`): the Modal consumes the press, so a
 *   page that steps back before it closes registers there, never on `BackHandler`. From the moment
 *   it starts to close, neither the card nor the scrim takes a touch.
 * - Modal to screen readers (`accessibilityViewIsModal`; its own window on Android), focus moves to
 *   its title on open, close reads "Close".
 * - The keyboard: the card's bottom padding follows the keyboard frame by frame on the keyboard's own
 *   curve (`useKeyboardOverlap`): the card continues behind the keyboard and its content ends above
 *   it. A body with fields renders a `KeyboardShell host="sheet"`, which keeps the focused field in view.
 *   A close, by any route, puts the keyboard away as it starts.
 * - Reduce Motion: opening and closing cross-fade in place (160 / 120 ms); a drag still tracks the
 *   finger and settles with a cross-fade.
 * - Growing from a place behind it (`anchor`, `SheetAnchor`; M6 the composer, M5 a ghost tile): it
 *   opens out of that place on `morph` and closes back into it on `smooth`, by every route, from where
 *   it is (a close mid-way turns back; a tap on the place mid-close reopens it). The card stays where
 *   it rests; one leaf plate behind it grows from the place's rect, corners and all, to the card's
 *   (width, height and radius on the UI thread, §4.3 rule 4: a rounded shape that changes its aspect
 *   is never scaled), the place's face stays where it is and fades, and the scrim follows. Nothing of
 *   the card draws outside the plate: the card fades in on `fade-in` once the plate covers it, and
 *   out on `fade-out` before the plate shrinks inside it, a turn mid-way included. A page's ember
 *   (`useSheetLead`) travels between its own place and the place's ember ahead of the card, one ember
 *   on every frame. The `Modal` stays up until the plate is back in the place. Under Reduce Motion it
 *   cross-fades as any sheet does.
 */

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, Pressable, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, { measure, useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { LAYOUT, RADII, SPACE } from '../../design/tokens';
import { haptics } from '../haptics';
import { COPY } from '../launcher/copy';
import { sheetBottomPadding } from '../launcher/keyboard-shell';
import { OverlayShownContext, useKeyboardOverlap } from '../launcher/KeyboardShell';
import type { IconName } from '../../design/icons/names';
import type { EmberLight, EmberLightRef } from './Ember';
import { Icon } from './Icon';
import { timing, usePressFeedback } from './motion';
import { OverlayModal, useOverlayTurn, useScrimCount } from './OverlayModal';
import { useAnchorEntry, type PlaceRef, type SheetAnchorEntry } from './SheetAnchor';
import { TopHighlight } from './TopHighlight';
import { TravelLayer } from './TravelLayer';
import { wrappingType } from './Text';
import { useTokens } from './tokens';
import { hitSlopFor, ICON_BUTTON, makeStyles, MAX_FONT_SCALE, PRESS_RETENTION, springConfig } from './tokens-pure';

// ── Drag physics (§4.3 rule 6), shared by every dragged surface ─────────────────

/** UIScrollView's normal deceleration rate, which the release projection assumes. */
const DECELERATION = 0.998;
/** How hard a drag past a bound is resisted. */
const RUBBER_BAND = 0.55;
/** A drag tracks the finger only after it has moved this far. */
export const DRAG_SLOP = 10;

/** Where a release at `velocity` (pt/s) from `position` would come to rest. */
export function projectRelease(position: number, velocity: number): number {
  'worklet';
  return position + ((velocity / 1000) * DECELERATION) / (1 - DECELERATION);
}

/** How far a drag `overshoot` past a bound moves, for a surface `dimension` tall. */
export function rubberBand(overshoot: number, dimension: number): number {
  'worklet';
  if (overshoot <= 0 || dimension <= 0) return 0;
  return (1 - 1 / ((overshoot * RUBBER_BAND) / dimension + 1)) * dimension;
}

/** Whether a drag released at `position` with `velocity` (both downward-positive) dismisses a
 *  surface `dimension` tall: its projected end passes half the height and the release velocity
 *  doesn't point back. Position alone never commits. */
export function releaseCommits(position: number, velocity: number, dimension: number): boolean {
  'worklet';
  return velocity >= 0 && projectRelease(position, velocity) > dimension / 2;
}

/** Where a drag that started at `start` and has moved `translation` past the slop puts a surface
 *  that rests at 0: 1:1 downward, rubber-banding above 0. */
export function dragPosition(start: number, translation: number, dimension: number): number {
  'worklet';
  const raw = start + translation;
  return raw >= 0 ? raw : -rubberBand(-raw, dimension);
}

/** The scrim's opacity under a card `y` below its open position, `height` tall: it follows the card,
 *  so a drag fades it with the finger, the Reduce Motion cross-fade `fade`, and how far the sheet has
 *  grown out of its anchor, `grown`. */
function scrimOpacity(y: number, height: number, fade: number, grown: number): number {
  'worklet';
  const shown = height > 0 ? 1 - Math.min(1, Math.max(0, y / height)) : 1;
  return shown * fade * Math.min(1, Math.max(0, grown));
}

// ── Growing out of a place (M6, M5) ───────────────────────────────────────────

/** How far along the way from the place to the card (0 → 1) the plate is whole: it fades in over
 *  the first stretch and out over the last, so its corners never show beside the place's own shape. */
export const PLATE_WHOLE = 0.1;
/** The place's face has faded out by this far along. */
export const FACE_GONE = 0.4;
/** A page's ember has reached the place once the sheet is this far on its way back into it: it leads. */
export const LEAD_SHARE = 0.6;

const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};
const lerp = (a: number, b: number, p: number) => {
  'worklet';
  return a + (b - a) * p;
};

/** Whether the plate, `k` of the way from the place to the card, covers the card. It is drawn
 *  between the place's rect and the card's, and a place is never as wide as the window, so it does
 *  only once it has reached the card's: the first frame the spring gets there. */
function plateCovers(k: number): boolean {
  'worklet';
  return k >= 1;
}

/** What `ref` measures, or `null`. On the UI thread an animated ref answers null until it is put on a
 *  view, and Reanimated's `measure` hands that null to the native side, which ends the app: the
 *  composer has no ember place, and a tile whose state has no ember draws none. */
function measured(ref: PlaceRef) {
  'worklet';
  const held: unknown = ref();
  return held === null ? null : measure(ref);
}

/** Where `ref` is drawn, from the frame's top-left, or `null` on a frame either cannot be measured. */
function placeIn(frame: PlaceRef, ref: PlaceRef) {
  'worklet';
  const origin = measured(frame);
  const at = measured(ref);
  if (origin === null || at === null || at.width === 0) return null;
  return { x: at.pageX - origin.pageX, y: at.pageY - origin.pageY, width: at.width, height: at.height, frameWidth: origin.width, frameHeight: origin.height };
}

/** Where the page's ember (`from`) and the anchor's ember place (`to`) are, or `null` when either
 *  cannot be measured: then the page's ember stays its own and fades with the card. */
function leadPlaces(frame: PlaceRef, source: PlaceRef, target: PlaceRef) {
  'worklet';
  const from = placeIn(frame, source);
  const to = placeIn(frame, target);
  return from === null || to === null ? null : { from, to };
}

/** The ember a page hands the sheet to lead with: where it is drawn, its light, and how to draw it. */
interface Lead {
  readonly ref: PlaceRef;
  readonly light: EmberLightRef;
  readonly draw: (from: EmberLight | null) => React.ReactNode;
}

/** The ember the page shown leads with, if it has one. */
type LeadStore = { current: Lead | null };

/** What a page in an anchored sheet reads: how far the sheet has grown, where its frame and the
 *  anchor's ember are, and where its own ember goes. */
interface SheetMorph {
  readonly grown: SharedValue<number>;
  /** How much of the card shows (0 → 1), never while the plate does not cover it. */
  readonly shown: SharedValue<number>;
  readonly anchored: boolean;
  readonly frame: PlaceRef;
  readonly target: PlaceRef | null;
  readonly lead: LeadStore;
}
const SheetMorphContext = createContext<SheetMorph | null>(null);

/**
 * The caller's ember leads the sheet into its anchor's ember place as it shrinks into it (M5, "ember
 * first") and back out as it grows from it. `ref` is the view the ember is drawn in, `light` reads its
 * light, `draw(from)` draws it at that view's size setting out in the light `from`. Put the returned
 * style on the ember: it hides it on exactly the frames the sheet draws it. Nothing outside an
 * anchored sheet.
 */
export function useSheetLead(ref: PlaceRef, light: EmberLightRef, draw: (from: EmberLight | null) => React.ReactNode) {
  const morph = useContext(SheetMorphContext);
  const store = morph?.lead ?? null;
  // Every render, so the ember the sheet draws follows the page's light inputs.
  useLayoutEffect(() => {
    if (store !== null) store.current = { ref, light, draw };
  });
  useEffect(
    () => () => {
      if (store !== null) store.current = null;
    },
    [store],
  );
  const still = useSharedValue(1);
  const grown = morph?.grown ?? still;
  const shown = morph?.shown ?? still;
  const on = morph?.anchored === true && morph.target !== null;
  const frame = morph?.frame ?? ref;
  const target = morph?.target ?? ref;
  return useAnimatedStyle(() => {
    const whole = shown.value >= 1;
    const away = grown.value < 1 || !whole;
    return { opacity: on && away && leadPlaces(frame, ref, target) !== null ? 0 : 1 };
  });
}

// ── Sheet ─────────────────────────────────────────────────────────────────────

export type SheetDetent = 'fit' | 'large';

/** The share of the window a sheet may take: `fit` grows to it, `large` is it. */
export const SHEET_MAX_HEIGHT = '92%';

export const SHEET_GRABBER = { width: 36, height: 5, top: 6 } as const;
/** The title sits this far under the grabber. */
const TITLE_GAP = SPACE[3];

export interface SheetProps {
  visible: boolean;
  /** Called by the scrim, the close control, Android back, the screen reader's escape and a drag
   *  past the commit point; it must set `visible` false. */
  onClose: () => void;
  /** The `title2` title under the grabber, where screen-reader focus lands on open. */
  title?: string;
  /** `fit` (default) or `large`. */
  detent?: SheetDetent;
  /** Default `COPY.sheetClose`. */
  closeLabel?: string;
  /** The place behind it (`useSheetAnchor`) it grows out of as it opens and shrinks back into as it
   *  closes; it rises from the bottom edge as any sheet when that place is not on the screen. */
  anchor?: string;
  children: React.ReactNode;
}

/** What Android back does on the sheet's current page, when it is not "close", and the sheet's say
 *  over whether its header shows a back control for it. */
interface SheetBack {
  readonly slot: React.MutableRefObject<(() => void) | null>;
  readonly showControl: (shown: boolean) => void;
}
const SheetBackContext = createContext<SheetBack | null>(null);

/** The sheet is leaving: its owner closed it, by whatever route. */
const SheetLeavingContext = createContext(false);

/** Whether the sheet the caller is in is leaving (any close: the control, the scrim, a drag, Android
 *  back), so a page can end a moment it is playing rather than leave on a frame of it. */
export function useSheetLeaving(): boolean {
  return useContext(SheetLeavingContext);
}

/** The caller's page is leaving the sheet under the page that replaced it (`TravelPage`): its step
 *  back is no longer the sheet's. */
const PageLeavingContext = createContext(false);

/** Wraps a page that is leaving the sheet under its successor: from then on the page's
 *  `useSheetBack` no longer takes Android back or draws the back control. */
export function SheetPageLeaving({ leaving, children }: Readonly<{ leaving: boolean; children: React.ReactNode }>) {
  return <PageLeavingContext.Provider value={leaving}>{children}</PageLeavingContext.Provider>;
}

export interface SheetBackOptions {
  /** Also draws the back control in the sheet's header row, beside the close control, for as long as
   *  the page is up: the page's visible way back, taking the same step. */
  readonly control?: boolean;
}

/**
 * Takes Android back (and hardware Escape) on the page that calls it, in place of closing the sheet:
 * a page that steps back before it closes — Plan returning to Describe, a row edit cancelling —
 * passes the step here. A `Modal` consumes the press, so `BackHandler` never sees it while a sheet is
 * up. The close control, the scrim and a drag still call `onClose`. Outside a sheet, or once the
 * page is leaving (`SheetPageLeaving`), it does nothing.
 */
export function useSheetBack(handler: () => void, { control = false }: SheetBackOptions = {}): void {
  const back = useContext(SheetBackContext);
  const leaving = useContext(PageLeavingContext);
  const latest = useRef(handler);
  latest.current = handler;
  // Before the frame the page is drawn on, so a page that starts to leave drops its control on that frame.
  useLayoutEffect(() => {
    if (back === null || leaving) return undefined;
    const { slot, showControl } = back;
    const call = () => latest.current();
    slot.current = call;
    showControl(control);
    return () => {
      if (slot.current === call) slot.current = null;
      showControl(false);
    };
  }, [back, control, leaving]);
}

const HEADER_ICON = 24;
const HEADER_ICON_MAX_SCALE = 1.5;

/** The glyph size of a control in a sheet's header: 24 (system.md §7.1 "24 in headers"), growing with
 *  the text size to 1.5 times that, where it stops being a header icon and starts crowding the title.
 *  The target stays the 44 the control already has. */
export function headerIconSize(fontScale: number): number {
  return Math.round(HEADER_ICON * Math.min(HEADER_ICON_MAX_SCALE, Math.max(1, fontScale)));
}

/** An icon control in the sheet's header row. `IconButton` draws its glyph at a fixed 20 or 24;
 *  these follow the text size (`headerIconSize`). */
function HeaderIconButton({ icon, label, onPress }: Readonly<{ icon: IconName; label: string; onPress: () => void }>) {
  const t = useTokens();
  const s = styles(t);
  const press = usePressFeedback('icon', t);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.pressIn}
      onPressOut={press.pressOut}
      hitSlop={hitSlopFor(ICON_BUTTON.size, t)}
      pressRetentionOffset={PRESS_RETENTION}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View style={[s.headerIcon, press.style]}>
        <Icon name={icon} size={headerIconSize(t.fontScale)} color={t.colors.text} />
      </Animated.View>
    </Pressable>
  );
}

const styles = makeStyles((t) => ({
  frame: { flex: 1, justifyContent: 'flex-end' as const },
  scrim: { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0, backgroundColor: t.colors.scrim },
  // The card paints the sheet to its edges and has no border: on Android React Native shrinks a
  // rounded view's background by 0.8 px on every side once it has any border, so a top border here
  // left a 1 px line of the scrim and shadow along the card's sides and bottom. The 1 px top
  // highlight is its own line over the card (`TopHighlight`), and the card keeps its 1 px of room for it.
  card: {
    backgroundColor: t.colors.sheet,
    borderTopLeftRadius: RADII.xl.radius,
    borderTopRightRadius: RADII.xl.radius,
    borderCurve: 'continuous' as const,
    boxShadow: t.shadows.raised,
    paddingTop: 1,
  },
  header: { paddingTop: SHEET_GRABBER.top },
  grabber: {
    alignSelf: 'center' as const,
    width: SHEET_GRABBER.width,
    height: SHEET_GRABBER.height,
    borderRadius: RADII.full.radius,
    backgroundColor: t.colors['fill-strong'],
  },
  titleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingLeft: LAYOUT.gutter,
    paddingRight: SPACE[2],
    marginTop: TITLE_GAP - SPACE[2],
  },
  // A back control sits where the close control does, so the row reads the same from both edges.
  titleRowBack: { paddingLeft: SPACE[2] },
  titleSlot: { flex: 1 },
  title: { color: t.colors.text, ...wrappingType('title2') },
  headerIcon: { width: ICON_BUTTON.size, height: ICON_BUTTON.size, alignItems: 'center' as const, justifyContent: 'center' as const },
  // Fills the card of a `large` sheet, which has a height of its own, so a page's footer sits at its
  // bottom; a `fit` sheet has none to fill and is as tall as its content, up to its cap.
  body: { flexGrow: 1, flexShrink: 1 },
}));

/** The motion state a sheet's frame reads: the card's offset from open, its height, and the fade
 *  that stands in for motion under Reduce Motion. */
interface SheetMotion {
  y: SharedValue<number>;
  height: SharedValue<number>;
  fade: SharedValue<number>;
  /** How far it has grown out of its anchor (1 when it has none). */
  grown: SharedValue<number>;
  /** How much of the card shows over the plate (1 when it has no anchor). */
  shown: SharedValue<number>;
  /** Where the growth is headed: 1 out to the card, 0 back into the place. */
  toward: SharedValue<number>;
}

// Spring configs as module constants: a worklet never calls `springConfig` (motion.ts).
const MORPH = springConfig('morph');
const SMOOTH = springConfig('smooth');

/** How a sheet moves: cross-faded under Reduce Motion, else out of and back into its anchor when it
 *  has one, else up from and down to the bottom edge. */
interface SheetMoves {
  readonly reduced: boolean;
  readonly anchored: boolean;
}

/** The entrance: from off screen (or, `fresh` false, from wherever a close has got to). Out of an
 *  anchor, the card fades in once the plate covers it (`useCardReveal`). */
function playEntrance({ y, height, fade, grown, shown, toward }: SheetMotion, { reduced, anchored }: SheetMoves, fresh: boolean): void {
  if (reduced || !anchored) {
    shown.value = 1;
    toward.value = 1;
  }
  if (reduced) {
    y.value = 0;
    grown.value = 1;
    fade.value = withTiming(1, timing('fadeIn', true));
    return;
  }
  fade.value = 1;
  if (!anchored) {
    // A showing that last went back into a place starts again from the bottom edge.
    if (fresh && grown.value < 1) y.value = height.value;
    grown.value = 1;
    y.value = withSpring(0, SMOOTH);
    return;
  }
  // Out of the place, or back out from wherever a close into it has got to.
  if (fresh) {
    y.value = 0;
    grown.value = 0;
    shown.value = 0;
  } else {
    y.value = withSpring(0, SMOOTH);
  }
  toward.value = 1;
  grown.value = withSpring(1, MORPH);
}

/** Back into the place from where the sheet is: the card fades out first if any of it shows, and the
 *  plate shrinks once it has gone, setting out at `velocity` (progress per second) when nothing had
 *  to fade; `done` once it is in the place. A turn back out cancels both. */
function shrinkInto({ grown, shown, toward }: SheetMotion, velocity: number, done: (finished?: boolean) => void): void {
  'worklet';
  toward.value = 0;
  if (shown.value <= 0) {
    grown.value = withSpring(0, { ...SMOOTH, velocity }, done);
    return;
  }
  shown.value = withTiming(0, FADE_OUT, (finished?: boolean) => {
    'worklet';
    if (finished) grown.value = withSpring(0, SMOOTH, done);
  });
}

/** The exit of a tapped close, from where the sheet is; `settled` once it has ended. */
function playExit(motion: SheetMotion, { reduced, anchored }: SheetMoves, settled: () => void): void {
  const { y, height, fade } = motion;
  const done = (finished?: boolean) => {
    'worklet';
    if (finished) scheduleOnRN(settled);
  };
  if (reduced) fade.value = withTiming(0, timing('fadeOut', true), done);
  else if (anchored) shrinkInto(motion, 0, done);
  else y.value = withSpring(height.value, SMOOTH, done);
}

/** Out of an anchor, the card fades in on `fade-in` from the frame the plate covers it, and the
 *  growth has ended (`grew`) once it shows. */
function useCardReveal({ grown, shown, toward }: SheetMotion, anchored: boolean, grew: () => void): void {
  useAnimatedReaction(
    () => {
      const out = toward.value === 1;
      const covered = plateCovers(grown.value);
      return anchored && out && covered;
    },
    (covered, before) => {
      if (!covered || before === true || shown.value >= 1) return;
      shown.value = withTiming(1, FADE_IN, (finished?: boolean) => {
        'worklet';
        if (finished) scheduleOnRN(grew);
      });
    },
    [anchored, grew],
  );
}

export function Sheet({ visible, onClose, title, detent = 'fit', closeLabel = COPY.sheetClose, anchor, children }: Readonly<SheetProps>) {
  const t = useTokens();
  const { height: windowHeight } = useWindowDimensions();
  const gate = useOverlayTurn(visible, { onRefused: onClose });
  // The window's own report that it is on screen, which Android needs before it serves a field in it.
  // A sheet already leaving asks for no keyboard, however late the report comes.
  const [presented, setPresented] = useState(false);
  const turn = useMemo(() => ({ ...gate, shown: () => { gate.shown(); setPresented(true); } }), [gate]);
  const { open, up, exited } = turn;
  useEffect(() => {
    if (!up) setPresented(false);
  }, [up]);
  const openRef = useRef(open);
  // A drag past the commit point already carries the card out; closing must not restart it.
  const closingRef = useRef(false);
  const y = useSharedValue(windowHeight);
  const height = useSharedValue(windowHeight);
  const fade = useSharedValue(t.reduceMotion ? 0 : 1);
  // How far the sheet has grown out of its anchor: 1 is the card, 0 the place.
  const grown = useSharedValue(1);
  const shown = useSharedValue(1);
  const toward = useSharedValue(1);
  const motion = useMemo<SheetMotion>(() => ({ y, height, fade, grown, shown, toward }), [y, height, fade, grown, shown, toward]);
  const entry = useAnchorEntry(anchor);
  const anchored = entry !== undefined && !t.reduceMotion;
  // A growth or shrink is under way: the sheet draws its ember lead, measured on every frame.
  const [moving, setMoving] = useState(false);
  useScrimCount(turn, () => {
    'worklet';
    return scrimOpacity(y.value, height.value, fade.value, grown.value);
  });

  const grew = useCallback(() => {
    if (openRef.current) setMoving(false);
  }, []);
  const settled = useCallback(() => {
    if (!closingRef.current && openRef.current) return;
    setMoving(false);
    closingRef.current = false;
    exited();
  }, [exited]);
  useCardReveal(motion, anchored, grew);

  // The `open` last acted on: only a change of it plays the entrance or the exit, never a change of
  // settings while the sheet shows.
  const actedOn = useRef(false);
  // The entrance has played in this showing: a sheet that is up without ever having opened has no
  // exit to wait for.
  const entered = useRef(false);
  useEffect(() => {
    openRef.current = open;
    if (!up) entered.current = false;
    if (actedOn.current === open) {
      if (up && !open && !entered.current) exited();
      return;
    }
    actedOn.current = open;
    const how = { reduced: t.reduceMotion, anchored };
    if (open) {
      const fresh = !entered.current;
      entered.current = true;
      closingRef.current = false;
      if (anchored) setMoving(true);
      playEntrance(motion, how, fresh);
      return;
    }
    // Its fields go with it, so the keyboard leaves as it starts to, not once its window has gone.
    if (up) Keyboard.dismiss();
    // Off screen already (its own drag ended it, or the system refused it), or a drag is carrying it out.
    if (!up || closingRef.current) return;
    if (anchored) setMoving(true);
    playExit(motion, how, settled);
  }, [open, up, t.reduceMotion, anchored, motion, settled, exited]);

  const dragClosed = useCallback(() => {
    closingRef.current = true;
    if (anchored) setMoving(true);
    onClose();
  }, [onClose, anchored]);
  const lead = useRef<Lead | null>(null);

  const backSlot = useRef<(() => void) | null>(null);
  const [backControl, setBackControl] = useState(false);
  const back = useMemo<SheetBack>(() => ({ slot: backSlot, showControl: setBackControl }), []);
  const requestClose = () => {
    if (backSlot.current) backSlot.current();
    else onClose();
  };

  return (
    // The frame is keyed by the text size: a size changed while the sheet is up leaves every text
    // measured at the old size on iOS (rows keep their height, words are cut in half), and only text
    // that is laid out again fits the new one. The sheet's own motion and the page's state in the
    // shell survive; what the page holds in itself (a ticked box, a half-edited row) starts again.
    <OverlayModal turn={turn} onRequestClose={requestClose}>
      <SafeAreaProvider>
        <SheetBackContext.Provider value={back}>
          <OverlayShownContext.Provider value={presented && open}>
            <SheetLeavingContext.Provider value={!visible}>
              <TravelLayer>
                <SheetFrame
                  key={t.fontScale}
                  closing={!open}
                  motion={motion}
                  anchor={anchored ? entry : undefined}
                  moving={moving}
                  lead={lead}
                  reduceMotion={t.reduceMotion}
                  title={title}
                  detent={detent}
                  closeLabel={closeLabel}
                  onClose={onClose}
                  onBack={backControl ? () => backSlot.current?.() : undefined}
                  onDragClosed={dragClosed}
                  onSettled={settled}
                >
                  {children}
                </SheetFrame>
              </TravelLayer>
            </SheetLeavingContext.Provider>
          </OverlayShownContext.Provider>
        </SheetBackContext.Provider>
      </SafeAreaProvider>
    </OverlayModal>
  );
}

interface SheetFrameProps {
  /** The sheet is leaving (or not yet open): neither the card nor the scrim takes a touch. */
  closing: boolean;
  motion: SheetMotion;
  /** The place it grows out of and shrinks into, under motion. */
  anchor: SheetAnchorEntry | undefined;
  /** It is growing out of its anchor or shrinking into it. */
  moving: boolean;
  lead: LeadStore;
  reduceMotion: boolean;
  title?: string;
  detent: SheetDetent;
  closeLabel: string;
  onClose: () => void;
  /** The page's step back, when it asks for a control: drawn in the header row, leading. */
  onBack?: () => void;
  onDragClosed: () => void;
  onSettled: () => void;
  children: React.ReactNode;
}

const prepareCommit = () => haptics.prepare('commit');
const playCommit = () => haptics.play('commit');

// What a released drag animates with, worked out here on the JS thread. The release runs on the UI
// thread, where `springConfig` and `timing` cannot be called: they are not worklets, a call to one
// from a worklet throws, and that throw ends the app (every drag of a sheet's header did, on release).
const FLING = springConfig('fling');
const FADE_OUT = timing('fadeOut', true);
const FADE_IN = timing('fadeIn', true);

function SheetFrame({ closing, motion, anchor, moving, lead, reduceMotion, title, detent, closeLabel, onClose, onBack, onDragClosed, onSettled, children }: Readonly<SheetFrameProps>) {
  const t = useTokens();
  const s = styles(t);
  const insets = useSafeAreaInsets();
  const { y, height, fade, grown, shown } = motion;
  const anchored = anchor !== undefined;
  const frame = useAnimatedRef<View>();
  const titleRef = useRef<RNText>(null);
  const { overlap, onLayout: onFrameLayout } = useKeyboardOverlap(frame, true);
  const safeBottom = insets.bottom;

  useEffect(() => {
    const node = titleRef.current;
    if (node) AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
  }, []);

  const dragStart = useSharedValue(0);
  const slop = useSharedValue(0);
  const committing = useSharedValue(false);
  const dragConfig = {
    activeOffsetY: [-DRAG_SLOP, DRAG_SLOP] as [number, number],
    onBegin: () => {
      'worklet';
      scheduleOnRN(prepareCommit);
    },
    onActivate: (e) => {
      'worklet';
      dragStart.value = y.value;
      slop.value = e.translationY;
      committing.value = false;
    },
    onUpdate: (e) => {
      'worklet';
      y.value = dragPosition(dragStart.value, e.translationY - slop.value, height.value);
      const commits = releaseCommits(y.value, e.velocityY, height.value);
      if (commits && !committing.value) scheduleOnRN(playCommit);
      committing.value = commits;
    },
    onDeactivate: (e) => {
      'worklet';
      const done = (finished?: boolean) => {
        'worklet';
        if (finished) scheduleOnRN(onSettled);
      };
      if (releaseCommits(y.value, e.velocityY, height.value)) {
        scheduleOnRN(onDragClosed);
        if (reduceMotion) fade.value = withTiming(0, FADE_OUT, done);
        // Back into its place, on `smooth` as any close of a morph, carrying the release's speed.
        else if (anchored) shrinkInto(motion, height.value > 0 ? -e.velocityY / height.value : 0, done);
        else y.value = withSpring(height.value, { ...FLING, velocity: e.velocityY }, done);
      } else if (reduceMotion) {
        y.value = withTiming(0, FADE_IN);
      } else {
        y.value = withSpring(0, { ...FLING, velocity: e.velocityY });
      }
    },
  } satisfies Parameters<typeof usePanGesture>[0];
  const drag = usePanGesture(dragConfig);
  // While it grows out of its place the card is not seen yet, and a view that is not seen takes no
  // touch, so the plate, the shape that is seen, takes the same drag.
  const plateDrag = usePanGesture({
    activeOffsetY: dragConfig.activeOffsetY,
    onBegin: dragConfig.onBegin,
    onActivate: dragConfig.onActivate,
    onUpdate: dragConfig.onUpdate,
    onDeactivate: dragConfig.onDeactivate,
    enabled: !closing,
  });

  const cardMotion = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: fade.value * shown.value,
    paddingBottom: sheetBottomPadding(overlap.value, safeBottom),
  }));
  const scrimMotion = useAnimatedStyle(() => ({ opacity: scrimOpacity(y.value, height.value, fade.value, grown.value) }));
  const morph = useMemo<SheetMorph>(() => ({ grown, shown, anchored, frame, target: anchor?.ember ?? null, lead }), [grown, shown, anchored, frame, anchor?.ember, lead]);
  const onCardLayout = (event: LayoutChangeEvent) => {
    height.value = event.nativeEvent.layout.height;
  };

  // A sheet that has started to leave takes no touch, from the commit that closes it on: a tap meant
  // for what is under it (the orb, right after a close) would otherwise land on a row still sliding out.
  return (
    <View ref={frame} collapsable={false} onLayout={onFrameLayout} style={s.frame} pointerEvents={closing ? 'box-none' : 'auto'}>
      <Animated.View style={[s.scrim, scrimMotion]} pointerEvents={closing ? 'none' : 'box-none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} accessibilityRole="none" importantForAccessibility="no" />
      </Animated.View>
      {anchor ? <AnchorMorph anchor={anchor} frame={frame} motion={motion} closing={closing} drag={plateDrag} /> : null}
      <Animated.View
        onLayout={onCardLayout}
        pointerEvents={closing ? 'none' : 'auto'}
        style={[s.card, detent === 'large' ? { height: SHEET_MAX_HEIGHT } : { maxHeight: SHEET_MAX_HEIGHT }, cardMotion]}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
      >
        <TopHighlight radius={RADII.xl.radius} continuous corners="top" />
        <GestureDetector gesture={drag}>
          <View style={s.header}>
            <View style={s.grabber} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <View style={[s.titleRow, onBack ? s.titleRowBack : null]}>
              {onBack ? <HeaderIconButton icon={t.platform === 'ios' ? 'chevron-left' : 'arrow-left'} label={COPY.backLabel} onPress={onBack} /> : null}
              <View style={s.titleSlot}>
                {title ? (
                  <RNText ref={titleRef} style={s.title} accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {title}
                  </RNText>
                ) : null}
              </View>
              <HeaderIconButton icon="x" label={closeLabel} onPress={onClose} />
            </View>
          </View>
        </GestureDetector>
        <View style={s.body}>
          <SheetMorphContext.Provider value={morph}>{children}</SheetMorphContext.Provider>
        </View>
      </Animated.View>
      {anchor && moving ? <LeadEmber lead={lead} frame={frame} target={anchor.ember} grown={grown} shown={shown} /> : null}
    </View>
  );
}

/** The plate growing between the anchor and the card, and the anchor's face, still, over it. The plate
 *  takes the sheet's drag while it is the shape seen; the face takes a tap while the sheet shrinks
 *  into it: the place's own tap, which reopens it. Each moving
 *  part is its own memoised view, so a render of the sheet or of Home never recomputes a style
 *  mid-way off the UI thread, where nothing can be measured. */
function AnchorMorph({ anchor, frame, motion, closing, drag }: Readonly<{ anchor: SheetAnchorEntry; frame: PlaceRef; motion: SheetMotion; closing: boolean; drag: ReturnType<typeof usePanGesture> }>) {
  const t = useTokens();
  const { ref, look, size } = anchor;
  return (
    <>
      <GestureDetector gesture={drag}>
        <Plate frame={frame} place={ref} radius={look.radius} y={motion.y} height={motion.height} grown={motion.grown} shown={motion.shown} color={t.colors.sheet} shadow={t.shadows.raised} />
      </GestureDetector>
      <Face frame={frame} place={ref} grown={motion.grown} width={size.width} height={size.height} closing={closing} onPress={look.onPress}>
        {look.face}
      </Face>
    </>
  );
}

interface PlateProps {
  frame: PlaceRef;
  place: PlaceRef;
  radius: number;
  y: SharedValue<number>;
  height: SharedValue<number>;
  grown: SharedValue<number>;
  shown: SharedValue<number>;
  color: string;
  shadow: string;
}

/** The one leaf view whose width, height and corners move (§4.3 rule 4): from the place's measured
 *  rect and radius to the card's, the card's top corners and square bottom. It stays on the card's
 *  rect, under it, until the card shows whole. */
const Plate = React.memo(function PlateView({ frame, place, radius, y, height, grown, shown, color, shadow }: Readonly<PlateProps>) {
  const style = useAnimatedStyle(() => {
    const k = Math.min(1, grown.value);
    const whole = shown.value >= 1;
    const at = placeIn(frame, place);
    if (at === null || (k >= 1 && whole)) return { opacity: 0, width: 0, height: 0 };
    const r = Math.min(radius, at.height / 2, at.width / 2);
    const top = lerp(r, RADII.xl.radius, k);
    const bottom = lerp(r, 0, k);
    return {
      opacity: clamp01(k / PLATE_WHOLE),
      width: lerp(at.width, at.frameWidth, k),
      height: lerp(at.height, height.value, k),
      transform: [{ translateX: lerp(at.x, 0, k) }, { translateY: lerp(at.y, at.frameHeight - height.value + y.value, k) }],
      borderTopLeftRadius: top,
      borderTopRightRadius: top,
      borderBottomLeftRadius: bottom,
      borderBottomRightRadius: bottom,
    };
  });
  return <Animated.View style={[morphStyles.at, { backgroundColor: color, boxShadow: shadow }, style]} />;
});

interface FaceProps {
  frame: PlaceRef;
  place: PlaceRef;
  grown: SharedValue<number>;
  width: number;
  height: number;
  closing: boolean;
  onPress: (() => void) | undefined;
  children: React.ReactNode;
}

/** The place's face where the place is drawn, never moving with the plate: it fades as the sheet
 *  leaves it and comes back as the sheet returns. A press or a lift scales the place, and Android
 *  measures what is drawn, so the copy, laid out at the place's own size, is scaled uniformly from its
 *  top-left to what the place measures: it sits exactly on it. */
function Face({ frame, place, grown, width, height, closing, onPress, children }: Readonly<FaceProps>) {
  const style = useAnimatedStyle(() => {
    const k = grown.value;
    const at = placeIn(frame, place);
    if (at === null || k >= 1) return { opacity: 0 };
    const scale = width > 0 ? at.width / width : 1;
    return { opacity: 1 - clamp01(k / FACE_GONE), transform: [{ translateX: at.x }, { translateY: at.y }, { scale }] };
  });
  return (
    <Animated.View style={[morphStyles.at, morphStyles.fromCorner, { width, height }, style]} pointerEvents={closing ? 'auto' : 'none'}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onPress} disabled={!closing || onPress === undefined} accessible={false} importantForAccessibility="no-hide-descendants">
        {children}
      </Pressable>
    </Animated.View>
  );
}

/** The page's ember on its way between its own place and the anchor's ember place, ahead of the card
 *  (`LEAD_SHARE`): drawn at its own size, scaled uniformly to the place's, setting out in the light it
 *  had. Drawn as the move starts and not again until it ends. */
const LeadEmber = React.memo(function LeadEmberView({ lead: store, frame, target, grown, shown }: Readonly<{ lead: LeadStore; frame: PlaceRef; target: PlaceRef; grown: SharedValue<number>; shown: SharedValue<number> }>) {
  const [lead] = useState(() => store.current);
  const [node] = useState(() => lead?.draw(lead.light.current?.() ?? null) ?? null);
  const source = lead?.ref ?? target;
  const style = useAnimatedStyle(() => {
    const k = Math.min(1, grown.value);
    const whole = shown.value >= 1;
    const places = leadPlaces(frame, source, target);
    if (places === null || (k >= 1 && whole)) return { opacity: 0 };
    const e = clamp01((1 - k) / LEAD_SHARE);
    const { from: a, to: b } = places;
    return {
      opacity: 1,
      transform: [
        { translateX: lerp(a.x + a.width / 2, b.x + b.width / 2, e) - a.width / 2 },
        { translateY: lerp(a.y + a.height / 2, b.y + b.height / 2, e) - a.height / 2 },
        { scale: lerp(1, b.width / a.width, e) },
      ],
    };
  });
  if (node === null) return null;
  return (
    <Animated.View style={[morphStyles.at, style]} pointerEvents="none">
      {node}
    </Animated.View>
  );
});

const morphStyles = StyleSheet.create({
  at: { position: 'absolute', top: 0, left: 0 },
  fromCorner: { transformOrigin: 'left top' },
});
