/** react-native-gesture-handler 3 for React interaction tests. A gesture hook returns its config;
 *  `GestureDetector` renders a `GestureDetector` host element holding it, so a test finds the
 *  detector and plays a gesture through its callbacks with `pan`. Callbacks run inline, as worklets
 *  would on the UI thread. */
import React from 'react';

/** What a pan reports on each update and when it ends. */
export interface PanPoint { translationX: number; translationY: number; velocityX: number; velocityY: number }
export interface PanConfig {
  activeOffsetY?: number | [number, number];
  failOffsetX?: number | [number, number];
  enabled?: boolean;
  onBegin?: (e: PanPoint) => void;
  onActivate?: (e: PanPoint) => void;
  onUpdate?: (e: PanPoint) => void;
  onDeactivate?: (e: PanPoint & { canceled?: boolean }) => void;
  onFinalize?: (e: PanPoint) => void;
}

export function usePanGesture(config: PanConfig): PanConfig {
  return config;
}

export function GestureDetector({ gesture, children }: { gesture: PanConfig; children?: React.ReactNode }) {
  return React.createElement('GestureDetector', { gesture }, children);
}

export function GestureHandlerRootView({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

/** Plays a vertical drag through `config`: activation, one update per translation, then release at
 *  `velocityY` (pt/s, positive downward). */
export function pan(config: PanConfig, translations: readonly number[], velocityY: number): void {
  const at = (translationY: number, v = 0): PanPoint => ({ translationX: 0, translationY, velocityX: 0, velocityY: v });
  config.onBegin?.(at(0));
  config.onActivate?.(at(translations[0] ?? 0));
  for (const y of translations) config.onUpdate?.(at(y));
  const last = translations.at(-1) ?? 0;
  config.onDeactivate?.(at(last, velocityY));
  config.onFinalize?.(at(last, velocityY));
}
