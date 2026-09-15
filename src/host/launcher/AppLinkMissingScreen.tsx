/**
 * AppLinkMissingScreen — "This app lives on another phone" (design D15; spec app-links "A link to
 * an app that isn't on this phone shows a friendly screen"). Shown when an app link's id matches
 * neither an installed app nor a pending build. Its one action, and system back, both go Home;
 * iOS has no hardware back button, so the button is the only affordance and it stays on screen
 * unconditionally.
 */
import React, { useEffect } from 'react';
import { BackHandler, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SPACING, RADIUS, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import { SHELL_PALETTE } from './theme';

export interface AppLinkMissingScreenProps {
  /** The one action (`Back to your apps`) and system back both call this. */
  onBackToApps: () => void;
}

export default function AppLinkMissingScreen({ onBackToApps }: Readonly<AppLinkMissingScreenProps>) {
  const p = SHELL_PALETTE;

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBackToApps();
      return true;
    });
    return () => sub.remove();
  }, [onBackToApps]);

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={styles.content}>
        <Text style={[TYPE_SCALE.stepTitle, { color: p.text }]}>{COPY.appLinkMissingTitle}</Text>
        <Text style={[TYPE_SCALE.body, styles.body, { color: p.textMuted }]}>{COPY.appLinkMissingBody}</Text>
      </View>
      <TouchableOpacity
        onPress={onBackToApps}
        accessibilityRole="button"
        style={[styles.primary, { backgroundColor: p.accent }]}
      >
        <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.appLinkMissingBack}</Text>
      </TouchableOpacity>
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
    marginBottom: SPACING.lg,
    borderRadius: RADIUS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
