// ─────────────────────────────────────────────────────────────────────────────
// NativeWhimLaunchScreen — codegen spec for the in-repo launch-screen TurboModule
// (design-system-v1 D12; specs/app-icon-and-launch "Launch shows the ember on the scheme's
// canvas with no flash"; docs/design/system.md §4.4 M27).
// ─────────────────────────────────────────────────────────────────────────────
// On a cold start each platform keeps its launch screen up past React Native's first frame:
// Android withholds the window's first draw, so the system splash (12+) or the launch window
// (below 12) stays, then fades the splash out over 160 ms; iOS covers the window with a copy of
// the launch storyboard and fades it out over 160 ms. `hide` ends that hold; Home calls it, through
// `src/host/launch-screen.ts`, on its first frame. Both sides also end it on their own after a
// cap, so a launch that never reaches Home is never stuck behind the ember. Fire-and-forget,
// idempotent, never throws back to JS.
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** Ends the cold-start hold of the launch screen with its 160 ms fade. Later calls do nothing. */
  hide(): void;
}

// `get` (not `getEnforcing`): a build without the module resolves to null, and hiding becomes a
// no-op that the native cap covers.
export default TurboModuleRegistry.get<Spec>('WhimLaunchScreen');
