/**
 * status-bar-style — the status bar's content over what is actually behind it (issue #218). No
 * React Native import, so the launcher's Node suites can load it.
 *
 * The bar sits over the page's frame, and while a sheet or menu is up, over that frame dimmed by
 * the overlay's scrim (in the shell's scheme, which may differ from an open app's frame). A light
 * app on a dark phone under the dark scrim is about #626160, where dark content reads at only ~3.4:1;
 * so the content is picked from the composited colour, never from either scheme alone.
 */

import { luminance, mixHex } from '../../design/tints';

export type StatusBarStyle = 'dark-content' | 'light-content';

const RGBA_RE = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/;

/** `layer` (`#rrggbb` or `rgba(r,g,b,a)`) composited over the opaque `under`, as `#RRGGBB`. */
function compositeOver(layer: string, under: string): string {
  const m = RGBA_RE.exec(layer);
  if (m === null) return mixHex(layer, under, 1);
  const hex = '#' + [m[1], m[2], m[3]].map((c) => Number(c).toString(16).padStart(2, '0')).join('');
  return mixHex(hex, under, Number(m[4]));
}

/** The colour under the status bar: `behind` (opaque) under each of `scrims`, the first lowest. */
export function backdropOf(behind: string, scrims: readonly string[]): string {
  return scrims.reduce((under, scrim) => compositeOver(scrim, under), behind);
}

/** The content with the higher contrast on `behind` under `scrims` (none: no overlay is up): each
 *  style draws white or black, whose WCAG contrast on a backdrop of luminance `l` is
 *  1.05 / (l + 0.05) and (l + 0.05) / 0.05. */
export function statusBarStyleOver(behind: string, scrims: readonly string[] = []): StatusBarStyle {
  const l = luminance(backdropOf(behind, scrims)) + 0.05;
  return 1.05 / l > l / 0.05 ? 'light-content' : 'dark-content';
}
