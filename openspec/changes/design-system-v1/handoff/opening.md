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
  a running realm never re-themes; a settings change applies at the next open or Retry remount.
- Wire: unchanged — `deliverBySourceJs({ …, theme })` → `reinject({ theme })` → `__whimHostInit`;
  the loader strips `chromeInsetBottom`, installs the rest as `__WHIM_THEME__`.
- Tests: `mini-app-host-ui.suite.tsx` ("a launch hands the realm the theme…", "a running app keeps
  the theme it opened with…"); desktop `deliver-by-source.desktop.mjs` check `host theme frame`
  (esbuild-compiles `theme-frame.ts` + `tokens-pure.ts` and delivers the real frame).

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
- Tests: `boot-state.suite.ts` ("only a paint stamped with the current bind's generation…", "a stale
  paint cannot cancel the startup deadline"); `mini-app-host-ui.suite.tsx` ("a trusted paint
  stamped for another launch…", "after Retry recreates the realm, the old realm's late paint…";
  fixture `firstPaint()` stamps the generation parsed from the delivery script); desktop
  `deliver-by-source.desktop.mjs` check `old realm paint after a reset`.

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
  so the plate never moves), Orb, ReportSheet. Both overlay layers are `pointerEvents="none"`.
- The WebView is never hidden itself (no opacity/visibility on it): the opaque cover hides it, so the
  page keeps drawing and its double-rAF `paint` is not throttled. "Hidden" = the cover is up.
- Cover fades out (`withTiming(0, timing('fadeIn', reduceMotion))`, 160 ms) when `revealed`; the
  plate fades the same way when the launch paints (`surface` leaves `boot`). Under Reduce Motion the
  fade is kept and marked `ReduceMotion.Never` (system.md §4.5: M2 becomes a 160 ms cross-fade).
- Both timers start when a WebView is bound and are keyed by its pool key: Retry restarts the opening.
- A failure surface (`launch-failed`, `app-error`) replaces the whole opening state at once.
- All container chrome (root, WebView, cover, both error screens) reads `useTokens()`; no
  `SHELL_PALETTE`. Error screens: `Text` title2/body `text-2`, primary = `buttonColors(t,'ink')`,
  secondary outlined `border` on `bg`. Copy unchanged (the crash-screen copy is a later chain).
- Closing: unchanged, `onExit` → `goHome` in `LauncherRoot`. The tile→screen container morph and
  the reverse are chain 22: it replaces the centred plate's position, not these timings or signals.
- Tests: `mini-app-host-ui.suite.tsx` (helpers `pageShown`, `isOpening`, `spansContainer`): "with no
  paint the page is shown at 600 ms anyway…", "the page fades in over 160 ms…", "the opening is the
  app's tile-sized plate…" (dark chrome), stale-paint/Retry/launch-failed cases; closing → Home in
  `mini-app-delivery.suite.tsx`.

## Pool (18.4) — `webview-pool.ts` (pure) + `MiniAppView.tsx` (`MiniAppStage`, `MiniAppView`)

```ts
export function MiniAppStage(props: { launch: MiniAppLaunch | null }); // in LauncherRoot once ready; MiniAppView = one launch
export function openApp(pool: WebViewPool, appId: string | null): WebViewPool; // + launchFailed, retryLaunch, pageLoaded,
// pageAnswered, pageGone, launchSlot, waitingSlot; PoolSlot.handedOut: 'warm' | 'loading' | 'cold'
```

- No app open: one WebView waits, the stage hidden (opacity 0, `pointerEvents="none"`, out of the a11y
  tree) under the screen. It holds `RUNTIME_HTML` and its idle, empty iframe; after `onLoadEnd` it gets
  `WARM_PROBE_JS` only, and is `warm` once the page answers `WARM_ANSWER` (its scripts ran).
- A launch takes the waiting WebView if `loading` or `warm` (delivered at once when loaded), else a
  cold one; a loaded-but-unanswered page (iOS JS off before the #74 rule list compiles) or one that
  failed/lost its process (`onError`, `onContentProcessDidTerminate`, `onRenderProcessGone`) is dropped.
- Every delivery is `reinject({ reset: true })`: new iframe, new nonce, the launch's generation, which
  is process-wide in `useMiniAppHost` (never reused across launches).
- A WebView that hosted a launch is destroyed on close, another app, a failure surface or Retry, and
  never waits again: chosen over a realm reset in place, so nothing of its outer page survives.
- Frames and load events reach a launch only from the WebView bound to it (by key): a stale frame of a
  previous launch or a retried realm — `paint`, `delivery {accepted}` (not GEN-stamped by the page;
  18b's LOW), `syscall`, `error` — is dropped. Opening timers are keyed by the bound WebView.
- Wire, `build/`, `src/runtime/web/` unchanged. Tests: `webview-pool.suite.ts`, `mini-app-host-ui` "pool: …",
  "after Retry, an accepted delivery…"; desktop "warm page, then a launch", "warm probe with … scripts off".

## Measuring tap-to-first-paint (18.4)

- Logged once per launch at the accepted paint of the realm the tap opened (never after Retry):
  `[whim] tap to first paint { tapToPaintMs, paintMs, webView }` (info, `CHANNELS.app`). Read it from
  logcat (`adb logcat -s ReactNativeJS | grep 'tap to first paint'`), the iOS console, or the dev log overlay.
- `tapToPaintMs` = `Date.now()` at `LauncherRoot.onOpen` (before the bundle read) → host accepts the
  paint (the reveal fade starts then). `paintMs` = the realm's mount → first paint. `webView` = how the
  launch got its WebView: `warm` | `loading` (still loading on Home) | `cold` (none waiting).
- Before = commit `chain-18d — log tap to first paint…` (same log, no pool); after = the tip (`warm`).
