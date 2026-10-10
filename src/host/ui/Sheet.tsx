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
 *   page that steps back before it closes registers there, never on `BackHandler`.
 * - Modal to screen readers (`accessibilityViewIsModal`; its own window on Android), focus moves to
 *   its title on open, close reads "Close".
 * - The keyboard: the card's bottom padding follows the keyboard frame by frame on the keyboard's own
 *   curve (`useKeyboardOverlap`): the card continues behind the keyboard and its content ends above
 *   it. A body with fields renders a `KeyboardShell host="sheet"`, which keeps the focused field in view.
 * - Reduce Motion: opening and closing cross-fade in place (160 / 120 ms); a drag still tracks the
 *   finger and settles with a cross-fade.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { LAYOUT, RADII, SPACE } from '../../design/tokens';
import { haptics } from '../haptics';
import { COPY } from '../launcher/copy';
import { sheetBottomPadding } from '../launcher/keyboard-shell';
import { OverlayShownContext, useKeyboardOverlap } from '../launcher/KeyboardShell';
import type { IconName } from '../../design/icons/names';
import { Icon } from './Icon';
import { timing, usePressFeedback } from './motion';
import { OverlayModal, useOverlayTurn } from './OverlayModal';
import { useTokens } from './tokens';
import { hitSlopFor, ICON_BUTTON, makeStyles, MAX_FONT_SCALE, PRESS_RETENTION, springConfig, typeStyle } from './tokens-pure';

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
  /** Called once after the sheet has finished closing and nothing of it is left on screen: the exit
   *  animation has ended and its `Modal` is gone (`OverlayModal`). Nothing needs to wait for it to
   *  show another sheet: overlays take turns by themselves. */
  onClosed?: () => void;
  children: React.ReactNode;
}

/** What Android back does on the sheet's current page, when it is not "close", and the sheet's say
 *  over whether its header shows a back control for it. */
interface SheetBack {
  readonly slot: React.MutableRefObject<(() => void) | null>;
  readonly showControl: (shown: boolean) => void;
}
const SheetBackContext = createContext<SheetBack | null>(null);

export interface SheetBackOptions {
  /** Also draws the back control in the sheet's header row, beside the close control, for as long as
   *  the page is up: the page's visible way back, taking the same step. */
  readonly control?: boolean;
}

/**
 * Takes Android back (and hardware Escape) on the page that calls it, in place of closing the sheet:
 * a page that steps back before it closes — Plan returning to Describe, a row edit cancelling —
 * passes the step here. A `Modal` consumes the press, so `BackHandler` never sees it while a sheet is
 * up. The close control, the scrim and a drag still call `onClose`. Outside a sheet it does nothing.
 */
export function useSheetBack(handler: () => void, { control = false }: SheetBackOptions = {}): void {
  const back = useContext(SheetBackContext);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (back === null) return undefined;
    const { slot, showControl } = back;
    const call = () => latest.current();
    slot.current = call;
    showControl(control);
    return () => {
      if (slot.current === call) slot.current = null;
      showControl(false);
    };
  }, [back, control]);
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
  card: {
    backgroundColor: t.colors.sheet,
    borderTopLeftRadius: RADII.xl.radius,
    borderTopRightRadius: RADII.xl.radius,
    borderCurve: 'continuous' as const,
    boxShadow: t.shadows.raised,
    borderTopWidth: 1,
    borderColor: t.topHighlight,
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
  title: { color: t.colors.text, ...typeStyle('title2') },
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
}

export function Sheet({ visible, onClose, title, detent = 'fit', closeLabel = COPY.sheetClose, onClosed, children }: Readonly<SheetProps>) {
  const t = useTokens();
  const { height: windowHeight } = useWindowDimensions();
  const gate = useOverlayTurn(visible, { onGone: onClosed, onRefused: onClose });
  // The window's own report that it is on screen, which Android needs before it serves a field in it.
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

  const settled = useCallback(() => {
    if (!closingRef.current && openRef.current) return;
    closingRef.current = false;
    exited();
  }, [exited]);

  // The `open` last acted on: only a change of it plays the entrance or the exit, never a change of
  // settings while the sheet shows.
  const actedOn = useRef(false);
  useEffect(() => {
    openRef.current = open;
    if (actedOn.current === open) return;
    actedOn.current = open;
    if (open) {
      closingRef.current = false;
      if (t.reduceMotion) {
        y.value = 0;
        fade.value = withTiming(1, timing('fadeIn', true));
      } else {
        fade.value = 1;
        y.value = withSpring(0, springConfig('smooth'));
      }
      return;
    }
    // Off screen already (its own drag ended it, or the system refused it), or a drag is carrying it out.
    if (!up || closingRef.current) return;
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(settled);
    };
    if (t.reduceMotion) fade.value = withTiming(0, timing('fadeOut', true), done);
    else y.value = withSpring(height.value, springConfig('smooth'), done);
  }, [open, up, t.reduceMotion, y, fade, height, settled]);

  const dragClosed = useCallback(() => {
    closingRef.current = true;
    onClose();
  }, [onClose]);

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
          <OverlayShownContext.Provider value={presented}>
            <SheetFrame
              key={t.fontScale}
              motion={{ y, height, fade }}
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
          </OverlayShownContext.Provider>
        </SheetBackContext.Provider>
      </SafeAreaProvider>
    </OverlayModal>
  );
}

interface SheetFrameProps {
  motion: SheetMotion;
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

function SheetFrame({ motion, reduceMotion, title, detent, closeLabel, onClose, onBack, onDragClosed, onSettled, children }: Readonly<SheetFrameProps>) {
  const t = useTokens();
  const s = styles(t);
  const insets = useSafeAreaInsets();
  const { y, height, fade } = motion;
  const frame = useRef<View>(null);
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
  const drag = usePanGesture({
    activeOffsetY: [-DRAG_SLOP, DRAG_SLOP],
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
        if (reduceMotion) fade.value = withTiming(0, timing('fadeOut', true), done);
        else y.value = withSpring(height.value, { ...springConfig('fling'), velocity: e.velocityY }, done);
      } else if (reduceMotion) {
        y.value = withTiming(0, timing('fadeIn', true));
      } else {
        y.value = withSpring(0, { ...springConfig('fling'), velocity: e.velocityY });
      }
    },
  });

  const cardMotion = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
    opacity: fade.value,
    paddingBottom: sheetBottomPadding(overlap.value, safeBottom),
  }));
  const scrimMotion = useAnimatedStyle(() => {
    const shown = height.value > 0 ? 1 - Math.min(1, Math.max(0, y.value / height.value)) : 1;
    return { opacity: shown * fade.value };
  });
  const onCardLayout = (event: LayoutChangeEvent) => {
    height.value = event.nativeEvent.layout.height;
  };

  return (
    <View ref={frame} collapsable={false} onLayout={onFrameLayout} style={s.frame}>
      <Animated.View style={[s.scrim, scrimMotion]} pointerEvents="box-none">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} accessibilityRole="none" importantForAccessibility="no" />
      </Animated.View>
      <Animated.View
        onLayout={onCardLayout}
        style={[s.card, detent === 'large' ? { height: SHEET_MAX_HEIGHT } : { maxHeight: SHEET_MAX_HEIGHT }, cardMotion]}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
      >
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
        <View style={s.body}>{children}</View>
      </Animated.View>
    </View>
  );
}
