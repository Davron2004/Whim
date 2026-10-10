/**
 * ContextMenu — the card a 350 ms long-press opens (system.md §7.1 Context menu, M12; app-launcher
 * "Tile menus follow the tile's state"; design-system-v1 task 11.2, #135). The caller owns the
 * long-press, the tile's lift and the `long-press` haptic; this is the menu itself.
 *
 * - A `raised` card, `r-lg`, `shadow-raised`, 248 wide, 8 pt under its anchor (above it when there
 *   is no room below), never over the anchor itself, so never over the names of the row it opens
 *   from (the anchor is the whole cell, name included). Headed by the app's full name (`footnote`
 *   600 `text-2`); rows 48 pt with a 20 pt icon and `body` text; a separator, then the destructive
 *   rows in `danger-text`.
 * - A row with `next` swaps the card's rows for a second step (with a back row) in 120 ms; any other
 *   row closes the menu, and its action runs once the menu has gone from the screen. The menu takes
 *   its turn with the shell's other overlays (`OverlayModal`), so the action is free to show a
 *   sheet, the share sheet or an alert.
 * - Announced as a menu; every row is its own button, reachable and activatable on its own. The
 *   scrim behind is a sibling screen readers skip, never the card's parent.
 * - Opens growing from the anchor's edge 0.92 → 1 (`smooth`) with a fade; closes with `fade-out` and
 *   0.96. Reduce Motion: cross-fades, no scale.
 * - Closes by the scrim, Android back, the screen reader's escape gesture, or a row.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { LAYOUT, RADII, SPACE, TIMINGS } from '../../design/tokens';
import type { IconName } from '../../design/icons/names';
import { COPY } from '../launcher/copy';
import { Icon } from './Icon';
import { timing } from './motion';
import { OverlayModal, useOverlayTurn } from './OverlayModal';
import { useTokens } from './tokens';
import { makeStyles, MAX_FONT_SCALE, springConfig, typeStyle } from './tokens-pure';

export interface MenuRow {
  /** Stable identity among its siblings. */
  key: string;
  label: string;
  icon: IconName;
  /** Runs once the menu has closed and gone from the screen. Leave out on a row that opens a second step. */
  onPress?: () => void;
  /** Drawn in `danger-text` after a separator, below every other row. */
  destructive?: boolean;
  /** A second step: tapping the row swaps the card's rows for these, with a back row. */
  next?: readonly MenuRow[];
}

/** The anchor's rect in window coordinates: the whole cell the menu opens from, its name included. */
export interface MenuAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ContextMenuProps {
  visible: boolean;
  /** The app's full name, heading the card. */
  title: string;
  anchor: MenuAnchor | null;
  rows: readonly MenuRow[];
  onClose: () => void;
}

export const MENU = { width: 248, gap: SPACE[2], row: 48, icon: 20, openScale: 0.92, closeScale: 0.96 } as const;

/** What a chosen row with no action of its own runs. */
const NO_ACTION = () => {};

/** Where a menu `size` goes for `anchor` in a window `window` tall and wide with `insets`: 8 pt under
 *  the anchor, or above it when it doesn't fit below (whichever side has more room when neither
 *  fits), centred on the anchor and kept inside the screen gutters. */
export function placeMenu(
  anchor: MenuAnchor,
  size: { width: number; height: number },
  window: { width: number; height: number },
  insets: { top: number; bottom: number },
): { left: number; top: number; below: boolean } {
  const floor = window.height - insets.bottom - LAYOUT.gutter;
  const ceiling = insets.top + LAYOUT.gutter;
  const belowTop = anchor.y + anchor.height + MENU.gap;
  const aboveTop = anchor.y - MENU.gap - size.height;
  const fitsBelow = belowTop + size.height <= floor;
  const fitsAbove = aboveTop >= ceiling;
  const below = fitsBelow || (!fitsAbove && floor - belowTop >= anchor.y - ceiling);
  const centred = anchor.x + anchor.width / 2 - size.width / 2;
  const left = Math.min(Math.max(centred, LAYOUT.gutter), window.width - LAYOUT.gutter - size.width);
  return { left, top: below ? belowTop : aboveTop, below };
}

/** The rows in the order the card draws them: every other row, then the destructive ones. */
export function menuOrder(rows: readonly MenuRow[]): { rows: MenuRow[]; destructive: MenuRow[] } {
  return { rows: rows.filter((r) => !r.destructive), destructive: rows.filter((r) => r.destructive) };
}

const styles = makeStyles((t) => ({
  frame: { flex: 1 },
  scrim: { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0, backgroundColor: t.colors.scrim },
  card: {
    position: 'absolute' as const,
    width: MENU.width,
    backgroundColor: t.colors.raised,
    borderRadius: RADII.lg.radius,
    borderCurve: 'continuous' as const,
    boxShadow: t.shadows.raised,
    borderTopWidth: 1,
    borderColor: t.topHighlight,
    paddingVertical: SPACE[1],
    overflow: 'hidden' as const,
  },
  heading: {
    ...typeStyle('footnote', true),
    color: t.colors['text-2'],
    paddingHorizontal: SPACE[4],
    paddingTop: SPACE[2],
    paddingBottom: SPACE[1],
  },
  row: {
    minHeight: MENU.row,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACE[3],
    paddingHorizontal: SPACE[4],
    paddingVertical: SPACE[2],
  },
  label: { ...typeStyle('body'), flexShrink: 1 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: t.colors.separator, marginVertical: SPACE[1] },
  // Laid out unseen until its size places it.
  unplaced: { left: 0, top: 0, opacity: 0 },
  fromTop: { transformOrigin: 'top' },
  fromBottom: { transformOrigin: 'bottom' },
  pressed: { backgroundColor: t.colors.fill },
}));

export function ContextMenu({ visible, title, anchor, rows, onClose }: Readonly<ContextMenuProps>) {
  const t = useTokens();
  // The anchor the card is drawn from, kept through its exit should the caller clear it early.
  const [from, setFrom] = useState(anchor);
  if (anchor !== null && anchor !== from) setFrom(anchor);
  const at = anchor ?? from;
  // The chosen row's action, held until the menu has gone: whatever it shows next (a sheet, the
  // share sheet, an alert) must not meet the menu still on screen.
  const chosen = useRef<(() => void) | null>(null);
  const gone = useCallback(() => {
    const action = chosen.current;
    chosen.current = null;
    action?.();
  }, []);
  const turn = useOverlayTurn(visible && at !== null, { onGone: gone, onRefused: onClose });
  const { open, up, exited } = turn;
  // Each opening mounts a fresh card, so it measures and grows in again.
  const [opening, setOpening] = useState({ open, count: 0 });
  if (opening.open !== open) setOpening({ open, count: opening.count + (open ? 1 : 0) });
  const openRef = useRef(open);
  const appear = useSharedValue(0);
  const scale = useSharedValue(t.reduceMotion ? 1 : MENU.openScale);

  const settled = useCallback(() => {
    if (!openRef.current) exited();
  }, [exited]);

  // The `open` last acted on: only a change of it opens or closes the menu, never a change of
  // settings while it shows.
  const actedOn = useRef(false);
  useEffect(() => {
    openRef.current = open;
    if (actedOn.current === open) return;
    actedOn.current = open;
    if (open) {
      chosen.current = null;
      appear.value = 0;
      scale.value = t.reduceMotion ? 1 : MENU.openScale;
      return;
    }
    if (!up) return;
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(settled);
    };
    appear.value = withTiming(0, timing('fadeOut', t.reduceMotion), done);
    if (!t.reduceMotion) scale.value = withTiming(MENU.closeScale, timing('fadeOut'));
  }, [open, up, t.reduceMotion, appear, scale, settled]);

  // The first row chosen while the menu is open is the one that counts: a second tap as it fades,
  // or a tap after the scrim closed it, chooses nothing.
  const choose = (row: MenuRow) => {
    if (!openRef.current || chosen.current !== null) return;
    chosen.current = row.onPress ?? NO_ACTION;
    onClose();
  };

  if (at === null) return null;
  return (
    <OverlayModal turn={turn} onRequestClose={onClose}>
      <SafeAreaProvider>
        <MenuCard key={opening.count} title={title} anchor={at} rows={rows} onClose={onClose} onChoose={choose} appear={appear} scale={scale} />
      </SafeAreaProvider>
    </OverlayModal>
  );
}

interface MenuCardProps {
  title: string;
  anchor: MenuAnchor;
  rows: readonly MenuRow[];
  onClose: () => void;
  /** A row that is not a second step was tapped. */
  onChoose: (row: MenuRow) => void;
  appear: SharedValue<number>;
  scale: SharedValue<number>;
}

function MenuCard({ title, anchor, rows, onClose, onChoose, appear, scale }: Readonly<MenuCardProps>) {
  const t = useTokens();
  const s = styles(t);
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [step, setStep] = useState<readonly MenuRow[] | null>(null);
  const swap = useSharedValue(1);

  const place = size ? placeMenu(anchor, size, screen, insets) : null;
  const below = place?.below ?? true;

  // Grow in once the card's size is known, from the edge facing the anchor. Only the first
  // measurement opens it; a second step's new size moves nothing.
  const measured = size != null;
  useEffect(() => {
    if (!measured) return;
    appear.value = withTiming(1, timing('fadeIn', t.reduceMotion));
    if (!t.reduceMotion) scale.value = withSpring(1, springConfig('smooth'));
  }, [measured, t.reduceMotion, appear, scale]);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
  };

  const showStep = (next: readonly MenuRow[] | null) => {
    setStep(next);
    swap.value = 0;
    swap.value = withTiming(1, { ...timing('fadeOut', true), duration: TIMINGS.fadeOut });
  };

  const choose = (row: MenuRow) => {
    if (row.next) showStep(row.next);
    else onChoose(row);
  };
  const back: MenuRow = { key: 'back', label: COPY.backLabel, icon: t.platform === 'ios' ? 'chevron-left' : 'arrow-left' };

  const cardMotion = useAnimatedStyle(() => ({ opacity: appear.value, transform: [{ scale: scale.value }] }));
  const scrimMotion = useAnimatedStyle(() => ({ opacity: appear.value }));
  const rowsMotion = useAnimatedStyle(() => ({ opacity: swap.value }));
  const shown = menuOrder(step ?? rows);

  const renderRow = (row: MenuRow, look: 'plain' | 'danger', onPress = () => choose(row)) => {
    const color = look === 'danger' ? t.colors['danger-text'] : t.colors.text;
    return (
      <Pressable
        key={row.key}
        onPress={onPress}
        style={({ pressed }) => [s.row, pressed && s.pressed]}
        accessibilityRole="button"
        accessibilityLabel={row.label}
      >
        <Icon name={row.icon} size={MENU.icon} color={color} />
        <RNText style={[s.label, { color }]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {row.label}
        </RNText>
      </Pressable>
    );
  };

  return (
    <View style={s.frame}>
      <Animated.View style={[s.scrim, scrimMotion]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} accessibilityRole="none" importantForAccessibility="no" />
      </Animated.View>
      <Animated.View
        onLayout={onLayout}
        style={[
          s.card,
          place ? { left: place.left, top: place.top } : s.unplaced,
          below ? s.fromTop : s.fromBottom,
          place ? cardMotion : null,
        ]}
        accessibilityRole="menu"
        accessibilityLabel={title}
        accessibilityViewIsModal
        onAccessibilityEscape={onClose}
      >
        <RNText style={s.heading} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header">
          {title}
        </RNText>
        <Animated.View style={rowsMotion}>
          {step ? renderRow(back, 'plain', () => showStep(null)) : null}
          {shown.rows.map((row) => renderRow(row, 'plain'))}
          {shown.destructive.length > 0 && shown.rows.length > 0 ? <View style={s.separator} /> : null}
          {shown.destructive.map((row) => renderRow(row, 'danger'))}
        </Animated.View>
      </Animated.View>
    </View>
  );
}
