/**
 * RunDetailsSheet — the build screen's details affordance as a bottom sheet (build-liveness B5),
 * replacing the absolute full-screen overlay `LauncherRoot.tsx` used to render there.
 *
 * The reported bug: the old overlay's `top: 0` was defined on the absolutely-positioned view
 * itself, so Yoga measured it against the SafeAreaView's border box and ignored the SafeAreaView's
 * own top padding — the inset that keeps content off the status bar and the selfie-camera cutout
 * (the same "an absolute child that DEFINES its own inset ignores the parent's padding" gotcha
 * this codebase already documents elsewhere). Anchoring the sheet to the BOTTOM instead sidesteps
 * that failure mode entirely rather than working around it: `maxHeight` caps it at 72% of the
 * window, so its top edge can never reach the status bar, and no top inset is needed at all.
 *
 * Always mounted by its caller (`LauncherRoot.tsx` renders it unconditionally beside `BuildStep`)
 * and returns `null` while `open` is false — never conditionally rendered by the caller — so the
 * rise animation's `Animated.Value` (and the caller's hardware-back listener keyed off its own
 * `timeline` state) survive a close/reopen instead of remounting. Rises on open
 * (`MOTION.sheetRise`, the same entrance `Orb.tsx`'s menu uses); no animation on close, which is
 * simply instant — the sheet returns `null` the moment `open` flips, with no exit tween to race an
 * unmount against.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MOTION, RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import RunTimeline from './RunTimeline';
import type { RunJournalEntry } from './run-journal';
import { SHELL_PALETTE } from './theme';

/** The scrim colour `Orb.tsx`'s menu dismiss layer already uses — one reserved "something is
 *  covering the screen" tone, not a second one invented for this sheet. */
const SCRIM_COLOR = 'rgba(24,22,20,0.5)';

/** The sheet never grows past this fraction of the window's height — the load-bearing property
 *  that keeps its top edge away from the status bar without needing a top safe-area inset. */
const SHEET_MAX_HEIGHT_FRACTION = 0.72;

/** How far the sheet rises from (design doc "Sheets enter from the edge they will return to"),
 *  the same distance `Orb.tsx`'s own menu rises. */
const RISE_DISTANCE_PX = 24;

const GRABBER_WIDTH = 36;
const GRABBER_HEIGHT = 4;

export interface RunDetailsSheetProps {
  /** Whether the sheet is showing. Toggling this drives the rise animation open and an instant
   *  close — never re-mount the component to open/close it, or the animation value resets. */
  open: boolean;
  /** The journal the caller read ON OPEN, exactly as `RunTimeline` expects it. */
  entries: readonly RunJournalEntry[] | null;
  /** The developer-diagnostics gate's verdict, decided by the caller (decision #60(c)). */
  devMode?: boolean;
  /** Tapping the scrim or the header's Close control. Hardware back is the CALLER's concern
   *  (`LauncherRoot.tsx` keeps its own `BackHandler` listener keyed off the same `open` state) —
   *  this component owns no back handling of its own. */
  onClose: () => void;
}

export default function RunDetailsSheet({ open, entries, devMode = false, onClose }: Readonly<RunDetailsSheetProps>) {
  const p = SHELL_PALETTE;
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const riseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!open) {
      riseAnim.setValue(0);
      return;
    }
    Animated.timing(riseAnim, {
      toValue: 1,
      duration: MOTION.sheetRise.durationMs,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [open, riseAnim]);

  if (!open) {
    return null;
  }

  return (
    <Pressable style={styles.scrim} onPress={onClose} accessibilityRole="none">
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: p.bg,
            maxHeight: windowHeight * SHEET_MAX_HEIGHT_FRACTION,
            paddingBottom: insets.bottom + SPACING.md,
            opacity: riseAnim,
            transform: [
              { translateY: riseAnim.interpolate({ inputRange: [0, 1], outputRange: [RISE_DISTANCE_PX, 0] }) },
            ],
          },
        ]}
        // Swallows the scrim's own Pressable so a tap ON the sheet never closes it — only the
        // scrim around it does.
        onStartShouldSetResponder={() => true}
      >
        <View style={[styles.grabber, { backgroundColor: p.cardBorder }]} />
        <View style={styles.header}>
          <Text style={[TYPE_SCALE.screenTitle, { color: p.text }]}>{COPY.timelineTitle}</Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
            <Text style={[TYPE_SCALE.controlLabel, { color: p.accent }]}>{COPY.timelineClose}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.bodyContent}>
          <RunTimeline entries={entries} devMode={devMode} />
        </ScrollView>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: SCRIM_COLOR,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: RADIUS.sheet,
    borderTopRightRadius: RADIUS.sheet,
    paddingTop: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  grabber: {
    width: GRABBER_WIDTH,
    height: GRABBER_HEIGHT,
    borderRadius: GRABBER_HEIGHT / 2,
    alignSelf: 'center',
    marginBottom: SPACING.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  bodyContent: { paddingBottom: SPACING.sm },
});
