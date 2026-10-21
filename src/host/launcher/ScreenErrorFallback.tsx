// ─────────────────────────────────────────────────────────────────────────────
// ScreenErrorFallback — the recoverable error screen `ScreenBoundary` renders (obs-v1, design D1,
// host-observability "Every screen renders inside a recoverable error boundary").
// ─────────────────────────────────────────────────────────────────────────────
// Plain English and one retry affordance. The thrown error NEVER reaches the surface — it went to
// the logging seam before this rendered; here it only decides that something failed. Drawn as a
// full screen in the phone's appearance from the shell's primitives; every string comes from
// `copy.ts`.
import React from 'react';
import { ScrollView, View } from 'react-native';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { COPY } from './copy';
import { fullScreenStyles } from './full-screen-styles';
import type { ScreenFallbackProps } from './ScreenBoundary';
import { useSystemBack } from './use-system-back';

/** Rendered only when `onLeave` is given (design D7) — Home's fallback stays `Try again` alone.
 *  A separate component keeps `useSystemBack`'s hook call unconditional on every mount where it
 *  runs at all. */
function LeaveAction({ onLeave }: Readonly<{ onLeave: () => void }>) {
  useSystemBack(onLeave);

  return <Button label={COPY.screenErrorBack} variant="plain" onPress={onLeave} />;
}

export default function ScreenErrorFallback({ resetErrorBoundary, onLeave }: Readonly<ScreenFallbackProps>) {
  const s = fullScreenStyles(useTokens());

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.content}>
        <Text type="title1">{COPY.screenErrorTitle}</Text>
        <Text type="callout" color="text-2">{COPY.screenErrorBody}</Text>
      </ScrollView>
      <View style={s.footer}>
        <Button label={COPY.screenErrorRetry} variant="ink" onPress={resetErrorBoundary} />
        {onLeave != null && <LeaveAction onLeave={onLeave} />}
      </View>
    </View>
  );
}
