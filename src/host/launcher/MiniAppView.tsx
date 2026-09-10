// ─────────────────────────────────────────────────────────────────────────────
// MiniAppView — a full-screen mini-app, launched from a host record (launcher-shell / #5).
// ─────────────────────────────────────────────────────────────────────────────
// One WebView == one realm == one app (#41 D2). The bundle is delivered BY SOURCE from the
// installed record's active version-store snapshot (#5 D3) — the iframe-side contract is
// byte-identical to the baked path. The orb menu's Home action (D5, shell-redesign-v2 D12) and
// Android system back (D4) both exit to the launcher; the realm can reach neither. LauncherRoot
// keys this component by
// the launcher id, so switching apps remounts it (a fresh realm every launch).
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { AppRecord } from '../bridge';
import type { WhimTheme } from '../../sdk/theme';
import { RADIUS, SPACING, TYPE_SCALE } from '../../sdk/theme';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import { loadEndAction } from './realm-delivery';
import { logWebViewError } from './webview-error';
import { useMiniAppHost } from './useMiniAppHost';
import { shellPalette } from './theme';
import { COPY } from './copy';
import { miniAppSurface } from './boot-state';
import { BreathingView } from './flow-skeletons';
import Orb from './Orb';

export interface MiniAppViewProps {
  record: AppRecord;
  bundleSource: string;
  /** The runtime engine appId (the launcher id, #5 D8) — a fork's own user data. */
  engineAppId: string;
  /** The resolved launcher theme, forwarded opaquely into delivery (design sdk-design-system D8). */
  theme: WhimTheme;
  onExit: () => void;
  /** Orb "Versions" — opens the real History screen for this running app. */
  onVersions: () => void;
  /** Orb "Change it" — opens the compose step prefilled for this running app (same path
   *  History's own "Change it from here" row action uses). */
  onChangeIt: () => void;
}

export default function MiniAppView({
  record,
  bundleSource,
  engineAppId,
  theme,
  onExit,
  onVersions,
  onChangeIt,
}: Readonly<MiniAppViewProps>) {
  const host = useMiniAppHost({ onExit });
  const p = shellPalette(theme);
  const bg = p.bg;
  // Bumped on Retry to force a fresh <WebView> mount -- a realm reset is a RECREATE, never a
  // re-inject (spike2 §5, #35/#37), so this is the only supported way to recover a live app.
  const [webKey, setWebKey] = useState(0);

  // Deliver after the host page has loaded so injectJavaScript is not silently dropped (#5 B1) --
  // exactly ONCE per <WebView> instance. Android's WebView does NOT promise one onPageFinished
  // (RN's onLoadEnd) per page load: it fires more than once on some devices/WebView versions, and
  // a second delivery would bind a new host generation and reinject into the live page, tearing
  // down the realm the user is already looking at. `deliveredKey` records the mount delivery
  // happened for, so the two legitimate deliveries still happen -- the component's first mount
  // (keyed by launcher id), and every Retry remount (a bumped webKey, i.e. a RECREATED realm,
  // spike2 §5) -- while a repeat for the same key is dropped. Theme is re-captured at each real
  // delivery, matching the "theme applies at delivery" model (design sdk-design-system Non-Goals):
  // a running realm never re-themes live.
  const deliveredKey = useRef<number | null>(null);
  const handleLoadEnd = useCallback(() => {
    if (loadEndAction(deliveredKey.current, webKey) === 'duplicate') {
      log.debug(CHANNELS.app, 'duplicate onLoadEnd for a delivered realm, not delivering again', {
        appId: record.appId,
        webKey,
      });
      return;
    }
    deliveredKey.current = webKey;
    host.deliverBySource(record, bundleSource, engineAppId, theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webKey]);

  // Which of the four container surfaces this render belongs to. The precedence (both failure
  // surfaces above the boot state) is decided by the pure `miniAppSurface` -- a launch that fails
  // before any paint is unpainted too, so an implicit "unpainted means booting" would park the
  // user in a permanent opening screen instead of the honest failure copy.
  const surface = miniAppSurface(host.state);

  // A launch refused pre-delivery (#41 D7, structured `launchApp` failure) never delivers a
  // bundle -- show honest product copy instead of a blank realm, with a way back to Home.
  if (surface === 'launch-failed') {
    return (
      <View style={[styles.root, styles.errorRoot, { backgroundColor: p.bg }]}>
        <Text style={[TYPE_SCALE.screenTitle, styles.errorTitle, { color: p.text }]}>{COPY.launchFailedTitle}</Text>
        <Text style={[TYPE_SCALE.bodyEmphatic, styles.errorBody, { color: p.textMuted }]}>{COPY.launchFailedBody}</Text>
        <Pressable style={[styles.errorButton, { backgroundColor: p.accent }]} onPress={onExit}>
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.launchFailedBack}</Text>
        </Pressable>
      </View>
    );
  }

  // A post-delivery failure (a fatal bundle-error frame, or a delivered app that never paints --
  // the watchdog in useMiniAppHost) leaves the realm dark otherwise -- show honest product copy
  // instead of a blank screen, with a way to retry the same app or leave to Home. Retry clears
  // lastError AND bumps webKey together: clearing alone can't remount (the branch below never
  // renders while lastError is set), and bumping the key alone can't reset lastError (only bind()
  // does that) -- both are needed to fall through into a fresh <WebView> mount.
  if (surface === 'app-error') {
    const retry = () => {
      host.clearLastError();
      setWebKey((k) => k + 1);
    };
    return (
      <View style={[styles.root, styles.errorRoot, { backgroundColor: p.bg }]}>
        <Text style={[TYPE_SCALE.screenTitle, styles.errorTitle, { color: p.text }]}>{COPY.appErrorTitle}</Text>
        <Text style={[TYPE_SCALE.bodyEmphatic, styles.errorBody, { color: p.textMuted }]}>{COPY.appErrorBody}</Text>
        <Pressable style={[styles.errorButton, { backgroundColor: p.accent }]} onPress={retry}>
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.appErrorRetry}</Text>
        </Pressable>
        <Pressable style={[styles.errorButton, { backgroundColor: p.accent }]} onPress={onExit}>
          <Text style={[TYPE_SCALE.bodyEmphatic, { color: p.onAccent }]}>{COPY.launchFailedBack}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <WebView
        key={webKey}
        ref={host.webRef}
        style={[styles.web, { backgroundColor: bg }]}
        originWhitelist={['*']}
        source={{ html: host.runtimeHtml }}
        onMessage={(e) => host.onMessage(e.nativeEvent.data)}
        onLoadEnd={handleLoadEnd}
        javaScriptEnabled
        domStorageEnabled={false}
        setSupportMultipleWindows={false}
        onError={(ev) => logWebViewError(log, ev.nativeEvent, { appId: record.appId })}
      />
      {/* The boot state: branded and minimal, drawn OVER a WebView that stays mounted and keeps
          loading -- a realm reset is a recreate, never a re-inject (spike2 §5), so the overlay must
          never gate the mount. It defines all four insets, so it spans the root's full border-box.
          The root already sits below the status bar (the launcher's top SafeAreaView is the one
          place the top inset is applied), so the overlay adds no inset of its own.
          `pointerEvents="none"` keeps the orb's guaranteed exit reachable throughout the wait. */}
      {surface === 'boot' && (
        <View
          style={[styles.boot, { backgroundColor: bg }]}
          pointerEvents="none"
          accessibilityRole="progressbar"
          accessibilityLabel={COPY.appBootA11yLabel}
        >
          <Text style={[TYPE_SCALE.screenTitle, styles.bootTitle, { color: p.text }]}>{record.name}</Text>
          <BreathingView style={[styles.bootMark, { backgroundColor: p.accent }]} />
          <Text style={[TYPE_SCALE.bodyEmphatic, styles.bootLabel, { color: p.textMuted }]}>{COPY.appBootLabel}</Text>
        </View>
      )}
      <Orb onExit={host.exit} onVersions={onVersions} onChangeIt={onChangeIt} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  web: { flex: 1 },
  errorRoot: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl },
  errorTitle: { textAlign: 'center', marginBottom: SPACING.sm },
  errorBody: { textAlign: 'center', marginBottom: SPACING.lg },
  // marginBottom, not a bare stack: two flush pills read as one overlapping shape on device.
  errorButton: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.field, marginBottom: SPACING.sm },
  boot: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl },
  bootTitle: { textAlign: 'center', marginBottom: SPACING.md },
  bootMark: { width: SPACING.xl, height: SPACING.xs, borderRadius: RADIUS.chip, marginBottom: SPACING.md },
  bootLabel: { textAlign: 'center' },
});
