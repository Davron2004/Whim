/** The rendered History screen over a real version store: a header with Back and Report over the
 *  title, the app's tile, its name and how many versions it has; one timeline row per version, the
 *  person's words first, with Whim's summary, the version and when, a neutral kind chip and
 *  `Current`, on a rail that stops at v1; no filters; the phone's scheme and a text size capped at
 *  200%. The first load is a loading state, not an empty list; a row expands without changing the
 *  version; Use this version and Make a copy from here act at once on that row's own version, once
 *  however often they are tapped, with no confirm sheet: Undo in the toast and on the row after it,
 *  "Copy made · Open", the copy question, the hidden-data line, and a copy's own data. Home's sheet
 *  and a running app's orb reach it, and leaving returns there. */
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { Harness } from './harness';
import { addedFieldsLine, COPY } from '../copy';
import HistoryScreen, { type HistoryScreenProps } from '../HistoryScreen';
import HomeScreen from '../HomeScreen';
import SettingsScreen from '../SettingsScreen';
import { AppIndex, type InstalledApp } from '../app-index';
import { StoreAccess, storeIdOf, type ActiveLaunch } from '../store-access';
import { createMemoryStore, MapKVBackend, VersionStore } from '../../version-store';
import { DescribePage } from '../DescribePage';
import ReadyPage from '../ReadyPage';
import MiniAppView from '../MiniAppView';
import { tileOf } from '../tile-identity';
import { TilePlate } from '../../ui/AppTile';
import { TILE_SIDE } from '../../ui/AppTile-geometry';
import { Icon } from '../../ui/Icon';
import { ToastHost, useToast } from '../../ui/Toast';
import { VersionSwitches } from '../version-switches';
import { COLORS, LAYOUT, SPACE, TINTS, TYPE_SCALE } from '../../../design/tokens';
import type { SchemaArtifact } from '../../storage-engine/contract';
import { appLinkFor } from '../app-link';
import { contrastRatio } from '../../../design/tints';
import { APP_BUNDLES } from '../../../runtime/generated/app-bundles';
import { APP_RECORDS } from '../../../runtime/generated/app-records';
import { accessibilitySettings, Alert, emitAccessibility, focusedCells, hardwareBack, openLink, setColorScheme, StyleSheet, windowMetrics } from './native-host';
import { iosPop, stackItems, stackMoveEnds, stackUnmountsMidMove } from './native-screens';
import { elapse, holdAnimations, layoutAnimations, layoutCommits, playedUnder, viewTagOf, type LayoutAnimation } from './native-reanimated';
import { springConfig, springReachMs, timingOf } from '../../ui/tokens-pure';
import { androidBack, button, captureTimeouts, press, renderScreen, textOf, unmountScreen, hostType } from './react-screen';
import { chooseRow, dismissToast, longPress, pressToastAction, renderHome, sheetRows, tile, toastOf } from './home-rig';
import { accessOver, disposeDeviceState, installApp, newDeviceState, withEngine } from './data-copy-rig';
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

/** A real store holding three versions of a log app whose newest, "add notes", adds a field. */
async function loggedVersions() {
  const record = (fields: SchemaArtifact['collections'][string]['fields']) =>
    ({ appId: 'log', name: 'Log', manifest: { capabilities: ['storage'] }, schemaArtifact: { schemaVersion: 1 as const, collections: { Entries: { id: 'c1', fields, tombstones: [] } } } });
  const amount = { amount: { id: 'f1', type: 'int' as const } };
  const store = createMemoryStore({ autoCompact: false });
  const access = new StoreAccess({ store, index: new AppIndex(new MapKVBackend()), now: () => Date.now() });
  const app = await access.update(
    await access.install({ id: 'log', name: 'Log', record: record(amount), bundleSource: 'V1', prompt: envelope('a spending log') }),
    { record: record(amount), bundleSource: 'V2', prompt: envelope('bigger numbers') },
  );
  await access.update(app, { record: record({ ...amount, notes: { id: 'f2', type: 'text', default: '' } }), bundleSource: 'V3', prompt: envelope('add notes') });
  return { access, app };
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

/** What a test sets of History's props; the rest are no-ops, and a copy is the store's own. */
type HistoryOver = Partial<Pick<HistoryScreenProps, 'onBack' | 'onReport' | 'canCopyData' | 'onFork' | 'onOpen'>>;

/** History with the shell's version switches (`VersionSwitches`) over that toast host, as `LauncherRoot`
 *  wires them: a switch or an Undo that lands has History read its rows again. */
function SwitchingHistory({ access, app, over }: Readonly<{ access: StoreAccess; app: InstalledApp; over: HistoryOver }>) {
  const toast = useToast();
  const [moved, setMoved] = React.useState(0);
  const [switches] = React.useState(() => new VersionSwitches({ access, toast: () => toast, moved: () => setMoved((n) => n + 1), busyWith: () => undefined }));
  return (
    <HistoryScreen app={app} access={access} onBack={noop} onChangeIt={noop} onReport={noop} onFork={(a, v, o) => access.fork(a, v, o)} onOpen={noop} onUseVersion={switches.use} versionsMoved={moved} {...over} />
  );
}

/** History under the shell's one toast host, as `LauncherRoot` mounts it. */
const historyScreen = (access: StoreAccess, app: InstalledApp, over: HistoryOver = {}) => (
  <ToastHost>
    <SwitchingHistory access={access} app={app} over={over} />
  </ToastHost>
);

async function withHistory(access: StoreAccess, app: InstalledApp, body: (tree: Tree) => Promise<void>, over: HistoryOver = {}): Promise<void> {
  const tree = await renderScreen(historyScreen(access, app, over));
  try { await body(tree); } finally { await unmountScreen(tree); }
}

async function reloadHistory(tree: Tree, access: StoreAccess, app: InstalledApp, over: HistoryOver = {}): Promise<void> {
  await TestRenderer.act(async () => { tree.update(historyScreen(access, app, over)); });
}

async function rejectInAct<T>(pending: Held<T>, message: string): Promise<void> {
  await TestRenderer.act(async () => { pending.reject(new Error(message)); });
}

async function waitForReassuranceToClear(tree: Tree): Promise<void> {
  await waitFor(() => !hasPendingReassurance(tree), 'the failed hidden-data read to clear');
}

/** Opens the closed row saying `words`, waits for its hidden-data line to be worked out, and says
 *  how many times the line shows. */
async function openRowAndReadLine(tree: Tree, words: string): Promise<number> {
  await press(row(tree, words));
  await waitFor(() => !hasPendingReassurance(tree), `${words}: the line to be worked out`);
  return textsSaying(tree.root, COPY.historyHiddenData).length;
}

/** The copy question's row whose label starts with `answer` (or is the sheet's close control). */
const questionRow = (tree: Tree, answer: string) =>
  sheetRows(tree, COPY.copyQuestionTitle).find((r) => String(r.props.accessibilityLabel).startsWith(answer));

/** The titles in `appId`'s Notes, read through the real engine. */
const notesIn = (state: ReturnType<typeof newDeviceState>, appId: string, schema: SchemaArtifact) =>
  withEngine(state, appId, schema, (engine) => engine.records.list('Notes').map((r) => r.title));

/** Opens the closed row saying `words` and presses its action `label`. */
async function openAndPress(tree: Tree, words: string, label: string): Promise<void> {
  await press(row(tree, words));
  await press(button(tree, label));
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

/** The texts saying `words` with no text inside them: the runs a renderer actually draws. */
const innermostTexts = (tree: Tree, words: string) =>
  tree.root.findAll((n) => hostType(n) === 'Text' && textOf(n).includes(words) && !n.findAll(isInnerText(n)).length);
const isInnerText = (outer: Node) => (m: Node) => m !== outer && hostType(m) === 'Text';

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
  return { access, app, store };
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
    const tree = await renderScreen(historyScreen(access, app, { onBack: () => left.push('back'), onReport: () => left.push('report') }));
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

  await h.test('history screen: an opened older version holds the hidden-data line’s place while it is worked out, and a failed read clears it without inventing the line', async () => {
    const { access, app } = await threeVersions();
    const diff = held<Awaited<ReturnType<StoreAccess['diff']>>>();
    access.diff = async () => diff.promise;
    await withHistory(access, app, async (tree) => {
      await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
      await press(row(tree, 'add a chime'));
      h.ok(hasPendingReassurance(tree), 'opening the row holds the line’s place, before either action');
      await rejectInAct(diff, 'diff is unavailable');
      await waitForReassuranceToClear(tree);
      h.ok(!textOf(tree.root).includes(COPY.historyHiddenData), 'a failed read does not invent the line');
    });
  });

  await h.test('history screen: an opened version that would hide saved data says so before either action; one that hides nothing, and the current one, say nothing', async () => {
    const record = (fields: SchemaArtifact['collections'][string]['fields']) =>
      ({ appId: 'log', name: 'Log', manifest: { capabilities: ['storage'] }, schemaArtifact: { schemaVersion: 1 as const, collections: { Entries: { id: 'c1', fields, tombstones: [] } } } });
    const amount = { amount: { id: 'f1', type: 'int' as const } };
    const store = createMemoryStore({ autoCompact: false });
    const access = new StoreAccess({ store, index: new AppIndex(new MapKVBackend()), now: () => Date.now() });
    const app = await access.update(
      await access.install({ id: 'log', name: 'Log', record: record(amount), bundleSource: 'V1', prompt: envelope('a spending log') }),
      { record: record(amount), bundleSource: 'V2', prompt: envelope('bigger numbers') },
    );
    await access.update(app, { record: record({ ...amount, notes: { id: 'f2', type: 'text', default: '' } }), bundleSource: 'V3', prompt: envelope('add notes') });
    await withHistory(access, app, async (tree) => {
      await waitFor(() => rows(tree).length === 3, 'the versions to load');
      h.eq(await openRowAndReadLine(tree, 'bigger numbers'), 1, 'v2 has no notes: going there hides them, and the open row says so');
      const line = textSaying(tree.root, COPY.historyHiddenData);
      h.ok(textOf(tree.root).indexOf(COPY.historyHiddenData) < textOf(tree.root).indexOf(COPY.historyUseVersion), 'above the actions, read before the tap');
      h.eq([styleOf(line).fontSize, styleOf(line).color], [TYPE_SCALE.footnote.size, COLORS.light['text-2']], 'in footnote, secondary');
      h.eq(await openRowAndReadLine(tree, 'add notes'), 0, 'the current version says nothing');
      await TestRenderer.act(async () => { await access.rollback(app, (await access.timeline(app))[1].id); });
      await reloadHistory(tree, access, { ...app });
      await waitFor(() => textsSaying(row(tree, 'bigger numbers'), 'Current').length === 1, 'v2 to be current');
      h.eq(await openRowAndReadLine(tree, 'a spending log'), 0, 'from v2, v1 has every field v2 has: nothing is hidden, nothing is said');
    });
  });

  await h.test('history screen: an opened row keeps its words where they were, and its added-fields line reads at least as clearly as secondary text, in light and dark', async () => {
    const record = (fields: SchemaArtifact['collections'][string]['fields']) =>
      ({ appId: 'log', name: 'Log', manifest: { capabilities: ['storage'] }, schemaArtifact: { schemaVersion: 1 as const, collections: { Entries: { id: 'c1', fields, tombstones: [] } } } });
    const amount = { amount: { id: 'f1', type: 'int' as const } };
    const store = createMemoryStore({ autoCompact: false });
    const access = new StoreAccess({ store, index: new AppIndex(new MapKVBackend()), now: () => Date.now() });
    const app = await access.install({ id: 'log', name: 'Log', record: record(amount), bundleSource: 'V1', prompt: envelope('a spending log') });
    await access.update(app, { record: record({ ...amount, notes: { id: 'f2', type: 'text', default: '' } }), bundleSource: 'V2', prompt: envelope('add notes') });
    const words = (tree: Tree) => textSaying(row(tree, 'add notes'), '“add notes”');
    /** Where the words sit: every margin and padding between them and the screen's top-left corner. */
    const place = (n: Node) => {
      let left = 0;
      let top = 0;
      for (let at: Node | null = n; at; at = at.parent) {
        const s = typeof at.type === 'string' ? (styleOf(at) ?? {}) : {};
        left += Number(s.marginLeft ?? s.marginHorizontal ?? s.margin ?? 0) + Number(s.paddingLeft ?? s.paddingHorizontal ?? s.padding ?? 0);
        top += Number(s.marginTop ?? s.marginVertical ?? s.margin ?? 0) + Number(s.paddingTop ?? s.paddingVertical ?? s.padding ?? 0);
      }
      return { left, top };
    };
    /** The colour a text is drawn in: its own, else the nearest text around it that sets one. */
    const drawnIn = (n: Node) => {
      for (let at: Node | null = n; at; at = at.parent) {
        if (hostType(at) === 'Text' && styleOf(at)?.color !== undefined) return String(styleOf(at).color);
      }
      throw new Error('no colour');
    };
    try {
      for (const scheme of ['light', 'dark'] as const) {
        await TestRenderer.act(async () => setColorScheme(scheme));
        await withHistory(access, app, async (tree) => {
          await waitFor(() => rows(tree).length === 2, 'the versions to load');
          const closed = place(words(tree));
          await press(row(tree, 'add notes'));
          await waitFor(() => textOf(tree.root).includes('Added: notes (text)'), 'the added-fields line');
          h.eq(place(words(tree)), closed, `${scheme}: opening the row moves its words neither across nor down`);
          const leaves = innermostTexts(tree, 'notes (text)');
          const floor = contrastRatio(COLORS[scheme]['text-2'], COLORS[scheme].surface);
          h.ok(leaves.length > 0 && leaves.every((n) => contrastRatio(drawnIn(n), COLORS[scheme].surface) >= floor),
            `${scheme}: every part of “Added: notes (text)” stands off the card at least as much as secondary text (${leaves.map((n) => drawnIn(n)).join(', ')})`);
        });
      }
    } finally {
      await TestRenderer.act(async () => setColorScheme('light'));
    }
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

  await h.test('history screen: tapping a row only expands it; Use this version makes that version current at once, with no sheet, once for two taps, and says “Back on version 2” with Undo', async () => {
    const { access, app, middle } = await threeVersions();
    const rollbacks: string[] = [];
    const finish = held<void>();
    const rollback = access.rollback.bind(access);
    access.rollback = async (entry, id) => { rollbacks.push(id); await finish.promise; return rollback(entry, id); };
    await withHistory(access, app, async (tree) => {
      await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
      await press(row(tree, 'add a chime'));
      h.eq(rollbacks, [], 'expanding a row changes nothing');
      h.eq(['make it louder', 'add a chime', 'a tea timer'].map((w) => textsSaying(row(tree, w), 'Current').length), [1, 0, 0], 'setup: v3 is current');
      // Two taps inside one frame both see the same button: only the handler’s own guard can refuse the second.
      await TestRenderer.act(async () => { const use = button(tree, COPY.historyUseVersion); use.props.onPress(); use.props.onPress(); });
      h.eq(rollbacks, [middle.id], 'the first tap uses that row’s own version, at once; the second runs nothing');
      h.eq(sheetsOpen(tree), 0, 'no sheet asks first');
      h.ok(textOf(tree.root).includes(COPY.historyUseVersionBusy), 'the action shows its busy words while it runs');
      await press(button(tree, COPY.historyUseVersionBusy));
      h.eq(rollbacks, [middle.id], 'and ignores a tap meanwhile');
      await TestRenderer.act(async () => { finish.resolve(); });
      await waitFor(() => toastOf(tree) !== null, 'the toast');
      h.eq(toastOf(tree), { message: 'Back on version 2', action: COPY.toastUndo }, '“Back on version 2 · Undo”');
      h.eq(await access.activeId(app), middle.id, 'the app now runs that version');
      await waitFor(() => textsSaying(row(tree, 'add a chime'), 'Current').length === 1, 'the rows to follow');
      h.eq(['make it louder', 'add a chime', 'a tea timer'].map((w) => textsSaying(row(tree, w), 'Current').length), [0, 1, 0], 'and the list says so, every version still listed');
      h.eq(rows(tree).map((r) => r.props.accessibilityState.expanded), [false, true, false], 'the row stays open');
    });
  });

  await h.test('history screen: Undo in the toast goes back to the version that was current, and both stay listed (scenario: using version 3 of 4, then Undo)', async () => {
    const { access, app } = await fourKinds();
    const [v4, v3] = await access.timeline(app);
    await withHistory(access, app, async (tree) => {
      await waitFor(() => rows(tree).length === 4, 'the versions to load');
      await openAndPress(tree, 'let me pick V60 or Chemex', COPY.historyUseVersion);
      await waitFor(() => toastOf(tree) !== null, 'the toast');
      h.eq(await access.activeId(app), v3.id, 'version 3 is in use');
      await pressToastAction(tree);
      await waitFor(() => textsSaying(row(tree, 'the countdown stops early'), 'Current').length === 1, 'version 4 to be current again');
      h.eq(await access.activeId(app), v4.id, 'Undo returned the app to version 4');
      h.eq(rows(tree).length, 4, 'and every version, 3 and 4 among them, is still listed');
      h.eq(await access.activeBundle(app), 'V4', 'running version 4’s own code');
    });
  });

  await h.test('history screen: once the toast has gone, the same Undo is a row away: the version left behind is listed with Use this version, and using it comes back', async () => {
    const { access, app } = await fourKinds();
    const [v4] = await access.timeline(app);
    await withHistory(access, app, async (tree) => {
      await waitFor(() => rows(tree).length === 4, 'the versions to load');
      await openAndPress(tree, 'add a chime', COPY.historyUseVersion);
      await waitFor(() => toastOf(tree) !== null, 'the toast');
      await dismissToast(tree);
      await waitFor(() => toastOf(tree) === null, 'the toast to go');
      await openAndPress(tree, 'the countdown stops early', COPY.historyUseVersion);
      await waitFor(() => textsSaying(row(tree, 'the countdown stops early'), 'Current').length === 1, 'version 4 to be current again');
      h.eq(await access.activeId(app), v4.id, 'the newer version is used again from its row');
      h.eq(toastOf(tree)?.message, 'Now on version 4', 'with its own toast, saying the app moved forward, not back');
      await openAndPress(tree, 'let me pick V60 or Chemex', COPY.historyUseVersion);
      await waitFor(() => toastOf(tree)?.message !== 'Now on version 4', 'the next toast');
      h.eq(toastOf(tree)?.message, 'Back on version 3', 'and back again, back');
    });
  });

  await h.test('history screen: an Undo tapped while a copy is being made is not lost: it goes back once the copy is made', async () => {
    const { access, app, store } = await fourKinds();
    const [v4, v3] = await access.timeline(app);
    const finish = held<void>();
    const fork = store.fork.bind(store);
    store.fork = async (appId, snapshotId) => { await finish.promise; return fork(appId, snapshotId); };
    await withHistory(access, app, async (tree) => {
      await waitFor(() => rows(tree).length === 4, 'the versions to load');
      await openAndPress(tree, 'let me pick V60 or Chemex', COPY.historyUseVersion);
      await waitFor(() => toastOf(tree)?.action === COPY.toastUndo, 'the toast with Undo');
      await openAndPress(tree, 'add a chime', COPY.historyMakeCopyHere);
      h.ok(textOf(tree.root).includes(COPY.historyMakeCopyBusy), 'setup: the copy is being made');
      await pressToastAction(tree);
      await settle();
      h.eq((await store.active(storeIdOf(app)))?.id, v3.id, 'while the copy runs, the app stays where it is');
      await TestRenderer.act(async () => { finish.resolve(); });
      await waitFor(() => textsSaying(row(tree, 'the countdown stops early'), 'Current').length === 1, 'the Undo to land');
      h.eq(await access.activeId(app), v4.id, 'then the Undo goes back to version 4');
      h.ok((await access.timeline(app)).some((v) => v.id === v3.id), 'and version 3 stays listed');
    });
  });

  await h.test('history screen: an Undo from an earlier toast tapped while a newer switch runs is dropped, so the app ends where the newest toast says', async () => {
    const { access, app } = await fourKinds();
    const [, , v2] = await access.timeline(app);
    await withHistory(access, app, async (tree) => {
      await waitFor(() => rows(tree).length === 4, 'the versions to load');
      await openAndPress(tree, 'let me pick V60 or Chemex', COPY.historyUseVersion);
      await waitFor(() => toastOf(tree)?.message === 'Back on version 3', 'the first switch’s toast, with Undo');
      const second = held<void>();
      const rollback = access.rollback.bind(access);
      access.rollback = async (entry, id) => { access.rollback = rollback; await second.promise; return rollback(entry, id); };
      await openAndPress(tree, 'add a chime', COPY.historyUseVersion);
      h.ok(textOf(tree.root).includes(COPY.historyUseVersionBusy), 'setup: the second switch runs');
      await pressToastAction(tree); // the first toast's Undo, still on screen
      await TestRenderer.act(async () => { second.resolve(); });
      await waitFor(() => toastOf(tree)?.message === 'Back on version 2', 'the second switch’s toast');
      await settle();
      h.eq(await access.activeId(app), v2.id, 'the app is on version 2');
      h.eq(toastOf(tree)?.message, 'Back on version 2', 'as the toast showing says');
      h.ok(textsSaying(row(tree, 'add a chime'), 'Current').length === 1, 'and the list says so');
    });
  });

  await h.test('history screen: an Undo from an earlier toast tapped while a newer switch runs is kept when that switch fails, so the app goes back as the Undo said', async () => {
    const { access, app } = await fourKinds();
    const before = await access.activeId(app);
    await withHistory(access, app, async (tree) => {
      await waitFor(() => rows(tree).length === 4, 'the versions to load');
      await openAndPress(tree, 'let me pick V60 or Chemex', COPY.historyUseVersion);
      await waitFor(() => toastOf(tree)?.message === 'Back on version 3', 'the first switch’s toast, with Undo');
      const second = held<void>();
      const rollback = access.rollback.bind(access);
      access.rollback = async () => { access.rollback = rollback; await second.promise; throw new Error('the store is unwritable'); };
      await openAndPress(tree, 'add a chime', COPY.historyUseVersion);
      h.ok(textOf(tree.root).includes(COPY.historyUseVersionBusy), 'setup: the second switch runs');
      await pressToastAction(tree); // the first toast's Undo, still on screen
      await TestRenderer.act(async () => { second.resolve(); });
      await waitFor(() => toastOf(tree)?.message === COPY.historyUseVersionFailed, 'the second switch’s failure to be said');
      await waitFor(() => textsSaying(row(tree, 'the countdown stops early'), 'Current').length === 1, 'the Undo to land');
      h.eq(await access.activeId(app), before, 'the Undo ran: the app is back on the version that was current');
    });
  });

  await h.test('history screen: the first version can be used too, and a failed switch says so and keeps the version that was current', async () => {
    const { access, app, current } = await threeVersions();
    await withHistory(access, app, async (tree) => {
      await waitFor(() => hasRow(tree, 'a tea timer'), 'the versions to load');
      await openAndPress(tree, 'a tea timer', COPY.historyUseVersion);
      await waitFor(() => toastOf(tree) !== null, 'the toast');
      h.eq(toastOf(tree)?.message, 'Back on version 1', 'v1 is a version like any other');
      h.eq(await access.activeBundle(app), 'V1', 'running its code');
      await pressToastAction(tree);
      await waitFor(() => textsSaying(row(tree, 'make it louder'), 'Current').length === 1, 'Undo to land');
      access.rollback = async () => { throw new Error('the store is unwritable'); };
      await openAndPress(tree, 'add a chime', COPY.historyUseVersion);
      await waitFor(() => toastOf(tree)?.message === COPY.historyUseVersionFailed, 'the failure to be said');
      h.eq(await access.activeId(app), current.id, 'the version that was current is still in use');
      h.ok(textOf(row(tree, 'make it louder')).includes('Current') && textOf(tree.root).includes(COPY.historyUseVersion), 'the list still says so, and the action can be tried again');
    });
  });

  await h.test('history screen: a text size changed while it shows builds its title and rows again, and History keeps what it holds — the open row and the question it is asking', async () => {
    const { access, app } = await threeVersions();
    const over = { canCopyData: true };
    await withHistory(access, app, async (tree) => {
      try {
        await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
        await openAndPress(tree, 'add a chime', COPY.historyMakeCopyHere);
        const asking = () => sheetRows(tree, COPY.copyQuestionTitle).length > 0;
        h.ok(asking(), 'setup: History is asking whether to copy the data');
        const title = () => titleOf(tree, app.name);
        const built = { title: title(), row: row(tree, 'add a chime') };
        await reloadHistory(tree, access, app, over);
        h.ok(title() === built.title && row(tree, 'add a chime') === built.row, 'setup: a render at the same text size keeps what is drawn');
        windowMetrics.fontScale = 2;
        await reloadHistory(tree, access, app, over);
        h.ok(title() !== built.title && row(tree, 'add a chime') !== built.row, 'the size changed: the title and the rows are built again, so iOS measures every text at the new size');
        h.ok(button(tree, COPY.historyMakeCopyHere) !== undefined, 'the row that was open is still open');
        h.ok(asking(), 'and the question is still open');
        const rebuilt = title();
        await reloadHistory(tree, access, app, over);
        h.ok(title() === rebuilt, 'built again once per size, not on every render');
      } finally {
        windowMetrics.fontScale = 1;
      }
    }, over);
  });

  await h.test('history screen: Make a copy from here asks “Copy the data, or start fresh?”, then copies that row’s version once however often it is tapped, says “Copy made” with Open, and Open opens the copy', async () => {
    const { access, app, middle } = await threeVersions();
    const forks: unknown[][] = [];
    const finish = held<void>();
    const opened: InstalledApp[] = [];
    const onFork: HistoryScreenProps['onFork'] = async (entry, id, opts) => { forks.push([entry.id, id, opts]); await finish.promise; return access.fork(entry, id, opts); };
    await withHistory(access, app, async (tree) => {
      await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
      await openAndPress(tree, 'add a chime', COPY.historyMakeCopyHere);
      h.eq(forks, [], 'the copy question comes first: nothing is made yet');
      h.ok(questionRow(tree, COPY.copyQuestionData) !== undefined && questionRow(tree, COPY.copyQuestionFresh) !== undefined, 'Home’s question, with its two answers');
      const close = questionRow(tree, COPY.sheetClose)!;
      await TestRenderer.act(async () => close.props.onPress());
      await waitFor(() => sheetsOpen(tree) === 0, 'the question to close');
      h.eq(forks, [], 'leaving the question makes nothing');
      await press(button(tree, COPY.historyMakeCopyHere));
      const fresh = questionRow(tree, COPY.copyQuestionFresh)!;
      // Two taps inside one frame: only the handler’s own guard can refuse the second.
      await TestRenderer.act(async () => { fresh.props.onPress(); fresh.props.onPress(); });
      h.ok(textOf(tree.root).includes(COPY.historyMakeCopyBusy), 'the action shows its busy words while the copy is made');
      await press(button(tree, COPY.historyMakeCopyBusy));
      h.eq(sheetsOpen(tree), 0, 'and a tap meanwhile neither asks again nor copies');
      await TestRenderer.act(async () => { finish.resolve(); });
      await waitFor(() => toastOf(tree) !== null, 'the copy to be made');
      h.eq(forks, [[app.id, middle.id, { data: 'fresh' }]], 'one copy, of that row’s version, starting fresh');
      h.eq(toastOf(tree), { message: COPY.copyMadeToast, action: COPY.actionOpen }, '“Copy made · Open”');
      await pressToastAction(tree);
      h.eq(opened.length, 1, 'Open opens one app');
      h.ok(opened[0].id !== app.id && opened[0].forkedFrom?.id === app.id, 'the copy, not the original');
      h.eq(await access.activeBundle(opened[0]), 'V2', 'which runs the copied version’s code');
      h.eq(await access.activeId(app), (await access.timeline(app))[0].id, 'and the original is still on its own current version');
      h.eq(await access.activeBundle(app), 'V3', 'running its own code');
    }, { canCopyData: true, onFork, onOpen: (a) => { opened.push(a); } });
  });

  await h.test('history screen: the copy question takes one answer: a second tap on it, after the first copy is already made, makes no second copy', async () => {
    const { access, app } = await threeVersions();
    const forks: string[] = [];
    const onFork: HistoryScreenProps['onFork'] = async (entry, id, opts) => { forks.push(id); return access.fork(entry, id, opts); };
    await withHistory(access, app, async (tree) => {
      await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
      // The question has come up in full (a tap needs it on screen); from the first answer on, its
      // way out is held.
      await openAndPress(tree, 'add a chime', COPY.historyMakeCopyHere);
      const release = holdAnimations();
      try {
        const fresh = questionRow(tree, COPY.copyQuestionFresh)!;
        await TestRenderer.act(async () => { fresh.props.onPress(); });
        await waitFor(() => toastOf(tree)?.message === COPY.copyMadeToast, 'the first copy to be made');
        h.ok(questionRow(tree, COPY.copyQuestionFresh) !== undefined, 'setup: the question is still on screen, sliding away');
        // The second tap of a quick double tap, landing on the answer the sheet still shows.
        await TestRenderer.act(async () => { questionRow(tree, COPY.copyQuestionFresh)!.props.onPress(); });
        await settle();
        h.eq(forks.length, 1, 'one copy');
      } finally {
        release();
      }
    }, { canCopyData: true, onFork });
  });

  await h.test('history screen: without the data copy, Make a copy from here makes a fresh copy at once, with no question; a failed copy says so and makes nothing', async () => {
    const { access, app, middle } = await threeVersions();
    const forks: unknown[][] = [];
    let fail = false;
    const onFork: HistoryScreenProps['onFork'] = async (entry, id, opts) => {
      forks.push([id, opts]);
      if (fail) throw new Error('no room left');
      return access.fork(entry, id, opts);
    };
    await withHistory(access, app, async (tree) => {
      await waitFor(() => hasRow(tree, 'add a chime'), 'the versions to load');
      await openAndPress(tree, 'add a chime', COPY.historyMakeCopyHere);
      await waitFor(() => toastOf(tree) !== null, 'the copy to be made');
      h.eq([sheetsOpen(tree), forks], [0, [[middle.id, { data: 'fresh' }]]], 'no question: a fresh copy of that version');
      h.eq(toastOf(tree)?.message, COPY.copyMadeToast, 'and “Copy made”');
      fail = true;
      await press(button(tree, COPY.historyMakeCopyHere));
      await waitFor(() => toastOf(tree)?.message === COPY.copyFailedToast, 'the failure to be said');
      h.ok(textOf(tree.root).includes(COPY.historyMakeCopyHere), 'and the action can be tried again');
    }, { onFork });
  });

  await h.test('history screen: a copy made from History with “Copy the data” has its own storage, separate from the original’s: writes to either never show in the other', async () => {
    const SCHEMA: SchemaArtifact = { schemaVersion: 1, collections: { Notes: { id: 'c1', tombstones: [], fields: { title: { id: 'f1', type: 'text' } } } } };
    const state = newDeviceState();
    try {
      const { access } = accessOver(state);
      const orig = await installApp(access, 'notes', SCHEMA, 'V1');
      await access.update(orig, { record: orig.record, bundleSource: 'V2', prompt: envelope('bigger titles') });
      withEngine(state, access.engineAppId(orig), SCHEMA, (engine) => { engine.records.append('Notes', { title: 'written before the copy' }); });
      const opened: InstalledApp[] = [];
      await withHistory(access, orig, async (tree) => {
        await waitFor(() => rows(tree).length === 2, 'the versions to load');
        await openAndPress(tree, 'notes V1', COPY.historyMakeCopyHere);
        const data = questionRow(tree, COPY.copyQuestionData)!;
        await TestRenderer.act(async () => { data.props.onPress(); });
        await waitFor(() => toastOf(tree) !== null, 'the copy to be made');
        await pressToastAction(tree);
      }, { canCopyData: true, onOpen: (a) => { opened.push(a); } });
      const [copy] = opened;
      h.ok(copy !== undefined && copy.id !== orig.id, 'the copy was made and opened');
      h.ok(access.engineAppId(copy) !== access.engineAppId(orig), 'it has its own storage-engine appId, never the original’s');
      const titles = (appId: string) => notesIn(state, appId, SCHEMA);
      h.eq(titles(access.engineAppId(copy)), ['written before the copy'], 'it starts with a copy of the data');
      withEngine(state, access.engineAppId(copy), SCHEMA, (engine) => { engine.records.append('Notes', { title: 'only in the copy' }); });
      withEngine(state, access.engineAppId(orig), SCHEMA, (engine) => { engine.records.append('Notes', { title: 'only in the original' }); });
      h.eq(titles(access.engineAppId(orig)), ['written before the copy', 'only in the original'], 'the original never sees the copy’s writes');
      h.eq(titles(access.engineAppId(copy)), ['written before the copy', 'only in the copy'], 'and the copy never sees the original’s');
      h.eq(await access.activeBundle(copy), 'V1', 'the copy runs the version it was made from');
      h.eq(await access.activeBundle(orig), 'V2', 'and the original is unchanged');
    } finally {
      disposeDeviceState(state);
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

  await h.test('history screen: on a phone that turned highlighting off before the switch was removed, the stored switch is deleted at launch and Whim’s summary is marked anyway', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const SUMMARY = 'Counts 8 glasses a day';
    await withLauncher({
      server: streamingServer(streams),
      prepare: (kv) => {
        kv.set('retired-keys-sweep', '1');
        kv.set('highlighting', '0');
      },
    }, async ({ tree, kv }) => {
      h.eq(kv.getString('highlighting'), undefined, 'the stored switch is gone once Whim has launched');
      await startBuild(tree, 'A water tracker');
      streams[0].push({ ...resultEvent('Water Tracker'), summary: { text: SUMMARY, kind: 'Start', touched: [], marks: [] } });
      streams[0].end();
      await waitFor(() => tree.root.findAllByType(ReadyPage).length === 1, 'the app');
      await press(button(tree, COPY.readyDone));
      const home = tree.root.findByType(HomeScreen);
      const tracker = home.props.apps.find((a: InstalledApp) => a.name === 'Water Tracker');
      await TestRenderer.act(async () => home.props.onHistory(tracker));
      await waitFor(() => rows(tree).length === 1, 'its version on the timeline');
      const count = innermostTexts(tree, '8').filter((n) => textOf(n) === '8');
      h.eq(count.map((n) => styleOf(n).fontVariant), [['tabular-nums']], 'the count in the summary is marked, in tabular figures');
    });
  });

  await h.test('history screen: a seeded example changed with the same data shape raises no hidden-data line and no added fields; a change that adds a collection does', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const record = APP_RECORDS['water-counter'];
    const seeded = record.schemaArtifact!;
    const withNotes: SchemaArtifact = { ...seeded, collections: { ...seeded.collections, Notes: { id: 'c2', tombstones: [], fields: { body: { id: 'f2', type: 'text' } } } } };
    const home = (tree: Tree) => tree.root.findByType(HomeScreen);
    const counter = (tree: Tree): InstalledApp => home(tree).props.apps.find((a: InstalledApp) => a.name === record.name);
    /** Changes the Water Counter example through the real flow; the server answers with its own build and `schema`. */
    const change = async (tree: Tree, words: string, schema: SchemaArtifact) => {
      await TestRenderer.act(async () => home(tree).props.onPromptAgain(counter(tree)));
      await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText(words));
      await tap(() => tree.root.findByType(DescribePage).props.onContinue());
      await waitFor(() => planLoaded(tree), `the plan for “${words}”`);
      const before = streams.length;
      await buildIt(tree);
      await waitFor(() => streams.length === before + 1, `the generation of “${words}”`);
      streams[before].push({ type: 'result', app: { name: record.name, source: 'export default {}', bundle: APP_BUNDLES['water-counter'], manifest: record.manifest, schema } });
      streams[before].end();
      await waitFor(() => tree.root.findAllByType(ReadyPage).length === 1, `“${words}” to land`);
      await press(button(tree, COPY.readyDone));
    };
    const openHistory = async (tree: Tree, count: number) => {
      await TestRenderer.act(async () => home(tree).props.onHistory(counter(tree)));
      await waitFor(() => rows(tree).length === count, `${count} versions`);
    };
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree }) => {
      await waitFor(() => tree.root.findAllByType(HomeScreen).length === 1 && counter(tree) !== undefined, 'the examples');
      await change(tree, 'Add a reset button', seeded);
      await openHistory(tree, 2);
      await press(row(tree, 'Add a reset button'));
      await settle();
      h.ok(!textOf(tree.root).includes('Added:'), 'the change kept the example’s data shape: it added no fields');
      h.eq(await openRowAndReadLine(tree, 'Example'), 0,'and using the example’s own first version hides nothing');
      await iosPop(tree);
      await change(tree, 'Add notes to each glass', withNotes);
      await openHistory(tree, 3);
      h.eq(await openRowAndReadLine(tree, 'Example'), 1, 'once a version adds a collection, the first version says using it would hide that');
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

  await h.test('history screen: opened from a running app’s Whim sheet, Android back while that sheet is still leaving goes back to the app, never Home', async () => {
    const never = () => new Promise<Response>(() => {});
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      const home = () => tree.root.findByType(HomeScreen);
      const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
      await waitFor(() => showing(HomeScreen) && home().props.apps.length > 0, 'the example apps');
      const app: InstalledApp = home().props.apps[0];
      await tap(() => home().props.onOpen(app));
      await waitFor(() => showing(MiniAppView), `${app.name} to open`);
      await press(button(tree, COPY.orbMenuOpenLabel));
      const release = holdAnimations();
      try {
        await press(button(tree, COPY.actionHistory));
        await waitFor(() => showing(HistoryScreen), 'its history');
        h.eq(sheetsOpen(tree), 1, 'setup: the Whim sheet is still sliding away, its window up and taking Android back');
        const midMove = stackUnmountsMidMove();
        // Android hands the press to the leaving sheet's window, not to History's back listener.
        await androidBack(tree);
        await waitFor(() => !showing(HistoryScreen), 'Back to leave History');
        h.ok(showing(MiniAppView) && !showing(HomeScreen), 'the press means History’s Back: the app it was opened over opens again');
        h.eq(tree.root.findByType(MiniAppView).props.installedApp.id, app.id, 'the same app');
        h.eq(stackUnmountsMidMove(), midMove, 'and the stack is never popped to Home under it');
      } finally {
        release();
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
    const { activeLaunch } = StoreAccess.prototype;
    const read: string[] = [];
    StoreAccess.prototype.activeLaunch = function (this: StoreAccess, entry: InstalledApp) {
      read.push(entry.id);
      return activeLaunch.call(this, entry);
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
      StoreAccess.prototype.activeLaunch = activeLaunch;
    }
  });

  await h.test('history screen: opened from Home and left by its own Back, a tile tapped during that pop reads busy from the tap and opens once the pop finished; when the person went elsewhere meanwhile it opens nothing', async () => {
    const never = () => new Promise<Response>(() => {});
    const { activeLaunch } = StoreAccess.prototype;
    const read: string[] = [];
    StoreAccess.prototype.activeLaunch = function (this: StoreAccess, entry: InstalledApp) {
      read.push(entry.id);
      return activeLaunch.call(this, entry);
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
      StoreAccess.prototype.activeLaunch = activeLaunch;
    }
  });

  await h.test('history screen: opened from a running app’s orb, when the store cannot read that app back, Back and system back land on Home with the alert instead of staying on History', async () => {
    const never = () => new Promise<Response>(() => {});
    const { activeLaunch } = StoreAccess.prototype;
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
          StoreAccess.prototype.activeLaunch = activeLaunch;
          await tap(() => home().props.onOpen(app));
          await waitFor(() => showing(MiniAppView), `${app.name} to open`);
          await press(button(tree, COPY.orbMenuOpenLabel));
          await press(button(tree, COPY.actionHistory));
          await waitFor(() => showing(HistoryScreen), 'its history');
          StoreAccess.prototype.activeLaunch = async () => { throw new Error('bundle read failed'); };
          const alerts = Alert.shown.length;
          await leave();
          await waitFor(() => Alert.shown.length > alerts, `${name}: the reopen to fail`);
          h.eq(Alert.shown.at(-1)?.message, 'bundle read failed', `${name}: the failed read is still told to the user`);
          h.ok(showing(HomeScreen) && !showing(HistoryScreen), `${name}: and the user lands on Home, not back on History`);
        }
      });
    } finally {
      StoreAccess.prototype.activeLaunch = activeLaunch;
    }
  });

  await h.test('history screen: opened from a running app’s orb, when reading that app back never settles, a second Back is ignored only for a bounded time: then the alert and Home, and a read that settles late opens nothing', async () => {
    const never = () => new Promise<Response>(() => {});
    const { activeLaunch } = StoreAccess.prototype;
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
        const late = held<ActiveLaunch>();
        StoreAccess.prototype.activeLaunch = () => late.promise;
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
        await TestRenderer.act(async () => { late.resolve({ app, source: 'late bundle', versionId: 'g1' }); });
        await settle();
        h.ok(showing(HomeScreen) && !showing(MiniAppView), 'the read that settles late opens nothing');
        h.eq(stackUnmountsMidMove(), midMove, 'and no stack is unmounted mid-pop');
        await stackMoveEnds();
        StoreAccess.prototype.activeLaunch = activeLaunch;
        await tap(() => home().props.onOpen(app));
        await waitFor(() => showing(MiniAppView), 'the app to open again from its tile');
      });
    } finally {
      StoreAccess.prototype.activeLaunch = activeLaunch;
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

  await h.test('history screen: in the launcher, Make a copy from here puts a new app on Home with its own storage, from that version, and the toast’s Open opens it', async () => {
    const never = () => new Promise<Response>(() => {});
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      const home = () => tree.root.findByType(HomeScreen);
      const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
      await waitFor(() => showing(HomeScreen) && home().props.apps.length > 0, 'the example apps');
      const app: InstalledApp = home().props.apps[0];
      const before = home().props.apps.length;
      await TestRenderer.act(async () => home().props.onHistory(app));
      await waitFor(() => showing(HistoryScreen) && rows(tree).length === 1, 'its history');
      await stackMoveEnds();
      const access: StoreAccess = tree.root.findByType(HistoryScreen).props.access;
      const firstCode = await access.activeBundle(app);
      const changed = await access.update(app, { record: app.record, bundleSource: `${firstCode}\n// v2`, prompt: envelope('a second version') });
      await TestRenderer.act(async () => home().props.onHistory(changed));
      await waitFor(() => rows(tree).length === 2, 'both versions');
      await press(rows(tree)[1]);
      await press(button(tree, COPY.historyMakeCopyHere));
      const fresh = questionRow(tree, COPY.copyQuestionFresh);
      h.ok(fresh !== undefined, 'the launcher can copy data, so it asks');
      await TestRenderer.act(async () => { fresh!.props.onPress(); });
      await waitFor(() => toastOf(tree)?.message === COPY.copyMadeToast, '“Copy made”');
      const copy: InstalledApp | undefined = home().props.apps.find((a: InstalledApp) => a.forkedFrom?.id === app.id);
      h.eq(home().props.apps.length, before + 1, 'one new app on Home');
      h.ok(copy !== undefined && access.engineAppId(copy) === copy.id && copy.id !== access.engineAppId(app), 'with its own storage-engine appId, never the original’s');
      h.eq(await access.activeBundle(copy!), firstCode, 'running the version it was made from');
      h.eq(await access.activeBundle(changed), `${firstCode}\n// v2`, 'while the original keeps its current version');
      await pressToastAction(tree);
      await waitFor(() => showing(MiniAppView), 'the copy to open');
      const view = tree.root.findByType(MiniAppView).props;
      h.eq([view.installedApp.id, view.engineAppId, view.bundleSource], [copy!.id, copy!.id, firstCode], 'Open opens the copy, on its own storage and its own code');
    });
  });

  await h.test('history screen: in the launcher, Use v1 from History over Home, Back, then Undo on the toast: the app opened from Home runs the newest version’s code with that version’s capabilities', async () => {
    const never = () => new Promise<Response>(() => {});
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      const home = () => tree.root.findByType(HomeScreen);
      const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
      const counter = () => waterCounterOn(tree);
      await waitFor(() => showing(HomeScreen) && counter() !== undefined, 'the examples');
      const { access, codes } = await counterWithLaterVersions(tree, counter);
      const newest = await access.activeId(counter());

      await TestRenderer.act(async () => home().props.onHistory(counter()));
      await waitFor(() => showing(HistoryScreen) && rows(tree).length === 3, 'its three versions');
      await stackMoveEnds();
      await openAndPress(tree, 'Example', COPY.historyUseVersion);
      await waitFor(() => toastOf(tree)?.action === COPY.toastUndo, 'the toast with Undo');
      await press(button(tree, COPY.backLabel));
      await stackMoveEnds();
      await waitFor(() => showing(HomeScreen), 'Home');
      h.eq(counter().record.manifest.capabilities, ['storage'], 'setup: Home came back holding version 1’s record');
      await pressToastAction(tree);
      await settle();
      h.eq(await access.activeId(counter()), newest, 'setup: the Undo returned the app to its newest version');

      await tap(() => home().props.onOpen(counter()));
      await waitFor(() => showing(MiniAppView), 'the app to open from Home');
      const view = tree.root.findByType(MiniAppView).props;
      h.eq(view.bundleSource, codes[2], 'the newest version’s code runs');
      h.eq(view.record.manifest.capabilities, TIMER_CAPABILITIES, 'with the capabilities that version declares');
      h.eq(view.record.schemaArtifact, undefined, 'and no storage it never declared');
    });
  });

  await h.test('history screen: in the launcher, an Undo tapped on Home brings Home up to date with the version it returns to', async () => {
    const never = () => new Promise<Response>(() => {});
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      const home = () => tree.root.findByType(HomeScreen);
      const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
      const counter = () => waterCounterOn(tree);
      await waitFor(() => showing(HomeScreen) && counter() !== undefined, 'the examples');
      await counterWithLaterVersions(tree, counter);
      await TestRenderer.act(async () => home().props.onHistory(counter()));
      await waitFor(() => showing(HistoryScreen) && rows(tree).length === 3, 'its three versions');
      await stackMoveEnds();
      await openAndPress(tree, 'Example', COPY.historyUseVersion);
      await waitFor(() => toastOf(tree)?.action === COPY.toastUndo, 'the toast with Undo');
      await press(button(tree, COPY.backLabel));
      await stackMoveEnds();
      await waitFor(() => showing(HomeScreen), 'Home');
      h.eq(counter().record.manifest.capabilities, ['storage'], 'setup: Home holds version 1’s record');
      await pressToastAction(tree);
      await waitFor(() => counter().record.manifest.capabilities.includes('cues'), 'Home to follow the Undo');
      h.eq(counter().record.manifest.capabilities, TIMER_CAPABILITIES, 'Home holds the newest version’s record again');
    });
  });

  await h.test('history screen: in the launcher, an Undo tapped while a copy is held, then Back to Home: once the copy is made the app is on the version it left, and Home shows it', async () => {
    const never = () => new Promise<Response>(() => {});
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      const home = () => tree.root.findByType(HomeScreen);
      const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
      const counter = () => waterCounterOn(tree);
      await waitFor(() => showing(HomeScreen) && counter() !== undefined, 'the examples');
      const { access } = await counterWithLaterVersions(tree, counter);
      const newest = await access.activeId(counter());
      await TestRenderer.act(async () => home().props.onHistory(counter()));
      await waitFor(() => showing(HistoryScreen) && rows(tree).length === 3, 'its three versions');
      await stackMoveEnds();
      await openAndPress(tree, 'Example', COPY.historyUseVersion);
      await waitFor(() => toastOf(tree)?.action === COPY.toastUndo, 'the toast with Undo');
      const copy = held<void>();
      const { fork } = VersionStore.prototype;
      VersionStore.prototype.fork = async function (this: VersionStore, ...args: Parameters<VersionStore['fork']>) {
        await copy.promise;
        return fork.apply(this, args);
      };
      try {
        await openAndPress(tree, 'make it a pour-over timer', COPY.historyMakeCopyHere);
        await TestRenderer.act(async () => { questionRow(tree, COPY.copyQuestionFresh)!.props.onPress(); });
        await waitFor(() => textOf(tree.root).includes(COPY.historyMakeCopyBusy), 'setup: the copy is being made');
        await pressToastAction(tree);
        await press(button(tree, COPY.backLabel));
        await stackMoveEnds();
        await waitFor(() => showing(HomeScreen), 'Home');
        await TestRenderer.act(async () => { copy.resolve(); });
      } finally {
        VersionStore.prototype.fork = fork;
      }
      await waitFor(() => counter().record.manifest.capabilities.includes('cues'), 'Home to follow the Undo');
      h.eq(await access.activeId(counter()), newest, 'the app is on the version it left');
      h.eq(counter().record.manifest.capabilities, TIMER_CAPABILITIES, 'and Home shows it');
    });
  });

  await h.test('history screen: opened from a running app’s orb, an Undo still running when History is left by Back or a swipe: the app reopens on the version the Undo returns to, with that version’s capabilities', async () => {
    const never = () => new Promise<Response>(() => {});
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      const home = () => tree.root.findByType(HomeScreen);
      const showing = (type: React.ElementType) => tree.root.findAllByType(type).length === 1;
      const counter = () => waterCounterOn(tree);
      await waitFor(() => showing(HomeScreen) && counter() !== undefined, 'the examples');
      const { codes } = await counterWithLaterVersions(tree, counter);
      const leaves: [string, () => Promise<void>][] = [
        ['Back', () => press(button(tree, COPY.backLabel))],
        ['iOS swipe', () => iosPop(tree)],
      ];
      for (const [name, leave] of leaves) {
        await tap(() => home().props.onOpen(counter()));
        await waitFor(() => showing(MiniAppView), `${name}: the app to open`);
        await press(button(tree, COPY.orbMenuOpenLabel));
        await press(button(tree, COPY.actionHistory));
        await waitFor(() => showing(HistoryScreen) && rows(tree).length === 3, `${name}: its history`);
        await stackMoveEnds();
        await openAndPress(tree, 'Example', COPY.historyUseVersion);
        await waitFor(() => toastOf(tree)?.action === COPY.toastUndo, `${name}: the toast with Undo`);
        const undo = held<void>();
        const { rollback } = VersionStore.prototype;
        VersionStore.prototype.rollback = async function (this: VersionStore, ...args: Parameters<VersionStore['rollback']>) {
          await undo.promise;
          return rollback.apply(this, args);
        };
        try {
          await pressToastAction(tree);
          await leave();
          await settle();
          await TestRenderer.act(async () => { undo.resolve(); });
        } finally {
          VersionStore.prototype.rollback = rollback;
        }
        await waitFor(() => !showing(HistoryScreen) && showing(MiniAppView) && tree.root.findByType(MiniAppView).props.bundleSource === codes[2], `${name}: the app to reopen on its newest version`);
        h.eq(tree.root.findByType(MiniAppView).props.record.manifest.capabilities, TIMER_CAPABILITIES, `${name}: with the capabilities that version declares`);
        h.eq(tree.root.findByType(MiniAppView).props.record.schemaArtifact, undefined, `${name}: and no storage it never declared`);
        await TestRenderer.act(async () => tree.root.findByType(MiniAppView).props.onExit());
        await stackMoveEnds();
      }
    });
  });

  // ── M26 History row ────────────────────────────────────────────────────────

  await h.test('M26: a tapped row opens on smooth — its card grows as a layout transition and the rows below move with it — while its actions fade in on fade-in, its words neither moving nor fading', async () => {
    const { access, app } = await threeVersions();
    await withHistory(access, app, async (tree) => {
      await settledList(tree);
      const card = cardOf(tree, 'add a chime');
      const view = viewTagOf(card);
      layoutAnimations.splice(0);
      await press(row(tree, 'add a chime'));
      const open = cardOf(tree, 'add a chime');
      h.ok(viewTagOf(open) === view, 'the card that grows is the row’s own, not a new view put in its place');
      h.ok(isSmoothMove(open.props.layout), 'it grows on smooth, a layout transition');
      h.ok(isSmoothMove(cellOf(tree, 'a tea timer').props.layout), 'the row below moves on smooth');
      const fading = open.findAll((n) => hostType(n) === 'Animated.View' && n.props.entering !== undefined);
      h.eq(fading.length, 1, 'one part of the opened row fades in');
      const entering = fading[0]?.props.entering as LayoutAnimation | undefined;
      h.ok(entering?.preset === 'FadeIn' && entering.config.duration === FADE_IN.duration && JSON.stringify(entering.config.easing) === JSON.stringify({ bezier: FADE_IN.bezier }), 'on the fade-in token');
      h.ok(entering !== undefined && entering.config.withInitialValues === undefined, 'opacity only: it sets out from no other place or size');
      h.ok(fading[0] !== undefined && textOf(fading[0]).includes(COPY.historyUseVersion), 'and it holds the actions');
      h.eq(fading[0]?.findAll((n) => n === row(tree, 'add a chime')).length, 0, 'the words are not in it: they are there at once');
      h.eq(layoutAnimations.filter((e) => e.phase === 'entering').length, 1, 'only that one entering animation played');
    });
  });

  await h.test('M26: closing an open row is its opening backwards — its card’s fill and its actions fade out on fade-out while the card shrinks on smooth; under Reduce Motion they go at once', async () => {
    const { access, app } = await threeVersions();
    for (const reduced of [false, true]) {
      accessibilitySettings.reduceMotion = reduced;
      await TestRenderer.act(async () => emitAccessibility('reduceMotionChanged', reduced));
      const label = reduced ? 'reduced' : 'with motion';
      try {
        await withHistory(access, app, async (tree) => {
          await settledList(tree);
          await press(row(tree, 'add a chime'));
          await restAfterMove(tree);
          const fill = () => cardOf(tree, 'add a chime').findAll(isCardFill)[0];
          h.eq(styleOf(fill()).opacity, 1, `${label}: open, the card is filled`);
          layoutAnimations.splice(0);
          const release = holdAnimations();
          try {
            await press(row(tree, 'add a chime'));
            h.eq(isSmoothMove(cardOf(tree, 'add a chime').props.layout), !reduced, `${label}: the card ${reduced ? 'shrinks at once' : 'shrinks on smooth'}`);
            const exits = layoutAnimations.filter((e) => e.phase === 'exiting' && playedUnder(e.animation, reduced) !== null);
            h.eq(exits.map((e) => [e.animation.preset, e.animation.config.duration, JSON.stringify(e.animation.config.easing)]), reduced ? [] : [['FadeOut', FADE_OUT.duration, JSON.stringify({ bezier: FADE_OUT.bezier })]], `${label}: ${reduced ? 'the actions go at once' : 'the actions fade out on fade-out'}`);
            await TestRenderer.act(async () => elapse(FADE_OUT.duration / 2));
            const mid = styleOf(fill()).opacity as number;
            h.ok(reduced ? mid === 0 : mid > 0 && mid < 1, `${label}: ${reduced ? 'the fill goes at once' : 'the fill is fading out'} (${mid})`);
          } finally { await TestRenderer.act(async () => release()); }
          h.eq(styleOf(fill()).opacity, 0, `${label}: closed, the card has no fill`);
        });
      } finally {
        accessibilitySettings.reduceMotion = false;
        await TestRenderer.act(async () => emitAccessibility('reduceMotionChanged', false));
      }
    }
  });

  await h.test('M26: tapping the row again while it is still opening closes the same card from where it is, the rows below moving back on smooth', async () => {
    const { access, app } = await threeVersions();
    await withHistory(access, app, async (tree) => {
      await settledList(tree);
      const card = viewTagOf(cardOf(tree, 'add a chime'));
      const below = viewTagOf(cellOf(tree, 'a tea timer'));
      const release = holdAnimations();
      try {
        await press(row(tree, 'add a chime'));
        layoutAnimations.splice(0);
        await press(row(tree, 'add a chime'));
      } finally { release(); }
      h.eq(rows(tree).map((r) => r.props.accessibilityState.expanded), [false, false, false], 'the second tap closes it');
      const closed = cardOf(tree, 'add a chime');
      h.ok(viewTagOf(closed) === card, 'the card the opening ran on is the card that closes: its transition retargets from the frame on screen');
      h.ok(isSmoothMove(closed.props.layout), 'on smooth');
      h.ok(viewTagOf(cellOf(tree, 'a tea timer')) === below && isSmoothMove(cellOf(tree, 'a tea timer').props.layout), 'the row below moves back, the same view');
      h.eq(layoutAnimations.length, 0, 'nothing plays an arrival or a leaving again');
    });
  });

  await h.test('M26: History drawn moves nothing — while it lays itself out, and long after it has held still, no row or cell carries a move; a tap then moves them', async () => {
    const { access, app } = await threeVersions();
    await withHistory(access, app, async (tree) => {
      await waitFor(() => rows(tree).length === 3, 'the versions to load');
      h.ok(movesOf(tree).every((m) => m === undefined), 'drawn, nothing moves');
      await restFor(MOVE_SETTLED_MS);
      h.ok(movesOf(tree).every((m) => m === undefined), 'nor once it has held still: nothing the person did moves it');
      await press(row(tree, 'add a chime'));
      h.ok(movesOf(tree).every(isSmoothMove), 'a tap moves the rows on smooth');
    });
  });

  await h.test('M26: a row opened or closed moves on smooth — the transition is in place on the card and every cell below before the commit that changes the card’s size — and only until that move is at rest', async () => {
    const { access, app } = await threeVersions();
    await withHistory(access, app, async (tree) => {
      await settledList(tree);
      for (const opens of [true, false]) {
        const label = opens ? 'opening' : 'closing';
        const from = layoutCommits.length;
        await press(row(tree, 'add a chime'));
        h.eq(row(tree, 'add a chime').props.accessibilityState.expanded, opens, `${label}: the tap ${label === 'opening' ? 'opens' : 'closes'} the row`);
        const resized = resizeCommit(cardOf(tree, 'add a chime'), from);
        h.ok(resized !== null, `${label}: the card changes size in a commit of its own`);
        const views = [cardOf(tree, 'add a chime'), cellOf(tree, 'add a chime'), cellOf(tree, 'a tea timer')];
        h.ok(resized !== null && views.every((v) => isSmoothMove(heldAt(viewTagOf(v), resized))), `${label}: the card and the rows from it down move with smooth, registered before that commit`);
        await restAfterMove(tree);
      }
    });
  });

  await h.test('M26: an open row’s added-fields line arriving after its move has come to rest is simply there — no card or cell moves', async () => {
    const { access, app } = await loggedVersions();
    const read = held<void>();
    const diff = access.diff.bind(access);
    access.diff = async (...args) => { await read.promise; return diff(...args); };
    await withHistory(access, app, async (tree) => {
      await settledList(tree);
      await press(row(tree, 'add notes'));
      h.ok(movesOf(tree).every(isSmoothMove), 'setup: the row opens on smooth');
      await restFor(MOVE_SETTLED_MS);
      const from = layoutCommits.length;
      await TestRenderer.act(async () => { read.resolve(); });
      await waitFor(() => textOf(tree.root).includes(addedFieldsLine(['notes'])), 'the added-fields line');
      const resized = resizeCommit(cardOf(tree, 'add notes'), from, true);
      h.ok(resized !== null, 'the card re-renders as the line lands');
      const views = rows(tree).flatMap((r) => [animatedAround(r), animatedAround(animatedAround(r))]);
      h.ok(resized !== null && views.every((v) => heldAt(viewTagOf(v), resized) === undefined), 'nothing moves as it lands: the line is there at once');
    });
  });

  await h.test('M26: a re-read nobody asked for, which adds a row and moves the current one, lands at once — no card or cell moves', async () => {
    const { access, app } = await threeVersions();
    await withHistory(access, app, async (tree) => {
      await settledList(tree);
      await press(row(tree, 'add a chime'));
      await restFor(MOVE_SETTLED_MS);
      const from = layoutCommits.length;
      const base = { appId: app.record.appId, name: app.record.name, manifest: { capabilities: [] } };
      const newer = await access.update(app, { record: base, bundleSource: 'V4', prompt: envelope('make it quieter') });
      await reloadHistory(tree, access, newer);
      await waitFor(() => rows(tree).length === 4, 'the new version to be read');
      const views = rows(tree).flatMap((r) => [animatedAround(r), animatedAround(animatedAround(r))]);
      const tags = new Set(views.map(viewTagOf));
      const since = layoutCommits.slice(from).filter((c) => tags.has(c.viewTag));
      h.ok(since.length > 0 && since.every((c) => c.held === undefined), 'no commit since the re-read began moved a card or a cell');
      h.ok(views.every((v) => v.props.layout === undefined), 'and none carries a move');
    });
  });

  await h.test('M26: Use this version and its Undo each move the rows on smooth as the re-read lands — the transition already in place before it — and the window closes once they are at rest', async () => {
    const { access, app } = await threeVersions();
    let gate: Held<void> | null = null;
    const timeline = access.timeline.bind(access);
    access.timeline = async (...args) => {
      if (gate) await gate.promise;
      return timeline(...args);
    };
    const currentIn = (tree: Tree) => WORDS.find((w) => textsSaying(row(tree, w), COPY.historyCurrent).length === 1);
    await withHistory(access, app, async (tree) => {
      await settledList(tree);
      await press(row(tree, 'add a chime'));
      await restAfterMove(tree);
      for (const step of ['use', 'undo'] as const) {
        const reread = held<void>();
        gate = reread;
        const tags = new Set(rows(tree).flatMap((r) => [viewTagOf(animatedAround(r)), viewTagOf(animatedAround(animatedAround(r)))]));
        const acted = layoutCommits.length;
        if (step === 'use') await press(button(tree, COPY.historyUseVersion));
        else await pressToastAction(tree);
        const was = currentIn(tree);
        await waitFor(() => movesOf(tree).every(isSmoothMove), `${step}: the rows to take their move before the re-read lands`);
        h.eq(currentIn(tree), was, `${step}: the re-read has not landed yet`);
        const first = layoutCommits.slice(acted).find((c) => tags.has(c.viewTag));
        h.ok(first !== undefined && isSmoothMove(first.layout), `${step}: the first render the action makes already sets the rows’ move, so no read can land before it`);
        const from = layoutCommits.length;
        gate = null;
        await TestRenderer.act(async () => { reread.resolve(); });
        await waitFor(() => currentIn(tree) === (step === 'use' ? 'add a chime' : 'make it louder'), `${step}: the re-read to land`);
        const since = layoutCommits.slice(from).filter((c) => tags.has(c.viewTag));
        h.ok(since.length > 0 && since.every((c) => isSmoothMove(c.held)), `${step}: every commit the re-read made moved its cards and cells on smooth`);
        await restAfterMove(tree);
      }
    });
  });

  await h.test('History: focus landing in a row (a screen reader, a keyboard) reaches the list, as it does in the cells the list draws itself, so the list keeps that row drawn', async () => {
    const { access, app } = await threeVersions();
    await withHistory(access, app, async (tree) => {
      await settledList(tree);
      focusedCells.splice(0);
      const cell = cellOf(tree, 'a tea timer');
      const hears = typeof cell.props.onFocusCapture === 'function';
      h.ok(hears, 'the row’s cell view hears focus land in it');
      if (hears) await TestRenderer.act(async () => cell.props.onFocusCapture({ nativeEvent: {} }));
      h.eq(focusedCells.length, 1, 'and the list hears it');
    });
  });

  await h.test('M26: History closed while a Use this version’s re-read is still on its way leaves nothing behind: the re-read landing afterwards starts no timer', async () => {
    const { access, app } = await threeVersions();
    const reread = held<void>();
    let gated = false;
    let waiting = 0;
    // The reads a re-read makes, while any is on its way.
    let reading = 0;
    const counted = async <T,>(read: () => Promise<T>): Promise<T> => {
      reading += 1;
      try { return await read(); } finally { reading -= 1; }
    };
    const timeline = access.timeline.bind(access);
    const activeId = access.activeId.bind(access);
    access.timeline = (...args) => counted(async () => {
      if (gated) {
        waiting += 1;
        await reread.promise;
      }
      return timeline(...args);
    });
    access.activeId = (...args) => counted(() => activeId(...args));
    const tree = await renderScreen(historyScreen(access, app));
    let clock: ReturnType<typeof captureTimeouts> | null = null;
    try {
      await settledList(tree);
      await press(row(tree, 'add a chime'));
      await restAfterMove(tree);
      gated = true;
      await press(button(tree, COPY.historyUseVersion));
      await waitFor(() => waiting > 0, 'the re-read to be on its way');
      await unmountScreen(tree);
      clock = captureTimeouts();
      await TestRenderer.act(async () => { reread.resolve(); });
      // The re-read's reads are off the JS turn: every one of them lands, then the turns after it run.
      const turn = () => TestRenderer.act(nextTurn);
      for (let i = 0; i < 2000 && reading > 0; i++) await turn();
      for (let i = 0; i < 5; i++) await turn();
      h.eq(reading, 0, 'the re-read has landed');
      h.eq(clock.count(springReachMs('smooth', 0.99)), 0, 'no timer to close the rows’ move is started once History has gone');
    } finally {
      clock?.restore();
      reread.resolve();
    }
  });

  await h.test('M26 under Reduce Motion: a row opens and closes at once, the rows below with it, and its actions are simply there; with motion, the same taps move', async () => {
    const { access, app } = await threeVersions();
    for (const reduced of [true, false]) {
      accessibilitySettings.reduceMotion = reduced;
      await TestRenderer.act(async () => emitAccessibility('reduceMotionChanged', reduced));
      try {
        await withHistory(access, app, async (tree) => {
          await settledList(tree);
          layoutAnimations.splice(0);
          await press(row(tree, 'add a chime'));
          const label = reduced ? 'reduced' : 'with motion';
          const moves = [cardOf(tree, 'add a chime').props.layout, cellOf(tree, 'a tea timer').props.layout];
          const played = moves.map((m) => playedUnder(m, reduced));
          h.eq(played.map((m) => m !== null), [!reduced, !reduced], `${label}: the card and the row below ${reduced ? 'change at once' : 'move'}`);
          h.eq(layoutAnimations.filter((e) => playedUnder(e.animation, reduced) !== null).length, reduced ? 0 : 1, `${label}: ${reduced ? 'no fade' : 'the actions fade in'}`);
          h.ok(textOf(tree.root).includes(COPY.historyUseVersion), `${label}: the actions show`);
          await press(row(tree, 'add a chime'));
          h.eq(playedUnder(cardOf(tree, 'add a chime').props.layout, reduced) !== null, !reduced, `${label}: and it closes ${reduced ? 'at once' : 'on smooth'}`);
        });
      } finally {
        accessibilitySettings.reduceMotion = false;
        await TestRenderer.act(async () => emitAccessibility('reduceMotionChanged', false));
      }
    }
  });
}

const SMOOTH = springConfig('smooth');
const FADE_IN = timingOf('fadeIn');
const FADE_OUT = timingOf('fadeOut');
/** An open card's fill, in the light scheme: the view under its content painted `surface`. */
const isCardFill = (n: Node) => hostType(n) === 'Animated.View' && n.props.pointerEvents === 'none' && styleOf(n).backgroundColor === COLORS.light.surface;
/** The next turn of the event loop. */
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const WORDS = ['make it louder', 'add a chime', 'a tea timer'];
/** `smooth` as a layout transition: Reanimated's spring mode with the token's physics. */
const isSmoothMove = (layout: unknown): boolean => {
  const l = layout as LayoutAnimation | undefined;
  return l?.preset === 'LinearTransition' && l.config.springify === true && JSON.stringify({ mass: l.config.mass, stiffness: l.config.stiffness, damping: l.config.damping }) === JSON.stringify(SMOOTH);
};
/** The nearest animated view holding `node`. */
function animatedAround(node: Node): Node {
  let up: Node | null = node.parent;
  while (up && hostType(up) !== 'Animated.View') up = up.parent;
  if (!up) throw new Error(`"${textOf(node)}" sits in no animated view`);
  return up;
}
/** A row's card: the view it opens in (M26). */
const cardOf = (tree: Tree, words: string) => animatedAround(row(tree, words));
/** A row's cell in the list: the view that moves when a row above it opens or closes. */
const cellOf = (tree: Tree, words: string) => animatedAround(cardOf(tree, words));
/** The move every row's card and cell carries. */
const movesOf = (tree: Tree): unknown[] => rows(tree).flatMap((r) => [animatedAround(r).props.layout, animatedAround(animatedAround(r)).props.layout]);
/** Long enough for a move on `smooth` to come to rest. */
const MOVE_SETTLED_MS = springReachMs('smooth', 0.99) + 100;
/** Lets `ms` of real time pass. */
const restFor = (ms: number) => TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
/** A move the person made, come to rest: no card or cell carries one any more. */
const restAfterMove = (tree: Tree) => waitFor(() => movesOf(tree).every((m) => m === undefined), 'the move to come to rest');
/** The layout transition registered for view `viewTag` as commit `commit` was drawn (`layoutCommits`). */
function heldAt(viewTag: number, commit: number): unknown {
  const entries = layoutCommits.filter((c) => c.viewTag === viewTag && c.commit <= commit);
  const last = entries.at(-1);
  if (last === undefined) return undefined;
  return last.commit === commit ? last.held : last.layout;
}
/** The first commit since entry `from` of `layoutCommits` in which `card` was drawn with another
 *  style than before it (or, with `anyRender`, was drawn at all), or null. */
function resizeCommit(card: Node, from: number, anyRender = false): number | null {
  const tag = viewTagOf(card);
  let style = layoutCommits.slice(0, from).filter((c) => c.viewTag === tag).at(-1)?.style;
  for (const c of layoutCommits.slice(from)) {
    if (c.viewTag !== tag) continue;
    if (anyRender || c.style !== style) return c.commit;
    style = c.style;
  }
  return null;
}
/** History loaded, and its list drawn for long enough to have held still (a frame is a timeout here). */
async function settledList(tree: Tree): Promise<void> {
  await waitFor(() => rows(tree).length === 3, 'the versions to load');
  await TestRenderer.act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
}

const WATER = 'water-counter';
const TIMER_CAPABILITIES = APP_RECORDS['pour-over-timer'].manifest.capabilities;
const isWaterCounter = (a: InstalledApp) => a.id === WATER;
/** The Water Counter example as Home holds it. */
const waterCounterOn = (tree: Tree): InstalledApp => tree.root.findByType(HomeScreen).props.apps.find(isWaterCounter);

/** The Water Counter example given two later versions through its store: one that saves nothing,
 *  then the newest, which declares the build's Pour-Over Timer manifest (cues, no storage). Ends back
 *  on Home, which holds the newest record. Returns the code each version runs, oldest first. */
async function counterWithLaterVersions(tree: Tree, counter: () => InstalledApp): Promise<{ access: StoreAccess; codes: string[] }> {
  await TestRenderer.act(async () => tree.root.findByType(HomeScreen).props.onHistory(counter()));
  await waitFor(() => tree.root.findAllByType(HistoryScreen).length === 1 && rows(tree).length === 1, 'its history');
  await stackMoveEnds();
  const access: StoreAccess = tree.root.findByType(HistoryScreen).props.access;
  const first = await access.activeBundle(counter());
  const codes = [first, `${first}\n// v2`, `${first}\n// v3`];
  const base = { appId: counter().record.appId, name: counter().record.name };
  const second = await access.update(counter(), { record: { ...base, manifest: { capabilities: [] } }, bundleSource: codes[1], prompt: envelope('stop saving my glasses') });
  await access.update(second, { record: { ...base, manifest: APP_RECORDS['pour-over-timer'].manifest }, bundleSource: codes[2], prompt: envelope('make it a pour-over timer') });
  await press(button(tree, COPY.backLabel));
  await stackMoveEnds();
  await waitFor(() => tree.root.findAllByType(HomeScreen).length === 1, 'Home');
  return { access, codes };
}
