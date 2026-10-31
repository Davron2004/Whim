/**
 * tiles — derived tile visuals for the current home grid (launcher-shell / #5 D6, shell-redesign-v2
 * chain-F): a colour per app, resolved over the design system's tints. A pure function, so it is
 * trivially unit-checkable.
 */

import { TINTS } from '../../design/tokens';
import { fallbackTint, nearestTint } from '../../design/tints';
import type { AppManifest } from '../bridge/contract';

/**
 * The colour the current screens paint an app's tile, history header and prose mentions with,
 * always one of the ten tints' light values (`docs/design/system.md` §2.4). A declared hex
 * `tileColor` on `manifest` (the host-held record's, never the running bundle's self-report) maps
 * to the nearest tint by CIEDE2000; anything else, or no manifest, takes `fallbackTint(name)`. No
 * tint is a reserved status or shell hue, so nothing needs filtering out. A transitional reader:
 * the host-assigned tile of an installed app is `tile-identity.ts#tileOf`.
 */
export function tileColor(name: string, manifest?: Pick<AppManifest, 'tileColor'>): string {
  const declared = manifest?.tileColor;
  const tint = (declared === undefined ? undefined : nearestTint(declared)) ?? fallbackTint(name);
  return TINTS[tint].light;
}
