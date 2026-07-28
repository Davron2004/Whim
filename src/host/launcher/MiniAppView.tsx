// ─────────────────────────────────────────────────────────────────────────────
// MiniAppView — a full-screen mini-app, launched from a host record (launcher-shell / #5).
// ─────────────────────────────────────────────────────────────────────────────
// One WebView == one realm == one app (#41 D2). The bundle is delivered BY SOURCE from the
// installed record's active version-store snapshot (#5 D3) — the iframe-side contract is
// byte-identical to the baked path. The floating affordance (D5) and Android system back (D4)
// both exit to the launcher; the realm can reach neither. LauncherRoot keys this component by
// the launcher id, so switching apps remounts it (a fresh realm every launch).
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { AppRecord } from '../bridge';
import type { WhimTheme } from '../../sdk/theme';
import { useMiniAppHost } from './useMiniAppHost';
import { shellPalette } from './theme';
import { COPY } from './copy';
import FloatingExit from './FloatingExit';

export interface MiniAppViewProps {
  record: AppRecord;
  bundleSource: string;
  /** The runtime engine appId (the launcher id, #5 D8) — a fork's own user data. */
  engineAppId: string;
  /** The resolved launcher theme, forwarded opaquely into delivery (design sdk-design-system D8). */
  theme: WhimTheme;
  onExit: () => void;
}

export default function MiniAppView({ record, bundleSource, engineAppId, theme, onExit }: Readonly<MiniAppViewProps>) {
  const host = useMiniAppHost({ onExit });
  const insets = useSafeAreaInsets();
  const bg = shellPalette(theme).bg;

  // Deliver after the host page has loaded so injectJavaScript is not silently dropped (#5 B1).
  // The component is keyed by launcher id, so each app is a fresh mount and onLoadEnd fires once
  // — theme is captured at that first delivery, matching the "theme applies at delivery" model
  // (design sdk-design-system Non-Goals): a running realm never re-themes live.
  const handleLoadEnd = useCallback(() => {
    host.deliverBySource(record, bundleSource, engineAppId, theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A launch refused pre-delivery (#41 D7, structured `launchApp` failure) never delivers a
  // bundle -- show honest product copy instead of a blank realm, with a way back to Home.
  if (host.state.launchFailed) {
    const p = shellPalette(theme);
    return (
      <View style={[styles.root, styles.errorRoot, { paddingTop: insets.top, backgroundColor: p.bg }]}>
        <Text style={[styles.errorTitle, { color: p.text }]}>{COPY.launchFailedTitle}</Text>
        <Text style={[styles.errorBody, { color: p.textMuted }]}>{COPY.launchFailedBody}</Text>
        <Pressable style={[styles.errorButton, { backgroundColor: p.accent }]} onPress={onExit}>
          <Text style={[styles.errorButtonLabel, { color: p.onAccent }]}>{COPY.launchFailedBack}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: bg }]}>
      <WebView
        ref={host.webRef}
        style={[styles.web, { backgroundColor: bg }]}
        originWhitelist={['*']}
        source={{ html: host.runtimeHtml }}
        onMessage={(e) => host.onMessage(e.nativeEvent.data)}
        onLoadEnd={handleLoadEnd}
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        onError={(ev) => console.log('[whim] webview error', JSON.stringify(ev.nativeEvent))}
      />
      <FloatingExit onPress={host.exit} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  web: { flex: 1 },
  errorRoot: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  errorTitle: { fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 12 },
  errorBody: { fontSize: 15, textAlign: 'center', marginBottom: 24 },
  errorButton: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 },
  errorButtonLabel: { fontSize: 15, fontWeight: '600' },
});
