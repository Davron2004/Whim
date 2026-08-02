// ─────────────────────────────────────────────────────────────────────────────
// SettingsScreen — the launcher's one settings surface (v2; docs/design/README.md "Two systems,
// not one" — the theme preset/accent/corners picker is CUT, the shell is fixed and
// non-themeable).
// ─────────────────────────────────────────────────────────────────────────────
// Colors come only from `shellPalette(theme)` (now always the same v2 values — never a hex
// literal of its own) and type faces from the SDK's v2 `TYPE_SCALE`/`RADIUS` (`vc-sdk`'s theme
// module). This screen is not a mini-app host: it owns its own hardware-back binding directly,
// and never touches `BackPolicy` (which only ever binds inside `useMiniAppHost`).
import React, { useEffect, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { RADIUS, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

export interface SettingsScreenProps {
  /** Returns to the home screen — supplied by `LauncherRoot`. */
  onBack: () => void;
  /** The persisted generation-server address (design D3), or `undefined` when unset. */
  serverUrl?: string;
  /** Persists the entered address — `LauncherRoot` writes it via `saveServerUrl` and re-reads
   *  the sanitized result back into its own state, same round-trip `server-address.ts` uses. */
  onServerUrlChange: (url: string) => void;
  /** Whether Whim Syntax prose highlighting is on (default true; `highlighting.ts`). */
  highlighting: boolean;
  /** Persists the toggle — `LauncherRoot` writes it via `saveHighlighting`. */
  onHighlightingChange: (enabled: boolean) => void;
}

export default function SettingsScreen({
  onBack,
  serverUrl,
  onServerUrlChange,
  highlighting,
  onHighlightingChange,
}: Readonly<SettingsScreenProps>) {
  const { theme } = useTheme();
  const [serverUrlDraft, setServerUrlDraft] = useState(serverUrl ?? '');
  const p = shellPalette(theme);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={[styles.header, { borderBottomColor: p.cardBorder }]}>
        <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.accent }]}>{'‹ ' + COPY.backLabel}</Text>
        </TouchableOpacity>
        <Text style={[TYPE_SCALE.screenTitle, { color: p.text }]}>{COPY.settingsTitle}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: p.textMuted }]}>
          {COPY.serverAddressSectionTitle}
        </Text>
        <TextInput
          value={serverUrlDraft}
          onChangeText={(next) => { setServerUrlDraft(next); onServerUrlChange(next); }}
          placeholder={COPY.serverAddressPlaceholder}
          placeholderTextColor={p.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[
            TYPE_SCALE.body,
            styles.serverInput,
            { color: p.text, borderColor: p.cardBorder, backgroundColor: p.card },
          ]}
        />
        <Text style={[TYPE_SCALE.caption, styles.hint, { color: p.textMuted }]}>{COPY.serverAddressHint}</Text>

        <Text style={[TYPE_SCALE.eyebrow, styles.sectionTitle, { color: p.textMuted }]}>
          {COPY.highlightingSectionTitle}
        </Text>
        <View style={[styles.row, { backgroundColor: p.card, borderColor: p.cardBorder }]}>
          <Text style={[TYPE_SCALE.body, { color: p.text }]}>{COPY.highlightingSectionTitle}</Text>
          <Switch
            value={highlighting}
            onValueChange={onHighlightingChange}
            trackColor={{ false: p.cardBorder, true: p.accent }}
            thumbColor={p.onAccent}
          />
        </View>
        <Text style={[TYPE_SCALE.caption, styles.hint, { color: p.textMuted }]}>{COPY.highlightingHint}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { paddingVertical: 2 },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { marginTop: 24, marginBottom: 10 },
  serverInput: { borderWidth: 1, borderRadius: RADIUS.field, paddingHorizontal: 12, paddingVertical: 10 },
  hint: { marginTop: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: RADIUS.field,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});
