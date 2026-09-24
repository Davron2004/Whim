/**
 * UpdateRequiredScreen — "Whim needs an update" (request-envelope D5; spec app-update-gate "The app
 * shows an update screen that blocks AI features, not the app"). Opened by an `update_required`
 * refusal, or by the launch-time check finding this build below its platform's minimum. `Update
 * Whim` opens Whim's own store listing (the store app, falling back to the https listing) and leaves
 * this screen up; `Not now` and system back both go Home, where installed apps keep running. Laid
 * out like `AppLinkMissingScreen`, with the consent screen's primary + plain-text action pair.
 */
import React from 'react';
import { Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import { STORE_LISTINGS } from './release-config';
import { SHELL_PALETTE } from './theme';
import { openStoreListing } from './update-gate';
import { useSystemBack } from './use-system-back';

export interface UpdateRequiredScreenProps {
  /** `Not now` and system back both call this. */
  onNotNow: () => void;
}

export default function UpdateRequiredScreen({ onNotNow }: Readonly<UpdateRequiredScreenProps>) {
  const p = SHELL_PALETTE;
  useSystemBack(onNotNow);
  // The store on the phone in hand: the App Store on iOS, Google Play on Android.
  const listing = STORE_LISTINGS[Platform.OS === 'android' ? 'android' : 'ios'];

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={styles.content}>
        <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{COPY.updateTitle}</Text>
        <Text style={[TYPE_SCALE.body, styles.body, { color: p.textMuted }]}>{COPY.updateBody}</Text>
      </View>
      <View>
        <TouchableOpacity
          onPress={() => openStoreListing(listing, (url) => Linking.openURL(url))}
          accessibilityRole="button"
          style={[styles.primary, { backgroundColor: p.accent }]}
        >
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.updateAction}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onNotNow} accessibilityRole="button" style={styles.plainAction}>
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{COPY.updateNotNow}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'space-between' },
  content: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.xl },
  body: { marginTop: SPACING.sm },
  primary: {
    height: 52,
    marginHorizontal: SPACING.lg,
    borderRadius: RADIUS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plainAction: {
    height: 46,
    marginBottom: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
