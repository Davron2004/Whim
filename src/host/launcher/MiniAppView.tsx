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
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { AppRecord } from '../bridge';
import { RUNTIME_HTML } from '../../runtime/generated/runtime-html';
import { LAYOUT, SPACE } from '../../design/tokens';
import { TilePlate } from '../ui/AppTile';
import { TILE, TILE_SIDE } from '../ui/AppTile-geometry';
import { timing } from '../ui/motion';
import { appAnchor, placeIn, useAnchorEntry, type PlaceRef } from '../ui/SheetAnchor';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';
import { useTokens } from '../ui/tokens';
import { springConfig, type ShellTokens } from '../ui/tokens-pure';
import { themeFrame } from './theme-frame';
import { tileOf } from './tile-identity';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import { loadEndAction } from './realm-delivery';
import { logWebViewError } from './webview-error';
import { useMiniAppHost } from './useMiniAppHost';
import { useSystemBack } from './use-system-back';
import { useKeyboardInset } from './KeyboardShell';
import { padsWebViewForKeyboard } from './keyboard-shell';
import { COPY } from './copy';
import { miniAppSurface, OPENING_LABEL_AFTER_MS, OPENING_REVEAL_CAP_MS, openingLook, type OpeningLook } from './boot-state';
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
  orb: Required<Pick<OrbProps, 'state' | 'activity'>> & Pick<OrbProps, 'flicker' | 'stuck'>;
  /** The crash screen's Reload: the launcher opens the app again in place, a new launch. */
  onReload: () => void;
  /** The crash screen's "Ask Whim to fix it", with the error to attach (`crashAttachment`, plain
   *  text): the launcher opens the Whim sheet over the app with the request prefilled. */
  onAskFix: (attachment: string) => void;
  /** A newer version of the app than this launch runs is current: the crash screen leads with Reload
   *  and offers no fix of an error from code no longer current. */
  behind: boolean;
  /** How the app comes out of its tile on Home and goes back into it (M2, M3); none, and it shows and
   *  goes at once. */
  morph?: AppMorph;
}

/**
 * Opening and closing between Home and the screen (system.md §4.4 M2, M3). The app's `bg` grows out of
 * its tile (`appAnchor`, measured on the UI thread on every frame) to the screen on `morph`, one leaf
 * view whose insets and corners move, with the tint a tile-sized plate where the tile is; leaving, the
 * page is covered first (`fade-out`) and the `bg` shrinks back into the tile on `smooth`, the plate
 * fading back in there. The launcher draws Home under the app while either runs (`homeUnder`), never
 * over its page: Home is added only once the page is covered, and goes once the `bg` covers the screen.
 * Under Reduce Motion the `bg` keeps the screen's size and cross-fades over Home instead.
 */
export interface AppMorph {
  /** The person tapped its tile: it grows out of it. Else it is on the screen from the start. */
  fromTile: boolean;
  /** Home is drawn under the app. */
  homeUnder: boolean;
  /** The person is leaving the app: back into its tile, from wherever it has got to. False again
   *  (its tile tapped mid-way) reopens it from there. */
  leaving: boolean;
  /** The app's `bg` covers the screen: Home under it can go. */
  onCovered: () => void;
  /** Leaving, the page is covered: Home can be drawn under the app. */
  onVeiled: () => void;
  /** Leaving, the app is back in its tile (or has faded, with no tile to go into): the launch ends. */
  onClosed: () => void;
}

export interface MiniAppStageProps {
  /** The open app, or `null` while none is: the container is then hidden, one WebView waiting. */
  launch: MiniAppLaunch | null;
  /** The tokens the open app's frame is held to (those captured at its delivery), or `null` while
   *  nothing is delivered: the shell's status-bar strip and status bar follow them over the app. */
  onFrame: (pinned: ShellTokens | null) => void;
  /** The screen the launcher shows: drawn under the open app's layers and over its page, so Home can
   *  sit under an app growing out of it or shrinking back into it (`AppMorph`). */
  children?: React.ReactNode;
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
export function MiniAppStage({ launch, onFrame, children }: Readonly<MiniAppStageProps>) {
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
  // The same view, for what the app's opening and closing measure on the UI thread.
  const place = useAnimatedRef<View>();
  const setFrame = useCallback((view: View | null) => {
    frame.current = view;
    place(view);
  }, [place]);
  // Home under an app sits where it sits on its own, at the window's top: the app's frame starts below
  // the status-bar strip, Home's above it.
  const top = useSafeAreaInsets().top;
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
  const homeUnder = open && launch.morph?.homeUnder === true;
  return (
    <View ref={setFrame} collapsable={false} style={open ? [styles.root, { backgroundColor: bg, paddingBottom: keyboard }] : styles.root}>
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
      <View style={homeUnder ? [styles.layer, { top: -top }] : styles.layer} pointerEvents="box-none">
        {children}
      </View>
      {open ? (
        <MiniAppView
          key={pool.launch}
          {...launch}
          frame={place}
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
  /** The stage's own view, which the opening and closing measure from. */
  frame: PlaceRef;
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

/** Where the app's tile is drawn, from the stage's top-left, and the stage's size, as last measured. */
interface TileAt {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

// Spring configs as module constants: a worklet never calls `springConfig` (motion.ts).
const MORPH = springConfig('morph');
const SMOOTH = springConfig('smooth');

/** Frames a tile going back in must hold still on before its plate shows there. */
const TILE_SETTLE_FRAMES = 3;

/** The same place, give or take half a point. */
const sameTileAt = (a: TileAt, b: TileAt) => {
  'worklet';
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;
};

const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};
const lerp = (a: number, b: number, p: number) => {
  'worklet';
  return a + (b - a) * p;
};

interface MorphInputs {
  morph: AppMorph | undefined;
  appId: string;
  frame: PlaceRef;
  reduceMotion: boolean;
  look: OpeningLook;
  failed: boolean;
}

/** M2 and M3 (`AppMorph`) over the opening state (task 18.3): how far the app's `bg` has grown, how
 *  much of it covers the page and where the tile is (`shape`, drawn by `BgShape`); the plate's opacity and its place on the tile
 *  (`plateMove`, "Opening…" under it: `labelMove`), centred when the app came from no tile; the orb,
 *  which comes and goes with the app. The page is revealed once the `bg` covers the screen and this
 *  launch has painted (or the 600 ms cap passed). */
function useAppMorph({ morph, appId, frame, reduceMotion, look, failed }: MorphInputs) {
  const fromTile = morph?.fromTile === true;
  const leaving = morph?.leaving === true;
  const homeUnder = morph?.homeUnder === true;
  const latest = useRef(morph);
  latest.current = morph;
  const tile = useAnchorEntry(morph === undefined ? undefined : appAnchor(appId))?.ref ?? null;
  // 0 the tile, 1 the screen. Under Reduce Motion the `bg` keeps the screen's size, and this is how
  // much of it shows.
  const grown = useSharedValue(fromTile ? 0 : 1);
  // 1 while the page is covered, 0 once it shows.
  const veil = useSharedValue(1);
  const plate = useSharedValue(1);
  // The orb comes in once the app covers the screen and goes as it leaves.
  const orbShown = useSharedValue(fromTile ? 0 : 1);
  const tileAt = useSharedValue<TileAt | null>(null);
  // Leaving, whether the tile has been measured in one place on `TILE_SETTLE_FRAMES` frames in a row
  // (`tileStill`: how many, and the last one's `grown`, which tells one frame from the next).
  const tileSettled = useSharedValue(true);
  const tileStill = useSharedValue({ frames: 0, k: Number.NaN });
  const [covered, setCovered] = useState(!fromTile);

  // Where the tile is: measured once as the app comes out of it, kept once Home has gone (every view a
  // frame moves is a commit of its own, and the page paints its first frame meanwhile); on every frame
  // it goes back into it, where Home under it may still be settling: Home is drawn afresh under the
  // app, and its first frames can lay the tile out higher than it ends up (by the status bar and a
  // navigation bar: 108 pt on an iOS 27 simulator, 117 dp on an Android emulator, for one or two
  // frames), so the plate fades in there only once the tile has held still. Under Reduce Motion going
  // back is the cross-fade alone, with no plate.
  const reducedNow = useRef(reduceMotion);
  reducedNow.current = reduceMotion;
  const tileSettledNow = useCallback(() => {
    if (latest.current?.leaving === true && !reducedNow.current) plate.value = withTiming(1, timing('fadeIn'));
  }, [plate]);
  useAnimatedReaction(
    () => (Number.isFinite(grown.value) && tile !== null && (leaving || tileAt.value === null) ? placeIn(frame, tile) : null),
    (at) => {
      if (at === null) return;
      const before = tileAt.value;
      tileAt.value = at;
      if (tileSettled.value) return;
      const k = grown.value;
      const still = tileStill.value;
      if (before === null || !sameTileAt(before, at)) tileStill.value = { frames: 1, k };
      else if (k !== still.k) tileStill.value = { frames: still.frames + 1, k };
      if (tileStill.value.frames < TILE_SETTLE_FRAMES) return;
      tileSettled.value = true;
      scheduleOnRN(tileSettledNow);
    },
    [frame, tile, leaving],
  );
  const coveredNow = useCallback(() => {
    setCovered(true);
    latest.current?.onCovered();
  }, []);
  const veiled = useCallback(() => latest.current?.onVeiled(), []);
  const closed = useCallback(() => latest.current?.onClosed(), []);
  useAnimatedReaction(
    () => grown.value >= 1,
    (now, before) => {
      if (now && before !== true) scheduleOnRN(coveredNow);
    },
    [coveredNow],
  );

  // Android back while it comes out of its tile turns it round, even before its realm is bound (when
  // the app's own back policy would leave Whim); while it goes back in, back has nothing more to do.
  const moving = morph !== undefined && (!covered || leaving);

  // Out of the tile from the first frame the app is drawn: once, as the launch mounts.
  useLayoutEffect(() => {
    if (fromTile) grown.value = reduceMotion ? withTiming(1, timing('fadeIn', true)) : withSpring(1, MORPH);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A failure surface replaces the opening at once, over the whole screen; leaving it goes at once.
  useEffect(() => {
    if (!failed) return;
    grown.value = 1;
    if (leaving) closed();
  }, [failed, leaving, grown, closed]);

  useEffect(() => {
    if (leaving) return;
    veil.value = look.revealed && covered ? withTiming(0, timing('fadeIn', reduceMotion)) : 1;
  }, [veil, look.revealed, covered, leaving, reduceMotion]);
  useEffect(() => {
    if (leaving) return;
    plate.value = look.plate ? 1 : withTiming(0, timing('fadeIn', reduceMotion));
  }, [plate, look.plate, leaving, reduceMotion]);
  useEffect(() => {
    const shown = covered && !leaving ? 1 : 0;
    if (orbShown.value !== shown) orbShown.value = withTiming(shown, timing(shown === 1 ? 'fadeIn' : 'fadeOut', reduceMotion));
  }, [orbShown, covered, leaving, reduceMotion]);

  // Leaving: the page goes under the `bg` first (§4.3 rule 4), so the launcher can draw Home under the
  // app; then back into the tile from wherever it is, the plate coming back where the tile is. A tap on
  // the tile mid-way (`leaving` false again) turns it back out from there.
  const left = useRef(false);
  useEffect(() => {
    if (failed) return;
    if (!leaving) {
      if (!left.current) return;
      left.current = false;
      grown.value = reduceMotion ? withTiming(1, timing('fadeIn', true)) : withSpring(1, MORPH);
      return;
    }
    left.current = true;
    if (!homeUnder) {
      tileAt.value = null;
      tileSettled.value = false;
      tileStill.value = { frames: 0, k: Number.NaN };
      if (veil.value >= 1) {
        veiled();
        return;
      }
      veil.value = withTiming(1, timing('fadeOut', reduceMotion), (finished?: boolean) => {
        'worklet';
        if (finished) scheduleOnRN(veiled);
      });
      return;
    }
    setCovered(false);
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(closed);
    };
    if (reduceMotion) {
      grown.value = withTiming(0, timing('fadeIn', true), done);
      return;
    }
    grown.value = withSpring(0, SMOOTH, done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving, homeUnder, failed]);

  const plateStyle = useAnimatedStyle(() => ({ opacity: plate.value }));
  // The plate sits where the tile is, at its drawn size, for an app that came out of it or is going
  // back into it, and is not drawn until the tile has been measured (going back, measured settled);
  // centred otherwise.
  const onTile = fromTile || leaving;
  const plateMove = useAnimatedStyle(() => {
    const at = tileAt.value;
    if (at === null) return { opacity: onTile ? 0 : 1, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    const dx = at.x + at.width / 2 - at.frameWidth / 2;
    const dy = at.y + at.height / 2 - at.frameHeight / 2;
    return { opacity: leaving && !tileSettled.value ? 0 : 1, transform: [{ translateX: dx }, { translateY: dy }, { scale: at.width / TILE_SIDE.grid }] };
  });
  const labelMove = useAnimatedStyle(() => {
    const at = tileAt.value;
    if (at === null) return { opacity: onTile ? 0 : 1, transform: [{ translateX: 0 }, { translateY: 0 }] };
    const dx = at.x + at.width / 2 - at.frameWidth / 2;
    const dy = at.y + at.height - (at.frameHeight + TILE_SIDE.grid) / 2;
    return { opacity: leaving && !tileSettled.value ? 0 : 1, transform: [{ translateX: dx }, { translateY: dy }] };
  });
  const orbStyle = useAnimatedStyle(() => ({ opacity: orbShown.value }));
  return { shape: { grown, veil, tileAt, reduceMotion }, plateStyle, plateMove, labelMove, orbStyle, moving };
}

/** Where the app's `bg` is, `k` of the way from the tile `at` to the stage, and its corner radius;
 *  `full` when it is the whole stage (grown, or with no tile to grow from, or under Reduce Motion,
 *  where only its opacity moves). */
function shapeOf(k: number, at: TileAt | null, reduced: boolean) {
  'worklet';
  if (reduced || at === null || k >= 1) return { full: true, x: 0, y: 0, w: 1, h: 1, r: 0, fw: 1, fh: 1 };
  return {
    full: false,
    x: lerp(at.x, 0, k),
    y: lerp(at.y, 0, k),
    w: lerp(at.width, at.frameWidth, k),
    h: lerp(at.height, at.frameHeight, k),
    r: lerp(TILE.corner * at.width, 0, k),
    fw: at.frameWidth,
    fh: at.frameHeight,
  };
}

/** The corner discs are drawn at this diameter and scaled uniformly to the corner's radius. */
const CORNER_DISC = 64;

interface BgShapeProps {
  grown: SharedValue<number>;
  veil: SharedValue<number>;
  tileAt: SharedValue<TileAt | null>;
  reduceMotion: boolean;
  color: string;
}

/**
 * The app's `bg` growing out of its tile (M2) and back into it (M3), which is also what covers the page
 * until it is revealed. Moved by transforms only (§4.3 rule 4's default): animating a view's size goes
 * through a layout commit on every frame, which on Android delayed the page's first paint by two
 * frames (`tapToPaintMs`, emulator, 71 → 102 ms). The rounded rect is drawn as two plain bars,
 * stretched (no rounded shape is ever scaled unevenly), and four discs at its corners, scaled
 * evenly to the radius. Its opacity only ever moves while it is the whole stage, drawn by one bar.
 */
const BgShape = React.memo(function BgShapeView({ grown, veil, tileAt, reduceMotion, color }: Readonly<BgShapeProps>) {
  const across = useAnimatedStyle(() => {
    const s = shapeOf(clamp01(grown.value), tileAt.value, reduceMotion);
    const opacity = s.full ? veil.value * clamp01(grown.value) : veil.value;
    return { opacity, transform: [{ translateX: s.x }, { translateY: s.full ? 0 : s.y + s.r }, { scaleX: s.full ? 1 : s.w / s.fw }, { scaleY: s.full ? 1 : (s.h - 2 * s.r) / s.fh }] };
  });
  const down = useAnimatedStyle(() => {
    const s = shapeOf(clamp01(grown.value), tileAt.value, reduceMotion);
    if (s.full) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scaleX: 1 }, { scaleY: 1 }] };
    return { opacity: veil.value, transform: [{ translateX: s.x + s.r }, { translateY: s.y }, { scaleX: (s.w - 2 * s.r) / s.fw }, { scaleY: s.h / s.fh }] };
  });
  return (
    <>
      <Animated.View style={[styles.shapeBar, { backgroundColor: color }, across]} pointerEvents="none" />
      <Animated.View style={[styles.shapeBar, { backgroundColor: color }, down]} pointerEvents="none" />
      {CORNERS.map((corner) => (
        <Corner key={corner.join()} corner={corner} grown={grown} veil={veil} tileAt={tileAt} reduceMotion={reduceMotion} color={color} />
      ))}
    </>
  );
});

/** Which corner a disc rounds: 0 the leading or top side, 1 the trailing or bottom side. */
const CORNERS = [[0, 0], [1, 0], [0, 1], [1, 1]] as const;

function Corner({ corner: [right, bottom], grown, veil, tileAt, reduceMotion, color }: Readonly<BgShapeProps & { corner: readonly [number, number] }>) {
  const style = useAnimatedStyle(() => {
    const s = shapeOf(clamp01(grown.value), tileAt.value, reduceMotion);
    if (s.full) return { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 0 }] };
    return {
      opacity: veil.value,
      transform: [{ translateX: s.x + right * (s.w - 2 * s.r) }, { translateY: s.y + bottom * (s.h - 2 * s.r) }, { scale: (2 * s.r) / CORNER_DISC }],
    };
  });
  return <Animated.View style={[styles.shapeCorner, { backgroundColor: color }, style]} pointerEvents="none" />;
}

/** System back while the app moves between its tile and the screen (`useAppMorph`): mounted only then,
 *  after the app's own listener, so it is asked first. */
function BackWhileMoving({ onBack }: Readonly<{ onBack: () => void }>) {
  useSystemBack(onBack);
  return null;
}

export default function MiniAppView({
  record, bundleSource, engineAppId, tappedAt, onExit, onOpenSheet, sheetOpen, onCloseSheet, installedApp, orb,
  onReload, onAskFix, behind, morph, frame, slot, outlet, natives, onFailed, onOpened, onPinned,
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
  const host = useMiniAppHost({ onExit, overlayOpen: sheetOpen, onCloseOverlay: onCloseSheet, webRef, leaving: morph?.leaving === true });

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
  const { shape, plateStyle, plateMove, labelMove, orbStyle, moving } = useAppMorph({
    morph,
    appId: installedApp.id,
    frame,
    reduceMotion: frameTokens.reduceMotion,
    look,
    failed,
  });

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
  // A launch refused at its delivery (#41 D7, structured `launchApp` failure) never runs a bundle --
  // show honest product copy instead of a blank realm, with a way back to Home. The refusal came at
  // the delivery, which already pinned the frame, so the `Button` takes the frame's tokens like the
  // text: on the phone's live ones it would follow a scheme change the frame keeps out.
  if (surface === 'launch-failed') {
    return (
      <View style={[styles.layer, styles.errorRoot, { backgroundColor: bg }]}>
        <Text tokens={frameTokens} type="title2" style={styles.errorTitle}>{COPY.launchFailedTitle}</Text>
        <Text tokens={frameTokens} color="text-2" style={styles.errorBody}>{COPY.launchFailedBody}</Text>
        <View style={styles.errorAction}>
          <Button tokens={frameTokens} label={COPY.launchFailedBack} variant="ink" onPress={onExit} />
        </View>
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
        <Orb appId={installedApp.id} {...orb} onOpen={onOpenSheet} />
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
      <BgShape {...shape} color={bg} />
      <Animated.View
        style={[styles.layer, styles.opening, plateStyle]}
        pointerEvents="none"
        accessibilityRole={look.plate ? 'progressbar' : undefined}
        accessibilityLabel={look.plate ? COPY.appBootA11yLabel : undefined}
        accessibilityElementsHidden={!look.plate}
        importantForAccessibility={look.plate ? 'auto' : 'no-hide-descendants'}
      >
        <Animated.View style={plateMove}>
          <TilePlate size="grid" state="ready" tint={tint} glyph={icon} tokens={frameTokens} />
        </Animated.View>
        {look.label ? (
          <Animated.View style={[styles.openingLabel, labelMove]}>
            <Text tokens={frameTokens} type="callout" color="text-2" style={styles.centred}>{COPY.appBootLabel}</Text>
          </Animated.View>
        ) : null}
      </Animated.View>
      <Animated.View style={[styles.layer, orbStyle]} pointerEvents="box-none">
        <Orb appId={installedApp.id} {...orb} onOpen={onOpenSheet} />
      </Animated.View>
      {moving ? <BackWhileMoving onBack={onExit} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  slot: { flex: 1 },
  waitingSlot: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0 },
  errorRoot: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: LAYOUT.gutter },
  errorTitle: { textAlign: 'center', marginBottom: SPACE[3] },
  errorBody: { textAlign: 'center', marginBottom: LAYOUT.gapTitleToContent },
  // The one action, the full width.
  errorAction: { alignSelf: 'stretch' },
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  // The app's `bg` (`BgShape`): two bars laid out over the whole stage and four corner discs, each
  // moved and scaled from its top-left.
  shapeBar: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, transformOrigin: 'left top' },
  shapeCorner: { position: 'absolute', top: 0, left: 0, width: CORNER_DISC, height: CORNER_DISC, borderRadius: CORNER_DISC / 2, transformOrigin: 'left top' },
  opening: { alignItems: 'center', justifyContent: 'center' },
  // Under the centred plate without moving it: the words appear late, and the plate must not jump.
  openingLabel: { position: 'absolute', top: '50%', left: SPACE[6], right: SPACE[6], marginTop: TILE_SIDE.grid / 2 + SPACE[3] },
  centred: { textAlign: 'center' },
});
