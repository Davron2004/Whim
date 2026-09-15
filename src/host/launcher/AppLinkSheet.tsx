/**
 * AppLinkSheet — reveals an installed app's link from the home grid's long-press sheet (design
 * D16; spec app-links "Every installed app can reveal its link from the home grid"). The app's
 * name, its link as selectable text (the system copy menu, not a clipboard dependency — see D16),
 * and one line saying the link opens the app on this phone. Reuses `SheetModal` — no second sheet
 * primitive (`handoff/sheet-modal.md`).
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import type { InstalledApp } from './app-index';
import { appLinkFor } from './app-link';
import { COPY, appLinkSheetLine } from './copy';
import SheetModal from './SheetModal';
import { SHELL_PALETTE } from './theme';

export interface AppLinkSheetProps {
  /** The app whose link is being revealed, or `null` while the sheet is closed. */
  app: InstalledApp | null;
  onClose: () => void;
}

export default function AppLinkSheet({ app, onClose }: Readonly<AppLinkSheetProps>) {
  const p = SHELL_PALETTE;

  return (
    <SheetModal visible={app != null} onClose={onClose}>
      {app && (
        <View style={styles.content}>
          <Text style={[TYPE_SCALE.stepTitle, styles.title, { color: p.text }]} numberOfLines={1}>
            {app.name}
          </Text>
          <Text style={[TYPE_SCALE.body, styles.link, { color: p.text, borderColor: p.cardBorder }]} selectable>
            {appLinkFor(app.id)}
          </Text>
          <Text style={[TYPE_SCALE.caption, styles.line, { color: p.textMuted }]}>{appLinkSheetLine(app.name)}</Text>
          <TouchableOpacity
            onPress={onClose}
            accessibilityRole="button"
            style={[styles.primary, { backgroundColor: p.accent }]}
          >
            <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.appLinkSheetClose}</Text>
          </TouchableOpacity>
        </View>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg },
  title: { textAlign: 'center', marginBottom: SPACING.md },
  link: { borderWidth: 1, borderRadius: RADIUS.field, padding: SPACING.sm },
  line: { marginTop: SPACING.sm },
  primary: {
    height: 52,
    borderRadius: RADIUS.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: SPACING.lg,
  },
});
