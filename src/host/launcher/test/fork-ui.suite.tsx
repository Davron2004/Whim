/** Making a copy from Home asks first, and the answer reaches `StoreAccess.fork` as its data option;
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
import HomeScreen from '../HomeScreen';
import { press, renderScreen, unmountScreen } from './react-screen';
import { chooseRow, longPress, renderRoot, sheetRows, tile, tileLabels, toastOf } from './home-rig';

const app: InstalledApp = { id: 'timer', name: 'Timer', createdAt: 1, lineageId: 'main', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } } };

export async function runForkUiTests(h: Harness): Promise<void> {
  await h.test('make a copy: on the device the question is asked, “Copy the data” and “Start fresh” fork with that data, and closing the sheet forks nothing', async () => {
    resetNativeStorage();
    const index = new AppIndex(createMmkvBackend('whim.launcher'));
    index.markSeeded(SEED_VERSION);
    index.put(app);
    const originalFork = StoreAccess.prototype.fork;
    const calls: unknown[][] = [];
    StoreAccess.prototype.fork = async function (...args: unknown[]) { calls.push(args); return { ...app, id: 'timer-copy' }; } as typeof originalFork;
    const tree = await renderRoot(<LauncherRoot deviceLocale={() => 'en-US'} />);
    try {
      h.eq(tree.root.findByType(HomeScreen).props.canCopyData, true, 'the device shell can copy data, so Home is told');
      const ask = async () => { await longPress(tree, 'Timer'); await chooseRow(tree, COPY.actionMakeCopy); };
      const answer = (label: string) => press(sheetRows(tree, COPY.copyQuestionTitle).find((r) => String(r.props.accessibilityLabel).startsWith(label))!);
      await ask();
      h.eq(calls.length, 0, 'choosing Make a copy asks first; nothing is forked yet');
      await TestRenderer.act(async () => sheetRows(tree, COPY.copyQuestionTitle).find((r) => r.props.accessibilityLabel === COPY.sheetClose)!.props.onPress());
      h.eq(calls.length, 0, 'closing the sheet forks nothing');
      await ask();
      await answer(COPY.copyQuestionData);
      await ask();
      await answer(COPY.copyQuestionFresh);
      h.eq(calls.map((c) => (c[0] as InstalledApp).id), [app.id, app.id], 'the long-pressed app is the one forked, each time');
      h.eq(calls.map((c) => c[1]), [undefined, undefined], 'from its current version');
      h.eq(calls.map((c) => c[2]), [{ data: 'copy' }, { data: 'fresh' }], 'with the data each answer names and nothing else');
    } finally {
      await unmountScreen(tree);
      StoreAccess.prototype.fork = originalFork;
    }
  });

  await h.test('make a copy: a copy that cannot be made says so in one toast and adds no tile', async () => {
    resetNativeStorage();
    const index = new AppIndex(createMmkvBackend('whim.launcher'));
    index.markSeeded(SEED_VERSION);
    index.put(app);
    const originalFork = StoreAccess.prototype.fork;
    StoreAccess.prototype.fork = async function () { throw new Error('no room'); } as typeof originalFork;
    const tree = await renderRoot(<LauncherRoot deviceLocale={() => 'en-US'} />);
    try {
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionMakeCopy);
      await press(sheetRows(tree, COPY.copyQuestionTitle).find((r) => String(r.props.accessibilityLabel).startsWith(COPY.copyQuestionData))!);
      h.eq(toastOf(tree)?.message, COPY.copyFailedToast, 'the failure toast');
      h.eq(tileLabels(tree), ['Timer'], 'and still one tile');
      h.eq(tile(tree, 'Timer').props.accessibilityState, { busy: false }, 'the tile is free again');
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
