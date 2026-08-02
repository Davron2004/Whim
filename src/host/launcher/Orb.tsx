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
import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RADIUS, SHELL_COLORS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { createMmkvBackend } from '../version-store/fs/mmkv-backend';
import { COPY } from './copy';
import { ORB_ACTIONS, recordOrbAction, type OrbActionId } from './orb-actions';

const ORB_SIZE = 62;
const ORB_BOTTOM = 130;

type OrbSheetKind = 'change' | 'versions' | 'copy';

export interface OrbProps {
  onExit: () => void;
}

function sheetTitle(sheet: OrbSheetKind): string {
  if (sheet === 'versions') return COPY.orbVersionsTitle;
  if (sheet === 'change') return COPY.orbChangeTitle;
  return COPY.orbActionCopy;
}

export default function Orb({ onExit }: Readonly<OrbProps>) {
  // Same `whim.launcher` KVBackend id every other launcher setting persists through (see
  // highlighting.ts) — a second MMKV instance opened with the same id shares the same storage.
  const kv = useRef(createMmkvBackend('whim.launcher')).current;
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState<OrbSheetKind | null>(null);

  const closeAll = () => {
    setMenuOpen(false);
    setSheet(null);
  };

  const onOrbPress = () => {
    if (sheet) return; // a sheet is already open; the orb itself is not the way to close it
    setMenuOpen((open) => !open);
  };

  const onAction = (id: OrbActionId) => {
    recordOrbAction(kv, id);
    setMenuOpen(false);
    if (id === 'home') {
      onExit();
      return;
    }
    setSheet(id);
  };

  const overlayVisible = menuOpen || sheet !== null;

  return (
    <>
      <Pressable
        onPress={onOrbPress}
        style={[styles.btn, menuOpen && styles.btnMenuOpen]}
        accessibilityRole="button"
        accessibilityLabel={menuOpen ? 'Close the app menu' : 'Open the app menu'}
      >
        <View style={[styles.bar, menuOpen && styles.barMenuOpen]} />
        <View style={[styles.bar, menuOpen && styles.barMenuOpen, styles.barGap]} />
        <View style={[styles.bar, menuOpen && styles.barMenuOpen]} />
      </Pressable>

      {overlayVisible && (
        <Pressable
          style={styles.scrim}
          onPress={closeAll}
          accessibilityRole="none"
          accessibilityLabel="Dismiss the app menu"
        >
          {menuOpen && (
            <View style={styles.menu} onStartShouldSetResponder={() => true}>
              {ORB_ACTIONS.map((action) => (
                <Pressable key={action.id} style={styles.row} onPress={() => onAction(action.id)}>
                  <Text style={styles.rowLabel}>{action.label}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {sheet !== null && (
            <View style={styles.sheet} onStartShouldSetResponder={() => true}>
              <Text style={styles.sheetTitle}>{sheetTitle(sheet)}</Text>
              {sheet === 'change' && <Text style={styles.sheetFooter}>{COPY.orbChangeFooter}</Text>}
              <Pressable style={styles.closeButton} onPress={closeAll}>
                <Text style={styles.closeLabel}>{COPY.orbClose}</Text>
              </Pressable>
            </View>
          )}
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
  sheet: {
    backgroundColor: SHELL_COLORS.paper,
    borderRadius: RADIUS.sheet,
    padding: SPACING.lg,
  },
  sheetTitle: { ...TYPE_SCALE.screenTitle, color: SHELL_COLORS.text, marginBottom: SPACING.xs },
  sheetFooter: { ...TYPE_SCALE.caption, color: SHELL_COLORS.muted, marginBottom: SPACING.md },
  closeButton: { alignSelf: 'flex-start', marginTop: SPACING.sm },
  closeLabel: { ...TYPE_SCALE.bodyEmphatic, color: SHELL_COLORS.muted },
});
