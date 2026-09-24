// ─────────────────────────────────────────────────────────────────────────────
// NativeWhimAppInfo — codegen spec for the in-repo installed-app-info TurboModule
// (request-envelope D2).
// ─────────────────────────────────────────────────────────────────────────────
// The version and build number the phone reports must be the installed binary's, not a constant
// committed to the repo: the build number is injected by Gradle / fastlane at release time, after
// any JS is bundled. Codegen reads this `Spec` to emit `NativeWhimAppInfoSpec` on each platform;
// `WhimAppInfoModule.kt` (Android, `PackageInfo.versionName` / `longVersionCode`) and
// `WhimAppInfoModule.mm` (iOS, `CFBundleShortVersionString` / `CFBundleVersion`) implement it.
// Both values cross as the raw strings the OS reports; `src/host/launcher/app-info.ts` is the one
// place that validates them (a positive-integer build, a non-empty version).
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  getConstants(): {
    /** The installed marketing version (`versionName` / `CFBundleShortVersionString`). */
    version: string;
    /** The installed build number as the OS reports it (`longVersionCode` / `CFBundleVersion`). */
    build: string;
  };
}

// `get` (not `getEnforcing`): a missing module resolves to null instead of throwing at import, so
// the failure surfaces where the app info is read (`app-info.ts`), with a message naming it.
export default TurboModuleRegistry.get<Spec>('WhimAppInfo');
