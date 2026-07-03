# Tasks: sdk-design-system

## 1. Theme core (SDK)

- [x] 1.1 Create `src/sdk/theme.ts`: `WhimTheme`/`ThemePref`/`ThemeShape` types, the 6 presets, 10 accent pairs, shape→radius scales, `resolveTheme`, `sanitizeTheme`, frozen `DEFAULT_THEME` — values verbatim from design.md "The theme model".
- [x] 1.2 Rework `src/sdk/tokens.ts`: resolvers read the active theme (`globalThis.__WHIM_THEME__` sanitized once, cached, fallback `DEFAULT_THEME`); `ColorToken` gains `positive`/`warning`; radius resolves through the theme's shape scale; add a `FONT` stack constant and use it where fonts were hardcoded.
- [x] 1.3 Re-export theme types (`WhimTheme`, `ThemeShape`) type-only from `src/sdk/index.tsx`; keep every existing export intact; `npm run build && npm run typecheck` green.

## 2. SDK controls

- [x] 2.1 Create `src/sdk/controls.tsx`: `TextInput`, `Switch`, `Checkbox`, `Slider`, `SegmentedControl` per design D6 (inline styles, tokens only, `emitUiEvent` on interaction, NumberInput-grade appearance resets).
- [x] 2.2 Upgrade `Button` in `src/sdk/index.tsx`: `variant` + `disabled` per D6, default behavior byte-compatible (`variant='primary'`).
- [x] 2.3 Re-export controls from `index.tsx`; build + typecheck + lint green.

## 3. SDK surfaces

- [x] 3.1 Create `src/sdk/surfaces.tsx`: `Card`, `Divider`, `Badge`, `ProgressBar`, `List`/`ListItem`, `Spacer`, `EmptyState`, `Modal`, `Grid` per D6.
- [x] 3.2 Add `align` to `Text`, `align`/`justify` to `Row` (existing defaults unchanged).
- [x] 3.3 Re-export surfaces from `index.tsx`; build + typecheck + lint green.

## 4. Runtime theme delivery

- [x] 4.1 `src/runtime/web/loader.js`: on the `__whimHostInit` frame, if a `theme` field is present, install it as `globalThis.__WHIM_THEME__` (Object.freeze) before any bundle mount; absent field = no global, zero behavior change.
- [x] 4.2 `src/host/launcher/deliver.ts`: `deliverBySourceJs(record, source, generation, theme?)` — serialize a validated theme into the `reinject` options; extend `deliver.suite.ts` (theme present/absent, serialization safety).
- [x] 4.3 `src/host/launcher/useMiniAppHost.ts`: thread an optional theme through `deliverBySource`.
- [ ] 4.4 MAIN THREAD ONLY: `build/assemble.mjs` — outer page carries `reinject` opts `theme` into the `__whimHostInit` frame; `build/build.mjs` — register `style-gallery` in `APPS` + `bundles`.

## 5. Launcher theme state

- [x] 5.1 Create `src/host/launcher/theme.ts`: `loadThemePref`/`saveThemePref` over `KVBackend` (key `whim.theme:v1`, tolerant parse), `shellPalette(theme)` mapping `WhimTheme` → the shell's named RN colors.
- [x] 5.2 Create theme context (`ThemeContext`/`useTheme`) with `{theme, pref, setPref}`.
- [x] 5.3 New `theme.suite.ts` in launcher tests: resolveTheme matrix (preset × accent × shape), sanitizeTheme rejection paths, pref persistence round-trip on `MapKVBackend`, garbage tolerance; wire into `acceptance.ts`.

## 6. Launcher UI

- [x] 6.1 `SettingsScreen.tsx` (new): preset cards (name + palette dots, selected ring), accent swatch row (incl. "preset default"), shape segmented control; changes apply live via `setPref`; own `hardwareBackPress` → home.
- [x] 6.2 `LauncherRoot.tsx`: provide theme context, persist on change, add `{kind:'settings'}` to the `Screen` union, pass the resolved theme into `MiniAppView` → `deliverBySource`.
- [x] 6.3 Restyle `HomeScreen.tsx` from `shellPalette`: header (wordmark + settings affordance), themed tiles/cards/CTA; kill inlined hex.
- [x] 6.4 Theme `MiniAppView`/`App.tsx` backgrounds + StatusBar style from `theme.dark`; all new strings through `copy.ts`.
- [ ] 6.5 (runs in chain-G — needs the gallery registered and built first) `seed.ts`: `SEED_VERSION = 2`, add `style-gallery` seed; update `seed.suite.ts`.

## 7. Gallery, docs, close-out

- [x] 7.1 Create `fixtures/style-gallery.app.tsx`: one screen exercising every new component (Cards per section, live Switch/Slider/Segmented state, Modal demo, Badge/Progress/List/EmptyState).
- [ ] 7.2 Write `docs/sdk-reference.md`: prompt-ready reference — every export, props, tokens, theme note.
- [ ] 7.3 MAIN THREAD: roadmap ledger note (launcher-theme scope beyond #5), decision log entry, `progress.md`, full gate.
