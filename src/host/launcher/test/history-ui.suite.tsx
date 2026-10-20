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
import SettingsScreen from '../SettingsScreen';
import { AppIndex, type InstalledApp } from '../app-index';
import { StoreAccess, storeIdOf } from '../store-access';
import { createMemoryStore, MapKVBackend } from '../../version-store';
import { DescribePage } from '../DescribePage';
import ReadyPage from '../ReadyPage';
import MiniAppView from '../MiniAppView';
import WhimProse from '../../ui/whim-prose/WhimProse';
import { SHELL_COLORS } from '../../../sdk/theme';
import { appLinkFor } from '../app-link';
import { Alert, hardwareBack, openLink, StyleSheet, windowMetrics } from './native-host';
import { iosPop, stackMoveEnds, stackUnmountsMidMove } from './native-screens';
import { activate, button, press, renderScreen, screenReaderElement, textOf, unmountScreen, hostType } from './react-screen';
import { chooseRow, longPress, renderHome, tile } from './home-rig';
import { buildIt, planLoaded, resultEvent, settle, sseStream, tap, waitFor, withLauncher } from './rendered-launcher';
import { startBuild, streamingServer } from './prompt-flow-ui.suite';

type Tree = TestRenderer.ReactTestRenderer;
const envelope = (text: string) => JSON.stringify({ v: 2, text });
const noop = () => {};

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

interface Held<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function held<T>(): Held<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

const historyScreen = (access: StoreAccess, app: InstalledApp) => <HistoryScreen app={app} access={access} onBack={noop} onChangeIt={noop} onReport={noop} />;

async function withHistory(access: StoreAccess, app: InstalledApp, body: (tree: Tree) => Promise<void>): Promise<void> {
  const tree = await renderScreen(historyScreen(access, app));
  try { await body(tree); } finally { await unmountScreen(tree); }
}

async function reloadHistory(tree: Tree, access: StoreAccess, app: InstalledApp): Promise<void> {
  await TestRenderer.act(async () => { tree.update(historyScreen(access, app)); });
}

async function rejectInAct<T>(pending: Held<T>, message: string): Promise<void> {
  await TestRenderer.act(async () => { pending.reject(new Error(message)); });
}

async function waitForReassuranceToClear(tree: Tree): Promise<void> {
  await waitFor(() => !hasPendingReassurance(tree), 'the failed restore reassurance to clear');
}

/** How many loading placeholders the screen shows. */
const loadingRows = (tree: Tree) => tree.root.findAll((n) => hostType(n) === 'View' && n.props.accessibilityLabel === COPY.historyLoadingLabel).length;
const hasPendingReassurance = (tree: Tree) => tree.root.findAll((n) => n.props.accessibilityLabel === COPY.historyReassurancePending).length > 0;

/** The row card whose headline is `text`. */
const row = (tree: Tree, text: string) => tree.root.find((n) => hostType(n) === 'TouchableOpacity' && typeof n.props.onPress === 'function' && textOf(n).includes(text) && textOf(n).includes(COPY.historyOriginYouSaid));
const hasRow = (tree: Tree, text: string) => tree.root.findAll((n) => hostType(n) === 'TouchableOpacity' && typeof n.props.onPress === 'function' && textOf(n).includes(text) && textOf(n).includes(COPY.historyOriginYouSaid)).length === 1;
/** The words a rendered prose line attributes to the user (its `yours` spans). */
const yoursIn = (prose: TestRenderer.ReactTestInstance) =>
  prose.findAll((n) => hostType(n) === 'Text' && StyleSheet.flatten(n.props.style).color === SHELL_COLORS.yours).map(textOf);

/** The words naming the app in the screen's title. */
const titleOf = (tree: Tree, name: string) => tree.root.find((n) => hostType(n) === 'Text' && textOf(n) === name);

/** How many sheets are open. */
const sheetsOpen = (tree: Tree) => tree.root.findAll((n) => String(n.type) === 'Modal').length;

/** The system back gesture, delivered as Android delivers it. */
const systemBack = () => TestRenderer.act(async () => { hardwareBack(); });

/** A tap on the Home tile named `name`. */
const tapTile = (tree: Tree, name: string) => TestRenderer.act(async () => tile(tree, name).props.onPress());

/** History opened from Home for `app`, its push finished, then its own Back with `links` arriving in the
 *  same moment, while the pop runs. */
async function backFromHistoryWithLinks(tree: Tree, app: InstalledApp, links: readonly InstalledApp[]): Promise<void> {
  await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onHistory(app));
  await waitFor(() => tree.root.findAllByType(HistoryScreen).length === 1, 'History');
  await stackMoveEnds();
  await TestRenderer.act(async () => {
    button(tree, COPY.backLabel).props.onPress();
    for (const link of links) openLink(appLinkFor(link.id));
  });
  await settle();
}

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

  await h.test('history screen: rejected initial and reload reads settle without losing already-rendered versions', async () => {
    const { access, app } = await threeVersions();
    const timeline = access.timeline.bind(access);
    let rejectRead = true;
    access.timeline = async (entry) => {
      if (rejectRead) throw new Error('history listing is unavailable');
      return timeline(entry);
    };
    await withHistory(access, app, async (tree) => {
      await waitFor(() => loadingRows(tree) === 0, 'the rejected initial read to settle');
      h.ok(!hasRow(tree, 'add a chime'), 'the unavailable initial read does not leave a loading row behind');

      rejectRead = false;
      await reloadHistory(tree, access, { ...app });
      await waitFor(() => hasRow(tree, 'add a chime'), 'the later successful read to render its versions');

      rejectRead = true;
      await reloadHistory(tree, access, { ...app });
      await waitFor(() => loadingRows(tree) === 0, 'the rejected reload to settle');
      h.ok(hasRow(tree, 'add a chime'), 'the rejected reload keeps the previously rendered versions visible');
    });
  });

  await h.test('history screen: a rejected restore diff removes its pending reassurance', async () => {
    const { access, app } = await threeVersions();
    const diff = held<Awaited<ReturnType<StoreAccess['diff']>>>();
    access.diff = async () => diff.promise;
    await withHistory(access, app, async (tree) => {
      await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
      await press(row(tree, 'add a chime'));
      await press(button(tree, COPY.historyGoBackToThis));
      await rejectInAct(diff, 'diff is unavailable');
      await waitForReassuranceToClear(tree);
      h.ok(!textOf(tree.root).includes('Added:'), 'a failed restore diff does not invent a reassurance');
    });
  });

  await h.test('history screen: a rejected expanded-row annotation clears without showing an annotation', async () => {
    const { access, app } = await threeVersions();
    const diff = held<Awaited<ReturnType<StoreAccess['diff']>>>();
    access.diff = async () => diff.promise;
    await withHistory(access, app, async (tree) => {
      await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
      await press(row(tree, 'add a chime'));
      await rejectInAct(diff, 'annotation is unavailable');
      await waitFor(() => !textOf(tree.root).includes('Added:'), 'the failed annotation to remain absent');
      h.ok(!textOf(tree.root).includes('Added:'), 'a rejected annotation does not reuse a field list from another row');
    });
  });

  await h.test('history screen: a cancelled annotation rejection cannot update a collapsed row', async () => {
    const { access, app } = await threeVersions();
    const diff = held<Awaited<ReturnType<StoreAccess['diff']>>>();
    access.diff = async () => diff.promise;
    await withHistory(access, app, async (tree) => {
      await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
      await press(row(tree, 'add a chime'));
      await press(row(tree, 'add a chime'));
      await rejectInAct(diff, 'cancelled annotation is unavailable');
      h.ok(!textOf(tree.root).includes('Added:'), 'the cancelled row stays free of an annotation after its rejected read');
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

  await h.test('history screen: a text size changed while it shows builds its title and rows again, and History keeps what it holds — the open row and the question it is asking', async () => {
    const { access, app } = await threeVersions();
    await withHistory(access, app, async (tree) => {
      try {
        await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
        await press(row(tree, 'add a chime'));
        await press(button(tree, COPY.historyGoBackToThis));
        const asking = () => tree.root.findByType(ConfirmSheet).props.confirm != null;
        h.ok(asking(), 'setup: History is asking whether to go back to that version');
        const title = () => titleOf(tree, app.name);
        const built = { title: title(), row: row(tree, 'add a chime') };
        await reloadHistory(tree, access, app);
        h.ok(title() === built.title && row(tree, 'add a chime') === built.row, 'setup: a render at the same text size keeps what is drawn');
        windowMetrics.fontScale = 2;
        await reloadHistory(tree, access, app);
        h.ok(title() !== built.title && row(tree, 'add a chime') !== built.row, 'the size changed: the title and the rows are built again, so iOS measures every text at the new size');
        h.ok(button(tree, COPY.historyGoBackToThis) !== undefined, 'the row that was open is still open');
        h.ok(asking(), 'and the question is still open');
        const rebuilt = title();
        await reloadHistory(tree, access, app);
        h.ok(title() === rebuilt, 'built again once per size, not on every render');
      } finally {
        windowMetrics.fontScale = 1;
      }
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
      await waitFor(() => tree.root.findAllByType(ReadyPage).length === 1, 'the first version');
      await press(button(tree, COPY.readyDone));
      // The edit comes a minute later, as it would on a phone: a version's time is its commit's,
      // to the second, and two versions stamped in the same second have no order between them.
      Date.now = () => realNow() + 60_000;
      await TestRenderer.act(async () => home(tree).props.onPromptAgain(tracker(tree)));
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('Let me set my own daily goal'));
      await tap(() => tree.root.findByType(DescribePage).props.onContinue());
      await waitFor(() => planLoaded(tree), 'the edit’s plan');
      await buildIt(tree);
      await waitFor(() => streams.length === 2, 'the edit’s generation');
      streams[1].push({ ...resultEvent('Water Tracker'), summary: summary(EDIT_SUMMARY, 'Added') });
      streams[1].end();
      await waitFor(() => tree.root.findAllByType(ReadyPage).length === 1, 'the second version');
      await press(button(tree, COPY.readyDone));
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

  await h.test('history screen: opened from a running app’s orb, Back, system back and an iOS swipe return to that app, and the stack is never unmounted mid-pop; opened from Home, to Home', async () => {
    const never = () => new Promise<Response>(() => {});
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      const home = () => tree.root.findByType(HomeScreen);
      const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
      await waitFor(() => showing(HomeScreen) && home().props.apps.length > 0, 'the example apps');
      const app: InstalledApp = home().props.apps[0];
      const leaves: [string, () => Promise<void>][] = [
        ['Back', () => press(button(tree, COPY.backLabel))],
        ['system back', systemBack],
        ['iOS swipe', () => iosPop(tree)],
      ];
      for (const [name, leave] of leaves) {
        await tap(() => home().props.onOpen(app));
        await waitFor(() => showing(MiniAppView), `${app.name} to open`);
        await press(button(tree, COPY.orbMenuOpenLabel));
        await press(button(tree, COPY.actionHistory));
        await waitFor(() => showing(HistoryScreen), 'its history');
        const midMove = stackUnmountsMidMove();
        await leave();
        await waitFor(() => showing(MiniAppView), `${name} to reopen the app`);
        h.ok(!showing(HistoryScreen), `${name} from the history opened over the app returns to the app`);
        h.eq(tree.root.findByType(MiniAppView).props.installedApp.id, app.id, `${name}: the same app`);
        h.eq(stackUnmountsMidMove(), midMove, `${name}: the app replaces the stack only once no pop of it is running (else iOS shows a blank Home next)`);
        await TestRenderer.act(async () => tree.root.findByType(MiniAppView).props.onExit());
      }
      for (const [name, leave] of leaves) {
        await TestRenderer.act(async () => home().props.onHistory(app));
        await leave();
        h.ok(showing(HomeScreen), `${name} from the history opened from Home returns Home`);
      }
    });
  });

  await h.test('history screen: opened from a running app’s orb, a second Back or system back while the app is reopening is ignored: the app replaces History, never Home mid-pop', async () => {
    const never = () => new Promise<Response>(() => {});
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      const home = () => tree.root.findByType(HomeScreen);
      const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
      await waitFor(() => showing(HomeScreen) && home().props.apps.length > 0, 'the example apps');
      const app: InstalledApp = home().props.apps[0];
      const seconds: [string, () => void][] = [
        ['Back', () => button(tree, COPY.backLabel).props.onPress()],
        ['system back', () => { hardwareBack(); }],
      ];
      for (const [name, second] of seconds) {
        await tap(() => home().props.onOpen(app));
        await waitFor(() => showing(MiniAppView), `${app.name} to open`);
        await press(button(tree, COPY.orbMenuOpenLabel));
        await press(button(tree, COPY.actionHistory));
        await waitFor(() => showing(HistoryScreen), 'its history');
        const midMove = stackUnmountsMidMove();
        // A fast double tap: the second lands before the first one's bundle read.
        await TestRenderer.act(async () => {
          button(tree, COPY.backLabel).props.onPress();
          second();
        });
        await waitFor(() => showing(MiniAppView), `Back then ${name} to reopen the app`);
        h.eq(tree.root.findByType(MiniAppView).props.installedApp.id, app.id, `Back then ${name}: the same app`);
        h.eq(stackUnmountsMidMove(), midMove, `Back then ${name}: the stack is not popped to Home under the reopening app (else iOS shows a blank Home next)`);
        await TestRenderer.act(async () => tree.root.findByType(MiniAppView).props.onExit());
      }
    });
  });

  await h.test('history screen: opened from Home and left by its own Back, an app link arriving during that pop waits for it to finish; of two, only the last opens; with no word from the stack, a fallback lets it through', async () => {
    const never = () => new Promise<Response>(() => {});
    const { activeBundle } = StoreAccess.prototype;
    const read: string[] = [];
    StoreAccess.prototype.activeBundle = function (this: StoreAccess, entry: InstalledApp) {
      read.push(entry.id);
      return activeBundle.call(this, entry);
    };
    try {
      await withLauncher({ examples: true, server: never }, async ({ tree, clock }) => {
        const home = () => tree.root.findByType(HomeScreen);
        const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
        await waitFor(() => showing(HomeScreen) && home().props.apps.length > 1, 'the example apps');
        const [first, second]: InstalledApp[] = home().props.apps;
        const backWithLinks = async (...links: InstalledApp[]) => {
          read.length = 0;
          await backFromHistoryWithLinks(tree, first, links);
        };

        let midMove = stackUnmountsMidMove();
        await backWithLinks(second);
        h.ok(showing(HomeScreen) && !showing(MiniAppView), 'while the pop runs the link waits, on Home');
        h.eq(read, [], 'and nothing is read yet');
        await stackMoveEnds();
        await waitFor(() => showing(MiniAppView), 'the link to open once the pop finished');
        h.eq(tree.root.findByType(MiniAppView).props.installedApp.id, second.id, 'the linked app opens');
        h.eq(stackUnmountsMidMove(), midMove, 'and the stack was not unmounted mid-pop (else iOS shows a blank Home next)');
        await TestRenderer.act(async () => tree.root.findByType(MiniAppView).props.onExit());

        midMove = stackUnmountsMidMove();
        await backWithLinks(first, second);
        await stackMoveEnds();
        await waitFor(() => showing(MiniAppView), 'the later link to open');
        await settle();
        h.eq(read, [second.id], 'two links during the pop: only the later one opens, the earlier never fires');
        h.eq(tree.root.findByType(MiniAppView).props.installedApp.id, second.id, 'and it is what shows');
        h.eq(stackUnmountsMidMove(), midMove, 'with no stack unmounted mid-pop');
        await TestRenderer.act(async () => tree.root.findByType(MiniAppView).props.onExit());

        await backWithLinks(second);
        h.ok(!showing(MiniAppView), 'a stack that never says its pop finished still holds the link a moment');
        await TestRenderer.act(async () => { clock.fireWithin(1000); });
        await waitFor(() => showing(MiniAppView), 'the fallback to let the link through');
        await settle();
        h.eq(read, [second.id], 'once');
      });
    } finally {
      StoreAccess.prototype.activeBundle = activeBundle;
    }
  });

  await h.test('history screen: opened from Home and left by its own Back, a tile tapped during that pop reads busy from the tap and opens once the pop finished; when the person went elsewhere meanwhile it opens nothing', async () => {
    const never = () => new Promise<Response>(() => {});
    const { activeBundle } = StoreAccess.prototype;
    const read: string[] = [];
    StoreAccess.prototype.activeBundle = function (this: StoreAccess, entry: InstalledApp) {
      read.push(entry.id);
      return activeBundle.call(this, entry);
    };
    try {
      await withLauncher({ examples: true, server: never }, async ({ tree }) => {
        const home = () => tree.root.findByType(HomeScreen);
        const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
        await waitFor(() => showing(HomeScreen) && home().props.apps.length > 1, 'the example apps');
        const [first, second]: InstalledApp[] = home().props.apps;
        const backThenTap = async () => {
          read.length = 0;
          await backFromHistoryWithLinks(tree, first, []);
          await tapTile(tree, second.name);
        };

        const midMove = stackUnmountsMidMove();
        await backThenTap();
        h.eq(tile(tree, second.name).props.accessibilityState, { busy: true }, 'the tapped tile reads busy at once, while the pop runs');
        h.ok(!showing(MiniAppView) && read.length === 0, 'and waits: nothing is read yet');
        await stackMoveEnds();
        await waitFor(() => showing(MiniAppView), 'the tapped app to open once the pop finished');
        h.eq(tree.root.findByType(MiniAppView).props.installedApp.id, second.id, 'the tapped app opens');
        h.eq(stackUnmountsMidMove(), midMove, 'with no stack unmounted mid-pop');
        await TestRenderer.act(async () => tree.root.findByType(MiniAppView).props.onExit());
        await stackMoveEnds();

        await backThenTap();
        await TestRenderer.act(async () => home().props.onSettings());
        h.ok(showing(SettingsScreen), 'the person went on to Settings before the pop finished');
        await stackMoveEnds();
        await settle();
        h.ok(showing(SettingsScreen) && !showing(MiniAppView) && read.length === 0, 'the held open is dropped: nothing opens over Settings');
        await TestRenderer.act(async () => tree.root.findByType(SettingsScreen).props.onBack());
        await stackMoveEnds();
        await waitFor(() => !showing(SettingsScreen), 'Home again');
        h.eq(tile(tree, second.name).props.accessibilityState?.busy ?? false, false, 'and the tile no longer reads busy');
      });
    } finally {
      StoreAccess.prototype.activeBundle = activeBundle;
    }
  });

  await h.test('history screen: opened from a running app’s orb, when the store cannot read that app back, Back and system back land on Home with the alert instead of staying on History', async () => {
    const never = () => new Promise<Response>(() => {});
    const { activeBundle } = StoreAccess.prototype;
    try {
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
          StoreAccess.prototype.activeBundle = activeBundle;
          await tap(() => home().props.onOpen(app));
          await waitFor(() => showing(MiniAppView), `${app.name} to open`);
          await press(button(tree, COPY.orbMenuOpenLabel));
          await press(button(tree, COPY.actionHistory));
          await waitFor(() => showing(HistoryScreen), 'its history');
          StoreAccess.prototype.activeBundle = async () => { throw new Error('bundle read failed'); };
          const alerts = Alert.shown.length;
          await leave();
          await waitFor(() => Alert.shown.length > alerts, `${name}: the reopen to fail`);
          h.eq(Alert.shown.at(-1)?.message, 'bundle read failed', `${name}: the failed read is still told to the user`);
          h.ok(showing(HomeScreen) && !showing(HistoryScreen), `${name}: and the user lands on Home, not back on History`);
        }
      });
    } finally {
      StoreAccess.prototype.activeBundle = activeBundle;
    }
  });

  await h.test('history screen: opened from a running app’s orb, when reading that app back never settles, a second Back is ignored only for a bounded time: then the alert and Home, and a read that settles late opens nothing', async () => {
    const never = () => new Promise<Response>(() => {});
    const { activeBundle } = StoreAccess.prototype;
    try {
      await withLauncher({ examples: true, server: never }, async ({ tree, clock }) => {
        const home = () => tree.root.findByType(HomeScreen);
        const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
        await waitFor(() => showing(HomeScreen) && home().props.apps.length > 0, 'the example apps');
        const app: InstalledApp = home().props.apps[0];
        await tap(() => home().props.onOpen(app));
        await waitFor(() => showing(MiniAppView), `${app.name} to open`);
        await press(button(tree, COPY.orbMenuOpenLabel));
        await press(button(tree, COPY.actionHistory));
        await waitFor(() => showing(HistoryScreen), 'its history');
        await stackMoveEnds();
        const late = held<string>();
        StoreAccess.prototype.activeBundle = () => late.promise;
        const alerts = Alert.shown.length;
        const midMove = stackUnmountsMidMove();
        await TestRenderer.act(async () => {
          button(tree, COPY.backLabel).props.onPress();
          hardwareBack();
        });
        await settle();
        h.ok(showing(HistoryScreen) && Alert.shown.length === alerts, 'while the read runs, History stays and the second Back is ignored');
        await TestRenderer.act(async () => { clock.fireWithin(10_000); });
        await waitFor(() => Alert.shown.length > alerts, 'the open to give up');
        h.eq(Alert.shown.at(-1)?.message, COPY.appOpenTimedOut, 'the user is told the app took too long to open');
        h.ok(showing(HomeScreen) && !showing(HistoryScreen), 'and lands on Home, not stranded on History');
        await TestRenderer.act(async () => { late.resolve('late bundle'); });
        await settle();
        h.ok(showing(HomeScreen) && !showing(MiniAppView), 'the read that settles late opens nothing');
        h.eq(stackUnmountsMidMove(), midMove, 'and no stack is unmounted mid-pop');
        await stackMoveEnds();
        StoreAccess.prototype.activeBundle = activeBundle;
        await tap(() => home().props.onOpen(app));
        await waitFor(() => showing(MiniAppView), 'the app to open again from its tile');
      });
    } finally {
      StoreAccess.prototype.activeBundle = activeBundle;
    }
  });

  await h.test('history screen: Home’s tile menu opens History for that app', async () => {
    const app: InstalledApp = { id: 'tea', name: 'Tea', createdAt: 1, lineageId: 'main', record: { appId: 'tea', name: 'Tea', manifest: { capabilities: [] } } };
    const opened: InstalledApp[] = [];
    const tree = await renderHome({ apps: [app], onHistory: (a) => { opened.push(a); } });
    try {
      await longPress(tree, 'Tea');
      await chooseRow(tree, COPY.actionHistory);
      h.eq(opened.map((a) => a.id), [app.id], 'History opens for the long-pressed app');
    } finally {
      await unmountScreen(tree);
    }
  });
}
