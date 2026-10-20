/**
 * KeyboardShell — the one keyboard-safe frame every launcher screen or sheet with a text field
 * renders (beta-1 D3; app-launcher "Text input never hides the content or action it belongs to";
 * design-system-v1 task 11.3). The keyboard is tracked by `react-native-keyboard-controller`; the
 * decisions live in `keyboard-shell.ts`.
 *
 * The scrolling content, and a pinned `footer` for the primary action. On a
 * screen the frame pads its bottom by the keyboard's overlap with it, frame by frame on the UI
 * thread as the keyboard moves, so the footer rides above the keyboard on its own curve and the
 * scroll view ends above the footer; inside a sheet the host (`SheetModal`, `Sheet`) pads.
 * While a field in the scroll view is focused, any change to what the scroll view shows (the
 * keyboard arriving or changing height, the field growing) scrolls the field, or the block it
 * names, back into view, `REVEAL_MARGIN` clear of the keyboard and the footer; while the keyboard
 * rises, it does so frame by frame, so the field rises with it, and a drag stops it.
 * A hairline above the footer shows while content continues below. In a sheet the frame fills the
 * body it sits in, so the footer sits at the bottom of a large sheet whatever the content; a footer that has outgrown its share of the
 * window (`FOOTER_SHARE`, the largest text sizes) scrolls with the content instead; and content
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
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import {
  KeyboardController,
  KeyboardEvents,
  useGenericKeyboardHandler,
  useWindowDimensions as useKeyboardWindow,
  type NativeEvent,
} from 'react-native-keyboard-controller';
import { SPACE } from '../../design/tokens';
import { SPACING, TYPE_SCALE } from '../../sdk/theme';
import { useTokens } from '../ui/tokens';
import { COPY } from './copy';
import {
  contentBelow,
  footerJoinsScroll,
  keyboardDismissMode,
  keyboardOverlap,
  pinsFooter,
  REVEAL_MARGIN,
  revealOffset,
  selectionColors,
  showsDoneBar,
  topFadeOpacity,
  type KeyboardShellHost,
  type ScrollMetrics,
} from './keyboard-shell';
import { SHELL_PALETTE } from './theme';

export interface KeyboardShellProps {
  /** Pinned below the scrolling content and kept above the keyboard: the primary action and what
   *  sits with it. Leave it out on a screen with no primary action. */
  footer?: React.ReactNode;
  /** `sheet` inside `SheetModal` or `Sheet`, which pads for the keyboard itself. */
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
  children: React.ReactNode;
}

/** How many frames the focused block follows a rising keyboard at most: a keyboard settles in well
 *  under a second, and `keyboardDidShow` ends it first; this only bounds one that never reports. */
const FOLLOW_FRAMES = 90;

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

/** The iOS keyboard toolbar's height — no SPACING counterpart. */
const DONE_BAR_HEIGHT = 44;

/** Where the view `frame` holds ends, measured from the top of its root (the app's, or a Modal's),
 *  which fills its window wherever a frame pads, just as the keyboard's height is reported from that
 *  window's bottom. `measureInWindow` would not do on Android, which measures from below the status bar. */
function measureBottom(frame: React.RefObject<View | null>, done: (bottom: number) => void): void {
  frame.current?.measure((_x, _y, _width, height, _pageX, pageY) => done(pageY + height));
}

/** What a frame that pads for the keyboard spreads onto the view it measures, and the padding. */
export interface KeyboardOverlap {
  /** The keyboard's overlap with the frame, on the UI thread; 0 when it is down or the frame is inactive. */
  readonly overlap: SharedValue<number>;
  /** Spread onto the measured view, whose bottom edge must not move with the padding this feeds. */
  readonly onLayout: () => void;
  /** The overlap a keyboard `keyboardHeight` tall will have with the frame, for planning ahead. */
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
      if (place && active && KeyboardController.isVisible()) {
        overlap.value = keyboardOverlap(Math.max(KeyboardController.state().height, systemHeight.value), bottom, windowSize.value);
      }
    });
  }, [active, clearBelow, frame, frameBottom, overlap, systemHeight, windowSize]);
  const onLayout = useCallback(() => measure(true), [measure]);
  const follow = (event: NativeEvent) => {
    'worklet';
    overlap.value = active ? keyboardOverlap(event.height, frameBottom.value, windowSize.value) : 0;
  };
  // A keyboard at rest is as tall as the system says, if it has said: see the frame listener below.
  const rest = (event: NativeEvent) => {
    'worklet';
    const resting = event.height > 0 ? Math.max(event.height, systemHeight.value) : 0;
    overlap.value = active ? keyboardOverlap(resting, frameBottom.value, windowSize.value) : 0;
  };
  const setOff = () => {
    'worklet';
    systemHeight.value = 0;
  };
  useGenericKeyboardHandler({ onStart: setOff, onMove: follow, onInteractive: follow, onEnd: rest }, [active]);
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
    if (!active || Platform.OS !== 'ios') return undefined;
    const subscription = Keyboard.addListener('keyboardDidChangeFrame', (event) => {
      const shown = Math.max(0, windowSize.value - event.endCoordinates.screenY);
      systemHeight.value = shown;
      overlap.value = keyboardOverlap(shown, frameBottom.value, windowSize.value);
    });
    return () => subscription.remove();
  }, [active, frameBottom, overlap, systemHeight, windowSize]);
  const overlapFor = useCallback(
    (keyboardHeight: number) => (active ? keyboardOverlap(keyboardHeight, frameBottom.value, windowSize.value) : 0),
    [active, frameBottom, windowSize],
  );
  return { overlap, onLayout, overlapFor };
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

/** The scroll view's wiring: its metrics, whether content continues below, and revealing the focused block.
 *  `shrinkFor` says how much the scroll view will lose to a keyboard of a given height, when the
 *  frame knows (a screen does; a sheet's host pads outside it). */
function useRevealingScroll(
  scrollRef: React.Ref<ScrollView> | undefined,
  onContentSizeChange: ScrollViewProps['onContentSizeChange'],
  onScrollOffset: ((offset: number) => void) | undefined,
  shrinkFor?: (keyboardHeight: number) => number,
) {
  const scroll = useRef<ScrollView | null>(null);
  const inner = useRef<View>(null);
  const metrics = useRef<ScrollMetrics>({ offset: 0, viewport: 0, content: 0 });
  const focusedTarget = useRef<RevealTarget | null>(null);
  const [below, setBelow] = useState(false);
  const pendingReveal = useRef<number | null>(null);
  const revealVersion = useRef(0);
  const keyboardMoving = useRef(false);
  // While the keyboard rises: the frames left to follow it (0 when not following), and the height
  // the scroll view is heading to, when the frame knows it.
  const followFrames = useRef(0);
  const heading = useRef<number | undefined>(undefined);
  // The person dragged the content while the keyboard rose: nothing scrolls it back until it next
  // sets off.
  const dragged = useRef(false);

  const cancelReveal = useCallback(() => {
    revealVersion.current += 1;
    followFrames.current = 0;
    if (pendingReveal.current != null) cancelAnimationFrame(pendingReveal.current);
    pendingReveal.current = null;
  }, []);

  const settle = useCallback((next: Partial<ScrollMetrics>) => {
    metrics.current = { ...metrics.current, ...next };
    setBelow(contentBelow(metrics.current));
  }, []);

  /** On the next frame, scrolls the focused block into view: of the scroll view as it is, or as tall
   *  as it will be (`viewport`). `animated` false jumps there, for a scroll that follows the
   *  keyboard frame by frame. `then` runs once the frame's measurement is done. */
  const reveal = useCallback((viewport?: number, animated = true, then?: () => void) => {
    cancelReveal();
    if (!focusedTarget.current) return;
    const version = revealVersion.current;
    // onLayout reports Yoga's destination while the native scroll view can still have its old
    // bounds. Measuring on the next frame lets that commit land before UIKit clamps scrollTo.
    pendingReveal.current = requestAnimationFrame(() => {
      pendingReveal.current = null;
      const target = focusedTarget.current?.current;
      const content = inner.current;
      if (!target || !content) return;
      target.measureLayout(
        content,
        (_x, top, _width, height) => {
          if (version !== revealVersion.current || focusedTarget.current?.current !== target) return;
          const shown = viewport === undefined ? metrics.current : { ...metrics.current, viewport };
          const next = revealOffset(shown, top, top + height, REVEAL_MARGIN);
          if (next != null) scroll.current?.scrollTo({ y: next, animated });
          then?.();
        },
        () => {},
      );
    });
  }, [cancelReveal]);

  /** One frame of following the rising keyboard: a scroll if the block is still below where it is
   *  kept, then the next frame, until the keyboard settles or the frames run out. */
  const follow = useCallback(() => {
    const left = followFrames.current;
    if (left <= 0) return;
    reveal(heading.current, false, () => {
      followFrames.current = left - 1;
      follow();
    });
    followFrames.current = left;
  }, [reveal]);

  useEffect(() => {
    // The frame's padding follows the keyboard frame by frame, and the native scroll view shrinks
    // with it: it cannot scroll further than its bounds allow at that moment. So from the moment the
    // keyboard sets off until it has settled, the focused block is scrolled toward where it will be
    // kept once a frame, and each frame the bounds have grown it gets that much further: it rises
    // with the keyboard instead of waiting under it. On a screen the target is the height the
    // scroll view is heading to; in a sheet, whose host pads outside it, the height it has now.
    // A drag stops it, and `keyboardDidShow` (also sent for a new height while up) rechecks once.
    const subscriptions = [
      KeyboardEvents.addListener('keyboardWillShow', (event) => {
        keyboardMoving.current = true;
        dragged.current = false;
        const shrink = shrinkFor?.(event.height) ?? 0;
        heading.current = shrink === 0 ? undefined : metrics.current.viewport - shrink;
        followFrames.current = FOLLOW_FRAMES;
        follow();
      }),
      KeyboardEvents.addListener('keyboardWillHide', () => {
        keyboardMoving.current = true;
        cancelReveal();
      }),
      KeyboardEvents.addListener('keyboardDidShow', () => {
        keyboardMoving.current = false;
        if (dragged.current) cancelReveal();
        else reveal();
      }),
      KeyboardEvents.addListener('keyboardDidHide', () => { keyboardMoving.current = false; }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
      cancelReveal();
      focusedTarget.current = null;
    };
  }, [cancelReveal, follow, reveal, shrinkFor]);

  const registry = useMemo<RevealRegistry>(
    () => ({
      focused: (target) => {
        focusedTarget.current = target;
        reveal();
      },
      blurred: (target) => {
        if (focusedTarget.current === target) {
          focusedTarget.current = null;
          cancelReveal();
        }
      },
    }),
    [cancelReveal, reveal],
  );

  const setScroll = useCallback(
    (node: ScrollView | null) => {
      scroll.current = node;
      assignRef(scrollRef, node);
    },
    [scrollRef],
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
    // A drag while the keyboard rises is the person's own scroll: nothing scrolls it back.
    onScrollBeginDrag: () => {
      if (!keyboardMoving.current) return;
      dragged.current = true;
      cancelReveal();
    },
    onLayout: (event: LayoutChangeEvent) => {
      const viewport = event.nativeEvent.layout.height;
      const resized = viewport !== metrics.current.viewport;
      settle({ viewport });
      if (resized && !keyboardMoving.current) reveal();
    },
    onContentSizeChange: (width: number, height: number) => {
      settle({ content: height });
      reveal();
      onContentSizeChange?.(width, height);
    },
  };
  return { scrollProps, below, registry };
}

/** The hairline above the footer, drawn only while content continues below it; always laid out, so
 *  showing it never shifts anything. */
function EdgeLine({ shown }: Readonly<{ shown: boolean }>) {
  return <View style={[styles.edge, shown && { backgroundColor: SHELL_PALETTE.cardBorder }]} />;
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
  host = 'screen',
  style,
  contentContainerStyle,
  scrollRef,
  onContentSizeChange,
  onScrollOffset,
  children,
}: Readonly<KeyboardShellProps>) {
  const inSheet = host === 'sheet';
  const frameRef = useRef<View>(null);
  // iOS screens sit above the home indicator (`NativeStack`'s `SafeAreaView`); Android's frame
  // measures true and is left to its own measure.
  const { bottom: safeBottom } = useSafeAreaInsets();
  const { overlap, onLayout, overlapFor } = useKeyboardOverlap(frameRef, !inSheet, Platform.OS === 'ios' ? safeBottom : 0);
  const padding = useAnimatedStyle(() => ({ paddingBottom: overlap.value }));
  const shrinkFor = useCallback((keyboardHeight: number) => overlapFor(keyboardHeight) - overlap.value, [overlap, overlapFor]);
  const topFade = useSharedValue(0);
  const trackOffset = useCallback(
    (offset: number) => {
      topFade.value = topFadeOpacity(offset, TOP_FADE_HEIGHT);
      onScrollOffset?.(offset);
    },
    [onScrollOffset, topFade],
  );
  const { scrollProps, below, registry } = useRevealingScroll(scrollRef, onContentSizeChange, trackOffset, inSheet ? undefined : shrinkFor);
  // A sheet's footer that has grown past its share of the window (large text) scrolls with the
  // content, so the content keeps room of its own and the footer's actions stay reachable.
  const { height: windowHeight } = useKeyboardWindow();
  const [footerHeight, setFooterHeight] = useState(0);
  const joinsScroll = inSheet && footerJoinsScroll(footerHeight, windowHeight);
  const pinned = pinsFooter(footer);
  const footerStyle = footerStyleFor(joinsScroll, inSheet, contentContainerStyle);
  const footerView = pinned ? (
    <View onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)} style={footerStyle}>
      {footer}
    </View>
  ) : null;
  const scroller = (
    <ScrollView
      {...scrollProps}
      contentContainerStyle={contentContainerStyle}
      keyboardDismissMode={keyboardDismissMode(Platform.OS)}
      keyboardShouldPersistTaps="handled"
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
 * A text field for a `KeyboardShell`: Whim's accent for its caret and selection handles, a highlight
 * its selected text stays readable on (`selectionColors`), and the shell keeps it in view while it
 * is focused.
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
      {...selectionColors(Platform.OS)}
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
      <InputAccessoryView nativeID={doneBarId} backgroundColor={SHELL_PALETTE.card}>
        <View style={[styles.doneBar, { borderTopColor: SHELL_PALETTE.cardBorder }]}>
          <TouchableOpacity onPress={dismissKeyboard} accessibilityRole="button" hitSlop={10}>
            <Text style={[TYPE_SCALE.controlLabel, { color: SHELL_PALETTE.accent }]}>{COPY.keyboardDone}</Text>
          </TouchableOpacity>
        </View>
      </InputAccessoryView>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // A sheet's frame fills the body it sits in (a large sheet has a height of its own, so the footer
  // sits at its bottom) and gives way to a sheet that is capped by its content.
  grow: { flexGrow: 1, flexShrink: 1 },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0, height: TOP_FADE_HEIGHT },
  edge: { height: StyleSheet.hairlineWidth },
  // A screen's gap between the scrolling content's cut edge and its pinned action: the design's
  // footer is `padding:16px 22px 24px` (`Whim Mobile.dc.html:427,459,487`), whose sides and bottom
  // `PrimaryAction` carries. A sheet spaces its own actions (`ReportSheet`'s Send keeps its margin).
  footer: { paddingTop: SPACING.md },
  naturalLineHeight: { lineHeight: undefined },
  doneBar: {
    height: DONE_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
