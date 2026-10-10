/**
 * KeyboardShell — the one keyboard-safe frame every launcher screen or sheet with a text field
 * renders (beta-1 D3; app-launcher "Text input never hides the content or action it belongs to";
 * design-system-v1 task 11.3). The keyboard is tracked by `react-native-keyboard-controller`; the
 * decisions live in `keyboard-shell.ts`.
 *
 * A pinned `header`, the scrolling content, and a pinned `footer` for the primary action. On a
 * screen the frame pads its bottom by the keyboard's overlap with it, frame by frame on the UI
 * thread as the keyboard moves, so the footer rides above the keyboard on its own curve and the
 * scroll view ends above the footer; inside a sheet the host (`SheetModal`, `Sheet`) pads.
 * While a field in the scroll view is focused, any change to what the scroll view shows (the
 * keyboard arriving or changing height, the field growing) scrolls the field, or the block it
 * names, back into view, `REVEAL_MARGIN` clear of the keyboard and the footer; while the keyboard
 * is still moving, that waits for it to settle.
 * A hairline under the header shows once content has scrolled beneath it, and one above the footer
 * while content continues below. A drag puts the keyboard away, a tap a control handles reaches the
 * control, and a tap on empty space anywhere in the frame puts the keyboard away.
 */

import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
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
import {
  KeyboardController,
  KeyboardEvents,
  useGenericKeyboardHandler,
  useWindowDimensions as useKeyboardWindow,
  type NativeEvent,
} from 'react-native-keyboard-controller';
import { SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import {
  keyboardDismissMode,
  keyboardOverlap,
  pinsFooter,
  REVEAL_MARGIN,
  revealOffset,
  scrollEdges,
  selectionColors,
  showsDoneBar,
  type KeyboardShellHost,
  type ScrollMetrics,
} from './keyboard-shell';
import { SHELL_PALETTE } from './theme';

export interface KeyboardShellProps {
  /** Pinned above the scrolling content: the screen's header. */
  header?: React.ReactNode;
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

/** A view the shell can measure inside its scroll view: a field, or the block a field names. */
type RevealTarget = React.RefObject<View | TextInput | null>;

/** How a shell's fields tell it which block to keep in view. */
interface RevealRegistry {
  focused: (target: RevealTarget) => void;
  blurred: (target: RevealTarget) => void;
}

const KeyboardShellContext = createContext<RevealRegistry | null>(null);

const dismissKeyboard = () => Keyboard.dismiss();

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
 */
export function useKeyboardOverlap(frame: React.RefObject<View | null>, active: boolean): KeyboardOverlap {
  const overlap = useSharedValue(0);
  const frameBottom = useSharedValue(0);
  const { height: windowHeight } = useKeyboardWindow();
  const windowSize = useSharedValue(windowHeight);
  useEffect(() => {
    windowSize.value = windowHeight;
  }, [windowSize, windowHeight]);
  const onLayout = useCallback(() => {
    measureBottom(frame, (bottom) => {
      frameBottom.value = bottom;
      if (active && KeyboardController.isVisible()) {
        overlap.value = keyboardOverlap(KeyboardController.state().height, bottom, windowSize.value);
      }
    });
  }, [active, frame, frameBottom, overlap, windowSize]);
  const follow = (event: NativeEvent) => {
    'worklet';
    overlap.value = active ? keyboardOverlap(event.height, frameBottom.value, windowSize.value) : 0;
  };
  useGenericKeyboardHandler({ onMove: follow, onInteractive: follow, onEnd: follow }, [active]);
  useEffect(() => {
    if (!active) {
      overlap.value = 0;
      return undefined;
    }
    const subscription = KeyboardEvents.addListener('keyboardWillShow', onLayout);
    return () => subscription.remove();
  }, [active, onLayout, overlap]);
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

/** The scroll view's wiring: its metrics, the edge hairlines, and revealing the focused block.
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
  const [edges, setEdges] = useState({ above: false, below: false });
  const pendingReveal = useRef<number | null>(null);
  const revealVersion = useRef(0);
  const keyboardMoving = useRef(false);

  const cancelReveal = useCallback(() => {
    revealVersion.current += 1;
    if (pendingReveal.current != null) cancelAnimationFrame(pendingReveal.current);
    pendingReveal.current = null;
  }, []);

  const settle = useCallback((next: Partial<ScrollMetrics>) => {
    metrics.current = { ...metrics.current, ...next };
    const { above, below } = scrollEdges(metrics.current);
    setEdges((prev) => (prev.above === above && prev.below === below ? prev : { above, below }));
  }, []);

  /** Scrolls the focused block into view: of the scroll view as it is, or, while the keyboard is on
   *  its way, as tall as it will be (`viewport`). */
  const reveal = useCallback((viewport?: number) => {
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
          if (next != null) scroll.current?.scrollTo({ y: next, animated: true });
        },
        () => {},
      );
    });
  }, [cancelReveal]);

  useEffect(() => {
    // The frame's padding follows the keyboard frame by frame, so the scroll view's height changes
    // on every frame while it moves: not on each of those layouts, but once as the keyboard sets off,
    // for the height it is heading to (so the field rides up with it), and once it has settled.
    // Showing settles with `keyboardDidShow` (also sent for a new height while up), which rechecks;
    // iOS can animate native bounds beyond the layout notification and the next frame. Each is a
    // one-shot event, not a scroll/layout retry loop.
    const subscriptions = [
      KeyboardEvents.addListener('keyboardWillShow', (event) => {
        keyboardMoving.current = true;
        const shrink = shrinkFor?.(event.height) ?? 0;
        if (shrink !== 0) reveal(metrics.current.viewport - shrink);
      }),
      KeyboardEvents.addListener('keyboardWillHide', () => { keyboardMoving.current = true; }),
      KeyboardEvents.addListener('keyboardDidShow', () => {
        keyboardMoving.current = false;
        reveal();
      }),
      KeyboardEvents.addListener('keyboardDidHide', () => { keyboardMoving.current = false; }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
      cancelReveal();
      focusedTarget.current = null;
    };
  }, [cancelReveal, reveal, shrinkFor]);

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
  return { scrollProps, edges, registry };
}

/** A hairline at a scroll edge, drawn only while content is hidden past it; always laid out, so
 *  showing it never shifts anything. */
function EdgeLine({ shown }: Readonly<{ shown: boolean }>) {
  return <View style={[styles.edge, shown && { backgroundColor: SHELL_PALETTE.cardBorder }]} />;
}

export default function KeyboardShell({
  header,
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
  const { overlap, onLayout, overlapFor } = useKeyboardOverlap(frameRef, !inSheet);
  const padding = useAnimatedStyle(() => ({ paddingBottom: overlap.value }));
  const shrinkFor = useCallback((keyboardHeight: number) => overlapFor(keyboardHeight) - overlap.value, [overlap, overlapFor]);
  const { scrollProps, edges, registry } = useRevealingScroll(scrollRef, onContentSizeChange, onScrollOffset, inSheet ? undefined : shrinkFor);
  const frame = (
    <KeyboardShellContext.Provider value={registry}>
      <Pressable
        style={inSheet ? [styles.shrink, style] : styles.fill}
        onPress={dismissKeyboard}
        accessible={false}
        focusable={false}
        android_disableSound
      >
        {header}
        {pinsFooter(header) && <EdgeLine shown={edges.above} />}
        <ScrollView
          {...scrollProps}
          style={inSheet ? styles.shrink : undefined}
          contentContainerStyle={contentContainerStyle}
          keyboardDismissMode={keyboardDismissMode(Platform.OS)}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        {pinsFooter(footer) && (
          <>
            <EdgeLine shown={edges.below} />
            <View style={inSheet ? undefined : styles.footer}>{footer}</View>
          </>
        )}
      </Pressable>
    </KeyboardShellContext.Provider>
  );
  if (inSheet) return frame;
  return (
    <View ref={frameRef} collapsable={false} onLayout={onLayout} style={[styles.fill, style]}>
      <Animated.View style={[styles.fill, padding]}>{frame}</Animated.View>
    </View>
  );
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
  useEffect(() => {
    if (!autoFocusOnMount.current) return undefined;
    // iOS: a frame after mounting, once the Done bar has linked to the field, so the keyboard comes
    // up with the bar already on it (focused in the mount frame, it intermittently arrived without
    // the bar in its reported frame, leaving the footer under the bar). Android: now, and again a
    // frame later, because it can refuse to show the keyboard for a field it doesn't serve yet; a
    // field already served ignores the second request.
    if (Platform.OS === 'android') input.current?.focus();
    const later = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(later);
  }, []);
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
  shrink: { flexShrink: 1 },
  edge: { height: StyleSheet.hairlineWidth },
  // A screen's gap between the scrolling content's cut edge and its pinned action: the design's
  // footer is `padding:16px 22px 24px` (`Whim Mobile.dc.html:427,459,487`), whose sides and bottom
  // `PrimaryAction` carries. A sheet spaces its own actions (`ReportSheet`'s Send keeps its margin).
  footer: { paddingTop: SPACING.md },
  naturalLineHeight: { lineHeight: undefined },
  // 44: the iOS keyboard toolbar's height — no SPACING counterpart.
  doneBar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
