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
import { useSystemBack } from './use-system-back';

/** Rendered only when `onLeave` is given (design D7) — Home's fallback stays `Try again` alone.
 *  A separate component keeps `useSystemBack`'s hook call unconditional on every mount where it
 *  runs at all. */
function LeaveAction({ onLeave }: Readonly<{ onLeave: () => void }>) {
  const p = SHELL_PALETTE;
  useSystemBack(onLeave);

  return (
    <TouchableOpacity onPress={onLeave} accessibilityRole="button" style={styles.leave}>
      <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.textMuted }]}>{COPY.screenErrorBack}</Text>
    </TouchableOpacity>
  );
}

export default function ScreenErrorFallback({ resetErrorBoundary, onLeave }: Readonly<ScreenFallbackProps>) {
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
      {onLeave != null && <LeaveAction onLeave={onLeave} />}
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
  leave: {
    marginTop: SPACING.md,
    alignSelf: 'flex-start',
    paddingVertical: SPACING.sm,
  },
});
