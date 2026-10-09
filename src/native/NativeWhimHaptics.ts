// ─────────────────────────────────────────────────────────────────────────────
// NativeWhimHaptics — codegen spec for the in-repo haptics TurboModule (design-system-v1 D11;
// docs/design/system.md §5).
// ─────────────────────────────────────────────────────────────────────────────
// The WhimTone pattern: one fire-and-forget module per platform over the system haptic engine.
// iOS plays the UIFeedbackGenerator family; Android plays `View.performHapticFeedback` on the
// activity's root view (which follows the system touch-feedback setting) and, for app cues,
// `VibrationEffect.createPredefined`. Each shell call carries both platforms' token, so the
// moment map stays one pure JS table (`src/host/haptics.ts`): iOS reads the generator arguments
// and ignores `android`, Android reads `android` (a `HapticFeedbackConstants` name, falling back
// per constant below its API level) and ignores the rest. No method returns anything or throws
// back to JS.
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  /** iOS: `UIImpactFeedbackGenerator` of `style` ('light' | 'medium' | 'heavy' | 'rigid' | 'soft')
   *  at `intensity` (0–1). Android: performs the `android` feedback constant. */
  impact(style: string, intensity: number, android: string): void;
  /** iOS: `UISelectionFeedbackGenerator`. Android: performs the `android` feedback constant. */
  selection(android: string): void;
  /** iOS: `UINotificationFeedbackGenerator` of `kind` ('success' | 'warning' | 'error').
   *  Android: performs the `android` feedback constant. */
  notification(kind: string, android: string): void;
  /** iOS: prepares the generator a coming moment will use, on touch-down ('selection',
   *  'notification', or an impact style). Android: nothing to prepare. */
  prepare(kind: string): void;
  /** An app cue's closed token ('tap' | 'double' | 'heavy'), mapped by each platform:
   *  iOS light impact / two light impacts 80 ms apart / heavy impact; Android
   *  `EFFECT_CLICK` / `EFFECT_DOUBLE_CLICK` / `EFFECT_HEAVY_CLICK`. Unknown tokens play as 'tap'. */
  cue(kind: string): void;
}

// `get` (not `getEnforcing`): a build without the module resolves to null and every haptic
// becomes a silent no-op instead of throwing at import.
export default TurboModuleRegistry.get<Spec>('WhimHaptics');
