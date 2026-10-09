# Contract: shell-ui (chain-10)

Interface only. Values come from `src/design/tokens.ts` (handoff/design-tokens.md); rules from system.md §2, §4, §6, §7.1.

## Scheme hook — `src/host/ui/tokens.ts` (RN) over `src/host/ui/tokens-pure.ts` (no RN; Node-importable)

```ts
export function useTokens(): ShellTokens;   // the ONLY way shell components read colours
export { makeStyles } from './tokens-pure';  // also exported from tokens-pure
export interface ShellTokens {
  readonly key: string;                      // identity of the settings combination; equal key = same frozen object
  readonly scheme: Scheme;                   // useColorScheme(); null/unspecified → 'light'
  readonly colors: Readonly<Record<ColorRole, string>>;  // COLORS[scheme]; Increase Contrast: 'text-2' = text
  readonly shadows: { readonly raised: string; readonly floating: string; readonly glow: string }; // RN boxShadow strings
  readonly topHighlight: string;             // 'transparent' light / rgba dark
  readonly increaseContrast: boolean;        // iOS darkerSystemColors, Android highTextContrast (live)
  readonly reduceMotion: boolean;            // AccessibilityInfo reduceMotion (live)
  readonly fontScale: number;                // useWindowDimensions().fontScale
  readonly largeText: boolean;               // fontScale >= LARGE_TEXT_FROM (1.35)
  readonly platform: 'ios' | 'android';
  readonly touchTarget: number;              // LAYOUT.touchTarget[platform]: 44 / 48
  readonly barStyle: 'dark-content' | 'light-content';  // StatusBar content for bg
}
export function makeStyles<T>(factory: (t: ShellTokens) => T): (t: ShellTokens) => T;  // memoised per t.key
export function resolveTokens(env: ShellEnvironment): ShellTokens;  // pure; what useTokens calls
```

Usage: `const styles = makeStyles((t) => ({ … }));` at module scope, then `const t = useTokens(); const s = styles(t);`.
One shared set of OS listeners (ref-counted, released with the last subscriber); a change of any setting
re-renders subscribers, no restart, no provider, no palette/theme prop. The first render after a cold attach
uses the last-known flags (default false) until the async `is…Enabled` queries resolve.

Pure helpers (`tokens-pure.ts`): `typeStyle(token: TypeToken, header?: boolean): { fontSize; lineHeight;
fontWeight: '400'|'500'|'600'|'700'; letterSpacing /* pt = em × size */ }`, `TABULAR` (`fontVariant`),
`MAX_FONT_SCALE = 2`, `springConfig(name: SpringName): { mass: 1; stiffness; damping }` (Reanimated physics
mode; Reanimated 4's own default mass is 4 — always pass this), `timingOf(name: 'fadeIn'|'fadeOut'|'color')`,
`bezierOf(css)`, `PRESS_SCALE { button .97, chip .96, icon .92 }`, `REDUCED_PRESS { opacity .7, duration 100 }`,
`PRESS_RETENTION = 10`, `hitSlopFor(visual, t): number`, `darken(hex, amount)`, `tintColors(t, tint): { fill; on }`,
`buttonColors`, `buttonMetrics`, `chipColors`, `noticeLook`, `CHIP`, `ICON_BUTTON`, `SKELETON`, `emberLook`,
`emberSize`, `HONEST_LIGHT`, `ACTIVITY_SMOOTHING`, `ambientOpacity`, `AMBIENT_STOPS`, `SPARK_PEAK`.

## Motion — `src/host/ui/motion.ts` (Reanimated)

```ts
export function timing(name: TimingName, reduced?: boolean): { duration; easing; reduceMotion?: ReduceMotion.Never };
export function usePressFeedback(kind: PressKind, t: Pick<ShellTokens, 'reduceMotion'>):
  { style /* animated: scale + opacity */; pressIn(): void; pressOut(): void };
```
M1: press-in `withSpring(PRESS_SCALE[kind], springConfig('instant'))`, release `snappy`; Reduce Motion →
opacity 0.7 over 100 ms. Every reduced-form replacement passes `reduceMotion: ReduceMotion.Never`, else App's
`<ReducedMotionConfig mode={System}>` skips the very fade that replaces the motion.

## Primitives — `src/host/ui/*.tsx` (props verbatim)

```ts
// Text.tsx — maxFontSizeMultiplier 2; role 'header' for largeTitle/title1/title2, else 'text'
export interface TextProps { children: React.ReactNode; type?: TypeToken /* body */; color?: ColorRole /* text */;
  header?: boolean; tabular?: boolean; italic?: boolean; numberOfLines?: number;
  accessibilityRole?: AccessibilityRole; style?: StyleProp<TextStyle> /* layout only */ }
// Button.tsx — role button, label = busy ?? label, state { disabled, busy }
export interface ButtonProps { label: string; onPress: () => void; variant: ButtonVariant; size?: ButtonSize /* large */;
  icon?: IconName; tint?: TintName /* for 'tint'; default slate */; disabled?: boolean;
  busy?: string /* busy words; taps ignored */; haptic?: HapticMoment /* prepare on press-in, play on press */;
  accessibilityHint?: string }
type ButtonVariant = 'ember'|'ink'|'tint'|'secondary'|'plain'|'plain-ember'|'danger'; type ButtonSize = 'large'|'medium'|'small';
// IconButton.tsx — 44 × 44, press .92, hitSlop to 48 on Android
export interface IconButtonProps { icon: IconName; label: string; onPress: () => void;
  variant?: 'plain'|'filled' /* plain */; iconSize?: 20|24 /* 20; 24 in headers */; disabled?: boolean }
export interface BackButtonProps { onPress: () => void; label?: string /* COPY.backLabel */ }  // iOS chevron-left, Android arrow-left
// Chip.tsx — 36 high, hitSlop to target; role radio | checkbox (multiple) with { checked }, suggestion = button
export interface ChipProps { label: string; onPress: () => void; kind?: ChipKind /* choice */; selected?: boolean;
  multiple?: boolean; disabled?: boolean }
type ChipKind = 'choice'|'decide'|'suggestion';   // selection haptic on choice/decide press, none on suggestion
// Notice.tsx — one accessible element, role 'alert' (danger) | 'text', liveRegion polite
export interface NoticeProps { message: string; tone?: 'neutral'|'danger'; countdown?: string /* worded; tabular */ }
// Skeleton.tsx — group is one progressbar { busy: true } named by label; opacity 0 → after 300 ms breathes
export interface SkeletonProps { label: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }
export interface SkeletonBlockProps { width: DimensionValue; height: number; radius?: number /* 0 */ } // fill-strong, hidden
// Ember.tsx — both hidden from screen readers
export interface EmberProps { size: EmberSize /* 20|24|48|96|128; 128 → 64 when largeText */; state: EmberState;
  activity?: number /* 0–1, default 0 */; spark?: number /* change the value to flare once */ }
type EmberState = 'working'|'stuck'|'out';
export interface AmbientLightProps { width: number; height: number; activity: number }  // pointerEvents none
```

Look per §7.1: filled variants darken 8% pressed; disabled = `fill` + `text-3` (plain variants: no fill,
`text-3`); 2 pt `text` focus ring 2 pt outside on keyboard focus. Chip fill fades over `color` (kept under
Reduce Motion), repaints at once on a scheme change. Ember: working intensity `0.55 + 0.45·a` on the
critically damped 0.6 s spring; stuck 0.35 over 1.5 s on a `fill-strong` silhouette; out = 1.5 pt `text-2`
outline; flare `withSequence` 1.18 → 1 on `spark`; Reduce Motion = still intensity per state, cross-faded.

## Not provided here (caller's or a later chain's job)

- Ember flicker (§4.6 `0.06·ã`, token-arrival timed) — needs per-token events, not the `activity` prop.
- Stacking paired buttons from 135% — read `t.largeText` in the screen's action area.
- Switching existing screens: none moved in this chain; `SHELL_PALETTE` (`launcher/theme.ts`) stays for them.

## Platform: dark mode on Android (chain-9)

`MainApplication.kt` pins `AppCompatDelegate.MODE_NIGHT_NO` (so edge-to-edge nav-bar icons stay dark on the
light-only shell). While it stands, `useColorScheme()` reports `'light'` on Android and the shell never goes
dark there. chain-9 must drop the pin when the shell follows the scheme; RN then sets nav-bar icon colour
from the night mode, which equals `t.scheme`. Status bar: `<StatusBar barStyle={t.barStyle} />` (chain-14).

## Tests (launcher suite, `npm run launcher:test`)

`shell-tokens.suite.tsx`, `shell-controls-ui.suite.tsx`, `shell-status-ui.suite.tsx`. `run.mjs` aliases
`react-native-reanimated` → `test/native-reanimated.tsx`: assignments to a shared value log to `animations`
(`Step` = spring/timing with `to`/`config`; delay/sequence/repeat wrap) and jump to the end value;
`useAnimatedStyle` repaints on change; `cancelled.count`. `native-host.tsx` adds `setColorScheme(s)` (call
inside act), `accessibilitySettings`, `emitAccessibility(event, on)`, `accessibilityListenerCount()`,
`windowMetrics.fontScale`, `StyleSheet.absoluteFill`; `native-svg.tsx` adds `Circle Rect Defs RadialGradient Stop`.
