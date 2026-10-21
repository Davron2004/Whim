/**
 * useSystemBackWith — the React-Native-free half of `useSystemBack` (design D9): binds exactly
 * once per mount and always resolves to the LATEST `handler`, no matter how many times a
 * re-render passes a new one. Split out of `use-system-back.ts` so this once-per-mount /
 * latest-handler contract is testable directly with `react-test-renderer`, without pulling
 * `react-native`'s `BackHandler` into the launcher's Node acceptance suite (`use-system-back.ts`
 * imports `react-native` and cannot itself be imported there).
 *
 * No React Native import — this module must load under the Node acceptance suite.
 *
 * `api` is read once at mount by contract: `BackHandler` is a singleton, so a caller passing a
 * fresh api object on every render is ignored on purpose — only `handler` is live-tracked.
 */
import { createContext, useContext, useEffect, useRef } from 'react';
import { bindSystemBack } from './system-back';
import type { BackHandlerLike } from './system-back';

/**
 * Whether the screen around a hook is the one system back acts on: false on a stack screen with
 * another pushed over it (`NativeStack`). RN asks its back listeners newest first, so a screen under
 * the top one that mounted again (Settings is keyed by the text size) would otherwise answer before
 * the top screen and leave from where the person is not (#218). Outside a stack, true.
 */
export const SystemBackOnTop = createContext(true);

export function useSystemBackWith(api: BackHandlerLike, handler: (() => void) | null): void {
  const onTop = useContext(SystemBackOnTop);
  const ref = useRef(handler);
  ref.current = onTop ? handler : null;

  useEffect(() => {
    return bindSystemBack(api, () => ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
