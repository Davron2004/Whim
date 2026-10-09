/**
 * launch-screen (design-system-v1 chain-9, D12): `hideLaunchScreen()` ends the native cold-start
 * hold once, and a build without the module or a module that throws never reaches Home.
 */
import { Harness } from './harness';
import { createLaunchScreen, hideLaunchScreen } from '../../launch-screen';
import type { Spec } from '../../../native/NativeWhimLaunchScreen';

/** A module that records each `hide` it receives. */
function recordingModule(): { native: Spec; hides: () => number } {
  let count = 0;
  const native = {
    hide: () => {
      count++;
    },
  } as unknown as Spec;
  return { native, hides: () => count };
}

export async function runLaunchScreenTests(h: Harness): Promise<void> {
  await h.test('launch screen: the first hide reaches the native module, later ones do not', () => {
    const { native, hides } = recordingModule();
    const screen = createLaunchScreen(native);
    screen.hide();
    h.eq(hides(), 1, 'Home’s first frame ends the hold');
    screen.hide();
    screen.hide();
    h.eq(hides(), 1, 'a re-render of Home does not call the module again');
  });

  await h.test('launch screen: a build without the module, or a module that throws, never reaches the caller', () => {
    let thrown: unknown = null;
    try {
      createLaunchScreen(null).hide();
      const failing = { hide: () => { throw new Error('no activity'); } } as unknown as Spec;
      createLaunchScreen(failing).hide();
      hideLaunchScreen(); // the test host registers no WhimLaunchScreen module
    } catch (e) {
      thrown = e;
    }
    h.eq(thrown, null, 'hiding never throws into Home’s first frame');
  });
}
