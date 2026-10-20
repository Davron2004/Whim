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
