/**
 * orb-geometry — where the orb sits over a running mini-app, how much of the app's bottom edge it
 * covers (beta-1 D5, `app-launcher` §"The host tells the realm how much of the bottom the orb
 * covers"), and how a drag carries it between its two corners (system.md §7.1 Orb, §4.3 rule 6, M16).
 *
 * `Orb.tsx` lays itself out from these same constants, so the footprint sent into the realm cannot
 * drift from where the orb is drawn. The drag functions are worklets: the orb's pan runs them on the
 * UI thread.
 */

import { SPACE } from '../../design/tokens';
import { projectRelease, rubberBand } from '../ui/Sheet';

/** The disc's diameter. */
export const ORB_DISC = 44;

/** The touch target's side; it spills past the disc equally on every side. */
export const ORB_TARGET = 52;

/** The gap between the disc and the screen's side edge, and between the disc and the bottom
 *  safe-area inset. */
const ORB_EDGE = SPACE[4];

/** The same gaps for the target, which reaches past the disc by half the difference. */
export const ORB_TARGET_EDGE = ORB_EDGE - (ORB_TARGET - ORB_DISC) / 2;

/** The largest footprint the realm is ever told about. */
const CHROME_INSET_MAX = 200;

/**
 * The height of the running app's bottom edge the orb covers: the disc with its edge gap below and
 * the same gap above (76 pt, what the first orb covered too, so SDK `Screen` and `Modal`'s action row
 * pad as before), plus the bottom safe-area inset, rounded to whole pixels and clamped to 0–200. The
 * whole target lies inside it in either corner. A non-finite result is 0.
 */
export function chromeInsetBottom(bottomSafeAreaInset: number): number {
  const inset = Math.round(ORB_EDGE + ORB_DISC + ORB_EDGE + bottomSafeAreaInset);
  if (!Number.isFinite(inset)) return 0;
  return Math.min(CHROME_INSET_MAX, Math.max(0, inset));
}

/** The target's left edge in each corner, for a screen `width` wide with these side insets. */
export function orbBounds(width: number, insets: { left: number; right: number }): { leading: number; trailing: number } {
  return { leading: insets.left + ORB_TARGET_EDGE, trailing: width - insets.right - ORB_TARGET_EDGE - ORB_TARGET };
}

/** Where a horizontal drag that started at `start` and has moved `translation` past the slop puts
 *  the target: 1:1 between the corners, rubber-banding past either. */
export function orbDragX(start: number, translation: number, leading: number, trailing: number): number {
  'worklet';
  const raw = start + translation;
  if (raw < leading) return leading - rubberBand(leading - raw, ORB_TARGET);
  if (raw > trailing) return trailing + rubberBand(raw - trailing, ORB_TARGET);
  return raw;
}

/** How far up a drag lifts the orb from its resting row (upward-positive): 1:1 upward, rubber-banding
 *  below the row. */
export function orbDragLift(translation: number): number {
  'worklet';
  const up = -translation;
  return up >= 0 ? up : -rubberBand(-up, ORB_TARGET);
}

/**
 * The arming predicate for a drag from `rest` at `x` with `velocityX` (pt/s, rightward-positive), as
 * the corner it points to (the target's left edge): the corner its projected end is nearer, unless
 * that is the other corner and the velocity points back toward `rest`. The orb asks it each frame
 * (`stepCommit`) and on release for a drag that has not armed; the release itself goes by the latch.
 */
export function orbReleaseX(rest: number, x: number, velocityX: number, leading: number, trailing: number): number {
  'worklet';
  const projected = projectRelease(x, velocityX);
  const nearer = Math.abs(projected - leading) < Math.abs(projected - trailing) ? leading : trailing;
  if (nearer !== rest && (rest - x) * velocityX > 0) return rest;
  return nearer;
}

/** The corner across from `rest`, as the target's left edge. */
export function orbOtherCorner(rest: number, leading: number, trailing: number): number {
  'worklet';
  return rest === leading ? trailing : leading;
}

/** Which way along x (+1 or −1) a drag from `rest` heads toward the other corner: a drag's commit
 *  direction. A position or velocity times this is how far, or how fast, it is going across. */
export function orbAcross(rest: number, leading: number, trailing: number): number {
  'worklet';
  return Math.sign(orbOtherCorner(rest, leading, trailing) - rest);
}

/** The velocity the settling spring is handed for a release at `x` with `velocityX` toward the
 *  corner at `to`: the release velocity, but never more than would project past the corner, so a hard
 *  fling lands in the corner instead of overshooting off the screen's edge. */
export function orbSettleVelocity(x: number, to: number, velocityX: number): number {
  'worklet';
  const reach = projectRelease(0, 1);
  const limit = Math.abs(to - x) / reach;
  if ((to - x) * velocityX <= 0) return velocityX;
  return Math.sign(velocityX) * Math.min(Math.abs(velocityX), limit);
}
