/**
 * theme-context — React state for the launcher's resolved theme (design sdk-design-system,
 * D7). Pure React: resolves a `ThemePref` to a `WhimTheme` via the SDK's `resolveTheme` and
 * hands both down through context, alongside a `setPref` setter. Persistence is deliberately
 * NOT this file's job — `ThemeProvider` calls `onPrefChange` on every `setPref` and leaves
 * writing it to storage (`saveThemePref`) to the caller (`LauncherRoot`), keeping this module
 * pure state plumbing.
 */

import React, { createContext, useContext, useMemo, useState } from 'react';
import { resolveTheme, ThemePref, WhimTheme } from '../../sdk/theme';

export interface ThemeContextValue {
  theme: WhimTheme;
  pref: ThemePref;
  setPref: (pref: ThemePref) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  /** The pref to resolve on first render (typically loaded via `loadThemePref`). */
  initialPref: ThemePref;
  /** Called with the new pref every time `setPref` runs — the caller's cue to persist it. */
  onPrefChange?: (pref: ThemePref) => void;
  children: React.ReactNode;
}

export function ThemeProvider({ initialPref, onPrefChange, children }: Readonly<ThemeProviderProps>) {
  const [pref, setPref] = useState<ThemePref>(initialPref);
  const theme = useMemo(() => resolveTheme(pref), [pref]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      pref,
      setPref: (next: ThemePref) => {
        setPref(next);
        onPrefChange?.(next);
      },
    }),
    [theme, pref, onPrefChange],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
