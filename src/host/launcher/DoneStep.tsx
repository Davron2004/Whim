/**
 * DoneStep — the flow's last step (`prompt-flow` spec "The done step offers two distinct
 * destinations"). The delivered app's own tile in its own colour, `<App name> is ready`, the body
 * line, and two actions that lead to DIFFERENT places: `Open it` launches the app full-screen,
 * `Back to your apps` returns to the home grid without launching anything.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import type { InstalledApp } from './app-index';
import AppTile from './app-tile';
import { COPY, readyTitle } from './copy';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

export interface DoneStepProps {
  app: InstalledApp;
  /** Launches the delivered mini-app full-screen. */
  onOpen: () => void;
  /** Returns to the home grid — no mini-app is launched. */
  onBackToApps: () => void;
}

export default function DoneStep({ app, onOpen, onBackToApps }: Readonly<DoneStepProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={styles.content}>
        <AppTile name={app.name} manifest={app.record.manifest} />
        <Text style={[TYPE_SCALE.screenTitle, styles.title, { color: p.text }]}>{readyTitle(app.name)}</Text>
        <Text style={[TYPE_SCALE.body, styles.body, { color: p.textMuted }]}>{COPY.doneBody}</Text>
      </View>

      <TouchableOpacity
        onPress={onOpen}
        accessibilityRole="button"
        style={[styles.primary, { backgroundColor: p.accent, borderColor: p.cardBorder }]}
      >
        <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.doneOpen}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onBackToApps}
        accessibilityRole="button"
        style={[styles.secondary, { backgroundColor: p.bg, borderColor: p.cardBorder }]}
      >
        <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{COPY.doneBackToApps}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.lg },
  title: { marginTop: SPACING.lg, textAlign: 'center' },
  body: { marginTop: SPACING.sm, textAlign: 'center', maxWidth: 250 },
  primary: {
    height: 54,
    marginHorizontal: SPACING.lg,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    height: 46,
    margin: SPACING.lg,
    marginTop: SPACING.sm,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
