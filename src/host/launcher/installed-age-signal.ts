/**
 * installed-age-signal — the one place the `WhimAgeSignal` native module meets the launcher
 * (legal-surface-v2 D11). `age-check.ts` reduces what this returns; a build without the module
 * answers `undefined`, which reduces to `unavailable`.
 */

import NativeWhimAgeSignal from '../../native/NativeWhimAgeSignal';

/** Asks the store for its age signal through the native module. */
export function installedAgeSignal(): Promise<unknown> {
  return NativeWhimAgeSignal ? NativeWhimAgeSignal.check() : Promise.resolve(undefined);
}
