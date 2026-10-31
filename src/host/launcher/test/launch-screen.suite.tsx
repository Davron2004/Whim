/**
 * launch-screen (design-system-v1 chain-9, D12): `hideLaunchScreen()` ends the native cold-start
 * hold once, and a build without the module or a module that throws never reaches Home. The shell
 * calls it once, on the frame after its first real screen commits, whichever screen that is.
 */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import LauncherRoot from '../LauncherRoot';
import HomeScreen from '../HomeScreen';
import AppLinkMissingScreen from '../AppLinkMissingScreen';
import FailureScreen from '../FailureScreen';
import { AppIndex } from '../app-index';
import { appLinkFor } from '../app-link';
import { PendingBuildStore } from '../pending-builds';
import { StoreAccess } from '../store-access';
import { SEED_VERSION } from '../seed';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { resetNativeStorage } from './native-storage';
import { Linking } from './native-host';
import { button, press, renderScreen, unmountScreen } from './react-screen';
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

type Tree = TestRenderer.ReactTestRenderer;

/** Renders the shell with a recording `hideLaunchScreen` and frames that run only when `frame()`
 *  steps them, so a test can tell "after the first screen commits" from "on the next frame". Each
 *  recorded call names the screens mounted at that moment. */
async function coldStart(body: (s: { tree: Tree; hides: string[][]; frame: () => Promise<void> }) => Promise<void>): Promise<void> {
  const platform = { request: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame };
  const frames = new Map<number, Parameters<typeof requestAnimationFrame>[0]>();
  let nextFrame = 0;
  globalThis.requestAnimationFrame = (callback) => { frames.set(++nextFrame, callback); return nextFrame; };
  globalThis.cancelAnimationFrame = (id) => { if (typeof id === 'number') frames.delete(id); };
  const hides: string[][] = [];
  let tree: Tree | null = null;
  const mounted = (): string[] => {
    const root = tree?.root;
    if (!root) return ['nothing'];
    return ([['home', HomeScreen], ['link-missing', AppLinkMissingScreen], ['failure', FailureScreen]] as const)
      .filter(([, type]) => root.findAllByType(type).length > 0)
      .map(([name]) => name);
  };
  const frame = async () => {
    const due = [...frames.values()];
    frames.clear();
    await TestRenderer.act(async () => { for (const callback of due) callback(0); });
  };
  try {
    tree = await renderScreen(<LauncherRoot deviceLocale={() => 'en-US'} hideLaunchScreen={() => hides.push(mounted())} />);
    try {
      await body({ tree, hides, frame });
    } finally { await unmountScreen(tree); }
  } finally {
    globalThis.requestAnimationFrame = platform.request;
    globalThis.cancelAnimationFrame = platform.cancel;
  }
}

export async function runLaunchScreenTests(h: Harness): Promise<void> {
  await h.test('launch screen: a first run holds over the skeleton and ends once, on the frame after Home commits', async () => {
    resetNativeStorage();
    // First-run seeding held open, so the skeleton stays up until the test releases it.
    const install = StoreAccess.prototype.install;
    let seeded!: () => void;
    const seeding = new Promise<void>((resolve) => { seeded = resolve; });
    StoreAccess.prototype.install = async (spec) => {
      await seeding;
      return { id: spec.id, name: spec.name, createdAt: 0, lineageId: 'main', record: spec.record };
    };
    try {
      await coldStart(async ({ tree, hides, frame }) => {
        await frame();
        h.eq(tree.root.findAllByType(HomeScreen).length, 0, 'the skeleton is up while first run seeds');
        h.eq(hides.length, 0, 'the skeleton stays under the launch screen');
        await TestRenderer.act(async () => { seeded(); });
        h.eq(tree.root.findAllByType(HomeScreen).length, 1, 'Home is the first real screen');
        h.eq(hides.length, 0, 'the hold outlasts the commit until the next frame');
        await frame();
        h.eq(hides, [['home']], 'the next frame ends the hold, with Home on screen');
        await press(button(tree, COPY.settingsTitle));
        await frame();
        h.eq(hides.length, 1, 'navigating later never ends the hold again');
      });
    } finally {
      seeded();
      StoreAccess.prototype.install = install;
    }
  });

  for (const landing of ['link-missing', 'failure'] as const) {
    await h.test(`launch screen: a cold start that lands on ${landing} ends the hold once, with that screen up`, async () => {
      resetNativeStorage();
      const kv = createMmkvBackend('whim.launcher');
      new AppIndex(kv).markSeeded(SEED_VERSION);
      const pending = new PendingBuildStore(kv);
      pending.create({ id: 'failed', prompt: 'Timer', workingTitle: 'Timer' });
      pending.setFailed('failed', { reason: 'Server stopped', diagnostics: '' });
      Linking.initialURL = appLinkFor(landing === 'failure' ? 'failed' : 'missing');
      try {
        await coldStart(async ({ hides, frame }) => {
          await frame();
          await frame();
          h.eq(hides, [landing === 'failure' ? ['home', 'failure'] : [landing]], `the hold ends once, over the ${landing} page${landing === 'failure' ? ', a sheet that covers Home' : ' and never over Home'}`);
        });
      } finally { Linking.initialURL = null; }
    });
  }

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
