/**
 * SheetModal — the one bottom-rising sheet primitive (design D14), shared by `ReportSheet.tsx`
 * and (a later chain) `AppLinkSheet.tsx`.
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
 * the same idiom both of those already keep. `KeyboardAvoidingView` keeps the sheet's own content
 * (the report note's `TextInput`) clear of the keyboard on iOS; Android's `windowSoftInputMode=
 * "adjustResize"` (AndroidManifest.xml) already handles it there, so `behavior` is `undefined` on
 * Android — an explicit `behavior` there would fight the OS resize instead of complementing it.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MOTION, RADIUS, SPACING } from '../../sdk/theme';
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
  const p = SHELL_PALETTE;
  const insets = useSafeAreaInsets();
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
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={[styles.scrim, { backgroundColor: inkAlpha(0.5) }]} onPress={onClose} accessibilityRole="none">
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: p.card,
                paddingBottom: insets.bottom + SPACING.md,
                opacity: riseAnim,
                transform: [
                  { translateY: riseAnim.interpolate({ inputRange: [0, 1], outputRange: [RISE_DISTANCE_PX, 0] }) },
                ],
              },
            ]}
            // Swallows the scrim's own Pressable so a tap ON the sheet never closes it.
            onStartShouldSetResponder={() => true}
          >
            {children}
          </Animated.View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrim: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
});
