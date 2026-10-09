/**
 * tokens — the shell's one scheme hook (design-system-v1 D2; decision #75 amends #62). Launcher
 * components read colours only through `useTokens()`, which follows the phone: appearance from
 * `useColorScheme`, Increase Contrast and Reduce Motion from `AccessibilityInfo`, text size from
 * `useWindowDimensions().fontScale`. No provider, no palette or theme prop: a change of any of
 * them re-renders every subscriber with the new tokens, without a restart.
 *
 * Styles are built per combination with `makeStyles((t) => …)` (memoised; see tokens-pure.ts).
 */

import { useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform, useColorScheme, useWindowDimensions } from 'react-native';
import { log } from '../logging';
import { CHANNELS } from '../logging/channels';
import { resolveTokens, type ShellTokens } from './tokens-pure';

export { makeStyles } from './tokens-pure';
export type { ShellTokens } from './tokens-pure';

interface AccessibilityFlags {
  readonly reduceMotion: boolean;
  readonly increaseContrast: boolean;
}

/** The OS accessibility flags, shared by every `useTokens` caller: one set of native listeners
 *  while anything is subscribed, released when the last subscriber goes. */
function createAccessibilityStore() {
  let flags: AccessibilityFlags = { reduceMotion: false, increaseContrast: false };
  const listeners = new Set<() => void>();
  let detach: (() => void) | null = null;

  const set = (patch: Partial<AccessibilityFlags>) => {
    const next = { ...flags, ...patch };
    if (next.reduceMotion === flags.reduceMotion && next.increaseContrast === flags.increaseContrast) return;
    flags = next;
    for (const listener of listeners) listener();
  };
  const failed = (flag: string) => (e: unknown) => {
    log.debug(CHANNELS.screen, 'accessibility setting unreadable', { flag, detail: e instanceof Error ? e.message : String(e) });
  };

  const attach = () => {
    // Increase Contrast is "Darker system colours" on iOS and "High contrast text" on Android.
    const ios = Platform.OS === 'ios';
    const contrastEvent = ios ? 'darkerSystemColorsChanged' : 'highTextContrastChanged';
    const readContrast = ios ? AccessibilityInfo.isDarkerSystemColorsEnabled : AccessibilityInfo.isHighTextContrastEnabled;
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', (on: boolean) => set({ reduceMotion: on }));
    const contrast = AccessibilityInfo.addEventListener(contrastEvent, (on: boolean) => set({ increaseContrast: on }));
    AccessibilityInfo.isReduceMotionEnabled().then((on) => set({ reduceMotion: on }), failed('reduceMotion'));
    readContrast().then((on) => set({ increaseContrast: on }), failed('increaseContrast'));
    return () => {
      motion.remove();
      contrast.remove();
    };
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      detach ??= attach();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && detach) {
          detach();
          detach = null;
        }
      };
    },
    snapshot: (): AccessibilityFlags => flags,
  };
}

const accessibility = createAccessibilityStore();

/** The tokens for the phone's current appearance and accessibility settings. */
export function useTokens(): ShellTokens {
  const scheme = useColorScheme();
  const { fontScale } = useWindowDimensions();
  const { reduceMotion, increaseContrast } = useSyncExternalStore(accessibility.subscribe, accessibility.snapshot);
  return resolveTokens({ scheme, fontScale, reduceMotion, increaseContrast, platform: Platform.OS });
}
