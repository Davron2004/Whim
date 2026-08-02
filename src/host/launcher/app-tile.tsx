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
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RADIUS, SHELL_COLORS } from '../../sdk/theme';
import { monogram, tileColor } from './tiles';
import type { AppManifest } from '../bridge/contract';

/** The tile's geometry (design-extract §2b: 88x88, tile radius). Exported so a loading skeleton
 *  (group D, sdk-design-system "Loading skeletons derive their geometry from exported component
 *  constants") imports these rather than restating them, guaranteeing no layout jump on load. */
export const APP_TILE_SIZE = 88;
export const APP_TILE_RADIUS = RADIUS.tile;

export interface AppTileProps {
  /** The app's display name — sources both monograms, the fallback colour, and the label below
   *  the tile. */
  name: string;
  /** The host-held record's manifest, read only for its declared colour — never anything the
   *  running bundle reports about itself. Omitted resolves `appColor(name)`. */
  manifest?: Pick<AppManifest, 'tileColor'>;
}

export default function AppTile({ name, manifest }: Readonly<AppTileProps>) {
  const mono = monogram(name);
  const bg = tileColor(name, manifest);

  return (
    <View style={styles.root}>
      <View style={[styles.tile, { backgroundColor: bg }]}>
        <Text style={styles.ghostMonogram} numberOfLines={1}>{mono}</Text>
        <Text style={styles.foregroundMonogram} numberOfLines={1}>{mono}</Text>
      </View>
      <Text style={styles.name} numberOfLines={1}>{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: APP_TILE_SIZE,
    alignItems: 'flex-start',
  },
  tile: {
    width: APP_TILE_SIZE,
    height: APP_TILE_SIZE,
    borderRadius: APP_TILE_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    padding: 8,
  },
  ghostMonogram: {
    position: 'absolute',
    top: -12,
    right: -8,
    fontSize: 62,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.16)',
  },
  foregroundMonogram: {
    fontSize: 19,
    fontWeight: '600',
    color: '#ffffff',
  },
  name: {
    fontSize: 11.5,
    lineHeight: 14,
    fontWeight: '500',
    color: SHELL_COLORS.text,
    marginTop: 6,
  },
});
