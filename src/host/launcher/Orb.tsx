// ─────────────────────────────────────────────────────────────────────────────
// Orb — the in-app tapped menu (launcher-shell / shell-redesign-v2 chain-G, `app-launcher`
// §"The orb is a tapped menu whose actions are instrumented"; design D12).
// ─────────────────────────────────────────────────────────────────────────────
// Replaces FloatingExit as the always-available, host-layer affordance rendered as a sibling of
// the WebView (never inside it — the realm can neither touch nor cover it). Unlike FloatingExit
// it is not draggable: a tap opens a plain vertical list of cheap, undoable actions; tapping the
// orb again closes it; tapping the scrim behind it dismisses with no side effect. Every action
// tap is instrumented (orb-actions.ts) before anything else happens.
//
// Deliberately NOT built here (design D12 / `app-launcher` negative requirement): press-and-hold
// arming, directional flick, wedge/wheel geometry, per-row direction hints, and the "hold to
// flick" caption — none of that gesture exists yet, and copy that advertises it is forbidden on
// this surface.
//
// Review fix-pass (shell-redesign-v2): all three actions now navigate rather than opening a
// placeholder sheet of their own — `home` already exited to the launcher; `versions` and `change`
// now reach the REAL destinations (the History screen, the compose step) instead of a stand-in
// title. There is nothing left for Orb.tsx itself to show once an action fires, so the orb-local
// "sheet" concept (and the fourth, undesigned `copy` action) is gone.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { MOTION, RADIUS, SHELL_COLORS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { createMmkvBackend } from '../version-store/fs/mmkv-backend';
import { COPY } from './copy';
import { ORB_ACTIONS, recordOrbAction, type OrbActionId } from './orb-actions';

const ORB_SIZE = 62;
const ORB_BOTTOM = 130;
// The menu rises from the bottom edge — the edge it collapses back to on close/dismiss (design
// doc "Sheet rise": "Sheets enter from the edge they will return to").
const MENU_RISE_DISTANCE = 24;

export interface OrbProps {
  onExit: () => void;
  /** Opens the real History screen for the running app ("Versions"). */
  onVersions: () => void;
  /** Opens the compose step prefilled for the running app ("Change it") — the same path
   *  History's own "Change it from here" row action uses. */
  onChangeIt: () => void;
}

export default function Orb({ onExit, onVersions, onChangeIt }: Readonly<OrbProps>) {
  // Same `whim.launcher` KVBackend id every other launcher setting persists through (see
  // highlighting.ts) — a second MMKV instance opened with the same id shares the same storage.
  const kv = useRef(createMmkvBackend('whim.launcher')).current;
  const [menuOpen, setMenuOpen] = useState(false);
  const riseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!menuOpen) {
      riseAnim.setValue(0);
      return;
    }
    Animated.timing(riseAnim, {
      toValue: 1,
      duration: MOTION.sheetRise.durationMs,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start();
  }, [menuOpen, riseAnim]);

  const closeAll = () => {
    setMenuOpen(false);
  };

  const onOrbPress = () => {
    setMenuOpen((open) => !open);
  };

  const onAction = (id: OrbActionId) => {
    recordOrbAction(kv, id);
    setMenuOpen(false);
    if (id === 'home') onExit();
    else if (id === 'versions') onVersions();
    else onChangeIt();
  };

  return (
    <>
      <Pressable
        onPress={onOrbPress}
        style={[styles.btn, menuOpen && styles.btnMenuOpen]}
        accessibilityRole="button"
        accessibilityLabel={menuOpen ? COPY.orbMenuCloseLabel : COPY.orbMenuOpenLabel}
      >
        <View style={[styles.bar, menuOpen && styles.barMenuOpen]} />
        <View style={[styles.bar, menuOpen && styles.barMenuOpen, styles.barGap]} />
        <View style={[styles.bar, menuOpen && styles.barMenuOpen]} />
      </Pressable>

      {menuOpen && (
        <Pressable
          style={styles.scrim}
          onPress={closeAll}
          accessibilityRole="none"
          accessibilityLabel={COPY.orbMenuDismissLabel}
        >
          <Animated.View
            style={[
              styles.menu,
              {
                opacity: riseAnim,
                transform: [
                  {
                    translateY: riseAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [MENU_RISE_DISTANCE, 0],
                    }),
                  },
                ],
              },
            ]}
            onStartShouldSetResponder={() => true}
          >
            {ORB_ACTIONS.map((action) => (
              <Pressable key={action.id} style={styles.row} onPress={() => onAction(action.id)}>
                <Text style={styles.rowLabel}>{action.label}</Text>
              </Pressable>
            ))}
          </Animated.View>
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    position: 'absolute',
    bottom: ORB_BOTTOM,
    alignSelf: 'center',
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    backgroundColor: SHELL_COLORS.ink,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  btnMenuOpen: { transform: [{ scale: 0.92 }] },
  bar: { width: 12, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.75)' },
  barMenuOpen: { width: 20, backgroundColor: 'rgba(255,255,255,0.9)' },
  barGap: { marginVertical: 3 },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(24,22,20,0.5)',
    justifyContent: 'flex-end',
    paddingHorizontal: SPACING.lg,
    paddingBottom: ORB_BOTTOM + ORB_SIZE + SPACING.sm,
  },
  menu: { gap: SPACING.xs },
  row: {
    backgroundColor: SHELL_COLORS.paper,
    borderWidth: 1,
    borderColor: SHELL_COLORS.border,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  rowLabel: { ...TYPE_SCALE.bodyEmphatic, color: SHELL_COLORS.text },
});
