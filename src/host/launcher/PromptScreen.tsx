// ─────────────────────────────────────────────────────────────────────────────
// PromptScreen — the prompt flow's entry surface (prompt-flow-ux, design D1/D3).
// ─────────────────────────────────────────────────────────────────────────────
// A full-screen sibling of SettingsScreen/HistoryScreen: its own hardware-back binding,
// `shellPalette(theme)` colors, every string from `copy.ts`. Purely presentational — submitting
// hands the trimmed text up to `onSubmit`; the rewrite request, the SSE loop, and delivery all
// live in `LauncherRoot` (design D1). `editing` absent = the home tile's new-app flow; present =
// the per-app "Prompt again" edit flow (`app-launcher` spec). `initialText` seeds the input when
// re-entering this screen with the user's text preserved (the failure screen's "rephrase" path).
// `serverConfigured` is a plain boolean handed down by the caller (design D3's Settings field
// lives in `SettingsScreen`/`LauncherRoot`, not here) — when false this screen shows an honest
// message and never lets the user submit, matching the "server address" requirement exactly.
import React, { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { InstalledApp } from './app-index';
import { COPY } from './copy';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

export interface PromptScreenProps {
  /** Present = re-prompting this installed app; absent = the home tile's new-app flow. */
  editing?: InstalledApp;
  /** Seeds the input — used to preserve the user's text across a failure-screen "rephrase". */
  initialText?: string;
  /** Whether a server address has been entered in Settings (design D3). */
  serverConfigured: boolean;
  /** Hands the trimmed prompt text up; only ever called when `serverConfigured` is true. */
  onSubmit: (text: string) => void;
  /** Returns to the home screen — supplied by `LauncherRoot`. */
  onBack: () => void;
  /** Opens the Settings screen — offered alongside the unconfigured-server message. */
  onOpenSettings: () => void;
}

export default function PromptScreen({ editing, initialText, serverConfigured, onSubmit, onBack, onOpenSettings }: Readonly<PromptScreenProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);

  const [text, setText] = useState(initialText ?? '');

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const trimmed = text.trim();
  const canSubmit = serverConfigured && trimmed.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={[styles.header, { borderBottomColor: p.cardBorder }]}>
        <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <Text style={[styles.backText, { color: p.accent }]}>{'‹ ' + COPY.backLabel}</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: p.text }]}>{editing ? COPY.promptTitleEdit : COPY.promptTitleNew}</Text>
      </View>

      <View style={styles.content}>
        {!serverConfigured && (
          <View style={[styles.notice, { backgroundColor: p.card, borderColor: p.cardBorder }]}>
            <Text style={[styles.noticeText, { color: p.text }]}>{COPY.promptServerUnconfigured}</Text>
            <TouchableOpacity onPress={onOpenSettings} hitSlop={10}>
              <Text style={[styles.noticeAction, { color: p.accent }]}>{COPY.promptOpenSettings}</Text>
            </TouchableOpacity>
          </View>
        )}

        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={COPY.promptPlaceholder}
          placeholderTextColor={p.textMuted}
          style={[styles.input, { color: p.text, borderColor: p.cardBorder, backgroundColor: p.card }]}
          multiline
          autoFocus
          editable={serverConfigured}
          textAlignVertical="top"
        />
        <Text style={[styles.dictationHint, { color: p.textMuted }]}>{COPY.promptDictationHint}</Text>
      </View>

      <TouchableOpacity
        onPress={submit}
        disabled={!canSubmit}
        style={[styles.submit, { backgroundColor: canSubmit ? p.accent : p.card, borderColor: p.cardBorder }]}
      >
        <Text style={[styles.submitText, { color: canSubmit ? p.onAccent : p.textMuted }]}>{COPY.promptSubmit}</Text>
      </TouchableOpacity>
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
  backText: { fontSize: 15, fontWeight: '700' },
  title: { fontSize: 18, fontWeight: '800' },
  content: { flex: 1, padding: 16 },
  notice: { borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 16 },
  noticeText: { fontSize: 14, fontWeight: '600' },
  noticeAction: { fontSize: 14, fontWeight: '700', marginTop: 10 },
  input: { flex: 1, minHeight: 140, fontSize: 16, borderWidth: 1, borderRadius: 12, padding: 14 },
  dictationHint: { fontSize: 12, marginTop: 10 },
  submit: { margin: 16, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  submitText: { fontSize: 16, fontWeight: '700' },
});
