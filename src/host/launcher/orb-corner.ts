/**
 * orb-corner — which bottom corner each app's orb rests in (system.md §7.1 Orb, M16: "remembered per
 * app"), in the `whim.launcher` store every launcher setting persists through. Only a move off the
 * default is stored, under the app's launcher id; deleting the app forgets it (`AppIndex.remove`).
 */

import type { KVBackend } from '../version-store/fs/kv-fs';

/** Bottom-trailing (the default) or bottom-leading. */
export type OrbCorner = 'trailing' | 'leading';

const cornerKey = (appId: string) => `orb-corner:${appId}`;

/** The corner `appId`'s orb was left in; bottom-trailing when it never moved or the value is unknown. */
export function loadOrbCorner(kv: KVBackend, appId: string): OrbCorner {
  return kv.getString(cornerKey(appId)) === 'leading' ? 'leading' : 'trailing';
}

/** Remember the corner `appId`'s orb settled in. */
export function saveOrbCorner(kv: KVBackend, appId: string, corner: OrbCorner): void {
  if (corner === 'leading') kv.set(cornerKey(appId), corner);
  else kv.delete(cornerKey(appId));
}

/** Forget `appId`'s corner: the app is gone. */
export function forgetOrbCorner(kv: KVBackend, appId: string): void {
  kv.delete(cornerKey(appId));
}
