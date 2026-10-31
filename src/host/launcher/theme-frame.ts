/**
 * theme-frame — the theme a launched app receives (design-system-v1 D3; app-launcher "A launched app
 * receives the theme for the phone's settings at that moment").
 *
 * Built from the shell's own token state (`useTokens()`: scheme, roles, text scale, Reduce Motion,
 * Increase Contrast, platform) and the app's tint, so the shell and the app paint from one token
 * module. The SDK's `sanitizeTheme` stays the trust boundary; this only selects values. Pure; no
 * React Native import, so the launcher's Node suites load it.
 */

import type { TintName } from '../../design/tokens';
import type { WhimTheme } from '../../sdk/theme';
import { tintColors, type ShellTokens } from '../ui/tokens-pure';

/** The part of the shell's tokens the frame reads. */
export type ThemeFrameSettings = Pick<ShellTokens, 'scheme' | 'colors' | 'fontScale' | 'reduceMotion' | 'increaseContrast' | 'platform'>;

/** The theme for an app with `tint` under the phone's settings `t`. Every SDK role reads the
 *  shell's role of the same name (`text-muted` is `text-2`, so Increase Contrast carries over);
 *  `primary`/`on-primary` are the tint's value and its label for the scheme. */
export function themeFrame(t: ThemeFrameSettings, tint: TintName): WhimTheme {
  const c = t.colors;
  const { fill, on } = tintColors(t, tint);
  return {
    colors: {
      bg: c.bg,
      surface: c.surface,
      sheet: c.sheet,
      'sheet-group': c['sheet-group'],
      thumb: c.thumb,
      text: c.text,
      'text-muted': c['text-2'],
      border: c.border,
      primary: fill,
      'on-primary': on,
      danger: c.danger,
      positive: c.positive,
      warning: c.warning,
    },
    scheme: t.scheme,
    tint,
    fontScale: t.fontScale,
    reduceMotion: t.reduceMotion,
    increaseContrast: t.increaseContrast,
    platform: t.platform,
  };
}
