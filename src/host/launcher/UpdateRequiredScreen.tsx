/**
 * UpdateRequiredScreen — "Whim needs an update" (request-envelope D5; spec app-update-gate "The app
 * shows an update screen that blocks AI features, not the app"). Opened by an `update_required`
 * refusal, or by the launch-time check finding this build below its platform's minimum. `Update
 * Whim` opens Whim's own store listing (the store app, falling back to the https listing) and leaves
 * this screen up; `Not now` and system back both go Home, where installed apps keep running (system.md
 * §9 Update needed: **Update Whim** `ink`, **Not now**).
 */
import React from 'react';
import { Linking, Platform, ScrollView, View } from 'react-native';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { COPY } from './copy';
import { fullScreenStyles } from './full-screen-styles';
import { STORE_LISTINGS } from './release-config';
import { openStoreListing } from './update-gate';
import { useSystemBack } from './use-system-back';

export interface UpdateRequiredScreenProps {
  /** The plain-text notice of the message that opened this screen (beta-1 D16: a message this
   *  build can't use whose fallback is `update`), shown in place of the standard body. Rendered as
   *  a plain `Text` — never parsed, linked or formatted. Absent: the standard body. */
  notice?: string;
  /** `Not now` and system back both call this. */
  onNotNow: () => void;
}

/** "Update Whim", wherever it is offered (this screen, and the Failure page of a run only a newer
 *  Whim can finish): Whim's own listing in the store on the phone in hand, the App Store on iOS,
 *  Google Play on Android, with its https fallback. */
export function openWhimUpdate(): Promise<void> {
  return openStoreListing(STORE_LISTINGS[Platform.OS === 'android' ? 'android' : 'ios'], (url) => Linking.openURL(url));
}

export default function UpdateRequiredScreen({ notice, onNotNow }: Readonly<UpdateRequiredScreenProps>) {
  const s = fullScreenStyles(useTokens());
  useSystemBack(onNotNow);

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.content}>
        <Text type="title1">{COPY.updateTitle}</Text>
        <Text type="callout" color="text-2">{notice ?? COPY.updateBody}</Text>
      </ScrollView>
      <View style={s.footer}>
        <Button label={COPY.updateAction} variant="ink" onPress={() => openWhimUpdate()} />
        <Button label={COPY.updateNotNow} variant="plain" onPress={onNotNow} />
      </View>
    </View>
  );
}
