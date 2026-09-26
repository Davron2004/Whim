/** The rendered History screen over a real version store: the first load is a loading state, not
 *  an empty list; a row quotes the user's words and opens to Whim's summary; a row expands without
 *  restoring; Go back and Start a copy act on that row's own version, once each, however often the
 *  confirm is tapped. Home's sheet and a running app's orb reach it, and leaving returns there. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { COPY } from '../copy';
import HistoryScreen from '../HistoryScreen';
import ConfirmSheet from '../ConfirmSheet';
import HomeScreen from '../HomeScreen';
import { AppIndex, type InstalledApp } from '../app-index';
import { StoreAccess, storeIdOf } from '../store-access';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import ComposeStep from '../ComposeStep';
import DoneStep from '../DoneStep';
import MiniAppView from '../MiniAppView';
import WhimProse from '../../ui/whim-prose/WhimProse';
import { SHELL_COLORS } from '../../../sdk/theme';
import { finishAnimations, hardwareBack, StyleSheet } from './native-host';
import { activate, button, press, renderScreen, screenReaderElement, textOf, unmountScreen } from './react-screen';
import { buildIt, planLoaded, resultEvent, sseStream, tap, waitFor, withLauncher } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';

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
/** The words a rendered prose line attributes to the user (its `yours` spans). */
const yoursIn = (prose: TestRenderer.ReactTestInstance) =>
  prose.findAll((n) => n.type === 'Text' && StyleSheet.flatten(n.props.style).color === SHELL_COLORS.yours).map(textOf);

/** How many sheets are open. */
const sheetsOpen = (tree: Tree) => tree.root.findAll((n) => String(n.type) === 'Modal').length;

/** The system back gesture, delivered as Android delivers it. */
const systemBack = () => TestRenderer.act(async () => { hardwareBack(); });

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
      h.ok(tree.root.findByType(ConfirmSheet).props.confirm != null, 'in the launcher’s confirm sheet, the one Settings asks in too');
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

  await h.test('history screen: to VoiceOver each confirm is Cancel and the action as labelled buttons, and activating the action restores or copies rather than cancelling', async () => {
    const asks = [
      { action: COPY.historyGoBackToThis, confirm: COPY.historyRestoreConfirm, ran: 'restore' },
      { action: COPY.historyStartCopyHere, confirm: COPY.historyCopyConfirm, ran: 'copy' },
    ];
    for (const ask of asks) {
      const { access, app, middle } = await threeVersions();
      const ran: string[] = [];
      const [rollback, fork] = [access.rollback.bind(access), access.fork.bind(access)];
      access.rollback = async (entry, id) => { ran.push(`restore ${id}`); return rollback(entry, id); };
      access.fork = async (entry, id, opts) => { ran.push(`copy ${id}`); return fork(entry, id, opts); };
      await withHistory(access, app, async (tree) => {
        await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
        await press(row(tree, 'add a chime'));
        await press(button(tree, ask.action));
        const sheet = tree.root.find((n) => String(n.type) === 'Modal');
        for (const label of [COPY.cancel, ask.confirm]) {
          const control = sheet.find((n) => ['Pressable', 'TouchableOpacity'].includes(String(n.type)) && textOf(n) === label);
          h.ok(screenReaderElement(control) === control, `${ask.ran}: "${label}" is an element of its own, not read as part of one around it`);
          h.eq([control.props.accessibilityRole, control.props.accessibilityLabel], ['button', label], `${ask.ran}: "${label}" is announced as a button, in its own words`);
        }
        await activate(button(tree, ask.confirm));
        await waitFor(() => sheetsOpen(tree) === 0, `${ask.ran}: the sheet to close`);
        h.eq(ran, [`${ask.ran} ${middle.id}`], `${ask.ran}: activating "${ask.confirm}" acts on that row’s version, and is not Cancel`);
      });
    }
  });

  await h.test('history screen: after a build and an edit made through the app, each row quotes the words that made it under “You said”, and Whim’s summary opens with the row', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const summary = (text: string, kind: 'Start' | 'Added') => ({ text, kind, touched: [], marks: [] });
    const FIRST_SUMMARY = 'Counts the glasses you drink';
    const EDIT_SUMMARY = 'You can now set your own daily water goal';
    const home = (tree: Tree) => tree.root.findByType(HomeScreen);
    const tracker = (tree: Tree): InstalledApp => home(tree).props.apps.find((a: InstalledApp) => a.name === 'Water Tracker');
    const realNow = Date.now;
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A water tracker');
      streams[0].push({ ...resultEvent('Water Tracker'), summary: summary(FIRST_SUMMARY, 'Start') });
      streams[0].end();
      await waitFor(() => tree.root.findAllByType(DoneStep).length === 1, 'the first version');
      await press(button(tree, COPY.doneBackToApps));
      // The edit comes a minute later, as it would on a phone: a version's time is its commit's,
      // to the second, and two versions stamped in the same second have no order between them.
      Date.now = () => realNow() + 60_000;
      await TestRenderer.act(async () => home(tree).props.onPromptAgain(tracker(tree)));
      await TestRenderer.act(async () => tree.root.findByType(ComposeStep).props.onChangeText('Let me set my own daily goal'));
      await tap(() => tree.root.findByType(ComposeStep).props.onContinue());
      await waitFor(() => planLoaded(tree), 'the edit’s plan');
      await buildIt(tree);
      await waitFor(() => streams.length === 2, 'the edit’s generation');
      streams[1].push({ ...resultEvent('Water Tracker'), summary: summary(EDIT_SUMMARY, 'Added') });
      streams[1].end();
      await waitFor(() => tree.root.findAllByType(DoneStep).length === 1, 'the second version');
      await press(button(tree, COPY.doneBackToApps));
      await TestRenderer.act(async () => home(tree).props.onHistory(tracker(tree)));
      await waitFor(() => tree.root.findAllByType(WhimProse).length === 2, 'both versions on the timeline');
      h.eq(tree.root.findAllByType(WhimProse).map((n) => n.props.storedPrompt), ['Let me set my own daily goal', 'A water tracker'], 'newest first: the edit never rewrites v1');
      h.eq(tree.root.findAllByType(WhimProse).map(yoursIn), [['Let me set my own daily goal'], ['A water tracker']], 'each headline quotes the user’s own words, rendered as theirs');
      h.ok(hasRow(tree, 'Let me set my own daily goal') && hasRow(tree, 'A water tracker'), 'each under “You said”');
      h.ok(!textOf(tree.root).includes(EDIT_SUMMARY) && !textOf(tree.root).includes(FIRST_SUMMARY), 'a collapsed row does not show Whim’s summary');
      await press(row(tree, 'Let me set my own daily goal'));
      h.ok(textOf(row(tree, 'Let me set my own daily goal')).includes(EDIT_SUMMARY), 'opening the edit’s row shows what Whim did for it');
      h.ok(!textOf(tree.root).includes(FIRST_SUMMARY), 'and only for it: the other row stays closed');
    }).finally(() => { Date.now = realNow; });
  });

  await h.test('history screen: opened from a running app’s orb, Back and system back return to that app; opened from Home, to Home', async () => {
    const never = () => new Promise<Response>(() => {});
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      const home = () => tree.root.findByType(HomeScreen);
      const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
      await waitFor(() => showing(HomeScreen) && home().props.apps.length > 0, 'the example apps');
      const app: InstalledApp = home().props.apps[0];
      const leaves: [string, () => Promise<void>][] = [
        ['Back', () => press(button(tree, COPY.backLabel))],
        ['system back', systemBack],
      ];
      for (const [name, leave] of leaves) {
        await tap(() => home().props.onOpen(app));
        await waitFor(() => showing(MiniAppView), `${app.name} to open`);
        await press(button(tree, COPY.orbMenuOpenLabel));
        await TestRenderer.act(async () => { finishAnimations(); });
        await press(button(tree, COPY.orbActionVersions));
        await waitFor(() => showing(HistoryScreen), 'its history');
        await leave();
        await waitFor(() => showing(MiniAppView) || showing(HomeScreen), `${name} to leave history`);
        h.ok(showing(MiniAppView), `${name} from the history opened over the app returns to the app, not Home`);
        h.eq(tree.root.findByType(MiniAppView).props.installedApp.id, app.id, `${name}: the same app`);
        await TestRenderer.act(async () => tree.root.findByType(MiniAppView).props.onExit());
      }
      for (const [name, leave] of leaves) {
        await TestRenderer.act(async () => home().props.onHistory(app));
        await leave();
        h.ok(showing(HomeScreen), `${name} from the history opened from Home returns Home`);
      }
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
