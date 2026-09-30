/**
 * installed-age-signal — the one place the `WhimAgeSignal` native module meets the launcher
 * (legal-surface-v2 D11). `age-check.ts` reduces what this returns; a build without the module
 * answers `undefined`, which reduces to `unavailable`.
 */

import { Platform } from 'react-native';
import NativeWhimAgeSignal from '../../native/NativeWhimAgeSignal';
import type { SignificantUpdateSheet } from './age-check';

/** Asks the store for its age signal through the native module. */
export function installedAgeSignal(): Promise<unknown> {
  return NativeWhimAgeSignal ? NativeWhimAgeSignal.check() : Promise.resolve(undefined);
}

/** The guardian's significant-change acknowledgment (beta-1 D2), on iOS only: Play has no such
 *  API, so on Android (and in a build without the module) there is none to ask. */
function significantUpdateSheet(): SignificantUpdateSheet | undefined {
  const native = NativeWhimAgeSignal;
  if (Platform.OS !== 'ios' || !native) return undefined;
  return {
    required: () => native.requiresSignificantUpdateAcknowledgment(),
    acknowledge: (description) => native.acknowledgeSignificantUpdate(description),
  };
}

export const installedSignificantUpdate = significantUpdateSheet();
