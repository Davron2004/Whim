# Contract: haptics (chain-8)

## Shell moments (`src/host/haptics.ts`)

```ts
export type HapticMoment =
  | 'selection'  // answer chip, segment, picker detent moves
  | 'toggle-on' | 'toggle-off'  // a switch toggles
  | 'long-press' // a long-press opens a menu
  | 'commit'     // a drag crosses its commit point
  | 'handoff'    // work handed to Whim: Make it, Make the change, Try again
  | 'success'    // app ready, version restored, copy made
  | 'failure'    // making failed
  | 'warning';   // app deleted, attempt discarded, confirm sheet's consequential choice

export interface Haptics {
  play(moment: HapticMoment): void;    // on the frame of the visual change
  prepare(moment: HapticMoment): void; // on touch-down (iOS warms the generator; Android no-op)
}
export const haptics: Haptics;                                  // over the installed WhimHaptics
export function createHaptics(native: Spec | null): Haptics;    // null module = every call a no-op
export const SHELL_HAPTICS: Readonly<Record<HapticMoment, { ios: …; android: … }>>;
```

- Never call it on plain taps, navigation, scrolling, typing, opening an app or a tapped sheet
  (app-launcher "The shell plays haptics from a fixed map").
- Never throws: a missing module is silent, a throwing one is logged (`whim:screen`, debug) and swallowed.
- Map (iOS / Android, fallback below the constant's API level, applied natively per constant):

| Moment | iOS | Android |
|---|---|---|
| selection | selection | `SEGMENT_TICK` → `CLOCK_TICK` |
| toggle-on / toggle-off | impact light | `TOGGLE_ON` / `TOGGLE_OFF` → `CONTEXT_CLICK` |
| long-press | impact medium | `LONG_PRESS` |
| commit | impact rigid 0.6 | `GESTURE_THRESHOLD_ACTIVATE` → `CONTEXT_CLICK` |
| handoff | impact medium | `CONFIRM` → `VIRTUAL_KEY` |
| success | notification success | `CONFIRM` → `VIRTUAL_KEY` |
| failure | notification error | `REJECT` → `LONG_PRESS` |
| warning | notification warning | `REJECT` → `LONG_PRESS` |

## Native module (`src/native/NativeWhimHaptics.ts`, TurboModule `WhimHaptics`)

```ts
export interface Spec extends TurboModule {
  impact(style: string, intensity: number, android: string): void; // 'light'|'medium'|'heavy'|'rigid'|'soft', 0–1
  selection(android: string): void;
  notification(kind: string, android: string): void;              // 'success'|'warning'|'error'
  prepare(kind: string): void;                                     // 'selection'|'notification'|an impact style
  cue(kind: string): void;                                         // 'tap'|'double'|'heavy'; unknown → 'tap'
}
export default TurboModuleRegistry.get<Spec>('WhimHaptics'); // null on a build without it
```

- Each call carries both platforms' token: iOS reads the generator args, Android reads `android` (a
  `HapticFeedbackConstants` name) and ignores the rest. Shell code calls `haptics`, never the module.
- iOS: `ios/Whim/WhimHapticsModule.mm`, registered via `codegenConfig.ios.modulesProvider`; all methods on
  the main queue; one generator per impact style kept, so a prepared generator is the one that plays.
- Android: `com.whim.haptics.WhimHapticsModule`/`WhimHapticsPackage` (spec class generated into
  `com.whim.tone`), added in `MainApplication.kt` after `WhimTonePackage()`. Shell moments:
  `performHapticFeedback` on the current activity's decor view (UI thread; follows the touch-feedback
  setting). Cues: `VibrationEffect.createPredefined(EFFECT_CLICK | EFFECT_DOUBLE_CLICK | EFFECT_HEAVY_CLICK)`
  as `USAGE_TOUCH` (API 33+) or after reading `HAPTIC_FEEDBACK_ENABLED` (29–32); below 29, view feedback.
  `VIBRATE` permission stays for cues.
- iOS cues: `tap` light impact, `double` two light impacts 80 ms apart, `heavy` heavy impact.

## App cues (`src/host/cue-backend.ts`)

```ts
export const HAPTIC_CUES_PER_SECOND = 10;
export const HAPTIC_CUE_BURST = 3;
export function createCueBackend(opts?: { haptics?: Spec | null; now?: () => number }): CueBackend;
```

- `CueBackend.haptic(kind: HapticKind, realm: RealmRecord)` (bridge `contract.ts`): the `cues.haptic` row
  passes the calling realm; it is the rate-cap key only. No registry row, syscall or manifest change.
- Per-realm token bucket (WeakMap on the `RealmRecord`): starts at 3, refills 10/s, max 3; an empty bucket
  drops the cue. Dropped cues still resolve `{}`. The cap runs in the handler, after the dispatcher's
  at-most-once dedupe, so a retried request id never spends a second token.
- RN `Vibration` is no longer imported anywhere in `src/`; the launcher test host no longer exports it.

## Tests

- `src/host/launcher/test/haptics.suite.ts` (registered in launcher `acceptance.ts`): the map against the
  system.md §5 table (parsed), prepare tokens, null/throwing module, cue tokens, burst of 20 → 3, 10/s
  sustained, per-realm caps, dedupe-before-cap, missing module.
- The launcher test host's `TurboModuleRegistry.get('WhimHaptics')` returns a recorder; read its calls
  from `hapticCalls` (`"<method>:<args joined by ,>"`, exported by `native-host.tsx`; splice to reset).
  Every other module name still resolves to null.
- Bridge §G8: the haptic row hands the backend the calling realm.
