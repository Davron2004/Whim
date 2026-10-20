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
  WebView mount (`onLoadEnd`, `loadEndAction` dedupe). The frame is captured at that delivery:
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
- Both timers start at each WebView mount and are keyed by `webKey`: Retry restarts the opening.
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
