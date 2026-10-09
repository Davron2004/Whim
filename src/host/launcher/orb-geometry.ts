/**
 * orb-geometry — where the orb sits over a running mini-app, and how much of the app's bottom
 * edge it covers (beta-1 D5, `app-launcher` §"The host tells the realm how much of the bottom the
 * orb covers").
 *
 * RN-free so the launcher's Node suite can test it. `Orb.tsx` lays itself out from these same
 * constants, so the footprint sent into the realm cannot drift from where the orb is drawn.
 */

import { SPACING } from '../../sdk/theme';

/** The orb's diameter. */
export const ORB_SIZE = 54;

/** The gap between the orb's bottom edge and the bottom safe-area inset. */
export const ORB_BOTTOM_MARGIN = SPACING.lg;

/** The largest footprint the realm is ever told about. */
const CHROME_INSET_MAX = 200;

/**
 * The height of the running app's bottom edge the orb covers: its size, its margin and the bottom
 * safe-area inset, rounded to whole pixels and clamped to 0–200. A non-finite result is 0.
 */
export function chromeInsetBottom(bottomSafeAreaInset: number): number {
  const inset = Math.round(ORB_SIZE + ORB_BOTTOM_MARGIN + bottomSafeAreaInset);
  if (!Number.isFinite(inset)) return 0;
  return Math.min(CHROME_INSET_MAX, Math.max(0, inset));
}
