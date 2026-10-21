# Contract: opening (chain-18)

Interface only. Theme shape: handoff/sdk-theme.md; token state: handoff/shell-ui.md.

## Theme frame (18.1) — `src/host/launcher/theme-frame.ts` (pure, no RN; Node-importable)

```ts
export type ThemeFrameSettings = Pick<ShellTokens,
  'scheme' | 'colors' | 'fontScale' | 'reduceMotion' | 'increaseContrast' | 'platform'>;
export function themeFrame(t: ThemeFrameSettings, tint: TintName): WhimTheme;
```

- Colours: every `WhimThemeColors` role reads `t.colors` of the same name; `text-muted` ← `text-2`
  (so Increase Contrast's `text-2 = text` carries over); `primary`/`on-primary` = `tintColors(t, tint)`
  (`TINTS[tint][scheme]`, `ON_TINT[scheme]`). Settings fields are copied as-is; `fontScale` is not
  clamped here (the SDK clamps to 0.85–2). `sanitizeTheme(frame)` deep-equals `frame`.
- `MiniAppView` has no `theme` prop any more. It builds the frame from `useTokens()` and
  `tileOf(installedApp).tint` each render and delivers `{ ...frame, chromeInsetBottom }` once per
  bound WebView (at bind if its page has loaded, else its `onLoadEnd`; `loadEndAction` dedupe). The frame is captured at that delivery:
  a running realm never re-themes; a settings change applies at the next open or Reload (a new launch).
- Wire: unchanged — `deliverBySourceJs({ …, theme })` → `reinject({ theme })` → `__whimHostInit`;
  the loader strips `chromeInsetBottom`, installs the rest as `__WHIM_THEME__`.
- Tests: `mini-app-host-ui` ("a launch hands the realm the theme…", "pool: a warm hand-over delivers the theme…", "a running
  app keeps the theme it opened with…"); desktop `deliver-by-source.desktop.mjs` `host theme frame` (the real frame).

## Opening signal (18.2) — `src/host/launcher/boot-state.ts` (pure) + `useMiniAppHost.ts`

```ts
export function paintAccepted(frame: PaintFrame | null | undefined, boundGeneration: number | null): boolean;
interface StartupDeadline {
  begin(): void;
  acceptPaint(frame: PaintFrame | null | undefined, boundGeneration: number | null): boolean;
  cancel(): void;
}
```

- The opening signal for the current launch is `host.state.paintMs !== null` (`hasPainted`). `bind()`
  resets it to `null`; only an accepted `paint` sets it. 18c reads this — no new state or frame.
- Accepted iff `trusted === true` (outer page's nonce check) AND `payload.generation ===
  boundGeneration` AND `payload.mountToFirstPaintMs` is finite and ≥ 0. `boundGeneration` is
  `live.current?.realm.generation ?? null` — the generation `deliverBySourceJs` sent as
  `reinject({ generation })`; `null` (nothing bound, launch refused, exited) accepts nothing.
- The stamp is the outer page's (`build/assemble.mjs` `stampGen`, chain-1), the host-bound `GEN`;
  the realm's own `__whimGeneration` never reaches the host. After a reset the old realm's paint
  fails the rotated nonce at the page (forwarded as `rejected-forgery`, `forgedKind: 'paint'`);
  one already forwarded to RN carries the old stamp and is refused by the host.
- Refused paints change nothing: the boot watchdog (`STARTUP_DEADLINE_MS` = 6 s) stays armed and
  still fails the launch ("app never became visible"). The 600 ms opening cap is 18c's, separate.
- Wire: unchanged. `src/runtime/web/` untouched.
- Tests: `boot-state.suite.ts` ("only a paint stamped with the current bind's generation…", "a stale paint cannot cancel
  the startup deadline"); `mini-app-host-ui` ("a trusted paint stamped for another launch…", "after Reload opens the app again
  in a new realm, the old realm’s late paint…"; `firstPaint()` stamps the delivered generation); desktop `old realm paint after a reset`.

## Opening state (18.3) — `boot-state.ts` (pure) + `MiniAppView.tsx`

```ts
export const OPENING_REVEAL_CAP_MS = 600;
export const OPENING_LABEL_AFTER_MS = 1_500;
export interface OpeningLook { revealed: boolean; plate: boolean; label: boolean }
export function openingLook(surface: MiniAppSurface, elapsed: { cap: boolean; label: boolean }): OpeningLook;
  // only 'boot' opens: revealed = !boot || cap; plate = boot; label = boot && label
```

- Layers in `MiniAppView`'s root (`bg`), in order: WebView (`bg`), cover (`bg`, all four insets 0,
  opacity 1 → 0), plate layer (transparent; `TilePlate size="grid" state="ready"` with
  `tileOf(installedApp)`'s tint and glyph, centred; "Opening…" `callout` `text-2` absolutely under it
  so the plate never moves), Orb. Both overlay layers are `pointerEvents="none"`.
- The WebView is never hidden itself (no opacity/visibility on it): the opaque cover hides it, so the
  page keeps drawing and its double-rAF `paint` is not throttled. "Hidden" = the cover is up.
- Cover fades out (`withTiming(0, timing('fadeIn', reduceMotion))`, 160 ms) when `revealed`; the
  plate fades the same way when the launch paints (`surface` leaves `boot`). Under Reduce Motion the
  fade is kept and marked `ReduceMotion.Never` (system.md §4.5: M2 becomes a 160 ms cross-fade).
- Timers keyed by the bound pool key (Reload restarts them): label from the bind, cap from the delivery —
  a loading page paints the light default canvas until the theme reaches it (18e, iOS dark flash).
- A failure surface (`launch-failed`, `app-error`) replaces the whole opening state at once.
- Frame boundary (18g): the app's area (stage root, WebView bg, cover, plate, "Opening…", error screens) + strip + `StatusBar` read the tokens captured at delivery (live `useTokens()` before it; Reload's WebView recaptures); orb and sheets stay live. `Text`/`TilePlate` take `tokens?: ShellTokens` (omitted = live).
- `launch-failed` (refused before delivery): `Text` title2/body `text-2`, one `buttonColors(t,'ink')` Back. `app-error` (fatal frame, paint watchdog, WebView gone) is the
  crash screen `AppCrashed({ name, tokens, bottomClearance, behind, onReload, onAskFix, onExit })` with the Orb over it; Reload = `MiniAppLaunch.onReload`, a new launch (no in-place retry); `behind` (= `MiniAppLaunch.behind`, the launch runs an older version than the app's current one) drops "Ask Whim to fix it" and says a newer version is ready.
- `LauncherRoot`'s frame (status-bar strip) + `StatusBar`: `bg`/`barStyle` of `MiniAppStage`'s `onFrame(pinned)` over an
  open app, else live tokens (`shellFrame(screen, live, appFrame)`).
- Closing (M3, chain 22): `onExit` → `morph.leaving`; in its tile `onClosed` → `goHome` unmounts the launch. Until then
  it keeps its WebView and realm (same generation): a tile tap mid-close turns the same launch back out, nothing re-delivered;
  its syscalls (storage writes, cues) are still served, as it may come back. Unmount tears the realm down and destroys the
  WebView; the next open is a new launch (WebView, iframe, nonce, generation). Leaving never cancels the startup deadline
  (`useMiniAppHost({ leaving })`): the realm's own 6 s, no fresh window on reopen; one ending while leaving is held unrecorded
  and fails the launch at once if it comes back out (an accepted paint clears it). Tests: `app-morph-ui` "M3: an app turned back out…".
- Tests: `mini-app-host-ui` ("…shown at 600 ms anyway…", "a page still loading is never shown before
  it has the theme…", "fades in over 160 ms…", "…tile-sized plate…", stale-paint/Reload cases);
  `mini-app-delivery` (closing → Home; "frame: over an open app…", "frame: an app opened in dark keeps…").

## Pool (18.4) — `webview-pool.ts` (pure) + `MiniAppView.tsx` (`MiniAppStage`, `MiniAppView`)
```ts
export function MiniAppStage(props: { launch: MiniAppLaunch | null; onFrame: (pinned: ShellTokens | null) => void }); // MiniAppView = one launch
export function openApp(pool: WebViewPool, opening: string | null): WebViewPool; // `${appId}@${tappedAt}`; + launchOpened, launchFailed,
// pageLoaded, pageAnswered, pageGone, launchSlot, waitingSlot; PoolSlot.handedOut: 'warm' | 'loading' | 'cold'
```
- One WebView waits with no app open, and beside an open app from its first accepted paint
  (`launchOpened`) or failure surface on (18e; not at bind: it slowed the opening). It holds
  `RUNTIME_HTML`; after `onLoadEnd` it gets `WARM_PROBE_JS` only, `warm` once it answers `WARM_ANSWER`.
- Each WebView sits in a slot `View` (`collapsable={false}`, kept for its life) carrying layout, opacity,
  `pointerEvents`, a11y; the WebView gets only `bg` (react-native-webview wraps it in a `flex: 1` View and
  gives `style`/`pointerEvents` to the native view, ignored on Android: 18f). Waiting slot: absolute fill,
  opacity 0, `none`, a11y-hidden; bound: `flex: 1`. `pool.slots` = draw order, waiting first (under).
- A launch takes the waiting WebView if `loading` or `warm` (delivered at once when loaded), else a cold one;
  loaded-but-unanswered (iOS JS off before the #74 rule list compiles), failed or process-gone ones are dropped.
- Every delivery is `reinject({ reset: true })`: new iframe, nonce, process-wide generation. A WebView that hosted
  a launch is destroyed on close, another app, a failure surface or Reload; a hand-over only restyles its slot.
- Frames and load events reach a launch only from its bound WebView (by key): a stale frame of a previous
  launch or reloaded realm, or any from the waiting one (`paint`, `delivery`, `syscall`, `error`), is dropped.
  Bound WebView gone (`onError`, process death): its events are dropped at once (Android sends a load end
  after an error), `host.webViewGone()` → `app-error`; Reload is a new launch in a fresh WebView.
- Tests: `webview-pool.suite.ts`, `mini-app-host-ui` "pool: …", "after Reload, an accepted delivery…";
  desktop "warm page, then a launch", "warm probe with … scripts off". Wire/`build/`/runtime unchanged.

## Measuring tap-to-first-paint (18.4)

- Once per launch (each Reload too) at its realm's accepted paint, release too: `[whim] tap to first paint { tapToPaintMs,
  paintMs, webView }` (info, `CHANNELS.app`). `tapToPaintMs` = `openNow`/`reloadRunning` press → accepted paint; `paintMs` =
  realm mount → paint; `webView`: `warm` | `loading` | `cold`. Android: `adb logcat -s ReactNativeJS`. iOS: os_log INFO —
  `xcrun simctl spawn <udid> log stream --level info --predicate 'subsystem == "com.facebook.react.log"'` (device: Console.app).
