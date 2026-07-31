// ─────────────────────────────────────────────────────────────────────────────
// FailureScreen — failure shown honestly, never as a crash (prompt-flow-ux, design D1,
// spec "Failure is shown honestly, never as a crash").
// ─────────────────────────────────────────────────────────────────────────────
// A full-screen sibling of the other launcher screens: `shellPalette(theme)`, own hardware-back
// binding (routed to `onDismiss`), every string from `copy.ts`. HINT-ONLY BY CONSTRUCTION: this
// component's props carry `reason` (the terminal event's or the client error's plain-English
// summary) and a list of `{hint: string}` — never a `Diagnostic`'s `kind`/`symbol`/`message`.
// "Rephrase" returns to the prompt screen with the user's text preserved (the caller re-opens
// `PromptScreen` with `initialText` set to that same text — this screen only signals the intent).
import React, { useEffect } from 'react';
import { BackHandler, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COPY } from './copy';
import { shellPalette } from './theme';
import { useTheme } from './theme-context';

export interface FailureScreenProps {
  /** The terminal `failure` event's `reason`, or a plain-English client/stream-error summary. */
  reason: string;
  /** Hint-only diagnostic detail — never `kind`/`symbol`/`message`. */
  diagnostics: readonly { hint: string }[];
  /** Returns to the prompt screen with the user's text preserved. */
  onRephrase: () => void;
  /** Dismisses the failure screen (back to home). */
  onDismiss: () => void;
}

export default function FailureScreen({ reason, diagnostics, onRephrase, onDismiss }: Readonly<FailureScreenProps>) {
  const { theme } = useTheme();
  const p = shellPalette(theme);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [onDismiss]);

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: p.text }]}>{COPY.failureTitle}</Text>
        <Text style={[styles.reason, { color: p.textMuted }]}>{reason}</Text>

        {diagnostics.length > 0 && (
          <>
            <Text style={[styles.hintsTitle, { color: p.textMuted }]}>{COPY.failureHintsTitle}</Text>
            <FlatList
              data={diagnostics}
              keyExtractor={(item, index) => `${index}:${item.hint}`}
              renderItem={({ item }) => (
                <Text style={[styles.hint, { color: p.text }]}>{'• ' + item.hint}</Text>
              )}
            />
          </>
        )}
      </View>

      <TouchableOpacity onPress={onRephrase} style={[styles.rephrase, { backgroundColor: p.accent }]}>
        <Text style={[styles.rephraseText, { color: p.onAccent }]}>{COPY.failureRephrase}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onDismiss} style={[styles.dismiss, { borderColor: p.cardBorder }]}>
        <Text style={[styles.dismissText, { color: p.textMuted }]}>{COPY.failureDismiss}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1, padding: 16 },
  title: { fontSize: 18, fontWeight: '800' },
  reason: { fontSize: 14, marginTop: 8 },
  hintsTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20 },
  hint: { fontSize: 14, marginTop: 8 },
  rephrase: { marginHorizontal: 16, marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  rephraseText: { fontSize: 16, fontWeight: '700' },
  dismiss: { margin: 16, marginTop: 10, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  dismissText: { fontSize: 15, fontWeight: '700' },
});
