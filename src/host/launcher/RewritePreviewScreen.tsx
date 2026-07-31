// ─────────────────────────────────────────────────────────────────────────────
// RewritePreviewScreen — the rewrite preview before generation (prompt-flow-ux, design D1/D4).
// ─────────────────────────────────────────────────────────────────────────────
// A full-screen sibling of the other launcher screens: `shellPalette(theme)`, own hardware-back
// binding, every string from `copy.ts`. v1's rewrite is one plain-English string end to end
// (design D4) — no separate "intent" vs. "SDK-detail" split — so this screen is a single
// editable `TextInput` seeded with `rewrittenPrompt`, with the original prompt shown small/muted
// above it for context only (never editable here). Approving hands the CURRENT text of the
// input to `onApprove` (possibly edited, per the spec's "user can edit the rewritten text"
// scenario) — never the original `rewrittenPrompt` value. No SDK-specific or engineering-internal
// detail is shown here, only the plain rewritten text (spec requirement).
import React, { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { COPY } from './copy';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

export interface RewritePreviewScreenProps {
  /** The user's original submitted text — shown small/muted for context, never editable here. */
  originalPrompt: string;
  /** The rewrite response's text — seeds the editable input. */
  rewrittenPrompt: string;
  /** Called with the (possibly edited) current text of the input. */
  onApprove: (text: string) => void;
  /** Returns to the prompt screen — supplied by `LauncherRoot`. */
  onBack: () => void;
}

export default function RewritePreviewScreen({ originalPrompt, rewrittenPrompt, onApprove, onBack }: Readonly<RewritePreviewScreenProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);

  const [text, setText] = useState(rewrittenPrompt);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const approve = () => onApprove(text);

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={[styles.header, { borderBottomColor: p.cardBorder }]}>
        <TouchableOpacity onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <Text style={[styles.backText, { color: p.accent }]}>{'‹ ' + COPY.backLabel}</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: p.text }]}>{COPY.rewritePreviewTitle}</Text>
      </View>

      <View style={styles.content}>
        <Text style={[styles.originalLabel, { color: p.textMuted }]}>{COPY.rewritePreviewOriginalLabel}</Text>
        <Text style={[styles.originalText, { color: p.textMuted }]} numberOfLines={3}>{originalPrompt}</Text>

        <TextInput
          value={text}
          onChangeText={setText}
          style={[styles.input, { color: p.text, borderColor: p.cardBorder, backgroundColor: p.card }]}
          multiline
          textAlignVertical="top"
        />
      </View>

      <TouchableOpacity onPress={approve} style={[styles.approve, { backgroundColor: p.accent }]}>
        <Text style={[styles.approveText, { color: p.onAccent }]}>{COPY.rewritePreviewApprove}</Text>
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
  originalLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  originalText: { fontSize: 13, marginTop: 4, marginBottom: 16 },
  input: { flex: 1, minHeight: 140, fontSize: 16, borderWidth: 1, borderRadius: 12, padding: 14 },
  approve: { margin: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  approveText: { fontSize: 16, fontWeight: '700' },
});
