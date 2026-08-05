/**
 * theme-context — React context for the launcher's (now fixed) theme (v2; docs/design/README.md
 * "Two systems, not one"). The shell theme is no longer a `ThemePref` resolved on the fly — it
 * is always the SDK's `DEFAULT_THEME`. `ThemeProvider`/`useTheme()` survive as a thin context
 * wrapper only so every screen that already reads `const { theme } = useTheme()` keeps working
 * unchanged; there is no `pref`/`setPref` surface left to simplify away further.
 */

import React, { createContext, useContext } from 'react';
import { DEFAULT_THEME, WhimTheme } from '../../sdk/theme';

export interface ThemeContextValue {
  theme: WhimTheme;
}

const DEFAULT_CONTEXT_VALUE: ThemeContextValue = { theme: DEFAULT_THEME };

const ThemeContext = createContext<ThemeContextValue>(DEFAULT_CONTEXT_VALUE);

export function ThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ThemeContext.Provider value={DEFAULT_CONTEXT_VALUE}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
