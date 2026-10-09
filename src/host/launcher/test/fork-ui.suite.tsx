/** Forking from Home asks first, and the answer reaches `StoreAccess.fork` as its data option;
 *  and a launch settles any data copy a closed process left unfinished. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import LauncherRoot from '../LauncherRoot';
import { StoreAccess } from '../store-access';
import { AppIndex, type InstalledApp } from '../app-index';
import { createMmkvBackend } from '../../version-store/fs/mmkv-backend';
import { SEED_VERSION } from '../seed';
import { DataCopyJournal } from '../data-copy-journal';
import { open as openNativeDb, resetNativeStorage } from './native-storage';
import { button, press, renderScreen, unmountScreen, hostType } from './react-screen';

const app: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };

export async function runForkUiTests(h: Harness): Promise<void> {
  await h.test('fork: answering "Start fresh" forks with data fresh', async () => {
    resetNativeStorage();
    const index = new AppIndex(createMmkvBackend('whim.launcher'));
    index.markSeeded(SEED_VERSION);
    index.put(app);
    const originalFork = StoreAccess.prototype.fork;
    const calls: unknown[][] = [];
    StoreAccess.prototype.fork = async function (...args: unknown[]) { calls.push(args); return { ...app, id: 'timer-copy' }; } as typeof originalFork;
    const tree = await renderScreen(<LauncherRoot deviceLocale={() => 'en-US'} />);
    try {
      await TestRenderer.act(async () => tree.root.find(node => hostType(node) === 'TouchableOpacity' && typeof node.props.onLongPress === 'function').props.onLongPress());
      await press(button(tree, COPY.actionFork));
      h.eq(calls.length, 0, 'choosing Fork asks first; nothing is forked yet');
      await press(button(tree, COPY.forkStartFresh));
      h.eq(calls.length, 1, 'the answer forks once');
      h.eq((calls[0]?.[0] as InstalledApp | undefined)?.id, app.id, 'the long-pressed app is the one forked');
      h.eq(calls[0]?.[1], undefined, 'from its current version');
      h.eq(calls[0]?.[2], { data: 'fresh' }, 'with data fresh and nothing else');
    } finally {
      await unmountScreen(tree);
      StoreAccess.prototype.fork = originalFork;
    }
  });

  await h.test('launch: a data copy a closed process left unfinished is deleted before the grid is ready', async () => {
    resetNativeStorage();
    const kv = createMmkvBackend('whim.launcher');
    const index = new AppIndex(kv);
    index.markSeeded(SEED_VERSION);
    index.put(app);
    // What the closed process left: its record, and a half-written store with no entry.
    new DataCopyJournal(kv).put({ copyAppId: 'timer__fork-1', sourceAppId: 'timer', startedAt: 1 });
    openNativeDb({ name: 'timer__fork-1.db' }).executeSync('CREATE TABLE half (x)');
    const tables = () => openNativeDb({ name: 'timer__fork-1.db' }).executeSync("SELECT name FROM sqlite_master WHERE type = 'table'").rows;
    const tree = await renderScreen(<LauncherRoot deviceLocale={() => 'en-US'} />);
    try {
      h.eq(new DataCopyJournal(kv).list(), [], 'the record is settled');
      h.eq(tables(), [], 'and the half-written store is gone');
      h.eq(index.list().map((a) => a.id), [app.id], 'no copy appears');
    } finally {
      await unmountScreen(tree);
    }
  });
}
