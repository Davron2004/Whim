/**
 * AppTile — the `2b` ghost-letterform app tile (shell-redesign-v2 chain-F, task F4;
 * design-extract §2b treatment 1; app-launcher "App tiles use the ghost-letterform treatment").
 * Square, filled solid with the app's colour, carrying its monogram twice: small in the
 * foreground at the bottom-left, and blown up bleeding off the top-right edge at 16% white. A 1px
 * inset white border at 30% opacity. The app's name renders beneath the tile, never inside it.
 *
 * Purely presentational: colour resolution delegates to `tiles.ts#tileColor` (the one path every
 * surface uses), so a tile never holds a second name->colour mapping. Press handling, the example
 * badge, and grid layout stay the caller's concern (group D) — this component only ever renders
 * one tile, matching "the grid SHALL show tiles at a uniform size and SHALL NOT vary treatment per
 * app: the app's colour is the only thing that differs between two tiles."
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { FONT_FAMILY, RADIUS, SHELL_COLORS } from '../../sdk/theme';
import { monogram, tileColor } from './tiles';
import type { AppManifest } from '../bridge/contract';

/** The tile's geometry (design-extract §2b: 88x88, tile radius). Exported so a loading skeleton
 *  (group D, sdk-design-system "Loading skeletons derive their geometry from exported component
 *  constants") imports these rather than restating them, guaranteeing no layout jump on load. */
export const APP_TILE_SIZE = 88;
export const APP_TILE_RADIUS = RADIUS.tile;

/** The done step's celebration tile rises in once on mount (design html:524
 *  `animation: rise .4s ease both`: opacity 0→1, translateY 6→0). Local to this variant — the grid
 *  tile has no entrance motion at all. */
const RISE_DURATION_MS = 400;
const RISE_TRANSLATE_Y = 6;

export interface AppTileProps {
  /** The app's display name — sources both monograms, the fallback colour, and the label below
   *  the tile. */
  name: string;
  /** The host-held record's manifest, read only for its declared colour — never anything the
   *  running bundle reports about itself. Omitted resolves `appColor(name)`. */
  manifest?: Pick<AppManifest, 'tileColor'>;
  /** `'done'` renders the flow's celebration variant (design html:520-524): 120x120, radius 32, a
   *  glow colour-matched to the app's own hue, a one-shot rise-in, and no name label — the done
   *  step writes its own headline instead. Omitted is the grid tile, unchanged. */
  size?: 'done';
}

export default function AppTile({ name, manifest, size }: Readonly<AppTileProps>) {
  const mono = monogram(name);
  const bg = tileColor(name, manifest);
  const isDone = size === 'done';

  const rise = useRef(new Animated.Value(isDone ? 0 : 1)).current;
  useEffect(() => {
    if (!isDone) return;
    const anim = Animated.timing(rise, {
      toValue: 1,
      duration: RISE_DURATION_MS,
      easing: Easing.ease,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [isDone, rise]);

  const riseStyle = isDone
    ? {
        opacity: rise,
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [RISE_TRANSLATE_Y, 0] }) }],
      }
    : undefined;

  return (
    <Animated.View style={[styles.root, isDone ? styles.rootDone : null, riseStyle]}>
      <View style={[styles.tile, isDone ? styles.tileDone : null, { backgroundColor: bg }, isDone ? { shadowColor: bg } : null]}>
        <Text style={[styles.ghostMonogram, isDone ? styles.ghostMonogramDone : null]} numberOfLines={1}>{mono}</Text>
        <Text style={[styles.foregroundMonogram, isDone ? styles.foregroundMonogramDone : null]} numberOfLines={1}>{mono}</Text>
      </View>
      {!isDone && <Text style={styles.name} numberOfLines={1}>{name}</Text>}
    </Animated.View>
  );
}

/** The done variant's geometry, from design html:520-524. These have no `SPACING`/`RADIUS`
 *  counterpart and get no one-off token (ruling R9) — they stay local, exactly as the grid tile's
 *  own 9/-13/62/19 do. */
const DONE_TILE_SIZE = 120;

const styles = StyleSheet.create({
  root: {
    width: APP_TILE_SIZE,
    alignItems: 'flex-start',
  },
  rootDone: { width: DONE_TILE_SIZE },
  tile: {
    width: APP_TILE_SIZE,
    height: APP_TILE_SIZE,
    borderRadius: APP_TILE_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    padding: 9,
  },
  tileDone: {
    width: DONE_TILE_SIZE,
    height: DONE_TILE_SIZE,
    borderRadius: 32,
    padding: 14,
    // `box-shadow: 0 8px 22px rgba(<own hue>,.3)` (html:520). `shadowColor` is the tile's own
    // resolved colour, set at the call site. Android has no box-shadow equivalent, so `elevation`
    // is an approximation of the same weight — the honest gap `Orb.tsx:139-143` already lives with.
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 22,
    elevation: 8,
  },
  ghostMonogram: {
    position: 'absolute',
    top: -13,
    right: -8,
    fontFamily: FONT_FAMILY.sansBold,
    fontSize: 62,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.16)',
  },
  ghostMonogramDone: { top: -20, right: -12, fontSize: 92 },
  foregroundMonogram: {
    fontFamily: FONT_FAMILY.sansSemiBold,
    fontSize: 19,
    fontWeight: '600',
    color: '#ffffff',
  },
  foregroundMonogramDone: { fontSize: 26 },
  name: {
    fontFamily: FONT_FAMILY.sansMedium,
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '500',
    color: SHELL_COLORS.text,
    marginTop: 6,
  },
});
