/**
 * AppTile (the Ready tile) — the celebration tile the done step shows: the app's own colour,
 * its monogram twice (small at the bottom-left, blown up and bleeding off the top-right at 16%
 * white), a glow in the same hue and a one-shot rise-in. Home's tiles are `ui/AppTile`; this one
 * stays until the Ready screen draws the 96 hero tile from the tints (design-system-v1 17.x).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { FONT_FAMILY, RADIUS } from '../../sdk/theme';
import { monogram, tileColor } from './tiles';
import type { AppManifest } from '../bridge/contract';

/** Far wider than any two-letter monogram, so the watermark never truncates. */
const GHOST_MONOGRAM_BOX_WIDTH = 240;
const APP_TILE_RADIUS = RADIUS.tile;

/** The tile rises in once on mount (opacity 0→1, translateY 6→0). CSS `ease` is
 *  `cubic-bezier(.25,.1,.25,1)`, which decelerates; RN's `Easing.ease` is `bezier(.42,0,1,1)`, the
 *  opposite shape, so the curve is spelled out. */
const RISE_DURATION_MS = 400;
const RISE_TRANSLATE_Y = 6;
const RISE_EASING = Easing.bezier(0.25, 0.1, 0.25, 1);

/** The glow is the tile's own hue at 30%: `tiles.ts#tileColor` only ever yields `#rrggbb`, so the
 *  alpha is a suffix (0.3 x 255 = 0x4d). */
const GLOW_ALPHA_HEX = '4d';
const GLOW_OFFSET_Y = 8;
const GLOW_BLUR = 22;
const DONE_TILE_SIZE = 120;

export interface AppTileProps {
  name: string;
  manifest?: Pick<AppManifest, 'tileColor'>;
  size: 'done';
}

export default function AppTile({ name, manifest }: Readonly<AppTileProps>) {
  const mono = monogram(name);
  const bg = tileColor(name, manifest);
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(rise, { toValue: 1, duration: RISE_DURATION_MS, easing: RISE_EASING, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [rise]);

  return (
    <Animated.View
      style={[
        styles.root,
        { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [RISE_TRANSLATE_Y, 0] }) }] },
      ]}
    >
      <View
        style={[
          styles.tile,
          { backgroundColor: bg },
          { boxShadow: [{ offsetX: 0, offsetY: GLOW_OFFSET_Y, blurRadius: GLOW_BLUR, color: `${bg}${GLOW_ALPHA_HEX}` }] },
        ]}
      >
        <Text style={styles.ghostMonogram} numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no">
          {mono}
        </Text>
        <Text style={styles.foregroundMonogram} numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no">
          {mono}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'flex-start', width: DONE_TILE_SIZE },
  tile: {
    width: DONE_TILE_SIZE,
    height: DONE_TILE_SIZE,
    borderRadius: APP_TILE_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    padding: 9,
  },
  ghostMonogram: {
    position: 'absolute',
    top: -13,
    right: -8,
    width: GHOST_MONOGRAM_BOX_WIDTH,
    textAlign: 'right',
    fontFamily: FONT_FAMILY.sansBold,
    fontSize: 62,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.16)',
  },
  foregroundMonogram: {
    fontFamily: FONT_FAMILY.sansSemiBold,
    fontSize: 19,
    fontWeight: '600',
    color: '#ffffff',
  },
});
