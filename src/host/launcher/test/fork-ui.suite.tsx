/** Forking from Home asks whether the copy shares the original's data, and the answer reaches
 *  `StoreAccess.fork` unchanged. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import LauncherRoot from '../LauncherRoot';
import { StoreAccess } from '../store-access';
import { AppIndex, type InstalledApp } from '../app-index';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { SEED_VERSION } from '../seed';
import { resetNativeStorage } from './native-storage';
import { button, press, renderScreen, unmountScreen } from './react-screen';

const app: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };

export async function runForkUiTests(h: Harness): Promise<void> {
  for (const [answer, shareData] of [[COPY.forkShareData, true], [COPY.forkStartFresh, false]] as const) {
    await h.test(`fork: answering "${answer}" forks with shareData ${shareData}`, async () => {
      resetNativeStorage();
      const index = new AppIndex(createMmkvBackend('whim.launcher'));
      index.markSeeded(SEED_VERSION);
      index.put(app);
      const originalFork = StoreAccess.prototype.fork;
      const calls: unknown[][] = [];
      StoreAccess.prototype.fork = async function (...args: unknown[]) { calls.push(args); return { ...app, id: 'timer-copy' }; } as typeof originalFork;
      const tree = await renderScreen(<LauncherRoot />);
      try {
        await TestRenderer.act(async () => tree.root.find(node => node.type === 'TouchableOpacity' && typeof node.props.onLongPress === 'function').props.onLongPress());
        await press(button(tree, COPY.actionFork));
        h.eq(calls.length, 0, 'choosing Fork asks first; nothing is forked yet');
        await press(button(tree, answer));
        h.eq(calls.length, 1, 'the answer forks once');
        h.eq((calls[0]?.[0] as InstalledApp | undefined)?.id, app.id, 'the long-pressed app is the one forked');
        h.eq(calls[0]?.[1], undefined, 'from its current version');
        h.ok(calls[0]?.[2] != null && (calls[0][2] as { shareData?: unknown }).shareData === shareData, `with shareData ${shareData} (got ${JSON.stringify(calls[0]?.[2])})`);
      } finally {
        await unmountScreen(tree);
        StoreAccess.prototype.fork = originalFork;
      }
    });
  }
}
