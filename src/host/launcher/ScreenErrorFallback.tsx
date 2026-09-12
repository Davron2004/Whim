// ─────────────────────────────────────────────────────────────────────────────
// ScreenErrorFallback — the recoverable error screen `ScreenBoundary` renders (obs-v1, design D1,
// host-observability "Every screen renders inside a recoverable error boundary").
// ─────────────────────────────────────────────────────────────────────────────
// Plain English and one retry affordance. The thrown error NEVER reaches the surface — it went to
// the logging seam before this rendered; here it only decides that something failed. Styled from
// the v2 tokens alone (`TYPE_SCALE`/`SPACING`/`RADIUS` + `SHELL_PALETTE`): no hex, no numeric
// font-size or radius literal. Every string comes from `copy.ts`.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { COPY } from './copy';
import type { ScreenFallbackProps } from './ScreenBoundary';
import { SHELL_PALETTE } from './theme';

export default function ScreenErrorFallback({ resetErrorBoundary }: Readonly<ScreenFallbackProps>) {
  const p = SHELL_PALETTE;

  return (
    <View style={[styles.root, { backgroundColor: p.bg }]}>
      <Text style={[TYPE_SCALE.screenTitle, { color: p.text }]}>{COPY.screenErrorTitle}</Text>
      <Text style={[TYPE_SCALE.body, styles.body, { color: p.textMuted }]}>{COPY.screenErrorBody}</Text>
      <TouchableOpacity
        onPress={resetErrorBoundary}
        accessibilityRole="button"
        style={[styles.retry, { backgroundColor: p.accent }]}
      >
        <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.screenErrorRetry}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'center', paddingHorizontal: SPACING.lg },
  body: { marginTop: SPACING.xs },
  retry: {
    marginTop: SPACING.lg,
    alignSelf: 'flex-start',
    borderRadius: RADIUS.card,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
});
