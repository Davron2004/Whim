/**
 * launch-screen — ends the cold-start hold of the native launch screen (design-system-v1 D12;
 * specs/app-icon-and-launch "Launch shows the ember on the scheme's canvas with no flash";
 * docs/design/system.md §4.4 M27). The launcher shell calls `hideLaunchScreen()` on the frame after its
 * first real screen commits (task 15.2; `LauncherRoot.tsx`); the native
 * side then fades the ember out over 160 ms. Calling it again, or on a warm start, does nothing.
 */
import WhimLaunchScreen, { type Spec } from '../native/NativeWhimLaunchScreen';
import { log } from './logging';
import { CHANNELS } from './logging/channels';

export interface LaunchScreen {
  /** Ends the hold. Never throws; a missing native module leaves the native cap to end it. */
  hide(): void;
}

/** The launch screen over a native module; a null module (a build without `WhimLaunchScreen`)
 *  makes `hide` a no-op, and a throwing one is logged and swallowed. */
export function createLaunchScreen(native: Spec | null): LaunchScreen {
  let hidden = false;
  return {
    hide() {
      if (hidden || !native) return;
      hidden = true;
      try {
        native.hide();
      } catch (e) {
        log.debug(CHANNELS.screen, 'hiding the launch screen failed', { detail: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}

const launchScreen = createLaunchScreen(WhimLaunchScreen);

/** Ends the native launch screen's cold-start hold. The launcher shell calls it once its first screen is up. */
export function hideLaunchScreen(): void {
  launchScreen.hide();
}
