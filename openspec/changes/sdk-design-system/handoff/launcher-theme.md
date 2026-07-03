# Handoff: launcher-theme-state (chain-E)

Interface only — implementation lives in `src/host/launcher/theme.ts` (pure, no
React/react-native — Node-runnable) and `src/host/launcher/theme-context.tsx` (React state
only; NOT imported by the Node test suite).

## `src/host/launcher/theme.ts`

```ts
export const DEFAULT_THEME_PREF: ThemePref; // = { preset: 'paper' }

export function loadThemePref(kv: KVBackend): ThemePref;
export function saveThemePref(kv: KVBackend, pref: ThemePref): void;

export interface ShellPalette {
  bg: string; card: string; cardBorder: string; text: string; textMuted: string;
  accent: string; onAccent: string; danger: string;
}
export function shellPalette(theme: WhimTheme): ShellPalette;
```

Storage key: fixed string `'whim.theme:v1'` in the same `KVBackend` as `AppIndex`
(`whim.launcher` MMKV instance on device; `MapKVBackend` in tests) — JSON-encoded `ThemePref`.

**Tolerance semantics**: `loadThemePref` never throws and never returns a pref referencing an
unresolvable preset/accent/shape. Absent key, invalid JSON, or a non-object value all resolve to
`DEFAULT_THEME_PREF`. When the stored value IS an object: an unknown/wrong-typed `preset` falls
back to `'paper'`, but an unknown/wrong-typed `accent` or `shape` is simply **dropped** (field
omitted) rather than discarding the whole pref — so `{preset:'ink', accent:'bogus'}` loads as
`{preset:'ink'}`, not `DEFAULT_THEME_PREF`.

`shellPalette` key → `WhimTheme.colors` role mapping (pure, no fallback logic — caller passes an
already-resolved `WhimTheme`, typically via `resolveTheme`/`sanitizeTheme` from `src/sdk/theme`):
`bg←bg`, `card←surface`, `cardBorder←border`, `text←text`, `textMuted←'text-muted'`,
`accent←primary`, `onAccent←'on-primary'`, `danger←danger`.

## `src/host/launcher/theme-context.tsx`

```tsx
export interface ThemeContextValue {
  theme: WhimTheme;
  pref: ThemePref;
  setPref: (pref: ThemePref) => void;
}

export interface ThemeProviderProps {
  initialPref: ThemePref;
  onPrefChange?: (pref: ThemePref) => void;
  children: React.ReactNode;
}

export function ThemeProvider(props: Readonly<ThemeProviderProps>): JSX.Element;
export function useTheme(): ThemeContextValue; // throws if called outside a ThemeProvider
```

`theme` is derived via `resolveTheme(pref)` (SDK, chain-A) on every pref change — the provider
holds `pref` as the source of truth and recomputes `theme` from it, never the reverse.
Persistence is deliberately NOT this file's job: `setPref` updates local state and calls
`onPrefChange(pref)`; the caller (chain-F's `LauncherRoot`) is expected to call
`saveThemePref(kv, pref)` from that callback. Typical wiring:
`<ThemeProvider initialPref={loadThemePref(kv)} onPrefChange={(p) => saveThemePref(kv, p)}>`.
