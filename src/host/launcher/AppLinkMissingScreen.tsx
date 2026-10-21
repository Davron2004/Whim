/**
 * AppLinkMissingScreen — "This app lives on another phone" (design D15; spec app-links "A link to
 * an app that isn't on this phone shows a friendly screen"). Shown when an app link's id matches
 * neither an installed app nor a pending build. Its one action, and system back, both go Home;
 * iOS has no hardware back button, so the button is the only affordance and it stays on screen
 * unconditionally.
 */
import React from 'react';
import { View } from 'react-native';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { COPY } from './copy';
import { fullScreenStyles } from './full-screen-styles';
import { useSystemBack } from './use-system-back';

export interface AppLinkMissingScreenProps {
  /** The one action (`Back to your apps`) and system back both call this. */
  onBackToApps: () => void;
}

export default function AppLinkMissingScreen({ onBackToApps }: Readonly<AppLinkMissingScreenProps>) {
  const s = fullScreenStyles(useTokens());
  useSystemBack(onBackToApps);

  return (
    <View style={s.root}>
      <View style={s.content}>
        <Text type="title1">{COPY.appLinkMissingTitle}</Text>
        <Text type="callout" color="text-2">{COPY.appLinkMissingBody}</Text>
      </View>
      <View style={s.footer}>
        <Button label={COPY.appLinkMissingBack} variant="ink" onPress={onBackToApps} />
      </View>
    </View>
  );
}

