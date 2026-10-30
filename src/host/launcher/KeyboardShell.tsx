/**
 * KeyboardShell — the one keyboard-safe frame every launcher screen or sheet with a text field
 * renders (beta-1 D3; app-launcher "Text input keeps its field and action above the keyboard";
 * design-system-v1 task 11.3). The keyboard is tracked by `react-native-keyboard-controller`; the
 * decisions live in `keyboard-shell.ts`.
 *
 * The scrolling content, and a pinned `footer` for the primary action. On a
 * screen the frame pads its bottom by the keyboard's overlap with it, frame by frame on the UI
 * thread as the keyboard moves, so the footer rides above the keyboard on its own curve and the
 * scroll view ends above the footer; inside a sheet the host (`Sheet`) pads.
 * While a field in the scroll view is focused, any change to what the scroll view shows (the
 * keyboard arriving or changing height, the field growing) scrolls the field, or the block it
 * names, back into view, `REVEAL_MARGIN` clear of the keyboard and the footer; while the keyboard
 * rises, it does so on the UI thread in each of the keyboard's frames, in step with the padding, so
 * the field rises with the keyboard, and a drag stops it.
 * A hairline above the footer shows while content continues below. In a sheet the frame fills the
 * body it sits in, so the footer sits at the bottom of a large sheet whatever the content; a footer that has outgrown its share of the
 * window (`footerShare`: the largest text sizes) scrolls with the content instead; and content
 * scrolling under the sheet's header fades out over 16 pt. A drag puts the keyboard away, a tap a control handles reaches the
 * control, and a tap on empty space anywhere in the frame puts the keyboard away.
 */

import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewProps,
  StyleProp,
  TextInputProps,
  ViewStyle,
} from 'react-native';
import Animated, { scrollTo, useAnimatedRef, useAnimatedStyle, useEvent, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  KeyboardController,
  KeyboardEvents,
  useGenericKeyboardHandler,
  useWindowDimensions as useKeyboardWindow,
  type NativeEvent,
} from 'react-native-keyboard-controller';
import { LAYOUT, SPACE } from '../../design/tokens';
import { wrappingType } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { COPY } from './copy';
import {
  contentBelow,
  fieldSelection,
  followOffset,
  FOOTER_SHARE,
  footerJoinsScroll,
  hiddenAtRest,
  keyboardDismissMode,
  keyboardOverlap,
  pinsFooter,
  REVEAL_MARGIN,
  revealOffset,
  riseProgress,
  sheetBottomPadding,
  showsDoneBar,
  topFadeOpacity,
  type KeyboardShellHost,
  type ScrollMetrics,
} from './keyboard-shell';

export interface KeyboardShellProps {
  /** Pinned below the scrolling content and kept above the keyboard: the primary action and what
   *  sits with it. Leave it out on a screen with no primary action. */
  footer?: React.ReactNode;
  /** In a sheet, the most of the window the footer may take before it scrolls with the content:
   *  `FOOTER_SHARE`, or `FIELDLESS_FOOTER_SHARE` for a sheet with no field. */
  footerShare?: number;
  /** `sheet` inside a `Sheet`, which pads for the keyboard itself. */
  host?: KeyboardShellHost;
  /** The frame's own style (its background). */
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** The content scroll view, for a screen that scrolls it itself. */
  scrollRef?: React.Ref<ScrollView>;
  /** Called when the scrolling content changes size. */
  onContentSizeChange?: ScrollViewProps['onContentSizeChange'];
  /** Called with the content's vertical offset as it scrolls. */
  onScrollOffset?: (offset: number) => void;
  /** Content above what is in view changing height (a block collapsing once scrolled past) leaves
   *  what is in view where it is, rather than shifting it. */
  keepsVisibleContent?: boolean;
  children: React.ReactNode;
}

/** A view the shell can measure inside its scroll view: a field, or the block a field names. */
type RevealTarget = React.RefObject<View | TextInput | null>;

/** How a shell's fields tell it which block to keep in view. */
interface RevealRegistry {
  focused: (target: RevealTarget) => void;
  blurred: (target: RevealTarget) => void;
}

const KeyboardShellContext = createContext<RevealRegistry | null>(null);

/** Whether the overlay a field sits in has been presented. An overlay (`Sheet`) provides it as
 *  `false` until its window reports it is shown; a field outside one is always `true`. */
export const OverlayShownContext = createContext(true);

const dismissKeyboard = () => Keyboard.dismiss();
const takesTouch = () => true;

/** The iOS keyboard toolbar's height — no space-token counterpart. */
const DONE_BAR_HEIGHT = 44;

/** Where the view `frame` holds ends, measured from the top of its root (the app's, or a Modal's),
 *  which fills its window wherever a frame pads, just as the keyboard's height is reported from that
 *  window's bottom. `measureInWindow` would not do on Android, which measures from below the status bar. */
function measureBottom(frame: React.RefObject<View | null>, done: (bottom: number) => void): void {
  frame.current?.measure((_x, _y, _width, height, _pageX, pageY) => done(pageY + height));
}

/** Whether the keyboard has settled up, as JS last heard: since its `keyboardDidShow`, until it sets
 *  off to hide (`keyboardWillHide`). The library's `isVisible()` stays true until `keyboardDidHide`
 *  reaches JS, which is after the UI thread has already ended the hide at 0, and its `state()` keeps
 *  the last show's height: a frame mounted in between would pad for a keyboard that has gone. */
let settledUp = false;
/** Called as the keyboard settles up, once `settledUp` says so: frames that saw nothing of it. */
const settleListeners = new Set<() => void>();
KeyboardEvents.addListener('keyboardDidShow', () => {
  settledUp = true;
  for (const listener of [...settleListeners]) listener();
});
for (const gone of ['keyboardWillHide', 'keyboardDidHide'] as const) {
  KeyboardEvents.addListener(gone, () => {
    settledUp = false;
  });
}

/** The height of the keyboard as it rests up, or 0: what a frame that mounts or lays out now pads
 *  for. A keyboard still rising is 0 here, as its own frames pad for it. */
function settledKeyboardHeight(): number {
  return settledUp && KeyboardController.isVisible() ? KeyboardController.state().height : 0;
}

/** What a frame that pads for the keyboard spreads onto the view it measures, and the padding. */
export interface KeyboardOverlap {
  /** The keyboard's overlap with the frame, on the UI thread; 0 when it is down or the frame is inactive. */
  readonly overlap: SharedValue<number>;
  /** The keyboard height the overlap is figured from, active or not: what every frame that pads for
   *  this keyboard pads for, Done bar included, and a keyboard already up as the frame mounted. */
  readonly height: SharedValue<number>;
  /** Spread onto the measured view, whose bottom edge must not move with the padding this feeds. */
  readonly onLayout: () => void;
  /** The overlap a keyboard `keyboardHeight` tall has with the frame; a worklet, so a keyboard frame
   *  on the UI thread can ask it too. */
  readonly overlapFor: (keyboardHeight: number) => number;
}

/**
 * The keyboard's overlap with the view `frame` holds, while `active`, following the keyboard frame
 * by frame (showing, hiding, an interactive drag, and a keyboard that changes height while up). The
 * view is measured on layout and again when the keyboard starts to show, in case an ancestor moved it.
 * `clearBelow` is how far the frame keeps clear of the window's bottom edge, when it is known: a
 * screen on the native stack sits in a `SafeAreaView`, which keeps it above the home indicator, yet
 * `measure` counts the frame from a root laid out far below the window (a pushed screen's frame
 * read 2420 in an 874-high window) and would put its bottom at the window's: the frame was then
 * padded by the home indicator's inset on top of what the keyboard covers.
 */
export function useKeyboardOverlap(frame: React.RefObject<View | null>, active: boolean, clearBelow = 0): KeyboardOverlap {
  const overlap = useSharedValue(0);
  const height = useSharedValue(0);
  const frameBottom = useSharedValue(0);
  const { height: windowHeight } = useKeyboardWindow();
  const windowSize = useSharedValue(windowHeight);
  useEffect(() => {
    windowSize.value = windowHeight;
  }, [windowSize, windowHeight]);
  // iOS: the keyboard's height as the system last reported its frame, since the keyboard last set
  // off (see the frame listener below); 0 until it has, and whenever the keyboard is down.
  const systemHeight = useSharedValue(0);
  /** Measures where the frame ends; `place` then pads it for the keyboard as it rests. */
  const measure = useCallback((place: boolean) => {
    measureBottom(frame, (measured) => {
      const bottom = Math.min(measured, windowSize.value - clearBelow);
      frameBottom.value = bottom;
      const settled = settledKeyboardHeight();
      if (place && active && settled > 0) {
        overlap.value = keyboardOverlap(Math.max(settled, systemHeight.value), bottom, windowSize.value);
      }
    });
  }, [active, clearBelow, frame, frameBottom, overlap, systemHeight, windowSize]);
  const onLayout = useCallback(() => measure(true), [measure]);
  const follow = (event: NativeEvent) => {
    'worklet';
    height.value = event.height;
    overlap.value = active ? keyboardOverlap(event.height, frameBottom.value, windowSize.value) : 0;
  };
  // A keyboard at rest is as tall as the system says, if it has said: see the frame listener below.
  const rest = (event: NativeEvent) => {
    'worklet';
    const resting = event.height > 0 ? Math.max(event.height, systemHeight.value) : 0;
    height.value = resting;
    overlap.value = active ? keyboardOverlap(resting, frameBottom.value, windowSize.value) : 0;
  };
  // A keyboard that changes height at once (iOS's emoji keyboard: a start with no duration, then no
  // frames before its end, which comes some frames later) pads for its new height in the start's own
  // frame. Its padded-for `height` waits for the end, so the reveal still sees where it set off from.
  const setOff = (event: NativeEvent) => {
    'worklet';
    systemHeight.value = 0;
    if (event.duration === 0) overlap.value = active ? keyboardOverlap(event.height, frameBottom.value, windowSize.value) : 0;
  };
  useGenericKeyboardHandler({ onStart: setOff, onMove: follow, onInteractive: follow, onEnd: rest }, [active]);
  // A keyboard already resting up as the frame mounts is padded for (`onLayout`) before any frame of it.
  useEffect(() => {
    const settled = settledKeyboardHeight();
    if (settled > 0) height.value = Math.max(settled, systemHeight.value);
  }, [height, systemHeight]);
  // A frame that mounts after the show has ended on the UI thread, before JS hears `keyboardDidShow`,
  // saw none of its frames and found it not yet settled: it is padded for it as JS hears it settle.
  // Android has nothing later to correct it (iOS has its frame notification, below).
  useEffect(() => {
    const missed = () => {
      const settled = settledKeyboardHeight();
      if (height.value > 0 || settled === 0) return;
      height.value = Math.max(settled, systemHeight.value);
      measure(true);
    };
    settleListeners.add(missed);
    return () => {
      settleListeners.delete(missed);
    };
  }, [height, measure, systemHeight]);
  useEffect(() => {
    if (!active) {
      overlap.value = 0;
      return undefined;
    }
    // Only where the frame ends: the library already reports the keyboard visible at its destination
    // here, before it has moved, and padding for that would cut the frame short a frame ahead of the
    // keyboard. The keyboard's own frames take the padding there.
    const subscription = KeyboardEvents.addListener('keyboardWillShow', () => measure(false));
    return () => subscription.remove();
  }, [active, measure, overlap]);
  // iOS: the first keyboard of a process is reported without the Done bar that attaches to it a moment
  // later. Measured on iOS 27: 328 at `keyboardWillShow`, the library's frames then reach 372 as the bar
  // arrives, and its end report goes back to 328, which a frame that ends there ends under the bar.
  // The system's frame notification (372, 400 ms after the show) is the keyboard as it rests, so the
  // library's end report may not make it shorter than that.
  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const subscription = Keyboard.addListener('keyboardDidChangeFrame', (event) => {
      const shown = Math.max(0, windowSize.value - event.endCoordinates.screenY);
      systemHeight.value = shown;
      height.value = shown;
      if (active) overlap.value = keyboardOverlap(shown, frameBottom.value, windowSize.value);
    });
    return () => subscription.remove();
  }, [active, frameBottom, height, overlap, systemHeight, windowSize]);
  const overlapFor = useCallback(
    (keyboardHeight: number) => {
      'worklet';
      return active ? keyboardOverlap(keyboardHeight, frameBottom.value, windowSize.value) : 0;
    },
    [active, frameBottom, windowSize],
  );
  return { overlap, height, onLayout, overlapFor };
}

/**
 * The keyboard's overlap with the view `frame` holds, while `active`, as React state that changes
 * once the keyboard has settled (shown, hidden, or a new height while up); 0 when it is down or
 * `active` is false. For a frame whose padding should not follow the keyboard frame by frame (a
 * mini-app's WebView, which would lay its page out again on every frame). The view's bottom edge
 * must not move with the padding this feeds.
 */
export function useKeyboardInset(frame: React.RefObject<View | null>, active: boolean): number {
  const [inset, setInset] = useState(0);
  const { height: windowHeight } = useKeyboardWindow();
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    const place = (keyboardHeight: number) => {
      measureBottom(frame, (bottom) => {
        if (live) setInset(keyboardOverlap(keyboardHeight, bottom, windowHeight));
      });
    };
    if (KeyboardController.isVisible()) place(KeyboardController.state().height);
    const subscriptions = [
      KeyboardEvents.addListener('keyboardDidShow', (event) => place(event.height)),
      KeyboardEvents.addListener('keyboardDidHide', () => setInset(0)),
    ];
    return () => {
      live = false;
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [active, frame, windowHeight]);
  return active ? inset : 0;
}

/** Hands `node` to a ref the caller passed in, whichever kind it is. */
function assignRef<T>(ref: React.Ref<T> | undefined, node: T | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
}

/** The focused block's place in the scroll content, for the UI thread. */
interface BlockSpan {
  readonly top: number;
  readonly bottom: number;
}

/** A keyboard setting off: whether the focused block follows it; the scroll view's height, offset
 *  and shrink (`shrinkAt`) as it set off, and the shrink it is heading to; and how far the block sat
 *  below where it is kept as it set off (`hiddenAtRest`), -1 until the block is known. */
interface Rise {
  readonly following: boolean;
  readonly viewport: number;
  readonly offset: number;
  readonly shrink: number;
  readonly end: number;
  readonly hidden: number;
}

/** What `useEvent` hands back, for a handler registered on a view by its tag: the scroll view is a
 *  plain one, so its native events reach the UI thread this way rather than through a prop. */
interface NativeEventHandler {
  readonly workletEventHandler: {
    registerForEvents: (tag: number) => void;
    unregisterFromEvents: (tag: number) => void;
  };
}

/** The scroll view's wiring: its metrics, whether content continues below, and revealing the focused
 *  block. `shrinkAt` is a worklet: how much of its height the scroll view has lost to a keyboard of a
 *  given height (on a screen, the frame's own padding; in a sheet, the card's growth). `keyboardHeight`
 *  is the height that padding is figured from now (`KeyboardOverlap.height`): a keyboard changing
 *  height starts from what is padded, not from what the library last reported. */
function useRevealingScroll(
  scrollRef: React.Ref<ScrollView> | undefined,
  onContentSizeChange: ScrollViewProps['onContentSizeChange'],
  onScrollOffset: ((offset: number) => void) | undefined,
  shrinkAt: (keyboardHeight: number) => number,
  keyboardHeight: SharedValue<number>,
) {
  const scroll = useRef<ScrollView | null>(null);
  const scrollOnUI = useAnimatedRef<ScrollView>();
  const inner = useRef<View>(null);
  const metrics = useRef<ScrollMetrics>({ offset: 0, viewport: 0, content: 0 });
  const focusedTarget = useRef<RevealTarget | null>(null);
  const [below, setBelow] = useState(false);
  const pendingReveal = useRef<number | null>(null);
  const revealVersion = useRef(0);
  const keyboardMoving = useRef(false);
  // The UI thread's copy: the scroll view's metrics as JS last heard them (its offset as its native
  // scroll events report it), the focused block, the rise in progress, and whether the person
  // dragged the content while the keyboard rose.
  const shown = useSharedValue<ScrollMetrics>({ offset: 0, viewport: 0, content: 0 });
  const offset = useSharedValue(0);
  const block = useSharedValue<BlockSpan | null>(null);
  const rise = useSharedValue<Rise>({ following: false, viewport: 0, offset: 0, shrink: 0, end: 0, hidden: -1 });
  const dragged = useSharedValue(false);

  const cancelReveal = useCallback(() => {
    revealVersion.current += 1;
    if (pendingReveal.current != null) cancelAnimationFrame(pendingReveal.current);
    pendingReveal.current = null;
  }, []);

  const settle = useCallback((next: Partial<ScrollMetrics>) => {
    metrics.current = { ...metrics.current, ...next };
    shown.value = metrics.current;
    setBelow(contentBelow(metrics.current));
  }, [shown]);

  /** Measures the focused block in the content and hands it to the UI thread; `then` gets it. */
  const place = useCallback((then?: (top: number, bottom: number) => void) => {
    const target = focusedTarget.current?.current;
    const content = inner.current;
    if (!target || !content) return;
    target.measureLayout(
      content,
      (_x, top, _width, height) => {
        if (focusedTarget.current?.current !== target) return;
        block.value = { top, bottom: top + height };
        then?.(top, top + height);
      },
      () => {},
    );
  }, [block]);

  /** On the next frame, scrolls the focused block into view of the scroll view as it is. */
  const reveal = useCallback(() => {
    cancelReveal();
    if (!focusedTarget.current) return;
    const version = revealVersion.current;
    // onLayout reports Yoga's destination while the native scroll view can still have its old
    // bounds. Measuring on the next frame lets that commit land before UIKit clamps scrollTo.
    pendingReveal.current = requestAnimationFrame(() => {
      pendingReveal.current = null;
      place((top, bottom) => {
        const { content, viewport, offset: at } = metrics.current;
        // Not before the content's size is known (`onContentSizeChange` reveals again), and never
        // past its end: a screen's scroll view does not clamp a scroll (below). One already past
        // it is pulled back.
        if (version !== revealVersion.current || content === 0) return;
        const end = Math.max(0, content - viewport);
        const next = Math.min(revealOffset(metrics.current, top, bottom, REVEAL_MARGIN) ?? at, end);
        if (Math.abs(next - at) > 0.5) scroll.current?.scrollTo({ y: next, animated: true });
      });
    });
  }, [cancelReveal, place]);

  // While the keyboard rises, the block follows it on the UI thread, in the keyboard's own frames:
  // each frame pads the frame (or the sheet's card) for the keyboard, which shrinks the scroll view
  // by `shrinkAt`, and in that same frame the block is scrolled up to where that shorter scroll view
  // keeps it, so it is never under the keyboard on the way up. JS plays no part in it: on iOS the
  // field's focus reaches JS only after the keyboard has set off. A drag stops it (`dragged`).
  useGenericKeyboardHandler(
    {
      onStart: (event) => {
        'worklet';
        const rising = event.height > keyboardHeight.value;
        const set = {
          following: rising,
          viewport: shown.value.viewport,
          offset: offset.value,
          shrink: shrinkAt(keyboardHeight.value),
          end: shrinkAt(event.height),
          hidden: -1,
        };
        rise.value = set;
        if (rising) dragged.value = false;
        // A keyboard that grows at once (no duration: no frames will come) leaves the scroll view its
        // end's height in this very frame, as its padding does: the block is kept clear of that now.
        const at = block.value;
        if (!rising || event.duration !== 0 || at == null) return;
        const frame = { offset: offset.value, viewport: set.viewport - (set.end - set.shrink), content: shown.value.content };
        const next = followOffset(frame, at.top, at.bottom, REVEAL_MARGIN);
        if (next != null) scrollTo(scrollOnUI, 0, next, false);
        rise.value = { ...set, following: false };
      },
      onMove: (event) => {
        'worklet';
        const set = rise.value;
        const at = block.value;
        if (!set.following || at == null) return;
        let hidden = set.hidden;
        if (hidden < 0) {
          hidden = hiddenAtRest(set, at.top, at.bottom, REVEAL_MARGIN);
          rise.value = { ...set, hidden };
        }
        const now = shrinkAt(event.height);
        const frame = { offset: offset.value, viewport: set.viewport - (now - set.shrink), content: shown.value.content };
        const left = hidden * (1 - riseProgress(set.shrink, set.end, now));
        const next = followOffset(frame, at.top, at.bottom, REVEAL_MARGIN, left);
        if (next != null) scrollTo(scrollOnUI, 0, next, false);
      },
      onEnd: () => {
        'worklet';
        rise.value = { ...rise.value, following: false };
      },
    },
    [shrinkAt, keyboardHeight],
  );

  // The scroll view's native scroll events, on the UI thread as they happen: where it stands, and a
  // drag while the keyboard rises, which is the person's own scroll: nothing scrolls it back.
  const nativeScroll = useEvent<NativeScrollEvent>(
    (event) => {
      'worklet';
      offset.value = event.contentOffset.y;
      if (event.eventName.endsWith('onScrollBeginDrag') && rise.value.following) {
        rise.value = { ...rise.value, following: false };
        dragged.value = true;
      }
    },
    ['onScroll', 'onScrollBeginDrag'],
  ) as unknown as NativeEventHandler;
  useEffect(
    () =>
      scrollOnUI.observe((tag) => {
        if (tag == null) return undefined;
        nativeScroll.workletEventHandler.registerForEvents(tag);
        return () => nativeScroll.workletEventHandler.unregisterFromEvents(tag);
      }),
    [nativeScroll, scrollOnUI],
  );

  useEffect(() => {
    // While the keyboard moves, the UI thread keeps the block in view (above); JS rechecks once it
    // has settled: `keyboardDidShow`, also sent for a new height while up, unless a drag took over.
    const subscriptions = [
      KeyboardEvents.addListener('keyboardWillShow', () => {
        keyboardMoving.current = true;
        cancelReveal();
      }),
      KeyboardEvents.addListener('keyboardWillHide', () => {
        keyboardMoving.current = true;
        cancelReveal();
      }),
      KeyboardEvents.addListener('keyboardDidShow', () => {
        keyboardMoving.current = false;
        if (!dragged.value) reveal();
      }),
      KeyboardEvents.addListener('keyboardDidHide', () => { keyboardMoving.current = false; }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
      cancelReveal();
      focusedTarget.current = null;
      block.value = null;
    };
  }, [block, cancelReveal, dragged, reveal]);

  /** The focused block is new, or changed place or size: the UI thread learns it at once, to follow
   *  it while the keyboard rises; JS reveals it otherwise. */
  const refresh = useCallback(() => {
    place();
    if (!keyboardMoving.current) reveal();
  }, [place, reveal]);

  const registry = useMemo<RevealRegistry>(
    () => ({
      focused: (target) => {
        focusedTarget.current = target;
        refresh();
      },
      blurred: (target) => {
        if (focusedTarget.current === target) {
          focusedTarget.current = null;
          block.value = null;
          cancelReveal();
        }
      },
    }),
    [block, cancelReveal, refresh],
  );

  const setScroll = useCallback(
    (node: ScrollView | null) => {
      scroll.current = node;
      scrollOnUI(node);
      assignRef(scrollRef, node);
    },
    [scrollOnUI, scrollRef],
  );

  const scrollProps = {
    ref: setScroll,
    // RN types this prop as never-null; React 19's `useRef(null)` is nullable until mounted.
    innerViewRef: inner as React.RefObject<View>,
    scrollEventThrottle: 16,
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      settle({ offset: event.nativeEvent.contentOffset.y });
      onScrollOffset?.(event.nativeEvent.contentOffset.y);
    },
    onLayout: (event: LayoutChangeEvent) => {
      const viewport = event.nativeEvent.layout.height;
      const resized = viewport !== metrics.current.viewport;
      settle({ viewport });
      if (resized && !keyboardMoving.current) reveal();
    },
    onContentSizeChange: (width: number, height: number) => {
      settle({ content: height });
      refresh();
      onContentSizeChange?.(width, height);
    },
  };
  return { scrollProps, below, registry };
}

/** The scroll view's anchor for `keepsVisibleContent`: the first block in view, from the first block on. */
const VISIBLE_ANCHOR = { minIndexForVisible: 0 } as const;

/** The hairline above the footer, drawn only while content continues below it; always laid out, so
 *  showing it never shifts anything. */
function EdgeLine({ shown }: Readonly<{ shown: boolean }>) {
  const t = useTokens();
  return <View style={[styles.edge, shown && { backgroundColor: t.colors.separator }]} />;
}

/** Content scrolling under a sheet's header fades out over this much, from the sheet's own colour
 *  (system.md §6). */
const TOP_FADE_HEIGHT = SPACE[4];

/** The soft edge under a sheet's header: the `sheet` colour fading to clear, drawn over the content
 *  as far as `opacity` says (nothing at rest) and never taking a touch. */
function SheetTopFade({ opacity }: Readonly<{ opacity: SharedValue<number> }>) {
  const t = useTokens();
  const shown = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.topFade, shown]}>
      <Svg width="100%" height={TOP_FADE_HEIGHT}>
        <Defs>
          <LinearGradient id="sheet-top-fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.colors.sheet} stopOpacity={1} />
            <Stop offset="1" stopColor={t.colors.sheet} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={TOP_FADE_HEIGHT} fill="url(#sheet-top-fade)" />
      </Svg>
    </Animated.View>
  );
}

/** The footer's wrapper: a screen spaces it from the scroll view; a sheet's own actions space
 *  themselves; one that scrolls with the content runs edge to edge, undoing the content's side
 *  padding that its actions carry again. */
function footerStyleFor(joinsScroll: boolean, inSheet: boolean, contentContainerStyle: StyleProp<ViewStyle>): StyleProp<ViewStyle> {
  if (joinsScroll) {
    const inset = StyleSheet.flatten(contentContainerStyle)?.paddingHorizontal;
    return { marginHorizontal: typeof inset === 'number' ? -inset : 0 };
  }
  return inSheet ? undefined : styles.footer;
}

export default function KeyboardShell({
  footer,
  footerShare = FOOTER_SHARE,
  host = 'screen',
  style,
  contentContainerStyle,
  scrollRef,
  onContentSizeChange,
  onScrollOffset,
  keepsVisibleContent = false,
  children,
}: Readonly<KeyboardShellProps>) {
  const inSheet = host === 'sheet';
  const frameRef = useRef<View>(null);
  // iOS screens sit above the home indicator (`NativeStack`'s `SafeAreaView`); Android's frame
  // measures true and is left to its own measure.
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { overlap, height: paddedFor, onLayout, overlapFor } = useKeyboardOverlap(frameRef, !inSheet, Platform.OS === 'ios' ? safeBottom : 0);
  const padding = useAnimatedStyle(() => ({ paddingBottom: overlap.value }));
  // What a keyboard takes from the scroll view: on a screen, the frame's padding; in a sheet, the
  // card's (`Sheet`), all of which a large sheet's body gives up. In a sheet this
  // frame pads nothing, yet `paddedFor` tracks the keyboard as the card's padding does.
  const shrinkAt = useCallback(
    (keyboardHeight: number) => {
      'worklet';
      return inSheet ? sheetBottomPadding(keyboardHeight, safeBottom) : overlapFor(keyboardHeight);
    },
    [inSheet, overlapFor, safeBottom],
  );
  const topFade = useSharedValue(0);
  const trackOffset = useCallback(
    (offset: number) => {
      topFade.value = topFadeOpacity(offset, TOP_FADE_HEIGHT);
      onScrollOffset?.(offset);
    },
    [onScrollOffset, topFade],
  );
  const { scrollProps, below, registry } = useRevealingScroll(scrollRef, onContentSizeChange, trackOffset, shrinkAt, paddedFor);
  // A sheet's footer that has grown past its share of the window (large text) scrolls with the
  // content, so the content keeps room of its own and the footer's actions stay reachable.
  const { height: windowHeight } = useKeyboardWindow();
  const [footerHeight, setFooterHeight] = useState(0);
  const joinsScroll = inSheet && footerJoinsScroll(footerHeight, windowHeight, footerShare);
  const pinned = pinsFooter(footer);
  const footerStyle = footerStyleFor(joinsScroll, inSheet, contentContainerStyle);
  const footerView = pinned ? (
    <View onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)} style={footerStyle}>
      {footer}
    </View>
  ) : null;
  // iOS clamps a scroll to the bounds the scroll view has when the scroll runs, and a keyboard frame's
  // scroll runs before that frame's padding has shrunk it: the block would trail the keyboard by a
  // frame's travel. A screen knows the height every frame leaves it, and every scroll it issues stops
  // at the content's end itself, so its scroll view is told not to clamp. A sheet's card pads outside
  // it, so it keeps the clamp.
  const scroller = (
    <ScrollView
      {...scrollProps}
      scrollToOverflowEnabled={!inSheet}
      contentContainerStyle={contentContainerStyle}
      keyboardDismissMode={keyboardDismissMode(Platform.OS)}
      keyboardShouldPersistTaps="handled"
      maintainVisibleContentPosition={keepsVisibleContent ? VISIBLE_ANCHOR : undefined}
    >
      {children}
      {joinsScroll ? footerView : null}
    </ScrollView>
  );
  // No view around the scroll view answers a touch: iOS does not scroll while a view around the
  // scroll view holds the touch (`RCTScrollViewComponentView` will not take a drag from an ancestor
  // that is the JS responder), so a drag that started on plain content moved nothing. Inside the
  // scroll view, a tap on empty space with the keyboard up is the scroll view's own
  // (`keyboardShouldPersistTaps="handled"` blurs the field); only the pinned footer, outside it, takes
  // a touch on its own empty space, and its actions, deeper, take theirs first.
  const frame = (
    <KeyboardShellContext.Provider value={registry}>
      <View style={inSheet ? [styles.grow, style] : styles.fill}>
        {inSheet ? (
          <View style={styles.grow}>
            {scroller}
            <SheetTopFade opacity={topFade} />
          </View>
        ) : (
          scroller
        )}
        {pinned && !joinsScroll && (
          <View onStartShouldSetResponder={takesTouch} onResponderRelease={dismissKeyboard}>
            <EdgeLine shown={below} />
            {footerView}
          </View>
        )}
      </View>
    </KeyboardShellContext.Provider>
  );
  if (inSheet) return frame;
  return (
    <View ref={frameRef} collapsable={false} onLayout={onLayout} style={[styles.fill, style]}>
      <Animated.View style={[styles.fill, padding]}>{frame}</Animated.View>
    </View>
  );
}

/** How many frames an Android field asks for the keyboard before it gives up: about two seconds at
 *  60 Hz, which only a window that is never served (a hardware keyboard that keeps the soft one away)
 *  outlasts. */
const KEYBOARD_ASK_FRAMES = 120;

/**
 * Android: focuses `input` and asks for its keyboard once a frame until the keyboard sets off. A
 * request is dropped (the field takes focus, with its caret and ring, and no keyboard comes) while
 * the window the field sits in is not yet served by the keyboard, which is after the window's report
 * that it is shown: measured, the first request, 80 to 300 ms after the report, was ignored ("view is
 * not served") or aborted by the system after layout. Nothing reports the moment the window is served,
 * and `focus()` of a field that is already focused does nothing, so the field has the keyboard library
 * request it again, frame by frame, until `keyboardWillShow` says it did. It stops when the field
 * loses focus, and at once if the keyboard is already up. Returns the stop.
 */
function askForKeyboard(input: React.RefObject<TextInput | null>, blurred: { current: boolean }): () => void {
  blurred.current = false;
  input.current?.focus();
  if (KeyboardController.isVisible()) return () => {};
  let frames = KEYBOARD_ASK_FRAMES;
  let pending = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(pending);
    subscription.remove();
  };
  const subscription = KeyboardEvents.addListener('keyboardWillShow', stop);
  const ask = () => {
    frames -= 1;
    if (blurred.current || frames < 0) {
      stop();
      return;
    }
    KeyboardController.setFocusTo('current');
    if (!stopped) pending = requestAnimationFrame(ask);
  };
  pending = requestAnimationFrame(ask);
  return stop;
}

export interface KeyboardTextInputProps extends TextInputProps {
  /** The block to keep in view while this field is focused (a plan row with its Save and Cancel);
   *  the field itself when left out. */
  revealTarget?: React.RefObject<View | null>;
}

/**
 * A text field for a `KeyboardShell`: an `ink` caret and selection handles, a highlight its selected
 * text stays readable on (`fieldSelection`), and the shell keeps it in view while it is focused.
 * `autoFocus` focuses it once it has mounted rather than natively: iOS links a Done bar to its field
 * when the bar mounts, and a field that took focus before that shows none. Multiline on iOS, it
 * carries the keyboard's Done bar, which puts the keyboard away and submits nothing; one line on iOS,
 * it sets no line height, which iOS would draw its text below, clipping the descenders.
 */
export function KeyboardTextInput({
  revealTarget,
  autoFocus,
  onFocus,
  onBlur,
  style,
  ...props
}: Readonly<KeyboardTextInputProps>) {
  const tokens = useTokens();
  const input = useRef<TextInput>(null);
  const shell = useContext(KeyboardShellContext);
  const doneBarId = useId();
  const target = revealTarget ?? input;
  const autoFocusOnMount = useRef(autoFocus === true);
  const overlayShown = useContext(OverlayShownContext) || Platform.OS !== 'android';
  // The field lost focus after it asked for the keyboard (the person put it away): it stops asking.
  const blurred = useRef(false);
  useEffect(() => {
    if (!autoFocusOnMount.current) return undefined;
    // iOS: a frame after mounting, once the Done bar has linked to the field, so the keyboard comes
    // up with the bar already on it (focused in the mount frame, it intermittently arrived without
    // the bar in its reported frame, leaving the footer under the bar). Android: see `askForKeyboard`.
    // In an overlay, the first request waits for the overlay's own report that it is on screen.
    if (!overlayShown) return undefined;
    if (Platform.OS === 'android') return askForKeyboard(input, blurred);
    const later = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(later);
  }, [overlayShown]);
  const doneBar = showsDoneBar(Platform.OS, props.multiline);
  const field = (
    <TextInput
      {...fieldSelection(tokens, props.multiline === true)}
      {...props}
      ref={input}
      style={[style, Platform.OS === 'ios' && props.multiline !== true && styles.naturalLineHeight]}
      onFocus={(event) => {
        shell?.focused(target);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        blurred.current = true;
        shell?.blurred(target);
        onBlur?.(event);
      }}
      inputAccessoryViewID={doneBar ? doneBarId : props.inputAccessoryViewID}
    />
  );
  if (!doneBar) return field;
  return (
    <>
      {field}
      <DoneBar nativeID={doneBarId} />
    </>
  );
}

/** How far the Done bar's label grows with the text size: the bar is the keyboard's, whose own keys
 *  don't grow with it, and a label at 200% outgrew the bar. */
const DONE_LABEL_MAX_SCALE = 1.3;

/** The iOS keyboard's Done bar: a `surface` strip over the keyboard, in the scheme the shell is in,
 *  with a `separator` hairline and Done in `text`. */
function DoneBar({ nativeID }: Readonly<{ nativeID: string }>) {
  const t = useTokens();
  return (
    <InputAccessoryView nativeID={nativeID} backgroundColor={t.colors.surface}>
      <View style={[styles.doneBar, { borderTopColor: t.colors.separator }]}>
        <TouchableOpacity onPress={dismissKeyboard} accessibilityRole="button" hitSlop={10}>
          <Text style={[styles.doneLabel, { color: t.colors.text }]} maxFontSizeMultiplier={DONE_LABEL_MAX_SCALE}>
            {COPY.keyboardDone}
          </Text>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // A sheet's frame fills the body it sits in (a large sheet has a height of its own, so the footer
  // sits at its bottom) and gives way to a sheet that is capped by its content.
  grow: { flexGrow: 1, flexShrink: 1 },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, height: TOP_FADE_HEIGHT },
  edge: { height: StyleSheet.hairlineWidth },
  // A screen's gap between the scrolling content's cut edge and its pinned action (system.md §2.8
  // Bottom action area). A sheet spaces its own actions (`ReportPage`'s actions pad themselves).
  footer: { paddingTop: LAYOUT.actionAreaTop },
  naturalLineHeight: { lineHeight: undefined },
  doneBar: {
    height: DONE_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: SPACE[4],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  doneLabel: wrappingType('headline'),
});
