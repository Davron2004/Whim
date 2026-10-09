/**
 * Toast — the shell's toast host (system.md §7.1 Toast, M14; design-system-v1 task 11.2). One toast
 * at a time: a new one replaces the one showing, in place (a queue of one).
 *
 * - A `raised` capsule with `shadow-floating`, at most 360 wide, at least 48 tall, padding 12 × 16,
 *   12 pt above whatever floats at the bottom (the caller's `bottomOffset`: the composer, the orb)
 *   and the safe area. `callout` text, an optional `headline` text action (`ember-text` when it asks
 *   Whim, else `text`).
 * - Shows 4 s, 6 s with an action, 10 s for a delete's Undo; the time pauses while it is touched
 *   and stops altogether while a screen reader runs (it stays until replaced or dismissed; every
 *   Undo stays reachable from History).
 * - Rises 16 pt with a fade (`smooth`); a swipe down tracks the finger and dismisses on the same
 *   projection rule as a sheet (`fling`). Reduce Motion: cross-fades.
 * - Announced politely: iOS announces it, Android reads it as a polite live region. Screen readers
 *   get a dismiss action and the escape gesture.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, Text as RNText, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { RADII, SPACE } from '../../design/tokens';
import { COPY } from '../launcher/copy';
import { timing } from './motion';
import { DRAG_SLOP, dragPosition, releaseCommits } from './Sheet';
import { useTokens } from './tokens';
import { makeStyles, MAX_FONT_SCALE, springConfig, typeStyle } from './tokens-pure';

export interface ToastAction {
  label: string;
  onPress: () => void;
  /** The action asks Whim for something: its label is `ember-text`. */
  asksWhim?: boolean;
}

export interface ToastSpec {
  message: string;
  action?: ToastAction;
  /** A delete's Undo: shows for 10 s. */
  undo?: boolean;
}

export interface ToastApi {
  /** Shows `toast`, replacing any toast showing. */
  show: (toast: ToastSpec) => void;
  dismiss: () => void;
}

export const TOAST = { maxWidth: 360, minHeight: 48, rise: 16, above: SPACE[3] } as const;

/** How long a toast shows (ms): 4 s, 6 s with an action, 10 s for Undo. */
export function toastDuration(toast: ToastSpec): number {
  if (toast.undo) return 10_000;
  return toast.action ? 6_000 : 4_000;
}

const ToastContext = createContext<ToastApi | null>(null);

/** The toast API of the nearest `ToastHost`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast needs a ToastHost above it');
  return api;
}

export interface ToastHostProps {
  /** How far above the bottom safe area floating chrome reaches (the composer, the orb); the toast
   *  sits 12 pt above it. Default 0. */
  bottomOffset?: number;
  children: React.ReactNode;
}

/** The screen reader's state, following the OS. */
function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled().then(
      (enabled) => {
        if (live) setOn(enabled);
      },
      () => undefined,
    );
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled: boolean) => setOn(enabled));
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return on;
}

interface Shown {
  toast: ToastSpec;
  /** Bumped per show, so a replacement restarts the time even with the same words. */
  id: number;
}

export function ToastHost({ bottomOffset = 0, children }: Readonly<ToastHostProps>) {
  const [shown, setShown] = useState<Shown | null>(null);
  const next = useRef(0);
  const gone = useCallback((id: number) => setShown((now) => (now?.id === id ? null : now)), []);
  const api = useMemo<ToastApi>(
    () => ({
      show: (toast) => {
        next.current += 1;
        setShown({ toast, id: next.current });
      },
      dismiss: () => setShown(null),
    }),
    [],
  );
  return (
    <ToastContext.Provider value={api}>
      {children}
      {shown ? <ToastView key="toast" shown={shown} bottomOffset={bottomOffset} onGone={gone} /> : null}
    </ToastContext.Provider>
  );
}

const styles = makeStyles((t) => ({
  slot: { position: 'absolute' as const, left: SPACE[4], right: SPACE[4], alignItems: 'center' as const },
  capsule: {
    maxWidth: TOAST.maxWidth,
    minHeight: TOAST.minHeight,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACE[3],
    paddingVertical: SPACE[3],
    paddingHorizontal: SPACE[4],
    borderRadius: RADII.full.radius,
    backgroundColor: t.colors.raised,
    boxShadow: t.shadows.floating,
    borderTopWidth: 1,
    borderColor: t.topHighlight,
  },
  message: { ...typeStyle('callout'), color: t.colors.text, flexShrink: 1 },
  action: { ...typeStyle('headline') },
}));

interface ToastViewProps {
  shown: Shown;
  bottomOffset: number;
  /** The toast `id` has left. */
  onGone: (id: number) => void;
}

function ToastView({ shown, bottomOffset, onGone }: Readonly<ToastViewProps>) {
  const t = useTokens();
  const s = styles(t);
  const insets = useSafeAreaInsets();
  const screenReader = useScreenReader();
  const { toast, id } = shown;
  const [touched, setTouched] = useState(false);
  // The toast that is leaving; a replacement arrives not leaving.
  const [leftId, setLeftId] = useState<number | null>(null);
  const leaving = leftId === id;
  const y = useSharedValue(t.reduceMotion ? 0 : TOAST.rise);
  const fade = useSharedValue(0);
  const height = useSharedValue<number>(TOAST.minHeight);

  const leave = useCallback(() => setLeftId(id), [id]);

  // Enter, and announce, once per toast; a replacement keeps the capsule where it is and swaps its
  // words. The settings are read as they are when it arrives.
  const enteredFor = useRef<number | null>(null);
  useEffect(() => {
    if (enteredFor.current === id) return;
    enteredFor.current = id;
    if (t.reduceMotion) {
      y.value = 0;
      fade.value = withTiming(1, timing('fadeIn', true));
    } else {
      y.value = withSpring(0, springConfig('smooth'));
      fade.value = withTiming(1, timing('fadeIn'));
    }
    if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(toast.message);
  }, [id, t.reduceMotion, y, fade, toast.message]);

  // The time: paused while touched, stopped under a screen reader, restarted per toast.
  const remaining = useRef(toastDuration(toast));
  useEffect(() => {
    remaining.current = toastDuration(toast);
  }, [id, toast]);
  useEffect(() => {
    if (touched || screenReader || leaving) return undefined;
    const started = Date.now();
    const timer = setTimeout(leave, remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [id, touched, screenReader, leaving, leave]);

  // Leave: fade (and sink) out, then unmount.
  useEffect(() => {
    if (!leaving) return;
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(onGone, id);
    };
    fade.value = withTiming(0, timing('fadeOut', t.reduceMotion), done);
  }, [leaving, fade, onGone, id, t.reduceMotion]);

  const dragStart = useSharedValue(0);
  const slop = useSharedValue(0);
  const swipe = usePanGesture({
    activeOffsetY: [-DRAG_SLOP, DRAG_SLOP],
    onActivate: (e) => {
      'worklet';
      dragStart.value = y.value;
      slop.value = e.translationY;
    },
    onUpdate: (e) => {
      'worklet';
      y.value = dragPosition(dragStart.value, e.translationY - slop.value, height.value);
    },
    onDeactivate: (e) => {
      'worklet';
      if (releaseCommits(y.value, e.velocityY, height.value)) {
        const gone = height.value + bottomOffset + insets.bottom + TOAST.above;
        const done = (finished?: boolean) => {
          'worklet';
          if (finished) scheduleOnRN(onGone, id);
        };
        if (t.reduceMotion) fade.value = withTiming(0, timing('fadeOut', true), done);
        else y.value = withSpring(gone, { ...springConfig('fling'), velocity: e.velocityY }, done);
      } else if (t.reduceMotion) {
        y.value = withTiming(0, timing('fadeIn', true));
      } else {
        y.value = withSpring(0, { ...springConfig('fling'), velocity: e.velocityY });
      }
    },
  });

  const motion = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateY: y.value }] }));
  const onLayout = (event: LayoutChangeEvent) => {
    height.value = event.nativeEvent.layout.height;
  };
  const runAction = () => {
    toast.action?.onPress();
    leave();
  };

  return (
    <View style={[s.slot, { bottom: insets.bottom + bottomOffset + TOAST.above }]} pointerEvents="box-none">
      <GestureDetector gesture={swipe}>
        <Animated.View
          onLayout={onLayout}
          onTouchStart={() => setTouched(true)}
          onTouchEnd={() => setTouched(false)}
          onTouchCancel={() => setTouched(false)}
          style={[s.capsule, motion]}
          accessibilityLiveRegion="polite"
          accessibilityActions={[{ name: 'dismiss', label: COPY.toastDismiss }, { name: 'escape' }]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'dismiss' || event.nativeEvent.actionName === 'escape') leave();
          }}
          onAccessibilityEscape={leave}
        >
          <RNText style={s.message} maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {toast.message}
          </RNText>
          {toast.action ? (
            <Pressable onPress={runAction} accessibilityRole="button" accessibilityLabel={toast.action.label} hitSlop={SPACE[3]}>
              <RNText
                style={[s.action, { color: toast.action.asksWhim ? t.colors['ember-text'] : t.colors.text }]}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
              >
                {toast.action.label}
              </RNText>
            </Pressable>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
