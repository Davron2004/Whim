/**
 * CustomizeTileSheet — "Customize tile" (app-launcher "Customize tile changes an app's tint and
 * glyph"; system.md §3.2). A large sheet with the app's tile as it stands, the ten tints as
 * swatches, and a searchable grid of the glyph set. Every pick is written as it is made, as the
 * tile's override, which wins over the assigned tint and glyph and survives changes to the app, so
 * the tile behind the sheet changes as the person chooses. "Use the original tile" drops the
 * override.
 */
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { LAYOUT, RADII, SPACE, ON_PLATE, TINT_NAMES, TINTS, type TintName } from '../../design/tokens';
import type { GlyphName } from '../../design/icons/names';
import { TilePlate } from '../ui/AppTile';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Sheet } from '../ui/Sheet';
import { Text } from '../ui/Text';
import { TextField } from '../ui/TextField';
import { useTokens } from '../ui/tokens';
import { hitSlopFor, makeStyles } from '../ui/tokens-pure';
import type { InstalledApp } from './app-index';
import { COPY } from './copy';
import { filterGlyphs, glyphLabel, tintLabel } from './customize-tile';
import KeyboardShell from './KeyboardShell';
import { tileOf, type TileIdentity } from './tile-identity';

export interface CustomizeTileSheetProps {
  visible: boolean;
  /** The app being customized, as it is now (the override included); the sheet reads its tile from it. */
  app: InstalledApp | null;
  /** The person picked a tint or a glyph: the whole tile as it now stands, to store as the override. */
  onChoose: (tile: TileIdentity) => void;
  /** "Use the original tile": drop the override. */
  onReset: () => void;
  onClose: () => void;
}

const SWATCH = { touch: 44, dot: 32 } as const;
const GLYPH_CELL = 48;

const styles = makeStyles(() => ({
  content: { paddingHorizontal: LAYOUT.gutter, paddingBottom: LAYOUT.actionAreaBottom, gap: LAYOUT.gapBetweenGroups },
  preview: { alignItems: 'center' as const, paddingTop: SPACE[2] },
  wrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACE[1] },
  swatch: { width: SWATCH.touch, height: SWATCH.touch, alignItems: 'center' as const, justifyContent: 'center' as const },
  dot: { width: SWATCH.dot, height: SWATCH.dot, borderRadius: SWATCH.dot / 2, alignItems: 'center' as const, justifyContent: 'center' as const },
  glyph: { width: GLYPH_CELL, height: GLYPH_CELL, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: RADII.md.radius, borderCurve: 'continuous' as const },
  header: { marginBottom: SPACE[2] },
  empty: { paddingVertical: SPACE[4] },
}));

function Swatch({ tint, chosen, onPick }: Readonly<{ tint: TintName; chosen: boolean; onPick: () => void }>) {
  const t = useTokens();
  const s = styles(t);
  return (
    <Pressable
      onPress={onPick}
      accessibilityRole="radio"
      accessibilityLabel={tintLabel(tint)}
      accessibilityState={{ checked: chosen }}
      hitSlop={hitSlopFor(SWATCH.touch, t)}
      style={s.swatch}
    >
      <View style={[s.dot, { backgroundColor: TINTS[tint].light }]}>{chosen ? <Icon name="check" size={20} color={ON_PLATE} /> : null}</View>
    </Pressable>
  );
}

function GlyphCell({ glyph, chosen, tint, onPick }: Readonly<{ glyph: GlyphName; chosen: boolean; tint: TintName; onPick: () => void }>) {
  const t = useTokens();
  const s = styles(t);
  return (
    <Pressable
      onPress={onPick}
      accessibilityRole="radio"
      accessibilityLabel={glyphLabel(glyph)}
      accessibilityState={{ checked: chosen }}
      style={[s.glyph, chosen ? { backgroundColor: TINTS[tint].light } : null]}
    >
      <Icon name={glyph} size={24} color={chosen ? ON_PLATE : t.colors.text} />
    </Pressable>
  );
}

function CustomizeBody({ app, onChoose, onReset }: Readonly<{ app: InstalledApp; onChoose: (tile: TileIdentity) => void; onReset: () => void }>) {
  const t = useTokens();
  const s = styles(t);
  const [query, setQuery] = useState('');
  const current = tileOf(app);
  const glyphs = filterGlyphs(query);
  return (
    <KeyboardShell host="sheet" contentContainerStyle={s.content}>
      <View style={s.preview}>
        <TilePlate size="hero" state="ready" tint={current.tint} glyph={current.icon} />
      </View>
      <View>
        <Text type="footnote" header color="text-2" style={s.header}>
          {COPY.customizeTintHeader}
        </Text>
        <View style={s.wrap}>
          {TINT_NAMES.map((tint) => (
            <Swatch key={tint} tint={tint} chosen={tint === current.tint} onPick={() => onChoose({ tint, icon: current.icon })} />
          ))}
        </View>
      </View>
      <View>
        <Text type="footnote" header color="text-2" style={s.header}>
          {COPY.customizeGlyphHeader}
        </Text>
        <TextField value={query} onChangeText={setQuery} accessibilityLabel={COPY.customizeSearchLabel} placeholder={COPY.customizeSearchLabel} autoCorrect={false} autoCapitalize="none" />
        {glyphs.length === 0 ? (
          <Text type="callout" color="text-2" style={s.empty}>
            {COPY.customizeSearchEmpty}
          </Text>
        ) : (
          <View style={[s.wrap, { marginTop: SPACE[3] }]}>
            {glyphs.map((glyph) => (
              <GlyphCell key={glyph} glyph={glyph} chosen={glyph === current.icon} tint={current.tint} onPick={() => onChoose({ tint: current.tint, icon: glyph })} />
            ))}
          </View>
        )}
      </View>
      {app.tileOverride ? <Button label={COPY.customizeReset} variant="plain" onPress={onReset} /> : null}
    </KeyboardShell>
  );
}

export function CustomizeTileSheet({ visible, app, onChoose, onReset, onClose }: Readonly<CustomizeTileSheetProps>) {
  return (
    <Sheet visible={visible && app !== null} onClose={onClose} title={COPY.customizeTitle} detent="large">
      {app ? <CustomizeBody key={app.id} app={app} onChoose={onChoose} onReset={onReset} /> : null}
    </Sheet>
  );
}
