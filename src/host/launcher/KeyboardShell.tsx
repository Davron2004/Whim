/**
 * KeyboardShell — the one keyboard-safe frame every launcher screen or sheet with a text field
 * renders (beta-1 D3; app-launcher "Text input never hides the content or action it belongs to").
 * React Native built-ins only; the decisions live in `keyboard-shell.ts`.
 *
 * A pinned `header`, the scrolling content, and a pinned `footer` for the primary action. On a
 * screen the frame pads its bottom by the keyboard's overlap with it, so the footer rides above the
 * keyboard and the scroll view ends above the footer; inside a sheet the host (`SheetModal`) pads.
 * While a field in the scroll view is focused, any change to what the scroll view shows (the
 * keyboard arriving, the field growing) scrolls the field, or the block it names, back into view.
 * A hairline under the header shows once content has scrolled beneath it, and one above the footer
 * while content continues below. A drag puts the keyboard away, a tap a control handles reaches the
 * control, and a tap on empty space anywhere in the frame puts the keyboard away.
 */

import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  LayoutAnimation,
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
  KeyboardEvent,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewProps,
  StyleProp,
  TextInputProps,
  ViewStyle,
} from 'react-native';
import { SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import {
  keyboardDismissMode,
  keyboardEvents,
  keyboardOverlap,
  padsForKeyboard,
  pinsFooter,
  revealOffset,
  scrollEdges,
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
  /** `sheet` inside `SheetModal`, which pads for the keyboard itself. */
  host?: KeyboardShellHost;
  /** The frame's own style (its background). */
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** The content scroll view, for a screen that scrolls it itself. */
  scrollRef?: React.Ref<ScrollView>;
  /** Called when the scrolling content changes size. */
  onContentSizeChange?: ScrollViewProps['onContentSizeChange'];
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

/** Moves the next layout with the keyboard, as iOS reports its motion (Android reports none). */
function moveWithKeyboard(event: KeyboardEvent | undefined): void {
  if (!event?.duration) return;
  LayoutAnimation.configureNext({
    duration: event.duration,
    update: { duration: event.duration, type: LayoutAnimation.Types[event.easing] ?? LayoutAnimation.Types.keyboard },
  });
}

/**
 * The keyboard's overlap with the view `frame` holds, while `active`; 0 when the keyboard is down or
 * `active` is false. The view's bottom edge must not move with the padding this feeds: a frame that
 * fills its parent, or a root that fills the window. The view is placed with `measure`'s page
 * coordinates, relative to its root (the app's, or a Modal's), which fills the window wherever a
 * frame pads, just as the keyboard's top edge is reported; `measureInWindow` would not do on
 * Android, which measures from below the status bar.
 */
export function useKeyboardInset(frame: React.RefObject<View | null>, active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    const place = (keyboardTop: number, event?: KeyboardEvent) => {
      frame.current?.measure((_x, _y, _width, height, _pageX, pageY) => {
        if (!live) return;
        moveWithKeyboard(event);
        setInset(keyboardOverlap(pageY + height, keyboardTop));
      });
    };
    const shown = Keyboard.metrics();
    if (Keyboard.isVisible() && shown) place(shown.screenY);
    const events = keyboardEvents(Platform.OS);
    const subscriptions = [
      Keyboard.addListener(events.show, (event) => place(event.endCoordinates.screenY, event)),
      Keyboard.addListener(events.hide, (event) => {
        moveWithKeyboard(event);
        setInset(0);
      }),
    ];
    return () => {
      live = false;
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [active, frame]);
  return active ? inset : 0;
}

/** Hands `node` to a ref the caller passed in, whichever kind it is. */
function assignRef<T>(ref: React.Ref<T> | undefined, node: T | null): void {
  if (typeof ref === 'function') ref(node);
  else if (ref) (ref as React.MutableRefObject<T | null>).current = node;
}

/** The scroll view's wiring: its metrics, the edge hairlines, and revealing the focused block. */
function useRevealingScroll(
  scrollRef: React.Ref<ScrollView> | undefined,
  onContentSizeChange: ScrollViewProps['onContentSizeChange'],
) {
  const scroll = useRef<ScrollView | null>(null);
  const inner = useRef<View>(null);
  const metrics = useRef<ScrollMetrics>({ offset: 0, viewport: 0, content: 0 });
  const focusedTarget = useRef<RevealTarget | null>(null);
  const [edges, setEdges] = useState({ above: false, below: false });

  const settle = useCallback((next: Partial<ScrollMetrics>) => {
    metrics.current = { ...metrics.current, ...next };
    const { above, below } = scrollEdges(metrics.current);
    setEdges((prev) => (prev.above === above && prev.below === below ? prev : { above, below }));
  }, []);

  const reveal = useCallback(() => {
    const target = focusedTarget.current?.current;
    const content = inner.current;
    if (!target || !content) return;
    target.measureLayout(
      content,
      (_x, top, _width, height) => {
        const next = revealOffset(metrics.current, top, top + height, SPACING.md);
        if (next != null) scroll.current?.scrollTo({ y: next, animated: true });
      },
      () => {},
    );
  }, []);

  const registry = useMemo<RevealRegistry>(
    () => ({
      focused: (target) => {
        focusedTarget.current = target;
        reveal();
      },
      blurred: (target) => {
        if (focusedTarget.current === target) focusedTarget.current = null;
      },
    }),
    [reveal],
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
    onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => settle({ offset: event.nativeEvent.contentOffset.y }),
    onLayout: (event: LayoutChangeEvent) => {
      const viewport = event.nativeEvent.layout.height;
      const resized = viewport !== metrics.current.viewport;
      settle({ viewport });
      if (resized) reveal();
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
  children,
}: Readonly<KeyboardShellProps>) {
  const inSheet = host === 'sheet';
  const frameRef = useRef<View>(null);
  const inset = useKeyboardInset(frameRef, !inSheet && padsForKeyboard(Platform, 'screen'));
  const { scrollProps, edges, registry } = useRevealingScroll(scrollRef, onContentSizeChange);
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
            <View style={styles.footer}>{footer}</View>
          </>
        )}
      </Pressable>
    </KeyboardShellContext.Provider>
  );
  if (inSheet) return frame;
  return (
    <View ref={frameRef} collapsable={false} style={[styles.fill, style, { paddingBottom: inset }]}>
      {frame}
    </View>
  );
}

export interface KeyboardTextInputProps extends TextInputProps {
  /** The block to keep in view while this field is focused (a plan row with its Save and Cancel);
   *  the field itself when left out. */
  revealTarget?: React.RefObject<View | null>;
}

/**
 * A text field for a `KeyboardShell`: Whim's accent for its caret and selection, and the shell keeps
 * it in view while it is focused.
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
    if (autoFocusOnMount.current) input.current?.focus();
  }, []);
  const doneBar = showsDoneBar(Platform.OS, props.multiline);
  const field = (
    <TextInput
      selectionColor={SHELL_PALETTE.accent}
      cursorColor={SHELL_PALETTE.accent}
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
  // The gap between the scrolling content's cut edge and the pinned action.
  footer: { paddingTop: SPACING.sm },
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
