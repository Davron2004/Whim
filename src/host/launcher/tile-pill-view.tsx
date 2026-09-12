/**
 * TilePill — the home grid tile's one overlay pill (design D8): a small chip, top-right, that
 * either names a seeded example, or accents an in-flight rebuild of an already-installed app.
 * The tile itself stays fully launchable underneath — this is an overlay, never the greyed
 * `ghost` treatment `AppTile`'s own `ghost` prop renders for a brand-new (not-yet-installed)
 * pending build. `building` is a passive caption (no tap target of its own: the tile's normal
 * tap stays `onOpen`, and Cancel lives in the long-press sheet); `failed`/`interrupted` is
 * tappable on its own, opening the failure screen without stealing the tile's `onOpen`.
 *
 * Which kind (if any) applies to a given tile is decided once, by `tilePillFor` in `tile-pill.ts`
 * — this component only ever renders the kind it's told.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, STATUS_COLORS, TYPE_SCALE } from '../../sdk/theme';
import { TILE_PILL, type TilePillKind } from './tile-pill';
import { SHELL_PALETTE } from './theme';

export interface TilePillProps {
  kind: TilePillKind;
  /** Only read for a tappable kind (`failed`/`interrupted`); ignored otherwise. */
  onPress?: () => void;
}

export default function TilePill({ kind, onPress }: Readonly<TilePillProps>) {
  const spec = TILE_PILL[kind];
  const alert = spec.tone === 'alert';
  const containerStyle = [
    styles.pill,
    alert ? styles.pillAlert : { backgroundColor: SHELL_PALETTE.card, borderColor: SHELL_PALETTE.cardBorder },
  ];
  const textStyle = [TYPE_SCALE.eyebrow, alert ? styles.pillAlertText : { color: SHELL_PALETTE.textMuted }];

  if (spec.tappable) {
    return (
      <TouchableOpacity accessibilityRole="button" style={containerStyle} onPress={onPress}>
        <Text style={textStyle} numberOfLines={1}>{spec.label}</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View style={containerStyle}>
      <Text style={textStyle} numberOfLines={1}>{spec.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    position: 'absolute',
    top: SPACING.xs,
    right: SPACING.xs,
    borderWidth: 1,
    borderRadius: RADIUS.chip,
    paddingHorizontal: 6,
  },
  pillAlert: { backgroundColor: STATUS_COLORS.broken, borderColor: STATUS_COLORS.broken },
  pillAlertText: { color: '#ffffff' },
});
