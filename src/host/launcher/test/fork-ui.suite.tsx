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
import { createPersistentStore } from '../../version-store';
import { SEED_VERSION } from '../seed';
import { DataCopyJournal } from '../data-copy-journal';
import { hasDatabase, open as openNativeDb, resetNativeStorage, saveUserData } from './native-storage';
import HomeScreen from '../HomeScreen';
import { waitFor } from './rendered-launcher';
import { press, renderScreen, unmountScreen } from './react-screen';
import { chooseRow, longPress, pressToastAction, renderRoot, sheetRows, sheetTitled, tile, tileLabels, toastOf } from './home-rig';
import { DataCopyError, type DataCopyErrorKind } from '../../storage-engine/copy-contract';

/** An installed app named `name` under `id` that declares the `storage` capability, carrying `extra` (a legacy copy's `storageGroupId`). */
const appNamed = (id: string, name: string, extra: Partial<InstalledApp> = {}): InstalledApp =>
  ({ id, name, createdAt: 1, lineageId: 'main', record: { appId: id, name, manifest: { capabilities: ['storage'] } }, ...extra });

const app = appNamed('timer', 'Timer');

export async function runForkUiTests(h: Harness): Promise<void> {
  await h.test('make a copy: on the device the question is asked, “Copy the data” and “Start fresh” fork with that data, and closing the sheet forks nothing', async () => {
    resetNativeStorage();
    const index = new AppIndex(createMmkvBackend('whim.launcher'));
    index.markSeeded(SEED_VERSION);
    index.put(app);
    saveUserData(app.id);
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
    saveUserData(app.id);
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

  await h.test('make a copy: an app that declares no storage is copied fresh at once, unasked, and the read leaves no store behind; a legacy copy whose shared store holds data is asked', async () => {
    resetNativeStorage();
    const index = new AppIndex(createMmkvBackend('whim.launcher'));
    index.markSeeded(SEED_VERSION);
    // Timer is installed through the version store with a saved manifest that declares no storage;
    // Notes (and its legacy copy) declare it and hold rows.
    const installer = new StoreAccess({ store: createPersistentStore(createMmkvBackend('whim-version-store')), index });
    await installer.install({ id: 'timer', name: 'Timer', record: { appId: 'timer', name: 'Timer', manifest: { capabilities: [] } }, bundleSource: 'V1', prompt: 'a timer' });
    index.put(appNamed('notes', 'Notes'));
    // #52's shared copy: no store of its own, its data in its founder's.
    index.put(appNamed('notes-copy', 'Notes Copy', { storageGroupId: 'notes' }));
    saveUserData('notes');
    const originalFork = StoreAccess.prototype.fork;
    const calls: unknown[][] = [];
    StoreAccess.prototype.fork = async function (...args: unknown[]) { calls.push(args); return { ...(args[0] as InstalledApp), id: `${(args[0] as InstalledApp).id}-copy-${calls.length}` }; } as typeof originalFork;
    const tree = await renderRoot(<LauncherRoot deviceLocale={() => 'en-US'} />);
    try {
      await longPress(tree, 'Timer');
      await chooseRow(tree, COPY.actionMakeCopy);
      // Whether it saved anything is read from its saved versions, which takes a few turns of the loop.
      await waitFor(() => toastOf(tree)?.message === COPY.copyMadeToast, '“Copy made”');
      h.eq(sheetTitled(tree, COPY.copyQuestionTitle), undefined, 'Timer saved nothing: no question');
      h.eq(calls.map((c) => [(c[0] as InstalledApp).id, c[2]]), [['timer', { data: 'fresh' }]], 'it is copied fresh at once');
      h.eq(hasDatabase('timer.db'), false, 'and asking left no store for Timer, an app that declares no storage');
      h.eq(toastOf(tree)?.message, COPY.copyMadeToast, '“Copy made”');

      await longPress(tree, 'Notes Copy');
      await chooseRow(tree, COPY.actionMakeCopy);
      await waitFor(() => sheetRows(tree, COPY.copyQuestionTitle).length > 0, 'the question');
      h.ok(sheetRows(tree, COPY.copyQuestionTitle).length > 0, 'the shared copy’s data lives in its founder’s store, so it is asked');
      h.eq(calls.length, 1, 'and nothing more is made until it is answered');
    } finally {
      await unmountScreen(tree);
      StoreAccess.prototype.fork = originalFork;
    }
  });

  await h.test('make a copy: a “Copy the data” that fails says why in plain words, for every kind, and offers “Start fresh”, which makes a fresh copy only when chosen', async () => {
    const said: Record<DataCopyErrorKind, string> = {
      no_space: COPY.copyNoRoomToast,
      source_unreadable: COPY.copyUnreadableToast,
      verify_failed: COPY.copyDataFailedToast,
      io: COPY.copyDataFailedToast,
    };
    for (const kind of Object.keys(said) as DataCopyErrorKind[]) {
      resetNativeStorage();
      const index = new AppIndex(createMmkvBackend('whim.launcher'));
      index.markSeeded(SEED_VERSION);
      index.put(app);
      saveUserData(app.id);
      const originalFork = StoreAccess.prototype.fork;
      const calls: unknown[] = [];
      StoreAccess.prototype.fork = async function (_entry: InstalledApp, _version?: string, opts?: { data?: string }) {
        calls.push(opts);
        if (opts?.data === 'copy') throw new DataCopyError(kind, `copy failed: ${kind}`);
        return { ...app, id: 'timer-copy' };
      } as typeof originalFork;
      const tree = await renderRoot(<LauncherRoot deviceLocale={() => 'en-US'} />);
      try {
        await longPress(tree, 'Timer');
        await chooseRow(tree, COPY.actionMakeCopy);
        await press(sheetRows(tree, COPY.copyQuestionTitle).find((r) => String(r.props.accessibilityLabel).startsWith(COPY.copyQuestionData))!);
        h.eq(toastOf(tree), { message: said[kind], action: COPY.copyQuestionFresh }, `${kind}: its own words, offering “Start fresh”`);
        h.eq([calls, tileLabels(tree)], [[{ data: 'copy' }], ['Timer']], `${kind}: nothing else was tried and no tile was added`);
        h.eq(tile(tree, 'Timer').props.accessibilityState, { busy: false }, `${kind}: the tile is free again`);
        await pressToastAction(tree);
        h.eq(calls, [{ data: 'copy' }, { data: 'fresh' }], `${kind}: choosing “Start fresh” makes the fresh copy`);
        h.eq(toastOf(tree)?.message, COPY.copyMadeToast, `${kind}: and says “Copy made”`);
      } finally {
        await unmountScreen(tree);
        StoreAccess.prototype.fork = originalFork;
      }
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
