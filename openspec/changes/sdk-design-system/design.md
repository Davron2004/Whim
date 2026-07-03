# Design: sdk-design-system

## Context

Mini-apps render via `React.createElement` + inline styles inside a hardened iframe; components accept semantic tokens only (#13), the contract is backend-agnostic (#11), and the only host→iframe data path is the postMessage handshake composed in `build/assemble.mjs`. The launcher shell has no theme system at all — hex literals inline in five files. `tokens.ts` and `index.tsx` both carry comments deferring their real design to this change. Full research: `research.md`.

## Goals / Non-Goals

**Goals**
- One theme vocabulary, chosen by the user once, restyling the launcher shell AND every mini-app (existing snapshots included — they already speak tokens).
- A component kit broad enough that generated apps stop looking like wireframes: forms, toggles, lists, cards, progress, modal.
- Theme is inert data end-to-end: no CSP, resolver, sandbox-attribute, or bridge change anywhere in this diff.
- Every piece of pure logic (theme resolution, sanitization, persistence, delivery serialization) covered by `launcher:test`.

**Non-Goals**
- Charts (#4), version-history UX (#6), prompt flow (#7), animation/motion system, icon library, custom fonts (CSP forbids remote fonts; system-ui stays), per-app themes, arbitrary user hex input beyond the curated accent list, Toast/Alert (imperative surfaces — need an SDK effects story first), live retheme of a *running* realm (theme applies at delivery; realms are recreated on every launch anyway).

## The theme model (normative — copy these values verbatim)

```ts
// src/sdk/theme.ts — pure data + pure functions. No React. No DOM. No side effects.
export type ThemeShape = 'sharp' | 'soft' | 'round';

export interface WhimTheme {
  name: string;          // preset id it was resolved from
  dark: boolean;         // drives status-bar style + WebView bg host-side
  shape: ThemeShape;
  colors: {
    bg: string; surface: string; text: string; 'text-muted': string; border: string;
    primary: string; 'on-primary': string;
    danger: string; positive: string; warning: string;
  };
}

export interface ThemePref { preset: string; accent?: string; shape?: ThemeShape; }
```

### Presets (6)

| id | dark | shape | bg | surface | text | text-muted | border | primary | on-primary | danger | positive | warning |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `paper` (default) | no | soft | `#fbfaf8` | `#f1efea` | `#1c1917` | `#6b6560` | `#e0dcd4` | `#4f46e5` | `#ffffff` | `#dc2626` | `#16a34a` | `#b45309` |
| `ink` | yes | soft | `#0b1020` | `#171d31` | `#e7eaf3` | `#8a93a8` | `#2a3149` | `#8ab4ff` | `#0b1020` | `#f87171` | `#4ade80` | `#fbbf24` |
| `neon` | yes | round | `#0a0a0f` | `#16121f` | `#f2eefc` | `#9a8fb8` | `#2d2440` | `#d946ef` | `#14041a` | `#fb7185` | `#34d399` | `#facc15` |
| `meadow` | no | soft | `#f6faf4` | `#eaf3e6` | `#1a2416` | `#5f6f58` | `#d5e3cf` | `#15803d` | `#ffffff` | `#dc2626` | `#16a34a` | `#ca8a04` |
| `sunset` | no | round | `#fff8f2` | `#ffeede` | `#33201a` | `#8a6f63` | `#f3ddc9` | `#ea580c` | `#ffffff` | `#be123c` | `#16a34a` | `#b45309` |
| `mono` | no | sharp | `#ffffff` | `#f5f5f5` | `#111111` | `#666666` | `#e2e2e2` | `#111111` | `#ffffff` | `#dc2626` | `#16a34a` | `#b45309` |

### Accent pairs (10, curated so contrast is guaranteed by curation, not math)

`indigo #4f46e5/#ffffff`, `blue #2563eb/#ffffff`, `sky #0284c7/#ffffff`, `teal #0d9488/#ffffff`, `green #16a34a/#ffffff`, `amber #b45309/#ffffff`, `rose #e11d48/#ffffff`, `fuchsia #c026d3/#ffffff`, `violet #7c3aed/#ffffff`, `slate #334155/#ffffff`. Each is a `{ primary, 'on-primary' }` pair; an accent override swaps exactly those two roles of the resolved preset.

### Shape → radius scales (px)

| shape | none | sm | md | lg | full |
|---|---|---|---|---|---|
| sharp | 0 | 2 | 4 | 8 | 12 |
| soft | 0 | 6 | 12 | 20 | 999 |
| round | 0 | 10 | 16 | 26 | 999 |

### Functions

- `resolveTheme(pref: ThemePref): WhimTheme` — pure: unknown preset → `paper`; unknown accent → ignore; explicit `shape` overrides the preset's.
- `sanitizeTheme(input: unknown): WhimTheme` — field-by-field: every color must match `/^#[0-9a-f]{6}$/i` else that field falls back to the default theme's value; `shape` must be one of the three else `soft`; `dark` coerced with `!!`. Never throws. This is the iframe-side trust boundary: the SDK treats `globalThis.__WHIM_THEME__` as untrusted input.
- `DEFAULT_THEME: WhimTheme` — `resolveTheme({preset:'paper'})`, exported as a frozen constant.

## Decisions

**D1 — Theme rides the existing init frame; the SDK reads a frozen global.** The host adds an optional `theme` field to the `__whimHostInit` postMessage frame (already the only trusted host→iframe config frame). `loader.js` stores it as `globalThis.__WHIM_THEME__` (Object.freeze, best-effort) *before* mounting the bundle. `tokens.ts` sanitizes it once at first resolver call, caches, and hard-falls-back to `DEFAULT_THEME`. No new message kinds, no bridge syscall, nothing for a hostile bundle to gain: mutating the global only mis-themes itself. Rejected: a `theme` syscall (capability creep for inert data); CSS variables (no stylesheet exists — inline styles everywhere); baking theme into bundles (breaks snapshot immutability and byte-identical delivery, #43 D7).

**D2 — Semantic roles are the contract; themes swap values, never names.** `ColorToken` grows exactly two roles (`positive`, `warning`); everything else restyles through existing names, which is why every existing snapshot themes for free. Rejected: exposing raw hex to apps (#13 stands).

**D3 — Customization = preset + two knobs.** Preset picker (6), accent override (10 curated pairs), shape override (3). Curated pairs make contrast a review-time property, not a runtime computation. Rejected: free-form color wheel (contrast + product-coherence hazard, and #13's spirit applies to users too — for v1).

**D4 — One source file serves both sides.** `src/sdk/theme.ts` is pure data + pure functions (no React import, nothing executable beyond them), so the RN launcher imports it directly, same as the sanctioned type-only seams. The launcher additionally derives its RN styles from the resolved `WhimTheme` via a small `shellPalette()` in `src/host/launcher/theme.ts` — the shell never grows its own second palette.

**D5 — SDK splits into modules behind the same barrel.** New components live in `src/sdk/controls.tsx` (interactive) and `src/sdk/surfaces.tsx` (layout/display), re-exported through `index.tsx`. The resolver gates the *specifier* `vc-sdk`, so internal files cost nothing. Existing components stay where they are.

**D6 — Component kit scope** (props are the whole contract; implementation is inline styles, `emitUiEvent` on every interaction, following existing patterns):
- `TextInput { label?, value, placeholder?, onChange?(s: string) }` — same chrome discipline as NumberInput (appearance/outline reset).
- `Switch { label?, value: boolean, onChange?(b) }` — custom div track+knob (no native checkbox chrome), animated via CSS transition on transform.
- `Checkbox { label, checked, onChange?(b) }` — native input + `accentColor: color('primary')`.
- `Slider { label?, value, min?=0, max?=100, step?=1, onChange?(n) }` — native range input + `accentColor` (pseudo-element styling is impossible with inline styles; `accent-color` is the sanctioned lever).
- `SegmentedControl { options: string[], value, onChange?(s) }` — surface container, selected segment `primary`/`on-primary`.
- `Button` gains `variant?: 'primary'|'secondary'|'ghost'|'danger'` and `disabled?: boolean` (secondary = surface bg + border + text; ghost = transparent + primary text; disabled = 0.5 opacity, callbacks suppressed).
- `Card { padding?='lg', radius?='lg', onPress?, children }` — surface bg + 1px border; with onPress renders as a button-semantics element.
- `Divider {}`, `Spacer {}` (flexGrow 1), `Grid { columns?=2, gap?='md', children }`.
- `Badge { label, tone?='neutral'|'primary'|'positive'|'warning'|'danger' }` — pill; tinted bg via 8-digit hex (`tone color + '22'`), text in tone color (neutral → text-muted).
- `ProgressBar { value /* 0..1, clamped */, tone?='primary' }` — 8px track (surface + border), filled span, radius full.
- `List { children }` / `ListItem { title, subtitle?, trailing?, onPress? }` — List draws hairline dividers between children; ListItem is the record-row workhorse.
- `EmptyState { title, hint? }` — centered muted stack.
- `Modal { visible, title?, onClose, children }` — fixed full overlay, dimmed backdrop (tap → onClose), bottom-sheet card with top radius `lg`. Renders `null` when hidden.
- `Text` gains `align?: 'start'|'center'|'end'`; `Row` gains `align?` (items) and `justify?: 'start'|'center'|'end'|'between'`.
Export count lands ≈35 — under the #42 ceiling. Search/filter stays app logic (TextInput + list state), not a List prop.

**D7 — Launcher theming.** `ThemePref` persisted as JSON under fixed key `whim.theme:v1` in the existing `whim.launcher` MMKV `KVBackend` (same seam as `SEED_KEY`). `LauncherRoot` resolves it, provides `{theme, pref, setPref}` via React context (`useTheme()`), re-persists on change — settings apply live. New `Screen` union member `{kind:'settings'}`; SettingsScreen registers its own `hardwareBackPress` → home (BackPolicy untouched — it only ever binds inside `useMiniAppHost`). MiniAppView/DevProbeScreen/App.tsx backgrounds + StatusBar style derive from the theme.

**D8 — Delivery.** `deliverBySourceJs(record, source, generation, theme?)` adds a `theme` field to the `reinject(...)` options; the outer page (assemble.mjs — **main-thread edit**) carries it into the `__whimHostInit` frame it posts on the iframe's hello. Absent theme anywhere in the chain → SDK defaults; the baked-bundle path and every invariant scenario page stay valid unmodified. Theme validity on the host side is structural — `resolveTheme` only ever draws from the curated compile-time tables, so the launcher never serializes a non-curated value; the regex check (`sanitizeTheme`) lives iframe-side, at the actual trust boundary. The delivery test asserts the serialized form can't break out of the JS string. A `reinject` without a theme clears any previously pending one (absent theme → SDK defaults, never a stale carry-over).

**D9 — Gallery fixture is the corpus app.** `fixtures/style-gallery.app.tsx` exercises every new component on one screen (sections in Cards, a Modal demo, live Switch/Slider/SegmentedControl state), registered in `build.mjs` `APPS` + `bundles` (**main-thread edit**), seeded as example #3 via `SEED_VERSION = 2`. It is the manual-QA surface, the knip anchor for every new export, and the honest stand-in for the waived corpus rule (#44 override recorded in proposal.md).

## Risks / Trade-offs

- **Hook-protected edits** (`build/assemble.mjs`, `build/build.mjs`) can't go to implementers — the main thread does them (chains.md marks chain-D-main NOT IMPLEMENTER-DISPATCHABLE). If the hook denies even the main thread in this unattended run, fallback: launcher-side theming still ships; iframe theme delivery waits for an attended session (SDK defaults keep apps correct).
- **Native control styling** (Slider/Checkbox via `accent-color`) trades pixel-perfect cross-theme consistency for zero custom drag logic. Revisit if the gallery looks wrong on-device.
- **Invariant suites must pass unedited** — this diff touches loader.js (trusted region). The change is additive (one optional field read, one global installed before mount). If any invariant reddens, the loader change is reverted, not the invariant.
- **Perf**: inline-style objects per render are the existing cost model; the 150ms first-paint ceiling is asserted by the existing suite and the gallery is deliberately one screen.

## Migration Plan

Purely additive. Existing snapshots re-render themed because they already speak tokens. Existing installs gain the gallery via the SEED_VERSION bump; no data migration anywhere.

## Open Questions

- Does `accent-color` render acceptably inside the Android System WebView for range inputs? (Desktop Chromium: yes. Device pass is the existing on-device probe ritual, out of this change's gate.)
- Should FloatingExit adopt the theme? Deferred — it is deliberately high-contrast for reachability; left untouched.
