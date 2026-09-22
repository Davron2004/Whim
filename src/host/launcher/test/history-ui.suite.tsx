/** The rendered History screen over a real version store: the first load is a loading state, not
 *  an empty list; a row expands without restoring; Go back and Start a copy act on that row's own
 *  version, once each, however often the confirm is tapped. And Home's sheet reaches it. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import HistoryScreen from '../HistoryScreen';
import HomeScreen from '../HomeScreen';
import { AppIndex, type InstalledApp } from '../app-index';
import { StoreAccess, storeIdOf } from '../store-access';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import { button, press, renderScreen, textOf, unmountScreen } from './react-screen';
import { waitFor } from './rendered-launcher';

type Tree = TestRenderer.ReactTestRenderer;
const envelope = (text: string) => JSON.stringify({ v: 2, text });

/** A real store holding three versions of one app: the install, a middle one, and the current. */
async function threeVersions() {
  let t = 1_700_000_000_000;
  const store = createMemoryStore({ autoCompact: false, now: () => (t += 1000) });
  const access = new StoreAccess({ store, index: new AppIndex(new MapKVBackend()), now: () => Date.now() });
  const app = await access.install({ id: 'tea', name: 'Tea', record: { appId: 'tea', name: 'Tea', manifest: { capabilities: [] } }, bundleSource: 'V1', prompt: envelope('a tea timer') });
  await store.snapshot(storeIdOf(app), { 'bundle.js': 'V2' }, envelope('add a chime'));
  await store.snapshot(storeIdOf(app), { 'bundle.js': 'V3' }, envelope('make it louder'));
  const [current, middle] = await access.timeline(app);
  return { access, app, current, middle };
}

function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function withHistory(access: StoreAccess, app: InstalledApp, body: (tree: Tree) => Promise<void>): Promise<void> {
  const noop = () => {};
  const tree = await renderScreen(<HistoryScreen app={app} access={access} onBack={noop} onChangeIt={noop} onReport={noop} />);
  try { await body(tree); } finally { await unmountScreen(tree); }
}

/** How many loading placeholders the screen shows. */
const loadingRows = (tree: Tree) => tree.root.findAll((n) => n.type === 'View' && n.props.accessibilityLabel === COPY.historyLoadingLabel).length;

/** The row card whose headline is `text`. */
const row = (tree: Tree, text: string) => tree.root.find((n) => n.type === 'TouchableOpacity' && typeof n.props.onPress === 'function' && textOf(n).includes(text) && textOf(n).includes(COPY.historyOriginYouSaid));
const hasRow = (tree: Tree, text: string) => tree.root.findAll((n) => n.type === 'TouchableOpacity' && typeof n.props.onPress === 'function' && textOf(n).includes(text) && textOf(n).includes(COPY.historyOriginYouSaid)).length === 1;

export async function runHistoryUiTests(h: Harness): Promise<void> {
  await h.test('history screen: the first load shows a loading state, never an empty list, until the versions arrive', async () => {
    const { access, app } = await threeVersions();
    const read = held<void>();
    const timeline = access.timeline.bind(access);
    access.timeline = async (entry) => { await read.promise; return timeline(entry); };
    await withHistory(access, app, async (tree) => {
      const loading = () => loadingRows(tree);
      h.eq(loading(), 1, 'the loading rows show while the versions are read');
      h.ok(!textOf(tree.root).includes('add a chime'), 'and no version row yet');
      await TestRenderer.act(async () => { read.resolve(); });
      await waitFor(() => loading() === 0, 'the versions to load');
      h.eq(loading(), 0, 'the loading rows go when the versions land');
      h.ok(textOf(tree.root).includes('add a chime'), 'and the versions show');
    });
  });

  await h.test('history screen: tapping a row only expands it; Go back restores that version once, however often confirm is tapped', async () => {
    const { access, app, middle } = await threeVersions();
    const rollbacks: string[] = [];
    const finish = held<void>();
    const rollback = access.rollback.bind(access);
    access.rollback = async (entry, id) => { rollbacks.push(id); await finish.promise; return rollback(entry, id); };
    await withHistory(access, app, async (tree) => {
      await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
      await press(row(tree, 'add a chime'));
      h.eq(rollbacks, [], 'expanding a row restores nothing');
      await press(button(tree, COPY.historyGoBackToThis));
      h.eq(rollbacks, [], 'Go back only asks first');
      // Two taps inside one frame both see the enabled button: only the handler’s own guard can refuse the second.
      await TestRenderer.act(async () => { const confirm = button(tree, COPY.historyRestoreConfirm); confirm.props.onPress(); confirm.props.onPress(); });
      h.eq(rollbacks, [middle.id], "confirming restores that row’s own version, once for two taps in one frame");
      await h.throws(() => press(button(tree, COPY.historyRestoreConfirmBusy)), 'Cannot press a disabled control', 'while it runs the confirm cannot be tapped again');
      await TestRenderer.act(async () => { finish.resolve(); });
      await waitFor(() => !textOf(tree.root).includes(COPY.historyRestoreConfirmBusy), 'the restore to finish');
      h.eq(rollbacks.length, 1, 'one restore in all');
      h.eq(await access.activeId(app), middle.id, 'and the app now runs that version');
    });
  });

  await h.test('history screen: Start a copy forks from that row’s version, once', async () => {
    const { access, app, middle } = await threeVersions();
    const forks: (string | undefined)[] = [];
    const finish = held<void>();
    const fork = access.fork.bind(access);
    access.fork = async (entry, id, opts) => { forks.push(id); await finish.promise; return fork(entry, id, opts); };
    await withHistory(access, app, async (tree) => {
      await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
      await press(row(tree, 'add a chime'));
      await press(button(tree, COPY.historyStartCopyHere));
      h.eq(forks, [], 'Start a copy only asks first');
      await TestRenderer.act(async () => { const confirm = button(tree, COPY.historyCopyConfirm); confirm.props.onPress(); confirm.props.onPress(); });
      await h.throws(() => press(button(tree, COPY.historyCopyConfirmBusy)), 'Cannot press a disabled control', 'while it runs the confirm cannot be tapped again');
      await TestRenderer.act(async () => { finish.resolve(); });
      await waitFor(() => textOf(tree.root).includes(COPY.historyCopyToast), 'the copy to finish');
      h.eq(forks, [middle.id], 'one copy, from that row’s version');
    });
  });

  await h.test('history screen: Home’s long-press sheet opens History for that app', async () => {
    const app: InstalledApp = { id: 'tea', name: 'Tea', createdAt: 1, lineageId: 'main', record: { appId: 'tea', name: 'Tea', manifest: { capabilities: [] } } };
    const opened: InstalledApp[] = [];
    const noop = () => {};
    const tree = await renderScreen(<HomeScreen apps={[app]} onOpen={noop} onFork={noop} onDelete={noop} onHistory={(a) => { opened.push(a); }} onPromptAgain={noop} onCreate={noop} onSettings={noop} />);
    try {
      await TestRenderer.act(async () => tree.root.find((n) => n.type === 'TouchableOpacity' && typeof n.props.onLongPress === 'function').props.onLongPress());
      await press(button(tree, COPY.actionHistory));
      h.eq(opened.map((a) => a.id), [app.id], 'History opens for the long-pressed app');
    } finally {
      await unmountScreen(tree);
    }
  });
}
