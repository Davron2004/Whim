// ─────────────────────────────────────────────────────────────────────────────
// NativeWhimAgeSignal — codegen spec for the in-repo store-age-signal TurboModule
// (legal-surface-v2 D11; spec store-age-signals).
// ─────────────────────────────────────────────────────────────────────────────
// `WhimAgeSignalModule.mm` + `WhimAgeSignal.swift` (iOS, Apple Declared Age Range, iOS 26.2+) and
// `WhimAgeSignalModule.kt` (Android, Play Age Signals) implement it. Each reduces the store's answer
// on the native side to one of `adult`, `minor-approved`, `minor-not-approved` or `unavailable`,
// so no age range, birth date or store status ever reaches JS. `src/host/launcher/age-check.ts`
// is the one place that reads the string, treating anything else as `unavailable`.
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** The store's age signal, reduced. Resolves `unavailable` on an unsupported OS, a region
   *  without a signal, or any error; never rejects. */
  check(): Promise<string>;
}

// `get` (not `getEnforcing`): a build without the module reads as `unavailable` (`age-check.ts`).
export default TurboModuleRegistry.get<Spec>('WhimAgeSignal');
