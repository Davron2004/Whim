// ─────────────────────────────────────────────────────────────────────────────
// MiniAppView — a full-screen mini-app, launched from a host record (launcher-shell / #5).
// ─────────────────────────────────────────────────────────────────────────────
// One WebView == one realm == one app (#41 D2). The bundle is delivered BY SOURCE from the
// installed record's active version-store snapshot (#5 D3) — the iframe-side contract is
// byte-identical to the baked path. The orb menu's Home action (D5, shell-redesign-v2 D12) and
// Android system back (D4) both exit to the launcher; the realm can reach neither. LauncherRoot
// keys this component by
// the launcher id, so switching apps remounts it (a fresh realm every launch).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { AppRecord } from '../bridge';
import { RADIUS, SPACING } from '../../sdk/theme';
import { SPACE } from '../../design/tokens';
import { TilePlate } from '../ui/AppTile';
import { TILE_SIDE } from '../ui/AppTile-geometry';
import { timing } from '../ui/motion';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { buttonColors } from '../ui/tokens-pure';
import { themeFrame } from './theme-frame';
import { tileOf } from './tile-identity';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import { loadEndAction } from './realm-delivery';
import { logWebViewError } from './webview-error';
import { useMiniAppHost } from './useMiniAppHost';
import { useKeyboardInset } from './KeyboardShell';
import { padsWebViewForKeyboard } from './keyboard-shell';
import { COPY } from './copy';
import { miniAppSurface, OPENING_LABEL_AFTER_MS, OPENING_REVEAL_CAP_MS, openingLook } from './boot-state';
import Orb from './Orb';
import { chromeInsetBottom } from './orb-geometry';
import { ReportSheet } from './ReportScreen';
import type { InstalledApp } from './app-index';
import type { StoreAccess } from './store-access';
import type { ClientOptions } from './generation-client';
import type { LegalLanguage } from './legal-language';

export interface MiniAppViewProps {
  record: AppRecord;
  bundleSource: string;
  /** The runtime engine appId (the launcher id, #5 D8) — a fork's own user data. */
  engineAppId: string;
  onExit: () => void;
  /** Orb "Versions" — opens the real History screen for this running app. */
  onVersions: () => void;
  /** Orb "Change it" — opens the compose step prefilled for this running app (same path
   *  History's own "Change it from here" row action uses). */
  onChangeIt: () => void;
  /** The installed-apps entry for this running app (design D13) — `ReportSheet`'s
   *  `reportDraftFor(entry, access)` input for the orb's "Report this app" action. */
  installedApp: InstalledApp;
  access: StoreAccess;
  /** Plain `ClientOptions` for the report sheet's `sendReport` call — no AI-data consent required
   *  (design D3). */
  reportOptions: ClientOptions;
  /** The orb's report was refused `update_required`: the host opens the update screen in place of
   *  this running app (request-envelope D5). */
  onUpdateRequired: () => void;
  /** The active legal language, for the report sheet's privacy link. */
  legalLanguage: LegalLanguage;
}

export default function MiniAppView({
  record,
  bundleSource,
  engineAppId,
  onExit,
  onVersions,
  onChangeIt,
  installedApp,
  access,
  reportOptions,
  onUpdateRequired,
  legalLanguage,
}: Readonly<MiniAppViewProps>) {
  // The report sheet is a host-layer overlay over the running realm (design D14): while it is
  // open, back-policy's `overlayOpen` input closes it instead of forwarding the press into the
  // app or exiting (mini-app-back-navigation delta "A host sheet takes back first").
  const [reportOpen, setReportOpen] = useState(false);
  const host = useMiniAppHost({ onExit, overlayOpen: reportOpen, onCloseOverlay: () => setReportOpen(false) });
  // Bumped on Retry to force a fresh <WebView> mount -- a realm reset is a RECREATE, never a
  // re-inject (spike2 §5, #35/#37), so this is the only supported way to recover a live app.
  const [webKey, setWebKey] = useState(0);
  // The keyboard (beta-1 D3): the page ends at its top edge on Android, where no window resizes for
  // it, so the page's viewport shrinks and the runtime scrolls the focused field into view
  // (`loader.js`). iOS's WebView avoids the keyboard itself (`padsWebViewForKeyboard`).
  const frame = useRef<View>(null);
  const keyboard = useKeyboardInset(frame, padsWebViewForKeyboard(Platform.OS));

  // Deliver after the host page has loaded so injectJavaScript is not silently dropped (#5 B1) --
  // exactly ONCE per <WebView> instance. Android's WebView does NOT promise one onPageFinished
  // (RN's onLoadEnd) per page load: it fires more than once on some devices/WebView versions, and
  // a second delivery would bind a new host generation and reinject into the live page, tearing
  // down the realm the user is already looking at. `deliveredKey` records the mount delivery
  // happened for, so the two legitimate deliveries still happen -- the component's first mount
  // (keyed by launcher id), and every Retry remount (a bumped webKey, i.e. a RECREATED realm,
  // spike2 §5) -- while a repeat for the same key is dropped. The theme is built at each real
  // delivery from the phone's settings at that moment and the app's tint (design-system-v1 D3): a
  // running realm never re-themes live, and a settings change applies at the next open or Retry.
  // It carries how much of the app's bottom edge the orb covers (beta-1 D5), computed from this
  // delivery's bottom safe-area inset; the loader keeps that out of the bundle-visible theme.
  const tokens = useTokens();
  // The container's own chrome paints the token `bg` of the phone's scheme, as the page does: a dark
  // page never sits on a light container (system.md §2: the runtime page, the iframe and the opening
  // container all paint `bg`).
  const c = tokens.colors;
  const bg = c.bg;
  const { tint, icon } = tileOf(installedApp);
  const theme = useMemo(() => themeFrame(tokens, tint), [tokens, tint]);
  const bottomInset = useSafeAreaInsets().bottom;
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
    host.deliverBySource(record, bundleSource, engineAppId, { ...theme, chromeInsetBottom: chromeInsetBottom(bottomInset) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webKey, bottomInset, theme]);

  // Which of the four container surfaces this render belongs to. The precedence (both failure
  // surfaces above the boot state) is decided by the pure `miniAppSurface` -- a launch that fails
  // before any paint is unpainted too, so an implicit "unpainted means booting" would park the
  // user in a permanent opening screen instead of the honest failure copy.
  const surface = miniAppSurface(host.state);

  // The opening state (M2, design-system-v1 task 18.3). The WebView stays mounted and drawn from the
  // start, under an opaque `bg` cover, so the page keeps loading and its double-rAF `paint` is never
  // throttled by a hidden view; the cover fades out over `fade-in` once this launch's signal
  // (`paintMs`, generation-fenced) arrives or the 600 ms cap passes. Above it the app's tile-sized
  // plate holds until the paint, with "Opening…" under it after 1.5 s. Both timers are keyed by the
  // WebView mount, so Retry's recreated realm opens from the start again. Under Reduce Motion the
  // fade is itself the replacement (§4.5), so it is played, not skipped.
  const [capFor, setCapFor] = useState<number | null>(null);
  const [labelFor, setLabelFor] = useState<number | null>(null);
  useEffect(() => {
    const cap = setTimeout(() => setCapFor(webKey), OPENING_REVEAL_CAP_MS);
    const label = setTimeout(() => setLabelFor(webKey), OPENING_LABEL_AFTER_MS);
    return () => {
      clearTimeout(cap);
      clearTimeout(label);
    };
  }, [webKey]);
  const look = openingLook(surface, { cap: capFor === webKey, label: labelFor === webKey });
  const reduceMotion = tokens.reduceMotion;
  const cover = useSharedValue(1);
  const plate = useSharedValue(1);
  useEffect(() => {
    cover.value = look.revealed ? withTiming(0, timing('fadeIn', reduceMotion)) : 1;
  }, [cover, look.revealed, reduceMotion]);
  useEffect(() => {
    plate.value = look.plate ? 1 : withTiming(0, timing('fadeIn', reduceMotion));
  }, [plate, look.plate, reduceMotion]);
  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.value }));
  const plateStyle = useAnimatedStyle(() => ({ opacity: plate.value }));
  const primary = buttonColors(tokens, 'ink', false);

  // A launch refused pre-delivery (#41 D7, structured `launchApp` failure) never delivers a
  // bundle -- show honest product copy instead of a blank realm, with a way back to Home.
  if (surface === 'launch-failed') {
    return (
      <View style={[styles.root, styles.errorRoot, { backgroundColor: bg }]}>
        <Text type="title2" style={styles.errorTitle}>{COPY.launchFailedTitle}</Text>
        <Text color="text-2" style={styles.errorBody}>{COPY.launchFailedBody}</Text>
        <Pressable
          accessibilityRole="button"
          style={[styles.errorAction, { backgroundColor: primary.fill, borderColor: primary.fill }]}
          onPress={onExit}
        >
          <Text type="headline" color="on-ink">{COPY.launchFailedBack}</Text>
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
      <View style={[styles.root, styles.errorRoot, { backgroundColor: bg }]}>
        <Text type="title2" style={styles.errorTitle}>{COPY.appErrorTitle}</Text>
        <Text color="text-2" style={styles.errorBody}>{COPY.appErrorBody}</Text>
        <Pressable
          accessibilityRole="button"
          style={[styles.errorAction, { backgroundColor: primary.fill, borderColor: primary.fill }]}
          onPress={retry}
        >
          <Text type="headline" color="on-ink">{COPY.appErrorRetry}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={[styles.errorAction, styles.errorSecondary, { backgroundColor: bg, borderColor: c.border }]}
          onPress={onExit}
        >
          <Text type="headline" color="text-2">{COPY.launchFailedBack}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View ref={frame} collapsable={false} style={[styles.root, { backgroundColor: bg, paddingBottom: keyboard }]}>
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
      {/* The opening state, drawn OVER a WebView that stays mounted and keeps loading -- a realm
          reset is a recreate, never a re-inject (spike2 §5), so it must never gate the mount. Both
          layers define all four insets, so they span the root's full border-box (the root already
          sits below the status bar). `pointerEvents="none"` keeps the orb's guaranteed exit
          reachable throughout the wait. */}
      <Animated.View style={[styles.layer, { backgroundColor: bg }, coverStyle]} pointerEvents="none" />
      <Animated.View
        style={[styles.layer, styles.opening, plateStyle]}
        pointerEvents="none"
        accessibilityRole={look.plate ? 'progressbar' : undefined}
        accessibilityLabel={look.plate ? COPY.appBootA11yLabel : undefined}
        accessibilityElementsHidden={!look.plate}
        importantForAccessibility={look.plate ? 'auto' : 'no-hide-descendants'}
      >
        <TilePlate size="grid" state="ready" tint={tint} glyph={icon} />
        {look.label ? (
          <View style={styles.openingLabel}>
            <Text type="callout" color="text-2" style={styles.centred}>{COPY.appBootLabel}</Text>
          </View>
        ) : null}
      </Animated.View>
      <Orb onExit={host.exit} onVersions={onVersions} onChangeIt={onChangeIt} onReport={() => setReportOpen(true)} />
      <ReportSheet
        app={reportOpen ? installedApp : null}
        access={access}
        options={reportOptions}
        legalLanguage={legalLanguage}
        onClose={() => setReportOpen(false)}
        onUpdateRequired={() => {
          setReportOpen(false);
          onUpdateRequired();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  web: { flex: 1 },
  errorRoot: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.lg },
  errorTitle: { textAlign: 'center', marginBottom: SPACING.sm },
  errorBody: { textAlign: 'center', marginBottom: SPACING.lg },
  // The app's standard pair (DoneStep): a filled primary and an outlined secondary, each the full
  // width and one height, with a gap so the two never read as one shape.
  errorAction: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorSecondary: { marginTop: SPACING.sm },
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  opening: { alignItems: 'center', justifyContent: 'center' },
  // Under the centred plate without moving it: the words appear late, and the plate must not jump.
  openingLabel: { position: 'absolute', top: '50%', left: SPACE[6], right: SPACE[6], marginTop: TILE_SIDE.grid / 2 + SPACE[3] },
  centred: { textAlign: 'center' },
});
