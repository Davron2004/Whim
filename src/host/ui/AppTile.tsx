/**
 * AppTile — an app's tile and the grid cell around it (system.md §3.2 Tiles, §7.1 App tile;
 * app-launcher "A tile is a tinted squircle with one glyph", "Tiles show their state"; design-
 * system-v1 tasks 11.4 and 15.1).
 *
 * `TilePlate` is the squircle alone, at any of the four sizes: a superellipse (one SVG path on both
 * platforms) in the tint's light value in both schemes with a white glyph at half its size, a 1.5 pt
 * inner rim in dark mode and a 1 pt `border` outline with Increase Contrast. In the states without
 * an app's own look it carries the ember instead of the glyph: `ember-soft` while it is made (the
 * ember following the stream, or still and dim while it waits), a `fill` plate with the ember out
 * when it did not work, plus the alert badge on a failure and the glowing ring around an app that is
 * being changed. The glyph and the ember are hidden from screen readers.
 *
 * `AppTile` is the whole cell: plate, name under it (two lines, then ellipsis), the line that states
 * the state, and the touch area (at least 64 × 84). Its label is the name plus the state ("Pour
 * Timer, making") with a hint for what a double tap does. A long-press of 350 ms plays the haptic
 * and reports the cell's rect in window coordinates, which the context menu anchors to; the caller
 * owns the menu and passes `lifted` while it is open.
 */

import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { ON_PLATE, SPACE, TILE_RIM, TINTS, type TintName } from '../../design/tokens';
import { squirclePath } from '../../design/icons/squircle';
import { mixHex } from '../../design/tints';
import { haptics } from '../haptics';
import { COPY } from '../launcher/copy';
import type { TileGlyph } from '../launcher/tile-identity';
import { Ember } from './Ember';
import { Icon } from './Icon';
import type { MenuAnchor } from './ContextMenu';
import { timing, usePressFeedback } from './motion';
import { GRID, TILE, TILE_SIDE, labelSidePadding, listRowPadding, type GridLayout, type TileSize } from './AppTile-geometry';
import { stateLine, tileAccessibilityHint, tileAccessibilityLabel, tileLook, type StateLine, type TileState } from './AppTile-states';
import { Text } from './Text';
import { useTokens } from './tokens';
import {
  ACTIVITY_SMOOTHING,
  emberLook,
  makeStyles,
  PRESS_RETENTION,
  springConfig,
  type EmberSize,
  type ShellTokens,
} from './tokens-pure';

/** How long a press must hold before it is a long-press (M12). */
export const LONG_PRESS_MS = 350;
/** The lifted tile's scale while its menu is open (M12). */
const LIFT_SCALE = 1.06;
/** The ring around a tile being changed: 2 pt, 3 pt outside the plate. */
const RING = { width: 2, gap: 3 } as const;
/** The badge sits this far past the plate's top-trailing corner. */
const BADGE_OUTSET = SPACE[1];
/** A busy tile (opening, copying) is dimmed, not shadowed: Android draws no `shadow*`. */
const BUSY_OPACITY = 0.7;

/** The ember a plate of this side carries. */
function emberFor(side: number): EmberSize {
  if (side >= TILE_SIDE.hero) return 48;
  return side >= TILE_SIDE.grid ? 24 : 20;
}

export interface TilePlateProps {
  size: TileSize;
  state: TileState;
  tint: TintName;
  glyph: TileGlyph;
  /** The stream's activity, 0–1, for the ember or ring of a tile being made or changed. */
  activity?: number;
}

const plateStyles = makeStyles((t) => ({
  centre: { ...StyleSheet.absoluteFill, alignItems: 'center' as const, justifyContent: 'center' as const },
  ring: { position: 'absolute' as const },
  badge: {
    position: 'absolute' as const,
    top: -BADGE_OUTSET,
    end: -BADGE_OUTSET,
    width: TILE.badge,
    height: TILE.badge,
    borderRadius: TILE.badge / 2,
    backgroundColor: t.colors.bg,
  },
}));

/** What fills the plate in `state`. */
function plateFill(t: ShellTokens, state: TileState, tint: TintName): string {
  const { plate } = tileLook(state);
  if (plate === 'tint') return TINTS[tint].light;
  return plate === 'ember-soft' ? t.colors['ember-soft'] : t.colors.fill;
}

export function TilePlate({ size, state, tint, glyph, activity = 0 }: Readonly<TilePlateProps>) {
  const t = useTokens();
  const s = plateStyles(t);
  const side = TILE_SIDE[size];
  const look = tileLook(state);
  const onTint = look.plate === 'tint';
  const ringSide = side + 2 * (RING.gap + RING.width);
  const rim = t.scheme === 'dark' && onTint ? mixHex(TINTS[tint].dark, TINTS[tint].light, TILE_RIM.mix) : null;

  const intensity = useSharedValue(emberLook('working', activity).body);
  useEffect(() => {
    const target = t.reduceMotion ? 1 : emberLook('working', activity).body;
    intensity.value = t.reduceMotion ? withTiming(target, timing('fadeIn', true)) : withSpring(target, ACTIVITY_SMOOTHING);
  }, [activity, intensity, t.reduceMotion]);
  const ringGlow = useAnimatedStyle(() => ({ opacity: intensity.value }));
  const ringBox = { top: -(RING.gap + RING.width), start: -(RING.gap + RING.width), width: ringSide, height: ringSide };

  return (
    <View style={{ width: side, height: side }} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={side} height={side} viewBox={`0 0 ${side} ${side}`}>
        <Path d={squirclePath(side)} fill={plateFill(t, state, tint)} />
        {rim ? <Path d={squirclePath(side - TILE_RIM.width)} fill="none" stroke={rim} strokeWidth={TILE_RIM.width} transform={`translate(${TILE_RIM.width / 2} ${TILE_RIM.width / 2})`} /> : null}
        {t.increaseContrast ? <Path d={squirclePath(side - 1)} fill="none" stroke={t.colors.border} strokeWidth={1} transform="translate(0.5 0.5)" /> : null}
      </Svg>
      <View style={s.centre}>
        {onTint ? <Icon name={glyph} size={side * TILE.glyph} color={ON_PLATE} stroke={TILE.glyphStroke} /> : null}
        {look.ember ? <Ember size={emberFor(side)} state={look.ember === 'waiting' ? 'stuck' : look.ember} activity={activity} /> : null}
      </View>
      {look.ring ? (
        <Animated.View style={[s.ring, ringBox, ringGlow]} pointerEvents="none">
          <Svg width={ringSide} height={ringSide} viewBox={`0 0 ${ringSide} ${ringSide}`}>
            <Path d={squirclePath(ringSide - RING.width)} fill="none" stroke={t.colors.ember} strokeWidth={RING.width} transform={`translate(${RING.width / 2} ${RING.width / 2})`} />
          </Svg>
        </Animated.View>
      ) : null}
      {look.badge ? (
        <View style={s.badge}>
          <Icon name="circle-alert" size={TILE.badge} color={t.colors.danger} />
        </View>
      ) : null}
    </View>
  );
}

export interface AppTileProps {
  /** The grid's cell geometry for this screen width and text size (`gridLayout`). */
  layout: GridLayout;
  /** The app's full name, or the name of the attempt. */
  name: string;
  state: TileState;
  tint: TintName;
  glyph: TileGlyph;
  /** "Example" on a seeded app, "Copy" on a copy, "2 didn't work" on the collapsed cell. */
  example?: boolean;
  copy?: boolean;
  count?: number;
  activity?: number;
  /** An operation on this app is running: the tile is dimmed and reads busy. */
  busy?: boolean;
  /** Its menu is open: the tile is lifted. */
  lifted?: boolean;
  onPress: () => void;
  /** After the 350 ms hold, with the cell's rect in window coordinates. */
  onLongPress: (anchor: MenuAnchor) => void;
}

const cellStyles = makeStyles((t) => ({
  column: { alignItems: 'center' as const, paddingHorizontal: labelSidePadding(t.largeText) },
  label: { marginTop: GRID.labelGap, textAlign: 'center' as const, alignSelf: 'stretch' as const },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACE[3], paddingHorizontal: listRowPadding(t.largeText) },
  texts: { flex: 1 },
  /** A list row centres its plate on the text beside it; a grid cell holds every plate on one line. */
  touchGrid: { justifyContent: 'flex-start' as const },
  touchList: { justifyContent: 'center' as const },
  lifted: { boxShadow: t.shadows.floating },
}));

export function AppTile({
  layout,
  name,
  state,
  tint,
  glyph,
  example,
  copy,
  count,
  activity,
  busy = false,
  lifted = false,
  onPress,
  onLongPress,
}: Readonly<AppTileProps>) {
  const t = useTokens();
  const s = cellStyles(t);
  const press = usePressFeedback('chip', t);
  const ref = useRef<View>(null);
  const line: StateLine | null = stateLine(state, { example, copy, count });

  const lift = useSharedValue(1);
  useEffect(() => {
    if (t.reduceMotion) lift.value = 1;
    else lift.value = withSpring(lifted ? LIFT_SCALE : 1, springConfig('snappy'));
  }, [lifted, lift, t.reduceMotion]);
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ scale: lift.value }] }));

  const openMenu = () => {
    haptics.play('long-press');
    ref.current?.measureInWindow((x, y, width, height) => onLongPress({ x, y, width, height }));
  };

  const inList = layout.kind === 'list';
  const size: TileSize = inList ? 'menu' : 'grid';
  const frame = inList
    ? { minHeight: layout.rowHeight, width: '100%' as const }
    : { minHeight: layout.cellHeight, width: layout.columnWidth };
  // Only the plate carries the lift's shadow, with the plate's own corner: the cell around it is not a shape.
  const plate = (
    <View style={lifted ? [s.lifted, { borderRadius: TILE.corner * TILE_SIDE[size] }] : null}>
      <TilePlate size={size} state={state} tint={tint} glyph={glyph} activity={activity} />
    </View>
  );
  const lines = line ? (
    <Text type="caption" color={line.color} numberOfLines={1} style={inList ? undefined : s.label}>
      {line.text}
    </Text>
  ) : null;

  return (
    <Animated.View style={[frame, liftStyle]}>
      <Pressable
        ref={ref}
        onPress={onPress}
        onLongPress={openMenu}
        delayLongPress={LONG_PRESS_MS}
        onPressIn={() => {
          haptics.prepare('long-press');
          press.pressIn();
        }}
        onPressOut={press.pressOut}
        pressRetentionOffset={PRESS_RETENTION}
        accessibilityRole="button"
        accessibilityLabel={tileAccessibilityLabel(name, line)}
        accessibilityHint={tileAccessibilityHint(state)}
        accessibilityState={{ busy }}
        accessibilityActions={[{ name: 'longpress', label: COPY.tileMenuAction }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress') openMenu();
        }}
        style={[inList ? s.touchList : s.touchGrid, { minHeight: frame.minHeight }]}
      >
        <Animated.View style={[press.style, busy ? { opacity: BUSY_OPACITY } : null]}>
          {inList ? (
            <View style={s.row}>
              {plate}
              <View style={s.texts}>
                {name === '' ? null : <Text type="body">{name}</Text>}
                {lines}
              </View>
            </View>
          ) : (
            <View style={s.column}>
              {plate}
              {name === '' ? null : (
                <Text type="caption" numberOfLines={GRID.labelLines} style={s.label}>
                  {name}
                </Text>
              )}
              {lines}
            </View>
          )}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}
