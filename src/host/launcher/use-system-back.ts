/**
 * useSystemBack — the hook every launcher screen calls instead of writing its own `BackHandler`
 * listener (design D1/D9; spec launcher-screen-exits "System back and the visible control perform
 * the same action"). Binds once per mount, so it survives the listener re-registering on every
 * render the way nine hand-written `useEffect([onBack])` listeners used to (research.md B
 * "Listener churn") — `handler` is kept in a ref assigned on every render, and `bindSystemBack`
 * always reads through the ref, so system back and the visible control that also reads `handler`
 * from this render can never drift out of step. The once-per-mount / latest-handler mechanics live
 * in `useSystemBackWith` (RN-free); this hook only supplies the real `BackHandler`.
 *
 * The only file under `src/host/launcher/` other than `useMiniAppHost.ts` that may import
 * `BackHandler` (spec launcher-screen-exits "A screen without a declared exit fails the fast
 * gate" — the "seam" rule).
 */
import { BackHandler } from 'react-native';
import { useSystemBackWith } from './use-system-back-with';

/** `handler` is `null` on a screen with no back action of its own (the home grid): system back
 *  then falls through to the platform default, same as a screen that never called this hook. */
export function useSystemBack(handler: (() => void) | null): void {
  useSystemBackWith(BackHandler, handler);
}
