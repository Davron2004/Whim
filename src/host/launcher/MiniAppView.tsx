// ─────────────────────────────────────────────────────────────────────────────
// MiniAppView — a full-screen mini-app, launched from a host record (launcher-shell / #5).
// ─────────────────────────────────────────────────────────────────────────────
// One WebView == one realm == one app (#41 D2). The bundle is delivered BY SOURCE from the
// installed record's active version-store snapshot (#5 D3) — the iframe-side contract is
// byte-identical to the baked path. The orb opens the Whim sheet, whose Back to your apps (drawn by
// the launcher, `WhimSheet.tsx`) and Android system back (D4) both exit to the launcher; the realm
// can reach neither.
//
// LauncherRoot keeps the container, `MiniAppStage`, mounted, hidden while no app is open, so it can
// hold one WebView warm (design-system-v1 task 18.4, `webview-pool.ts`): the runtime page loaded and
// nothing else. Each launch is a `MiniAppView` of its own (keyed by the launch, so a fresh host,
// realm and opening state every time); it takes the waiting WebView, or a cold one, and that WebView
// is destroyed when the launch ends or fails. No WebView ever hosts a second launch. A
// fresh WebView starts waiting, unseen, once the launch has painted, so the next is warm too.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { AppRecord } from '../bridge';
import { RUNTIME_HTML } from '../../runtime/generated/runtime-html';
import { RADIUS, SPACING } from '../../sdk/theme';
import { SPACE } from '../../design/tokens';
import { TilePlate } from '../ui/AppTile';
import { TILE_SIDE } from '../ui/AppTile-geometry';
import { timing } from '../ui/motion';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { buttonColors, type ShellTokens } from '../ui/tokens-pure';
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
import {
  EMPTY_POOL,
  launchFailed,
  launchOpened,
  launchSlot,
  openApp,
  pageAnswered,
  pageGone,
  pageLoaded,
  waitingSlot,
  WARM_ANSWER,
  WARM_PROBE_JS,
  type PoolSlot,
  type WebViewPool,
} from './webview-pool';
import Orb, { type OrbProps } from './Orb';
import { chromeInsetBottom } from './orb-geometry';
import type { InstalledApp } from './app-index';
import { AppCrashed } from './AppCrashed';
import { crashAttachment } from './crash-report';

/** One open of one app: what the launcher hands the container while the app is open. */
export interface MiniAppLaunch {
  record: AppRecord;
  bundleSource: string;
  /** The runtime engine appId (the launcher id, #5 D8) — a fork's own user data. */
  engineAppId: string;
  /** When the user tapped to open this app (`Date.now()`): the near end of the tap-to-first-paint
   *  record this launch logs at its first accepted paint. With the app's id it names the opening:
   *  another tap (Reload included) is another launch, in a fresh WebView and realm. */
  tappedAt: number;
  onExit: () => void;
  /** The orb's tap: the launcher opens the Whim sheet over this app. */
  onOpenSheet: () => void;
  /** A launcher sheet (the Whim sheet, or a change's pages grown from it) is over this app: Android
   *  back closes it (`onCloseSheet`) before it reaches the app (mini-app-back-navigation "A host
   *  sheet takes back first"). */
  sheetOpen: boolean;
  onCloseSheet: () => void;
  /** The installed-apps entry for this running app: its tile, its name, the orb's remembered corner.
   *  Another id is another launch. */
  installedApp: InstalledApp;
  /** What the orb shows of a change to this app (`app-launcher` "Changing an app keeps it running
   *  and offers Reload"): being made, with its stream's activity; landed; failed; or nothing. */
  orb: Required<Pick<OrbProps, 'state' | 'activity'>>;
  /** The crash screen's Reload: the launcher opens the app again in place, a new launch. */
  onReload: () => void;
  /** The crash screen's "Ask Whim to fix it", with the error to attach (`crashAttachment`, plain
   *  text): the launcher opens the Whim sheet over the app with the request prefilled. */
  onAskFix: (attachment: string) => void;
  /** A newer version of the app than this launch runs is current: the crash screen leads with Reload
   *  and offers no fix of an error from code no longer current. */
  behind: boolean;
}

export interface MiniAppStageProps {
  /** The open app, or `null` while none is: the container is then hidden, one WebView waiting. */
  launch: MiniAppLaunch | null;
  /** The tokens the open app's frame is held to (those captured at its delivery), or `null` while
   *  nothing is delivered: the shell's status-bar strip and status bar follow them over the app. */
  onFrame: (pinned: ShellTokens | null) => void;
}

/** The current launch's end of its WebView's events. Frames and load events reach a launch only
 *  from the WebView bound to it, by key: never from the waiting one, nor from a WebView a previous
 *  launch had, whatever is still queued on the bridge for it. */
interface LaunchOutlet {
  key: number | null;
  onMessage: (data: string) => void;
  onLoadEnd: () => void;
  /** The WebView failed to load its page or lost its web content process. */
  onGone: () => void;
}

const RUNTIME_PAGE = { html: RUNTIME_HTML };
const ORIGINS = ['*'];

/** Which opening of which app `launch` is: its app and the tap that opened it. */
function openingOf(launch: MiniAppLaunch | null): string | null {
  return launch === null ? null : `${launch.installedApp.id}@${launch.tappedAt}`;
}

/** The container: the pool's WebViews, and the open app's `MiniAppView` over its own. */
export function MiniAppStage({ launch, onFrame }: Readonly<MiniAppStageProps>) {
  const tokens = useTokens();
  // An open app's area keeps the settings it was delivered with (app-launcher "Settings changed
  // while an app runs apply next time"; system.md: no live theme frame); before its delivery, and
  // with no app open, the container follows the phone.
  const [pinned, setPinned] = useState<ShellTokens | null>(null);
  const onPinned = useCallback((next: ShellTokens | null) => {
    setPinned(next);
    onFrame(next);
  }, [onFrame]);
  const bg = (pinned ?? tokens).colors.bg;
  const opening = openingOf(launch);
  const [pool, setPool] = useState<WebViewPool>(() => openApp(EMPTY_POOL, opening));
  // A different opening (another app, the same app opened again by Reload, or none) is a new launch:
  // the pool moves before anything renders for it, so no frame shows the container closed between.
  const switching = pool.opening !== opening;
  if (switching) setPool((p) => openApp(p, opening));
  const poolRef = useRef(pool);
  poolRef.current = pool;
  const natives = useRef(new Map<number, WebView>());
  // One ref callback per WebView, kept for its life, so a re-render never detaches it.
  const attach = useRef(new Map<number, (web: WebView | null) => void>());
  const refFor = (key: number) => {
    let ref = attach.current.get(key);
    if (!ref) {
      ref = (web: WebView | null) => {
        if (web) {
          natives.current.set(key, web);
        } else {
          natives.current.delete(key);
          attach.current.delete(key);
        }
      };
      attach.current.set(key, ref);
    }
    return ref;
  };
  const outlet = useRef<LaunchOutlet | null>(null);
  // The keyboard (beta-1 D3): the page ends at its top edge on Android, where no window resizes for
  // it, so the page's viewport shrinks and the runtime scrolls the focused field into view
  // (`loader.js`). iOS's WebView avoids the keyboard itself (`padsWebViewForKeyboard`).
  const frame = useRef<View>(null);
  const keyboard = useKeyboardInset(frame, launch !== null && padsWebViewForKeyboard(Platform.OS));
  const onFailed = useCallback(() => setPool(launchFailed), []);
  const onOpened = useCallback(() => setPool(launchOpened), []);

  const onSlotLoadEnd = (key: number) => {
    const bound = outlet.current;
    if (bound !== null && bound.key === key) {
      bound.onLoadEnd();
      return;
    }
    if (waitingSlot(poolRef.current)?.key !== key) return;
    setPool((p) => pageLoaded(p, key));
    natives.current.get(key)?.injectJavaScript(WARM_PROBE_JS);
  };
  const onSlotMessage = (key: number, data: string) => {
    const bound = outlet.current;
    if (bound !== null && bound.key === key) bound.onMessage(data);
    else if (data === WARM_ANSWER) setPool((p) => pageAnswered(p, key));
  };
  const onSlotGone = (key: number) => {
    const bound = outlet.current;
    if (bound !== null && bound.key === key) bound.onGone();
    else setPool((p) => pageGone(p, key));
  };

  const open = launch !== null && !switching && pool.launch !== null;
  return (
    <View
      ref={frame}
      collapsable={false}
      style={open ? [styles.root, { backgroundColor: bg, paddingBottom: keyboard }] : styles.waiting}
      pointerEvents={open ? 'auto' : 'none'}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
    >
      {/* Every WebView, waiting or bound, is this one element: the same page, the same settings, the
          same native view manager (whose network refusal, decision #74, every instance gets). Its
          slot, a native view for the WebView's whole life, carries layout, visibility, touch and
          accessibility: react-native-webview wraps the WebView in a `flex: 1` View of its own and
          hands `style` and `pointerEvents` to the native view only, which ignores `pointerEvents` on
          Android. The waiting slot is drawn under the launch's, out of the layout, unseen,
          untouchable and out of the accessibility tree; a handover only restyles its slot. */}
      {pool.slots.map((slot) => {
        const waiting = slot.launch === null;
        return (
          <View
            key={slot.key}
            collapsable={false}
            style={waiting ? styles.waitingSlot : styles.slot}
            pointerEvents={waiting ? 'none' : 'auto'}
            accessibilityElementsHidden={waiting}
            importantForAccessibility={waiting ? 'no-hide-descendants' : 'auto'}
          >
            <WebView
              ref={refFor(slot.key)}
              style={{ backgroundColor: bg }}
              originWhitelist={ORIGINS}
              source={RUNTIME_PAGE}
              onMessage={(e) => onSlotMessage(slot.key, e.nativeEvent.data)}
              onLoadEnd={() => onSlotLoadEnd(slot.key)}
              javaScriptEnabled
              domStorageEnabled={false}
              setSupportMultipleWindows={false}
              // Android's WebView zooms text by the system font scale on its own; the SDK already
              // sizes text by the theme's `fontScale` (system.md §6), so text is scaled once. iOS
              // has no such zoom and ignores the prop.
              textZoom={100}
              onError={(ev) => {
                logWebViewError(log, ev.nativeEvent, waiting ? { surface: 'waiting' } : { appId: launch?.record.appId });
                onSlotGone(slot.key);
              }}
              onContentProcessDidTerminate={() => onSlotGone(slot.key)}
              onRenderProcessGone={() => onSlotGone(slot.key)}
            />
          </View>
        );
      })}
      {open ? (
        <MiniAppView
          key={pool.launch}
          {...launch}
          slot={launchSlot(pool)}
          outlet={outlet}
          natives={natives}
          onFailed={onFailed}
          onOpened={onOpened}
          onPinned={onPinned}
        />
      ) : null}
    </View>
  );
}

/** One launch's view, over the WebView `MiniAppStage` bound to it. */
interface MiniAppViewProps extends MiniAppLaunch {
  /** The WebView bound to this launch; none on a failure surface. */
  slot: PoolSlot | undefined;
  outlet: React.MutableRefObject<LaunchOutlet | null>;
  natives: React.MutableRefObject<Map<number, WebView>>;
  /** The launch reached a failure surface: its WebView goes. */
  onFailed: () => void;
  /** The launch painted: the next WebView may start warming beside it. */
  onOpened: () => void;
  /** The tokens this launch's frame is held to now, `null` while it follows the phone. */
  onPinned: (pinned: ShellTokens | null) => void;
}

export default function MiniAppView({
  record, bundleSource, engineAppId, tappedAt, onExit, onOpenSheet, sheetOpen, onCloseSheet, installedApp, orb,
  onReload, onAskFix, behind, slot, outlet, natives, onFailed, onOpened, onPinned,
}: Readonly<MiniAppViewProps>) {
  const slotKey = slot?.key ?? null;
  // The WebView this launch's host controls is looked up when used: the one bound to the launch
  // now, and none once it is gone, so a late result of this launch never reaches another WebView.
  const boundKey = useRef<number | null>(null);
  const [webRef] = useState(() => ({
    get current(): WebView | null {
      return boundKey.current === null ? null : natives.current.get(boundKey.current) ?? null;
    },
  }));
  // The launcher's sheet over the running realm (the Whim sheet, design D14): while it is open,
  // back-policy's `overlayOpen` input closes it instead of forwarding the press into the app or
  // exiting (mini-app-back-navigation delta "A host sheet takes back first").
  const host = useMiniAppHost({ onExit, overlayOpen: sheetOpen, onCloseOverlay: onCloseSheet, webRef });

  // Deliver once the bound WebView's page has loaded, so injectJavaScript is not silently dropped
  // (#5 B1): at once for a WebView handed over already loaded, else at its `onLoadEnd` -- exactly
  // ONCE per WebView. Android's WebView does NOT promise one onPageFinished (RN's onLoadEnd) per
  // page load, and a second delivery would bind a new host generation and reinject into the live
  // page, tearing down the realm the user is already looking at; `deliveredKey` drops the repeat.
  // The delivery resets the page's realm (`reinject({ reset: true })`): the waiting page's idle
  // iframe is replaced by a fresh one with a new nonce and this launch's generation (spike2 §5).
  // The theme is built at each real delivery from the phone's settings at that moment and the
  // app's tint (design-system-v1 D3): a running realm never re-themes live, and a settings change
  // applies at the next open or Reload. It carries how much of the app's bottom edge the orb covers
  // (beta-1 D5), computed from this delivery's bottom safe-area inset; the loader keeps that out
  // of the bundle-visible theme.
  const tokens = useTokens();
  const { tint, icon } = tileOf(installedApp);
  const theme = useMemo(() => themeFrame(tokens, tint), [tokens, tint]);
  const bottomInset = useSafeAreaInsets().bottom;
  const deliveredKey = useRef<number | null>(null);
  // The WebView the theme was delivered into, and the phone's settings it was built from.
  const [delivered, setDelivered] = useState<{ key: number; tokens: ShellTokens } | null>(null);
  const deliveredFor = delivered?.key ?? null;
  const deliverInto = (key: number) => {
    if (loadEndAction(deliveredKey.current, key) === 'duplicate') {
      log.debug(CHANNELS.app, 'duplicate onLoadEnd for a delivered realm, not delivering again', {
        appId: record.appId,
        webKey: key,
      });
      return;
    }
    deliveredKey.current = key;
    setDelivered({ key, tokens });
    host.deliverBySource(record, bundleSource, engineAppId, { ...theme, chromeInsetBottom: chromeInsetBottom(bottomInset) });
  };
  const deliver = useRef(deliverInto);
  deliver.current = deliverInto;
  const loadedWhenBound = slot !== undefined && slot.page !== 'loading';
  useLayoutEffect(() => {
    boundKey.current = slotKey;
    outlet.current = {
      key: slotKey,
      onMessage: host.onMessage,
      onLoadEnd: () => { if (slotKey !== null) deliver.current(slotKey); },
      // The realm went with its WebView: nothing it sends any more (Android follows a load error with
      // a load end) reaches the launch, and the launch fails at once -- a page that failed while
      // loading was never delivered into, so no startup deadline would ever fail it.
      onGone: () => {
        log.error(CHANNELS.app, 'mini-app webview gone', { appId: engineAppId, webKey: slotKey });
        boundKey.current = null;
        outlet.current = null;
        host.webViewGone();
      },
    };
    if (slotKey !== null && loadedWhenBound) deliver.current(slotKey);
    return () => {
      boundKey.current = null;
      outlet.current = null;
    };
    // `loadedWhenBound` is read for the WebView as it was handed over; it never changes after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotKey, host.onMessage, host.webViewGone, outlet]);

  // The frame (design-system-v1 18g): everything drawn in the app's area -- container, cover, plate,
  // "Opening…", the failure screens -- and the shell's status-bar strip keep the settings the realm
  // was delivered with, as the page does (app-launcher "Settings changed while an app runs apply next
  // time"; system.md: one `bg`, no live theme frame). Before the delivery they follow the phone. A
  // failure surface keeps the frame its realm had; a Reload is a new launch, which follows the phone
  // until its own delivery captures anew. The host overlays above the app (orb, Whim sheet) follow
  // the phone.
  const pinned = delivered !== null && (delivered.key === slotKey || slotKey === null) ? delivered.tokens : null;
  const frameTokens = pinned ?? tokens;
  const c = frameTokens.colors;
  const bg = c.bg;
  useLayoutEffect(() => onPinned(pinned), [pinned, onPinned]);
  useLayoutEffect(() => () => onPinned(null), [onPinned]);

  // Which of the four container surfaces this render belongs to. The precedence (both failure
  // surfaces above the boot state) is decided by the pure `miniAppSurface` -- a launch that fails
  // before any paint is unpainted too, so an implicit "unpainted means booting" would park the
  // user in a permanent opening screen instead of the honest failure copy. A failure surface
  // destroys the launch's WebView; Reload is a new launch in a fresh one.
  const surface = miniAppSurface(host.state);
  const failed = surface === 'launch-failed' || surface === 'app-error';
  useEffect(() => {
    if (failed) onFailed();
  }, [failed, onFailed]);

  // The opening state (M2, design-system-v1 task 18.3). The WebView stays mounted and drawn from the
  // start, under an opaque `bg` cover, so the page keeps loading and its double-rAF `paint` is never
  // throttled by a hidden view; the cover fades out over `fade-in` once this launch's signal
  // (`paintMs`, generation-fenced) arrives or the 600 ms cap passes. Above it the app's tile-sized
  // plate holds until the paint, with "Opening…" under it after 1.5 s. Both timers are keyed by the
  // bound WebView. The label counts from the bind; the cap from the delivery, because a page still
  // loading paints the default light canvas until the delivered theme reaches it (a light frame in
  // dark mode, measured on iOS). Under Reduce Motion the fade is itself the replacement (§4.5), so it
  // is played, not skipped.
  const [capFor, setCapFor] = useState<number | null>(null);
  const [labelFor, setLabelFor] = useState<number | null>(null);
  useEffect(() => {
    if (slotKey === null) return undefined;
    const label = setTimeout(() => setLabelFor(slotKey), OPENING_LABEL_AFTER_MS);
    return () => clearTimeout(label);
  }, [slotKey]);
  useEffect(() => {
    if (slotKey === null || deliveredFor !== slotKey) return undefined;
    const cap = setTimeout(() => setCapFor(slotKey), OPENING_REVEAL_CAP_MS);
    return () => clearTimeout(cap);
  }, [slotKey, deliveredFor]);
  const look = openingLook(surface, { cap: slotKey !== null && capFor === slotKey, label: slotKey !== null && labelFor === slotKey });
  const reduceMotion = frameTokens.reduceMotion;
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

  // Tap to first paint (task 18.4): logged once per launch, at the first accepted paint of its realm
  // (a launch has one: Reload is a launch of its own), beside that realm's own mount-to-paint time and
  // how the launch got its WebView.
  const handedOut = slot?.handedOut ?? null;
  const timed = useRef(false);
  const { paintedAt, paintMs } = host.state;
  useEffect(() => {
    if (timed.current || paintedAt === null) return;
    timed.current = true;
    log.info(CHANNELS.app, 'tap to first paint', { tapToPaintMs: paintedAt - tappedAt, paintMs, webView: handedOut });
  }, [paintedAt, paintMs, tappedAt, handedOut]);
  useEffect(() => {
    if (paintedAt !== null) onOpened();
  }, [paintedAt, onOpened]);
  const primary = buttonColors(frameTokens, 'ink', false);

  // A launch refused pre-delivery (#41 D7, structured `launchApp` failure) never delivers a
  // bundle -- show honest product copy instead of a blank realm, with a way back to Home.
  if (surface === 'launch-failed') {
    return (
      <View style={[styles.layer, styles.errorRoot, { backgroundColor: bg }]}>
        <Text tokens={frameTokens} type="title2" style={styles.errorTitle}>{COPY.launchFailedTitle}</Text>
        <Text tokens={frameTokens} color="text-2" style={styles.errorBody}>{COPY.launchFailedBody}</Text>
        <Pressable
          accessibilityRole="button"
          style={[styles.errorAction, { backgroundColor: primary.fill, borderColor: primary.fill }]}
          onPress={onExit}
        >
          <Text tokens={frameTokens} type="headline" color="on-ink">{COPY.launchFailedBack}</Text>
        </Pressable>
      </View>
    );
  }

  // A running app that failed after its delivery -- a fatal error frame (a render error no boundary in
  // the app caught, a mount or bundle failure), a delivered app that never paints (the watchdog in
  // useMiniAppHost), or its WebView gone (a page that failed to load, a web content process that died)
  // -- is the crash screen (`app-launcher` "A crashed app keeps the orb and offers a way forward"), in
  // the app's place, with the orb over it. Its Reload is a new launch of the app in place: a fresh
  // WebView and realm (a realm reset is a RECREATE, never a re-inject, spike2 §5). "Ask Whim to fix
  // it" hands the launcher the error as plain, capped text for the request it prefills.
  if (surface === 'app-error') {
    const crash = host.state.crash;
    return (
      <>
        <AppCrashed
          name={installedApp.name}
          tokens={frameTokens}
          bottomClearance={chromeInsetBottom(bottomInset)}
          onReload={onReload}
          behind={behind}
          onAskFix={() => onAskFix(crash === null ? '' : crashAttachment(crash))}
          onExit={onExit}
        />
        <Orb appId={installedApp.id} state={orb.state} activity={orb.activity} onOpen={onOpenSheet} />
      </>
    );
  }

  return (
    <>
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
        <TilePlate size="grid" state="ready" tint={tint} glyph={icon} tokens={frameTokens} />
        {look.label ? (
          <View style={styles.openingLabel}>
            <Text tokens={frameTokens} type="callout" color="text-2" style={styles.centred}>{COPY.appBootLabel}</Text>
          </View>
        ) : null}
      </Animated.View>
      <Orb appId={installedApp.id} state={orb.state} activity={orb.activity} onOpen={onOpenSheet} />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // No app open: the container and its waiting WebView are out of layout, invisible, untouchable and
  // out of the accessibility tree, under whatever screen the launcher shows.
  waiting: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0 },
  slot: { flex: 1 },
  waitingSlot: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0 },
  errorRoot: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.lg },
  errorTitle: { textAlign: 'center', marginBottom: SPACING.sm },
  errorBody: { textAlign: 'center', marginBottom: SPACING.lg },
  // A filled primary the full width.
  errorAction: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  opening: { alignItems: 'center', justifyContent: 'center' },
  // Under the centred plate without moving it: the words appear late, and the plate must not jump.
  openingLabel: { position: 'absolute', top: '50%', left: SPACE[6], right: SPACE[6], marginTop: TILE_SIDE.grid / 2 + SPACE[3] },
  centred: { textAlign: 'center' },
});
