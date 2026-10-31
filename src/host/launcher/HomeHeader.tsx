/**
 * HomeHeader — "Your apps" and the settings button (system.md §9 Your apps). The title is a large
 * title and a heading to screen readers; a long-press on it reaches the developer probe where the
 * build offers one. Shared by Home and its loading skeleton, so the title never jumps when the apps
 * arrive.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { LAYOUT, SPACE } from '../../design/tokens';
import { IconButton } from '../ui/IconButton';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { makeStyles } from '../ui/tokens-pure';
import { COPY } from './copy';

export interface HomeHeaderProps {
  /** Opens Settings. Absent (the loading skeleton), the button is drawn but inert and hidden from
   *  screen readers: a placeholder is never an activatable control. */
  onSettings?: () => void;
  /** Long-press on the title; present only in a build with the developer tools. */
  onOpenDevProbe?: () => void;
}

const styles = makeStyles(() => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingStart: LAYOUT.gutter,
    paddingEnd: SPACE[2],
    paddingTop: SPACE[2],
    minHeight: LAYOUT.headerRowHeight + SPACE[6],
  },
  title: { flexShrink: 1 },
}));

const settingsButton = (onSettings: () => void) => (
  <IconButton icon="settings" label={COPY.settingsTitle} onPress={onSettings} iconSize={24} />
);

export function HomeHeader({ onSettings, onOpenDevProbe }: Readonly<HomeHeaderProps>) {
  const t = useTokens();
  const s = styles(t);
  return (
    <View style={s.row}>
      <Pressable style={s.title} onLongPress={onOpenDevProbe} accessible={false}>
        <Text type="largeTitle" numberOfLines={1}>
          {COPY.homeTitle}
        </Text>
      </Pressable>
      {onSettings ? (
        settingsButton(onSettings)
      ) : (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {settingsButton(() => undefined)}
        </View>
      )}
    </View>
  );
}
