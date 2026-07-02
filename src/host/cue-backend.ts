// ─────────────────────────────────────────────────────────────────────────────
// cue-backend — the RN host implementation of the bridge `CueBackend` (effects-and-cues D5/D6).
// ─────────────────────────────────────────────────────────────────────────────
// This is the ONE place React Native APIs meet the cue contract. It is imported only host-side
// (`useMiniAppHost` injects it into `createDefaultRegistry`), NEVER by `src/host/bridge/*` — the
// bridge rows bind to the pure `CueBackend` interface so they stay loadable under Node (the
// deterministic suites). The token→pattern (haptics) and token→tone (sound) mappings live here
// (and, for sound, in the Kotlin module): the syscall contract exposes only the closed tokens,
// so this table can be tuned for on-device feel without touching the contract (D4 swappability).
import { Vibration } from 'react-native';
import type { CueBackend, HapticKind, SoundName } from './bridge/contract';
import WhimTone from '../native/NativeWhimTone';

// Haptic token → Android vibration pattern (ms). A single number vibrates that long; an array is
// [initialDelay, on, off, on, …] (RN `Vibration.vibrate`). Closed-set substitution only (D4).
const HAPTIC_PATTERN: Record<HapticKind, number | number[]> = {
  tap: 18, // a single light tick
  double: [0, 22, 90, 22], // two quick taps — the stage-transition cue
  heavy: [0, 70, 50, 120], // a firmer buzz — the "done" cue
};

/**
 * Build the host cue backend. Haptics ride RN core `Vibration` (no new native dep — design D6);
 * sound rides the in-repo `WhimTone` TurboModule (`android.media.ToneGenerator`). Both are
 * fire-and-forget and defensively wrapped: a cue must NEVER crash the host (D7 — cues add zero
 * surface, including no failure surface the bundle can observe). `WhimTone` is resolved
 * non-enforcingly, so a build/platform without the native module degrades to silent sound while
 * haptics keep working — rather than throwing at import.
 */
export function createCueBackend(): CueBackend {
  return {
    haptic(kind: HapticKind): void {
      try {
        Vibration.vibrate(HAPTIC_PATTERN[kind] ?? HAPTIC_PATTERN.tap);
      } catch {
        /* fire-and-forget: a missing/disabled vibrator is not the bundle's concern */
      }
    },
    sound(name: SoundName): void {
      try {
        // The Kotlin module owns the token→tone+duration table (host-side, D6); we pass the
        // closed token straight through. Null when the native module isn't present (e.g. a
        // codegen-less dev build) → sound is a no-op, haptics still fire.
        WhimTone?.play(name);
      } catch {
        /* fire-and-forget */
      }
    },
  };
}
