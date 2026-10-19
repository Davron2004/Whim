/**
 * ReadyPage — the making sheet's last page when a run delivers with the sheet open (system.md §9
 * Ready; `prompt-flow` "The Ready page opens the app or returns home"): the app's 96 pt tile, its
 * name, the person's words, "It's on your home screen.", `Open it` in the app's own tint and `Done`.
 * The app does not run until it is opened: there is no preview. Android back is the sheet's close,
 * which is `Done`, so the page registers nothing with the sheet.
 */
import React from 'react';
import { View } from 'react-native';
import { LAYOUT, SPACE } from '../../design/tokens';
import { TilePlate } from '../ui/AppTile';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { makeStyles } from '../ui/tokens-pure';
import type { InstalledApp } from './app-index';
import { COPY } from './copy';
import KeyboardShell from './KeyboardShell';
import { tileOf } from './tile-identity';

export interface ReadyPageProps {
  /** The delivered app: its tile, its name and its tint. */
  app: InstalledApp;
  /** The person's words, quoted under the name. */
  words: string;
  /** Opens the app from its tile. */
  onOpen: () => void;
  /** Back to Home; nothing is launched. */
  onDone: () => void;
}

const styles = makeStyles(() => ({
  content: { paddingHorizontal: LAYOUT.gutter, paddingTop: SPACE[8], paddingBottom: SPACE[4], alignItems: 'center' as const, gap: SPACE[2] },
  name: { textAlign: 'center' as const, marginTop: SPACE[5] },
  centered: { textAlign: 'center' as const },
  footer: { paddingHorizontal: LAYOUT.gutter, paddingTop: LAYOUT.actionAreaTop, paddingBottom: LAYOUT.actionAreaBottom, gap: SPACE[3] },
}));

export default function ReadyPage({ app, words, onOpen, onDone }: Readonly<ReadyPageProps>) {
  const s = styles(useTokens());
  const tile = tileOf(app);
  return (
    <KeyboardShell
      host="sheet"
      contentContainerStyle={s.content}
      footer={
        <View style={s.footer}>
          <Button label={COPY.readyOpen} variant="tint" tint={tile.tint} onPress={onOpen} />
          <Button label={COPY.readyDone} variant="plain" onPress={onDone} />
        </View>
      }
    >
      <TilePlate size="hero" state="ready" tint={tile.tint} glyph={tile.icon} />
      <Text type="title1" style={s.name}>
        {app.name}
      </Text>
      <Text type="title3" italic style={s.centered}>{`“${words}”`}</Text>
      <Text type="callout" color="text-2" style={s.centered}>
        {COPY.readyOnHome}
      </Text>
    </KeyboardShell>
  );
}
