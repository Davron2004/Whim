/**
 * SheetModal — the one bottom-rising sheet primitive (design D14), shared by `ReportSheet.tsx`
 * and `AppLinkSheet.tsx`.
 *
 * A genuine RN `Modal` — not an absolutely-positioned sibling `View` like `RunDetailsSheet.tsx`
 * uses — because a `Modal` mounts into its own native window and so reliably layers above a
 * WebView and the orb; a plain sibling view's stacking order over a hardware-accelerated WebView
 * is not guaranteed on Android. `transparent` keeps the screen underneath visible (a running
 * mini-app, or whatever screen opened the sheet) rather than painting over it.
 *
 * Closes on a scrim tap and on `onRequestClose` (Android delivers hardware back to a VISIBLE
 * Modal's `onRequestClose` instead of any `BackHandler` listener — see `back-policy.ts`'s
 * `overlayOpen` input for the belt-and-suspenders reducer-level rule). iOS has no hardware back
 * button at all, so a caller must ALWAYS give the sheet its own visible close control (a Cancel/
 * Done action) — `onRequestClose` firing is never the only way out.
 *
 * Rises on open with `MOTION.sheetRise` (the same entrance `Orb.tsx`'s menu and
 * `RunDetailsSheet.tsx` use); closing is instant, with no exit tween to race an unmount against —
 * the same idiom both of those already keep.
 *
 * The dim covers the whole window, status bar, navigation bar and keyboard included (#105's class,
 * which the orb menu fixed the same way): the Modal's window draws under both bars on every Android
 * version, and the sheet keeps clear of them with that window's own safe-area insets, read through a
 * `SafeAreaProvider` inside the Modal (the app's outer insets describe the app's window, which on
 * Android before 15 stops at the bars). A window drawn under the bars doesn't resize for the
 * keyboard, so the sheet pads its own bottom by the keyboard (`useKeyboardInset`, keyboard-shell.ts):
 * its card continues behind the keyboard rather than stopping at its top edge. It is the sheet's only
 * avoidance: a `KeyboardShell` inside a sheet (`host="sheet"`) adds none.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MOTION, RADIUS, SPACING } from '../../sdk/theme';
import { padsForKeyboard } from './keyboard-shell';
import { useKeyboardInset } from './KeyboardShell';
import { inkAlpha } from './theme';
import { SHELL_PALETTE } from './theme';

/** The distance the sheet rises from — the same `Orb.tsx`/`RunDetailsSheet.tsx` constant. */
const RISE_DISTANCE_PX = 24;

export interface SheetModalProps {
  /** Whether the sheet is showing. Toggling this drives the rise animation open and an instant
   *  close — the caller keeps this component mounted across opens (its `Animated.Value` and any
   *  loaded content survive a close), the same contract `RunDetailsSheet.tsx` keeps. */
  visible: boolean;
  /** Fires on a scrim tap AND on `onRequestClose` (Android hardware back while visible). Never
   *  the only way to close on iOS — see the module doc comment. */
  onClose: () => void;
  children: React.ReactNode;
}

export default function SheetModal({ visible, onClose, children }: Readonly<SheetModalProps>) {
  const riseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      riseAnim.setValue(0);
      return;
    }
    Animated.timing(riseAnim, {
      toValue: 1,
      duration: MOTION.sheetRise.durationMs,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [visible, riseAnim]);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <SafeAreaProvider>
        <SheetFrame riseAnim={riseAnim} onClose={onClose}>
          {children}
        </SheetFrame>
      </SafeAreaProvider>
    </Modal>
  );
}

/** The dim and the sheet, filling the Modal's window, inside its own `SafeAreaProvider`. */
function SheetFrame({
  riseAnim,
  onClose,
  children,
}: Readonly<{ riseAnim: Animated.Value; onClose: () => void; children: React.ReactNode }>) {
  const p = SHELL_PALETTE;
  const insets = useSafeAreaInsets();
  const frame = useRef<View>(null);
  const keyboard = useKeyboardInset(frame, padsForKeyboard(Platform, 'sheet'));
  return (
    <View ref={frame} collapsable={false} style={[styles.frame, { paddingTop: insets.top + SPACING.md }]}>
      <Pressable style={[styles.scrim, { backgroundColor: inkAlpha(0.5) }]} onPress={onClose} accessibilityRole="none" />
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: p.card,
            // The keyboard covers the home indicator's inset, so the larger of the two, not both.
            paddingBottom: Math.max(insets.bottom, keyboard) + SPACING.md,
            opacity: riseAnim,
            transform: [
              { translateY: riseAnim.interpolate({ inputRange: [0, 1], outputRange: [RISE_DISTANCE_PX, 0] }) },
            ],
          },
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, justifyContent: 'flex-end' },
  // Its insets define it, so it spans the frame's whole box, the status bar's padding included.
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  sheet: {
    maxHeight: '100%',
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
});
