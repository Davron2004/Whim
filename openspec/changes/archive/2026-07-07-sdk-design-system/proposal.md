# Proposal: sdk-design-system

## Why

Whim's promise is "speak an app into existence" — but every app a user speaks today comes out wearing the same placeholder palette, and the launcher around it is a wall of hard-coded hex literals. `tokens.ts` itself says its values are placeholders pending this change, and `index.tsx` defers `Slider`/`SegmentedControl` to it by name. This is roadmap change #3 (`sdk-design-system`), plus the launcher half that makes it user-visible: one theme, chosen by the user, restyling both the shell and every mini-app they ever generate.

Owner override, recorded per decision #44's own protocol: the "every export needs a corpus need" rule is **explicitly waived by the owner for this change** (2026-07-02, unattended-run instruction). The export ceiling (#42: 60–80 is a ceiling, not a target) still applies.

## What Changes

- **Theme model** (`src/sdk/theme.ts`, new): a data-only `WhimTheme` (semantic color roles, shape, dark flag), six curated presets, curated accent pairs, strict `sanitizeTheme`, pure `resolveTheme(pref)`. Shared by SDK and launcher — no React, no executable capability.
- **Theme-aware tokens** (`src/sdk/tokens.ts`): resolvers read the active theme (host-supplied via a frozen `globalThis.__WHIM_THEME__`, sanitized, hard fallback to the default theme). `ColorToken` grows `positive` and `warning`. Font stack becomes a token.
- **Component kit** (new SDK exports): `TextInput`, `Switch`, `Checkbox`, `Slider`, `SegmentedControl`, `Card`, `Divider`, `Badge`, `ProgressBar`, `List`/`ListItem`, `Spacer`, `EmptyState`, `Modal`, `Grid`; `Button` gains `variant`/`disabled`; `Text` gains `align`; `Row` gains `align`/`justify`.
- **Theme delivery** (runtime): optional `theme` field on the existing `__whimHostInit` frame; `loader.js` exposes it as a frozen global before mount. No new message kinds, no CSP/resolver/bridge change.
- **Launcher theming**: `ThemePref` persisted in the existing MMKV `KVBackend`; a Settings screen (presets, accent swatches, shape); Home and MiniAppView restyled from the resolved theme; the same theme handed to `deliverBySource` so mini-apps match the shell.
- **Gallery fixture** (`fixtures/style-gallery.app.tsx`): a seeded example app exercising every new component — the manual-QA surface and the knip anchor.
- **Docs**: `docs/sdk-reference.md` (the prompt-ready SDK reference, roadmap #3 deliverable); roadmap ledger note for the launcher-theme scope; decision log entry.

## Capabilities

### New Capabilities
- `sdk-design-system` — the themeable token contract and component kit rendered under the unchanged containment contract.

### Modified Capabilities
- `app-launcher` — adds user theme customization: persisted preference, settings surface, themed shell, theme handed to launched apps. (Base spec exists; delta only adds requirements.)

## Impact

**Code:** `src/sdk/*` (theme.ts new, tokens.ts, index.tsx, new component modules), `src/runtime/web/loader.js`, `src/host/launcher/*` (theme module + context, SettingsScreen new, HomeScreen/LauncherRoot/MiniAppView/deliver.ts/useMiniAppHost/copy.ts/seed.ts), `fixtures/style-gallery.app.tsx` (new), `build/build.mjs` + `build/assemble.mjs` (**hook-protected — main-thread edits only**), launcher test suites, `openspec/specs`, docs.

**Off-limits:** CSP, iframe sandbox attributes, resolver allowlist, bridge contract/registry/gate/dispatcher, version store, storage engine, `scripts/gate*.sh`, package.json (no new dependencies), invariant suites (runtime-owner surface — this change must pass them unedited).
