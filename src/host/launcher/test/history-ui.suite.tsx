/** The rendered History screen over a real version store: a header with Back and Report over the
 *  title, the app's tile, its name and how many versions it has; one timeline row per version, the
 *  person's words first, with Whim's summary, the version and when, a neutral kind chip and
 *  `Current`, on a rail that stops at v1; no filters; the phone's scheme and a text size capped at
 *  200%. The first load is a loading state, not an empty list; a row expands without restoring; Go
 *  back and Start a copy act on that row's own version, once each, however often the confirm is
 *  tapped. Home's sheet and a running app's orb reach it, and leaving returns there. */
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
import { tileOf } from '../tile-identity';
import { TilePlate } from '../../ui/AppTile';
import { TILE_SIDE } from '../../ui/AppTile-geometry';
import { Icon } from '../../ui/Icon';
import { COLORS, LAYOUT, SPACE, TINTS, TYPE_SCALE } from '../../../design/tokens';
import { appLinkFor } from '../app-link';
import { Alert, hardwareBack, openLink, setColorScheme, StyleSheet, windowMetrics } from './native-host';
import { iosPop, stackItems, stackMoveEnds, stackUnmountsMidMove } from './native-screens';
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
const loadingRows = (tree: Tree) => tree.root.findAll((n) => hostType(n) !== undefined && n.props.accessibilityLabel === COPY.historyLoadingLabel).length;
const hasPendingReassurance = (tree: Tree) => tree.root.findAll((n) => n.props.accessibilityLabel === COPY.historyReassurancePending).length > 0;

type Node = TestRenderer.ReactTestInstance;
const DAY_MS = 86_400_000;

/** Every control a finger can press. */
const pressables = (tree: Tree) => tree.root.findAll((n) => ['TouchableOpacity', 'Pressable'].includes(String(hostType(n))) && typeof n.props.onPress === 'function');
/** The rows: the controls that open and close a version, newest first. */
const rows = (tree: Tree) => pressables(tree).filter((n) => n.props.accessibilityState?.expanded !== undefined);
/** The row whose words include `text`. */
const row = (tree: Tree, text: string) => {
  const found = rows(tree).filter((n) => textOf(n).includes(text));
  if (found.length !== 1) throw new Error(`Expected one row saying "${text}", found ${found.length}`);
  return found[0];
};
const hasRow = (tree: Tree, text: string) => rows(tree).filter((n) => textOf(n).includes(text)).length === 1;
const styleOf = (n: Node) => StyleSheet.flatten(n.props.style);
/** The host texts under `n` that say exactly `text`. */
const textsSaying = (n: Node, text: string) => n.findAll((m) => hostType(m) === 'Text' && textOf(m) === text);
const textSaying = (n: Node, text: string) => {
  const found = textsSaying(n, text);
  if (found.length === 0) throw new Error(`No text says "${text}"`);
  return found[found.length - 1];
};
/** A kind chip in `n`: the innermost view holding exactly one icon and the kind's word. */
const chipIn = (n: Node, word: string) => {
  const found = n.findAll((m) => hostType(m) === 'View' && textOf(m) === word && m.findAllByType(Icon).length === 1);
  if (found.length === 0) throw new Error(`No chip says "${word}"`);
  return found[found.length - 1];
};
/** The timeline's rail: the 2 pt absolute segments drawn between the rows' dots, top first. */
const railOf = (tree: Tree, colour: string) => tree.root.findAll((n) => hostType(n) === 'View' && styleOf(n).position === 'absolute' && styleOf(n).backgroundColor === colour && styleOf(n).width === 2);
/** Whether `n`, or a text it sits in, caps its size at 200% (a nested text takes its parent's cap). */
const capped = (n: Node): boolean => {
  for (let at: Node | null = n; at; at = at.parent) {
    if (hostType(at) === 'Text' && typeof at.props.maxFontSizeMultiplier === 'number') return at.props.maxFontSizeMultiplier <= 2;
  }
  return false;
};

/** Whether the longest word of text `n` fits `width` at text size `fontScale`, as far as its cap lets
 *  it grow: a system font's widest capitals and bold run under 0.7 em a letter. */
const wordsFit = (n: Node, fontScale: number, width: number) => {
  const size = Number(styleOf(n).fontSize) * Math.min(fontScale, n.props.maxFontSizeMultiplier ?? Infinity);
  return Math.max(...textOf(n).split(' ').map((w) => w.length)) * 0.7 * size <= width;
};

/** The words naming the app under the screen's title. */
const titleOf = (tree: Tree, name: string) => textSaying(tree.root, name);

const summaryOf = (text: string, kind: string) => ({ text, kind, touched: [], marks: [] });
const summarised = (text: string, summary: object) => JSON.stringify({ v: 2, text, summary });

/** A real store holding four versions of Pour Timer, two days old: the install (no summary of its
 *  own), then an Added, a Changed and a Fixed version; the last is current. */
async function fourKinds() {
  let t = Date.now() - 2 * DAY_MS - 60_000;
  const store = createMemoryStore({ autoCompact: false, now: () => (t += 1000) });
  const access = new StoreAccess({ store, index: new AppIndex(new MapKVBackend()), now: () => Date.now() });
  const app = await access.install({ id: 'pour', name: 'Pour Timer', record: { appId: 'pour', name: 'Pour Timer', manifest: { capabilities: [] } }, bundleSource: 'V1', prompt: envelope('a timer for my pour-over') });
  await store.snapshot(storeIdOf(app), { 'bundle.js': 'V2' }, summarised('add a chime', summaryOf('Plays a chime at the end of every step.', 'Added')));
  await store.snapshot(storeIdOf(app), { 'bundle.js': 'V3' }, summarised('let me pick V60 or Chemex', summaryOf('Adds a brewer choice.', 'Changed')));
  await store.snapshot(storeIdOf(app), { 'bundle.js': 'V4' }, summarised('the countdown stops early', summaryOf('The countdown runs to zero now.', 'Fixed')));
  return { access, app };
}

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
  await h.test('history screen: a header with Back and a Report text button, then “History”, the app’s 40 pt tile, its name in its tint and how many versions it has', async () => {
    const { access, app } = await fourKinds();
    const left: string[] = [];
    const tree = await renderScreen(<HistoryScreen app={app} access={access} onBack={() => left.push('back')} onChangeIt={noop} onReport={() => left.push('report')} />);
    try {
      await waitFor(() => rows(tree).length === 4, 'the versions to load');
      await press(button(tree, COPY.backLabel));
      await press(button(tree, 'Report'));
      h.eq(left, ['back', 'report'], 'Back leaves, and the Report text button reports');
      h.eq(textOf(button(tree, 'Report')), 'Report', 'Report is a text button, in words');
      const title = textSaying(tree.root, 'History');
      h.eq([title.props.accessibilityRole, styleOf(title).fontSize], ['header', TYPE_SCALE.title1.size], '“History” is the title, a heading in title1');
      const { tint, icon } = tileOf(app);
      const plates = tree.root.findAllByType(TilePlate);
      h.eq(plates.map((p) => [p.props.size, TILE_SIDE[p.props.size as keyof typeof TILE_SIDE], p.props.tint, p.props.glyph]), [['menu', 40, tint, icon]], 'the app’s own tile, at 40 pt');
      h.eq(styleOf(titleOf(tree, app.name)).color, TINTS[tint].light, 'its name in its tint');
      h.ok(textsSaying(tree.root, '4 versions').length === 1, 'and how many versions it has');
    } finally {
      await unmountScreen(tree);
    }
  });

  await h.test('history screen: each row leads with the person’s words, quoted, then Whim’s summary, “vN · when” in tabular figures, a neutral kind chip with its icon, and `Current` on the active version', async () => {
    const { access, app } = await fourKinds();
    await withHistory(access, app, async (tree) => {
      await waitFor(() => rows(tree).length === 4, 'the versions to load');
      const expected = [
        { said: 'the countdown stops early', summary: 'The countdown runs to zero now.', meta: 'v4 · 2 days ago', kind: 'Fixed', icon: 'wrench', current: true },
        { said: 'let me pick V60 or Chemex', summary: 'Adds a brewer choice.', meta: 'v3 · 2 days ago', kind: 'Changed', icon: 'pencil', current: false },
        { said: 'add a chime', summary: 'Plays a chime at the end of every step.', meta: 'v2 · 2 days ago', kind: 'Added', icon: 'plus', current: false },
        { said: 'a timer for my pour-over', summary: COPY.historyInstallLabel, meta: 'v1 · 2 days ago', kind: 'Start', icon: 'flag', current: false },
      ];
      h.eq(rows(tree).map((r) => textOf(r).startsWith(`“`)), [true, true, true, true], 'every row starts with the person’s words');
      const chips: { fill: unknown; label: unknown }[] = [];
      for (const want of expected) {
        const r = row(tree, want.said);
        const words = textSaying(r, `“${want.said}”`);
        h.eq([styleOf(words).fontStyle, styleOf(words).fontSize, styleOf(words).color], ['italic', TYPE_SCALE.title3.size, COLORS.light.text], `v${want.meta[1]}: the words, quoted, in italic title3`);
        h.ok(textOf(r).indexOf(want.said) < textOf(r).indexOf(want.summary), `v${want.meta[1]}: Whim’s summary follows the words`);
        h.eq([styleOf(textSaying(r, want.summary)).fontSize, styleOf(textSaying(r, want.summary)).color], [TYPE_SCALE.callout.size, COLORS.light['text-2']], `v${want.meta[1]}: the summary in callout, secondary`);
        const meta = textSaying(r, want.meta);
        h.ok((styleOf(meta).fontVariant as string[] | undefined)?.includes('tabular-nums') === true, `v${want.meta[1]}: “${want.meta}” in tabular figures`);
        const chip = chipIn(r, want.kind);
        h.eq(chip.findByType(Icon).props.name, want.icon, `v${want.meta[1]}: the ${want.kind} chip carries its icon`);
        chips.push({ fill: styleOf(chip).backgroundColor, label: styleOf(textSaying(chip, want.kind)).color });
        h.eq(textsSaying(r, 'Current').length, want.current ? 1 : 0, `v${want.meta[1]}: ${want.current ? '`Current` on the active version' : 'no `Current`'}`);
      }
      h.eq(chips, expected.map(() => ({ fill: COLORS.light.fill, label: COLORS.light['text-2'] })), 'every kind chip has the same neutral colours: only the icon and the word differ');
    });
  });

  await h.test('history screen: the rail runs from the newest version’s dot and stops at v1’s; one version draws none', async () => {
    const { access, app } = await fourKinds();
    await withHistory(access, app, async (tree) => {
      await waitFor(() => rows(tree).length === 4, 'the versions to load');
      const rail = railOf(tree, COLORS.light.separator);
      h.eq(rail.length, 4, 'a 2 pt separator segment beside each row');
      const [newest, ...rest] = rail.map(styleOf);
      const v1 = rest[rest.length - 1];
      h.ok(Number(newest.top) > 0 && newest.bottom === 0, 'the newest row’s segment starts at its dot and runs on down');
      h.ok(rest.slice(0, -1).every((s) => s.top === 0 && s.bottom === 0), 'the rows between carry it the whole way');
      h.ok(v1.top === 0 && v1.bottom === undefined && Number(v1.height) === Number(newest.top), 'v1’s comes down to its dot and stops there');
    });
    const loneAccess = new StoreAccess({ store: createMemoryStore({ autoCompact: false }), index: new AppIndex(new MapKVBackend()), now: () => Date.now() });
    const lone = await loneAccess.install({ id: 'lone', name: 'Lone', record: { appId: 'lone', name: 'Lone', manifest: { capabilities: [] } }, bundleSource: 'V1', prompt: envelope('one and only') });
    await withHistory(loneAccess, lone, async (tree) => {
      await waitFor(() => rows(tree).length === 1, 'the one version to load');
      h.eq(railOf(tree, COLORS.light.separator).length, 0, 'a single version has no rail');
    });
  });

  await h.test('history screen: no filters: every version is listed, and the only controls are Back, Report and the rows', async () => {
    const { access, app } = await fourKinds();
    await withHistory(access, app, async (tree) => {
      await waitFor(() => rows(tree).length === 4, 'the versions to load');
      const labels = pressables(tree).map((n) => n.props.accessibilityLabel ?? textOf(n));
      h.eq(labels.slice(0, 2), [COPY.backLabel, 'Report'], 'Back and Report');
      h.eq(labels.length, 2 + 4, 'and one row per version, nothing else');
      for (const word of ['All 4', 'What it does', 'Look', 'Fixes']) h.eq(textsSaying(tree.root, word).length, 0, `no “${word}” filter`);
    });
  });

  await h.test('history screen: at the largest text size every text stops at 200%, so the title and a two-word name break between words, never inside one (#186)', async () => {
    const { access, app } = await fourKinds();
    const named = { ...app, name: 'Water Counter' };
    windowMetrics.fontScale = 3.12;
    try {
      await withHistory(access, named, async (tree) => {
        await waitFor(() => rows(tree).length === 4, 'the versions to load');
        const texts = tree.root.findAll((n) => hostType(n) === 'Text' && textOf(n).trim().length > 0);
        h.eq(texts.filter((n) => !capped(n)).map(textOf), [], 'no text grows past 200%');
        // At 200% each word must fit the width it is given, on a 390 pt phone: the title the screen
        // inside its gutters, the name what the 40 pt tile beside it leaves.
        const inside = 390 - 2 * LAYOUT.gutter;
        h.ok(wordsFit(textSaying(tree.root, 'History'), 3.12, inside), '“History” fits on one line');
        h.ok(wordsFit(titleOf(tree, 'Water Counter'), 3.12, inside - TILE_SIDE.menu - SPACE[3]), '“Counter” fits beside the tile');
      });
    } finally {
      windowMetrics.fontScale = 1;
    }
  });

  await h.test('history screen: in dark mode it draws the dark roles, its name in the tint’s dark value', async () => {
    const { access, app } = await fourKinds();
    await TestRenderer.act(async () => setColorScheme('dark'));
    try {
      await withHistory(access, app, async (tree) => {
        await waitFor(() => rows(tree).length === 4, 'the versions to load');
        const [root] = tree.root.findAll((n) => hostType(n) === 'View');
        h.eq(styleOf(root).backgroundColor, COLORS.dark.bg, 'the canvas is the dark `bg`');
        h.eq(styleOf(textSaying(tree.root, 'History')).color, COLORS.dark.text, 'the title in the dark `text`');
        h.eq(styleOf(titleOf(tree, app.name)).color, TINTS[tileOf(app).tint].dark, 'the name in the tint’s dark value');
        const r = row(tree, 'add a chime');
        h.eq(styleOf(textSaying(r, '“add a chime”')).color, COLORS.dark.text, 'the words in the dark `text`');
        h.eq(styleOf(textSaying(r, 'Plays a chime at the end of every step.')).color, COLORS.dark['text-2'], 'the summary in the dark `text-2`');
        h.eq(styleOf(chipIn(r, 'Added')).backgroundColor, COLORS.dark.fill, 'the chip on the dark `fill`');
        h.eq(railOf(tree, COLORS.dark.separator).length, 4, 'the rail in the dark `separator`');
      });
    } finally {
      await TestRenderer.act(async () => setColorScheme('light'));
    }
  });

  await h.test('history screen: in dark mode, opened from Home or from a running app’s Whim sheet, its stack entry and the status bar follow the scheme', async () => {
    const never = () => new Promise<Response>(() => {});
    const statusBar = (tree: Tree) => tree.root.find((n) => hostType(n) === 'StatusBar').props.barStyle;
    const entry = (tree: Tree) => stackItems(tree).find((item) => item.props.screenId === 'history')?.props.contentStyle.backgroundColor;
    try {
      await withLauncher({ examples: true, server: never }, async ({ tree }) => {
        const home = () => tree.root.findByType(HomeScreen);
        const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
        await waitFor(() => showing(HomeScreen) && home().props.apps.length > 0, 'the example apps');
        await TestRenderer.act(async () => setColorScheme('dark'));
        const app: InstalledApp = home().props.apps[0];
        await TestRenderer.act(async () => home().props.onHistory(app));
        await waitFor(() => showing(HistoryScreen), 'its history, from Home');
        h.eq([entry(tree), statusBar(tree)], [COLORS.dark.bg, 'light-content'], 'from Home: the dark canvas, light status-bar content');
        await iosPop(tree);
        await tap(() => home().props.onOpen(app));
        await waitFor(() => showing(MiniAppView), `${app.name} to open`);
        await press(button(tree, COPY.orbMenuOpenLabel));
        await press(button(tree, COPY.actionHistory));
        await waitFor(() => showing(HistoryScreen), 'its history, from the Whim sheet');
        h.eq([entry(tree), statusBar(tree)], [COLORS.dark.bg, 'light-content'], 'from the Whim sheet: a host screen in the phone’s scheme, not the app’s frame');
      });
    } finally {
      await TestRenderer.act(async () => setColorScheme('light'));
    }
  });

  await h.test('history screen: Android back during History’s push from Home holds an app link until the pop has finished, not just the push (stack never unmounted mid-move)', async () => {
    const never = () => new Promise<Response>(() => {});
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      const home = () => tree.root.findByType(HomeScreen);
      const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
      await waitFor(() => showing(HomeScreen) && home().props.apps.length > 1, 'the example apps');
      const [first, second]: InstalledApp[] = home().props.apps;
      const midMove = stackUnmountsMidMove();
      await TestRenderer.act(async () => home().props.onHistory(first));
      await waitFor(() => showing(HistoryScreen), 'History, its push still running');
      await systemBack();
      h.ok(showing(HomeScreen) && !showing(HistoryScreen), 'Android back during the push asks for the pop to Home');
      await stackMoveEnds();
      await TestRenderer.act(async () => { openLink(appLinkFor(second.id)); });
      await settle();
      h.ok(!showing(MiniAppView), 'the push’s finish is not the pop’s: the link still waits');
      h.eq(stackUnmountsMidMove(), midMove, 'and the stack is not unmounted while the pop runs');
      await stackMoveEnds();
      await waitFor(() => showing(MiniAppView), 'the link to open once the pop finished');
      h.eq(tree.root.findByType(MiniAppView).props.installedApp.id, second.id, 'the linked app opens');
      h.eq(stackUnmountsMidMove(), midMove, 'with no stack unmounted mid-move');
    });
  });

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

  await h.test('history screen: after a build and an edit made through the app, within the same second, each row quotes the words that made it, newest first, with Whim’s summary under them', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const summary = (text: string, kind: 'Start' | 'Added') => ({ text, kind, touched: [], marks: [] });
    const FIRST_SUMMARY = 'Counts the glasses you drink';
    const EDIT_SUMMARY = 'You can now set your own daily water goal';
    const home = (tree: Tree) => tree.root.findByType(HomeScreen);
    const tracker = (tree: Tree): InstalledApp => home(tree).props.apps.find((a: InstalledApp) => a.name === 'Water Tracker');
    await withLauncher({ server: streamingServer(streams) }, async ({ tree }) => {
      await startBuild(tree, 'A water tracker');
      streams[0].push({ ...resultEvent('Water Tracker'), summary: summary(FIRST_SUMMARY, 'Start') });
      streams[0].end();
      await waitFor(() => tree.root.findAllByType(ReadyPage).length === 1, 'the first version');
      await press(button(tree, COPY.readyDone));
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
      await waitFor(() => rows(tree).length === 2, 'both versions on the timeline');
      const [edit, first] = rows(tree);
      h.ok(textOf(edit).startsWith('“Let me set my own daily goal”') && textOf(first).startsWith('“A water tracker”'), 'newest first: the edit never rewrites v1');
      h.eq([edit, first].map((r) => styleOf(textSaying(r, textOf(r).slice(0, textOf(r).indexOf('”') + 1))).fontStyle), ['italic', 'italic'], 'each row leads with the user’s own words, quoted, in the italic that marks them as theirs');
      h.ok(textOf(edit).includes(EDIT_SUMMARY) && textOf(first).includes(FIRST_SUMMARY), 'each with what Whim did for it, without opening it');
      h.ok(!textOf(edit).includes(FIRST_SUMMARY) && !textOf(first).includes(EDIT_SUMMARY), 'and only its own');
      h.eq([textsSaying(edit, 'Current').length, chipIn(first, 'Start') !== undefined], [1, true], 'the edit is current; the build it began with is the Start');
      await press(row(tree, 'Let me set my own daily goal'));
      h.eq(rows(tree).map((r) => r.props.accessibilityState.expanded), [true, false], 'tapping the edit’s row opens it alone');
    });
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
