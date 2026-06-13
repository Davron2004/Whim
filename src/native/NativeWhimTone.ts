// ─────────────────────────────────────────────────────────────────────────────
// NativeWhimTone — codegen spec for the in-repo audio-cue TurboModule (effects-and-cues D6).
// ─────────────────────────────────────────────────────────────────────────────
// The "minimal dependency is NONE" choice: a ~30-line Kotlin module wrapping
// `android.media.ToneGenerator`, instead of dragging react-native-sound / expo-av into a bare
// RN 0.85 (new-arch, bridgeless) app for three beeps. Codegen (gradle) reads this `Spec` to
// emit the abstract `NativeWhimToneSpec`; `WhimToneModule.kt` implements it. The contract is a
// single fire-and-forget `play(token)` — the host (Kotlin) owns the token→tone+duration table,
// so the bundle never expresses a raw tone, duration, or asset (tokens-not-values, D4).
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** Play a short cue tone for a closed sound token: 'tick' | 'chime' | 'alarm'. Fire-and-forget
   *  (no return, nothing observable — D7). Unknown tokens fall back to a neutral beep. */
  play(token: string): void;
}

// `get` (not `getEnforcing`): a build without the native module compiled in resolves to null,
// and the host cue backend degrades sound to a silent no-op (haptics still fire) rather than
// throwing at import. Audio is the most polish-y, least load-bearing leg of v0.3.
export default TurboModuleRegistry.get<Spec>('WhimTone');
