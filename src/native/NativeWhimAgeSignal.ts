// ─────────────────────────────────────────────────────────────────────────────
// NativeWhimAgeSignal — codegen spec for the in-repo store-age-signal TurboModule
// (legal-surface-v2 D11; beta-1 D2; spec store-age-signals).
// ─────────────────────────────────────────────────────────────────────────────
// `WhimAgeSignalModule.mm` + `WhimAgeSignal.swift` (iOS, Apple Declared Age Range, iOS 26.2+) and
// `WhimAgeSignalModule.kt` (Android, Play Age Signals) implement it. Each reduces the store's answer
// on the native side to one of `adult`, `minor-approved`, `minor-not-approved`, `under-13` or
// `unavailable` (iOS never answers `minor-not-approved`), so no age range, birth date or store
// status ever reaches JS. `src/host/launcher/age-check.ts`
// is the one place that reads the string, treating anything else as `unavailable`.
//
// The significant-change acknowledgment (Apple only, iOS 26.4+) is two calls, so JS can give the
// store query its 3-second deadline and the guardian's sheet its 60-second one. Android answers
// `false` and `unavailable`: Play has no such API.
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** The store's age signal, reduced. Resolves `unavailable` on an unsupported OS, a region
   *  without a signal, or any error; never rejects. */
  check(): Promise<string>;
  /** Whether the store requires a guardian to be told of a significant app change (iOS 26.4+:
   *  `requiredRegulatoryFeatures` holds `significantAppChangeRequiresAdultNotification`).
   *  Resolves `false` on older iOS, on Android, and on any error; never rejects. */
  requiresSignificantUpdateAcknowledgment(): Promise<boolean>;
  /** Shows the guardian Apple's significant-update acknowledgment with `description`. Resolves
   *  `acknowledged`, `declined` (the guardian cancelled) or `unavailable` (older iOS, Android, no
   *  active window scene, any other error); never rejects. */
  acknowledgeSignificantUpdate(description: string): Promise<string>;
}

// `get` (not `getEnforcing`): a build without the module reads as `unavailable` (`age-check.ts`).
export default TurboModuleRegistry.get<Spec>('WhimAgeSignal');
