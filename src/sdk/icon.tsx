// ─────────────────────────────────────────────────────────────────────────────
// vc-sdk — icons (docs/design/system.md §3.1, §7.2)
// ─────────────────────────────────────────────────────────────────────────────
// Every SDK icon is inline SVG drawn from the one vendored path set (`src/design/icons`): DOM the
// sandbox already renders, so no network request, no image source and no CSP change. A name never
// fails: aliases, then keywords, then `circle` (`resolveIcon`), so an app can't render a blank.
import * as React from 'react';
import { ICON_PATHS, ICON_VIEWBOX } from '../design/icons/paths';
import { resolveIcon } from '../design/icons/names';
import { textColor, type TextColorToken } from './tokens';

export type IconSize = 'sm' | 'md' | 'lg';

/** Rendered side of each public size, in CSS px. */
const ICON_PX: Readonly<Record<IconSize, number>> = { sm: 16, md: 20, lg: 24 };

/** The rendered stroke of §3.1: 1.5 px up to 20, 1.75 px from 24. */
function renderedStroke(sizePx: number): number {
  return sizePx >= 24 ? 1.75 : 1.5;
}

export interface GlyphProps {
  name: string;
  /** Rendered side in CSS px. */
  sizePx: number;
  /** A resolved colour; absent = `currentColor`, the colour of the text around it. */
  colorValue?: string;
  /** Accessible name; absent = decorative (hidden from assistive technology). */
  label?: string;
}

/** The SDK-internal icon renderer that `Icon` and the components with an `icon` prop share. */
export function Glyph({ name, sizePx, colorValue, label }: GlyphProps): React.ReactElement {
  const resolved = resolveIcon(typeof name === 'string' ? name : '').name;
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return React.createElement(
    'svg',
    {
      ...a11y,
      width: sizePx,
      height: sizePx,
      viewBox: `0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`,
      fill: 'none',
      stroke: 'currentColor',
      // In viewBox units, so the rendered stroke is §3.1's at every size.
      strokeWidth: (renderedStroke(sizePx) * ICON_VIEWBOX) / sizePx,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      focusable: 'false',
      style: {
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
        ...(colorValue === undefined ? {} : { color: colorValue }),
      },
    },
    React.createElement('path', { d: ICON_PATHS[resolved] }),
  );
}

export interface IconProps {
  /** One of the icon names (`timer`, `coffee`, …). Old and near names resolve; an unknown one draws
   *  a plain circle. */
  name: string;
  /** `sm` 16, `md` 20 (default), `lg` 24. */
  size?: IconSize;
  color?: TextColorToken;
  /** What the icon means, for screen readers. Absent = decorative (a label beside it says it). */
  label?: string;
}

export function Icon({ name, size = 'md', color = 'text', label }: IconProps): React.ReactElement {
  const sizePx = Object.prototype.hasOwnProperty.call(ICON_PX, size) ? ICON_PX[size] : ICON_PX.md;
  return React.createElement(Glyph, { name, sizePx, colorValue: textColor(color), label });
}
