// ─────────────────────────────────────────────────────────────────────────────
// haptics — the shell's fixed moment map (docs/design/system.md §5; design-system-v1 D11).
// ─────────────────────────────────────────────────────────────────────────────
// The shell plays haptics only for the moments named here, through the `WhimHaptics` module,
// on the frame of the visual change; never on plain taps, navigation, scrolling, typing, opening
// an app or a tapped sheet. Each row carries both platforms' engine call, so one call reaches the
// native module and each platform reads its own half (see `src/native/NativeWhimHaptics.ts`).
// Android's API-34 constants fall back per constant inside the native module: SEGMENT_TICK →
// CLOCK_TICK, TOGGLE_ON/TOGGLE_OFF and GESTURE_THRESHOLD_ACTIVATE → CONTEXT_CLICK, CONFIRM →
// VIRTUAL_KEY, REJECT → LONG_PRESS. App cues do not come through here: they are
// `cues.haptic`, played by `cue-backend.ts`.
import WhimHaptics, { type Spec } from '../native/NativeWhimHaptics';
import { log } from './logging';
import { CHANNELS } from './logging/channels';

/** Every moment the shell may play a haptic for (system.md §5, one name per table row; switch
 *  toggles split on and off). */
export type HapticMoment =
  | 'selection' // an answer chip, segment or picker detent moves
  | 'toggle-on' // a switch turns on
  | 'toggle-off' // a switch turns off
  | 'long-press' // a long-press opens a menu
  | 'commit' // a drag crosses its commit point
  | 'handoff' // work handed to Whim: Make it, Make the change, Try again
  | 'success' // app ready, version restored, copy made
  | 'failure' // making failed
  | 'warning'; // app deleted, attempt discarded, a confirm sheet's consequential choice

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';

/** The iOS engine call: a UIFeedbackGenerator family member and its arguments. */
type IosHaptic =
  | { kind: 'selection' }
  | { kind: 'impact'; style: ImpactStyle; intensity: number }
  | { kind: 'notification'; type: 'success' | 'warning' | 'error' };

/** The Android `HapticFeedbackConstants` name the native module performs on the root view. */
type AndroidFeedback =
  | 'SEGMENT_TICK'
  | 'TOGGLE_ON'
  | 'TOGGLE_OFF'
  | 'LONG_PRESS'
  | 'GESTURE_THRESHOLD_ACTIVATE'
  | 'CONFIRM'
  | 'REJECT';

interface MomentHaptic {
  ios: IosHaptic;
  android: AndroidFeedback;
}

const LIGHT: IosHaptic = { kind: 'impact', style: 'light', intensity: 1 };
const MEDIUM: IosHaptic = { kind: 'impact', style: 'medium', intensity: 1 };

/** The moment map of system.md §5. */
export const SHELL_HAPTICS: Readonly<Record<HapticMoment, MomentHaptic>> = {
  selection: { ios: { kind: 'selection' }, android: 'SEGMENT_TICK' },
  'toggle-on': { ios: LIGHT, android: 'TOGGLE_ON' },
  'toggle-off': { ios: LIGHT, android: 'TOGGLE_OFF' },
  'long-press': { ios: MEDIUM, android: 'LONG_PRESS' },
  commit: { ios: { kind: 'impact', style: 'rigid', intensity: 0.6 }, android: 'GESTURE_THRESHOLD_ACTIVATE' },
  handoff: { ios: MEDIUM, android: 'CONFIRM' },
  success: { ios: { kind: 'notification', type: 'success' }, android: 'CONFIRM' },
  failure: { ios: { kind: 'notification', type: 'error' }, android: 'REJECT' },
  warning: { ios: { kind: 'notification', type: 'warning' }, android: 'REJECT' },
};

export interface Haptics {
  /** Play a moment's haptic now, on the frame its visual change lands. */
  play(moment: HapticMoment): void;
  /** Warm the generator a moment will use; call on touch-down so `play` lands without latency. */
  prepare(moment: HapticMoment): void;
}

/** The generator `prepare` warms for an iOS call. */
function generatorOf(ios: IosHaptic): string {
  if (ios.kind === 'impact') return ios.style;
  return ios.kind;
}

/** The moment map over a native module. A null module (a build without `WhimHaptics`) makes
 *  every call a no-op; a throwing module never reaches the caller. */
export function createHaptics(native: Spec | null): Haptics {
  const run = (moment: HapticMoment, call: (module: Spec, row: MomentHaptic) => void): void => {
    if (!native) return;
    try {
      call(native, SHELL_HAPTICS[moment]);
    } catch (e) {
      log.debug(CHANNELS.screen, 'haptic failed', {
        moment,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  };
  return {
    play(moment) {
      run(moment, (module, { ios, android }) => {
        if (ios.kind === 'selection') module.selection(android);
        else if (ios.kind === 'impact') module.impact(ios.style, ios.intensity, android);
        else module.notification(ios.type, android);
      });
    },
    prepare(moment) {
      run(moment, (module, { ios }) => module.prepare(generatorOf(ios)));
    },
  };
}

/** The shell's haptics, over the installed `WhimHaptics` module. */
export const haptics: Haptics = createHaptics(WhimHaptics);
