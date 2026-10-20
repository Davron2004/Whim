/** The Whim sheet over a running app (`app-launcher` "The Whim sheet is a running app's one menu";
 *  system.md §9 Whim sheet), driven through the real shell over a real version store: what the orb
 *  opens and in what order, each row its own accessibility element (#103), the running version's line
 *  and the Reload row while a newer version waits, sending growing the same sheet into the change's
 *  plan page with the app still running, History, Report pushed inside the sheet, Back to your apps,
 *  Android back, and typed words surviving a text-size rebuild. */
import type React from 'react';
import TestRenderer from 'react-test-renderer';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Harness } from './harness';
import { COPY } from '../copy';
import HomeScreen from '../HomeScreen';
import HistoryScreen from '../HistoryScreen';
import MiniAppView from '../MiniAppView';
import { DescribePage } from '../DescribePage';
import { PlanPage } from '../PlanPage';
import MakingPage from '../MakingPage';
import { Sheet } from '../../ui/Sheet';
import { PendingBuildStore } from '../pending-builds';
import type { InstalledApp } from '../app-index';
import { setColorScheme, windowMetrics } from './native-host';
import { androidBack, button, hostType, isHost, press, screenReaderElement, textOf } from './react-screen';
import { buildIt, makingSheetOpen, planLoaded, resultEvent, settle, sseStream, tap, waitFor, withLauncher, type Tree } from './rendered-launcher';
import { streamingServer } from './prompt-flow-ui.suite';

type Node = TestRenderer.ReactTestInstance;

export const APP_NAME = 'Tip Splitter';
const DAY_MS = 24 * 60 * 60 * 1000;
/** The Reload row as a screen reader names it: its title, then its trailing word. */
export const RELOAD_ROW = `${COPY.whimSheetNewVersion}, ${COPY.actionReload}`;

export const home = (tree: Tree) => tree.root.findByType(HomeScreen);
export const showing = (tree: Tree, type: React.ElementType) => tree.root.findAllByType(type).length === 1;
const tipSplitter = (tree: Tree): InstalledApp => (home(tree).props.apps as InstalledApp[]).find((a) => a.name === APP_NAME)!;
export const runningApp = (tree: Tree) => tree.root.findByType(MiniAppView);

/** The orb, whatever state it reads ("Whim menu", then its state after a comma). */
export function orb(tree: Tree): Node {
  const found = tree.root.findAll((n) => hostType(n) === 'Pressable' && String(n.props.accessibilityLabel).startsWith(COPY.orbMenuOpenLabel));
  if (found.length !== 1) throw new Error(`expected one orb, got ${found.length}`);
  return found[0];
}

/** The open sheet's card: the one view a screen reader is held inside. */
export function sheetCard(tree: Tree): Node {
  const cards = tree.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityViewIsModal === true);
  if (cards.length !== 1) throw new Error(`expected one open sheet, got ${cards.length}`);
  return cards[0];
}

/** The controls in the open sheet, in the order they are drawn, by the name a screen reader reads,
 *  leaving out the sheet's own close control. */
export const controlsIn = (tree: Tree) =>
  sheetCard(tree)
    .findAll((n) => (hostType(n) === 'Pressable' || hostType(n) === 'TextInput') && n.props.accessibilityLabel !== COPY.sheetClose)
    .map((n) => String(n.props.accessibilityLabel));

const field = (tree: Tree) => sheetCard(tree).find((n) => hostType(n) === 'TextInput' && n.props.accessibilityLabel === COPY.whimSheetAsk);
export const typeWords = (tree: Tree, words: string) => TestRenderer.act(async () => field(tree).props.onChangeText(words));
export const hasButton = (tree: Tree, label: string) =>
  tree.root.findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === label).length > 0;

/** The running app's version line in the open sheet. */
export const versionLine = (tree: Tree) =>
  sheetCard(tree).findAll(isHost('Text')).map(textOf).find((text) => text.startsWith('Version ')) ?? null;

/** Home with the example apps, then Tip Splitter opened from it. */
export async function openTipSplitter(tree: Tree): Promise<InstalledApp> {
  await waitFor(() => showing(tree, HomeScreen) && home(tree).props.apps.length > 0, 'the example apps');
  const app = tipSplitter(tree);
  await tap(() => home(tree).props.onOpen(app));
  await waitFor(() => showing(tree, MiniAppView), `${APP_NAME} to open`);
  return app;
}

/** The orb's tap, and the Whim sheet open over the app. */
export async function openSheet(tree: Tree): Promise<void> {
  await press(orb(tree));
  await waitFor(() => hasButton(tree, COPY.whimSheetBackToApps), 'the Whim sheet');
}

const never = () => new Promise<Response>(() => {});

type Spacing = { gap?: number; marginTop?: number; marginBottom?: number };
const spacing = (style: unknown) => (StyleSheet.flatten(style as StyleProp<ViewStyle>) ?? {}) as Spacing;

/** The first host views under `node`, looking through components. */
function hostChildren(node: Node): Node[] {
  return node.children.flatMap((child) => {
    if (typeof child === 'string') return [];
    return typeof child.type === 'string' ? [child] : hostChildren(child);
  });
}

/** The space between each block of the sheet's content and the next one (its margin, the content's
 *  gap and the next one's margin), from the block holding `inside` up to the content itself. */
function blockGaps(inside: Node): number[] {
  let content: Node | null = inside.parent;
  while (content && !(typeof content.type === 'string' && hostChildren(content).length >= 3)) content = content.parent;
  if (!content) throw new Error('no content holds that control');
  const blocks = hostChildren(content);
  // A scroll view lays its children out in its content container.
  const gap = spacing(content.props.contentContainerStyle ?? content.props.style).gap ?? 0;
  return blocks.slice(1).map((next, i) => (spacing(blocks[i].props.style).marginBottom ?? 0) + gap + (spacing(next.props.style).marginTop ?? 0));
}

export async function runWhimSheetUiTests(h: Harness): Promise<void> {
  await h.test('whim sheet: the orb opens it over the running app: tile, name and version line, then the send area, History, Report a problem and Back to your apps, in that order', async () => {
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      await openTipSplitter(tree);
      const launch = runningApp(tree).props.tappedAt;
      await openSheet(tree);
      h.eq(controlsIn(tree), [COPY.whimSheetAsk, COPY.whimSheetSend, COPY.actionHistory, COPY.reportScreenTitle, COPY.whimSheetBackToApps],
        'the send area and its arrow, then History, Report a problem and Back to your apps; no Reload with no newer version');
      const shown = textOf(sheetCard(tree));
      h.ok(shown.indexOf(APP_NAME) >= 0 && shown.indexOf(APP_NAME) < shown.indexOf(COPY.actionHistory), 'the app’s name heads the sheet');
      await waitFor(() => versionLine(tree) !== null, 'the version line');
      h.eq(runningApp(tree).props.tappedAt, launch, 'and the app runs on under it, the same launch');
    });
  });

  await h.test('whim sheet: every row is its own accessibility element, each control a button, the field a text input, the name and version line read on their own', async () => {
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      await openTipSplitter(tree);
      await openSheet(tree);
      await waitFor(() => versionLine(tree) !== null, 'the version line');
      for (const label of [COPY.whimSheetSend, COPY.actionHistory, COPY.reportScreenTitle, COPY.whimSheetBackToApps]) {
        const found = sheetCard(tree).findAll((n) => hostType(n) === 'Pressable' && n.props.accessibilityLabel === label);
        h.eq(found.length, 1, `"${label}" is one element`);
        h.eq(found[0]?.props.accessibilityRole, 'button', `"${label}" is announced as a button`);
        h.ok(found[0] !== undefined && screenReaderElement(found[0]) === found[0], `"${label}" sits inside no other element, so VoiceOver reaches it on its own`);
      }
      h.ok(screenReaderElement(field(tree)) === field(tree), 'the send area’s field is reached on its own');
      const texts = sheetCard(tree).findAll(isHost('Text'));
      for (const words of [APP_NAME, versionLine(tree)!]) {
        const text = texts.find((n) => textOf(n) === words);
        h.ok(text !== undefined && screenReaderElement(text) === text, `"${words}" is read on its own`);
      }
    });
  });

  await h.test('whim sheet: the version line names the running version and how long ago it was made', async () => {
    const realNow = Date.now;
    try {
      await withLauncher({ examples: true, server: never }, async ({ tree }) => {
        await openTipSplitter(tree);
        await openSheet(tree);
        await waitFor(() => versionLine(tree) !== null, 'the version line');
        h.eq(versionLine(tree), 'Version 1 · changed just now', 'an example installed a moment ago is its first version');
        await press(button(tree, COPY.sheetClose));
        Date.now = () => realNow() + 2 * DAY_MS + 60_000;
        await openSheet(tree);
        await waitFor(() => versionLine(tree) !== null, 'the version line');
        h.eq(versionLine(tree), 'Version 1 · changed 2 days ago', 'two days on, it says so');
      });
    } finally {
      Date.now = realNow;
    }
  });

  await h.test('whim sheet: a change that lands while the app runs shows "New version ready · Reload" on top; the app keeps its version until Reload opens the new one', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    const realNow = Date.now;
    try {
      await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, kv }) => {
        await waitFor(() => showing(tree, HomeScreen) && home(tree).props.apps.length > 0, 'the example apps');
        const app = tipSplitter(tree);
        await TestRenderer.act(async () => home(tree).props.onPromptAgain(app));
        await TestRenderer.act(async () => tree.root.findByType(DescribePage).props.onChangeText('Add a tip slider'));
        await tap(() => tree.root.findByType(DescribePage).props.onContinue());
        await waitFor(() => planLoaded(tree), 'the change’s plan');
        await buildIt(tree);
        await waitFor(() => showing(tree, MakingPage) && streams.length === 1, 'the change being made');
        await press(button(tree, COPY.sheetClose));
        await tap(() => home(tree).props.onOpen(app));
        await waitFor(() => showing(tree, MiniAppView), `${APP_NAME} to open while its change is made`);
        const opened = runningApp(tree).props.tappedAt;
        await openSheet(tree);
        await waitFor(() => versionLine(tree) !== null, 'the version line');
        h.ok(!hasButton(tree, RELOAD_ROW), 'no Reload while the running version is the newest');
        await press(button(tree, COPY.sheetClose));

        // The change lands a minute later: a version's time is its commit's, to the second.
        Date.now = () => realNow() + 60_000;
        streams[0].push(resultEvent(APP_NAME));
        streams[0].end();
        await waitFor(() => new PendingBuildStore(kv).list().length === 0, 'the change delivered');
        await settle();
        h.eq(runningApp(tree).props.tappedAt, opened, 'nothing reloads by itself');
        await openSheet(tree);
        await waitFor(() => hasButton(tree, RELOAD_ROW), 'the Reload row');
        h.eq(controlsIn(tree)[0], RELOAD_ROW, 'on top of the sheet');
        h.eq(versionLine(tree), 'Version 1 · changed 1 min ago', 'the line still names the version that runs');
        const gaps = blockGaps(button(tree, RELOAD_ROW));
        h.ok(gaps.length === 3 && gaps.every((gap) => gap === gaps[0]) && gaps[0] > 0,
          `the same space under each block: the name, the Reload row, the send area (${gaps.join(', ')})`);

        await press(button(tree, RELOAD_ROW));
        await waitFor(() => showing(tree, MiniAppView) && runningApp(tree).props.tappedAt !== opened, 'the app to open again');
        h.eq(runningApp(tree).props.installedApp.id, app.id, 'the same app');
        await openSheet(tree);
        await waitFor(() => versionLine(tree) === 'Version 2 · changed just now', 'the new version’s line');
        h.ok(!hasButton(tree, RELOAD_ROW), 'on the new version, no Reload');
      });
    } finally {
      Date.now = realNow;
    }
  });

  await h.test('whim sheet: sending grows the same sheet into the plan page for a change of this app, with the app still running; closing the plan returns to the app', async () => {
    const streams: ReturnType<typeof sseStream>[] = [];
    await withLauncher({ examples: true, server: streamingServer(streams) }, async ({ tree, sent }) => {
      const app = await openTipSplitter(tree);
      const launch = runningApp(tree).props.tappedAt;
      await openSheet(tree);
      h.eq(button(tree, COPY.whimSheetSend).props.disabled, true, 'the arrow waits for words');
      const modal = tree.root.find(isHost('Modal'));
      h.eq(tree.root.findByType(Sheet).props.detent, 'fit', 'the sheet fits its rows');
      await typeWords(tree, 'Add a tip slider');
      await press(button(tree, COPY.whimSheetSend));
      await waitFor(() => showing(tree, PlanPage), 'the plan page');
      h.eq(tree.root.findByType(PlanPage).props.editing?.id, app.id, 'the plan is for a change of this app');
      h.eq(sent.find((r) => r.path === '/v1/clarify')?.body?.prompt, 'Add a tip slider', 'asked about the words typed');
      h.ok(tree.root.findAll(isHost('Modal')).includes(modal), 'in the same sheet, never closed in between');
      h.eq(tree.root.findByType(Sheet).props.detent, 'large', 'grown to the plan’s height');
      h.ok(showing(tree, MiniAppView) && runningApp(tree).props.tappedAt === launch, 'the app keeps running under it');
      h.ok(!showing(tree, HomeScreen), 'and Home is not drawn under it');

      await press(button(tree, COPY.sheetClose));
      h.ok(!makingSheetOpen(tree), 'closing the plan closes the sheet');
      h.ok(showing(tree, MiniAppView) && runningApp(tree).props.tappedAt === launch, 'onto the same running app');
      h.ok(!showing(tree, HomeScreen), 'not Home');
      await openSheet(tree);
      h.eq(field(tree).props.value, '', 'the words went with the change: the field starts empty again');
    });
  });

  await h.test('whim sheet: History opens History for this app', async () => {
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      const app = await openTipSplitter(tree);
      await openSheet(tree);
      await press(button(tree, COPY.actionHistory));
      await waitFor(() => showing(tree, HistoryScreen), 'History');
      h.eq(tree.root.findByType(HistoryScreen).props.app.id, app.id, 'for the app the sheet was opened over');
      h.ok(!makingSheetOpen(tree), 'the sheet is gone');
    });
  });

  await h.test('whim sheet: Report a problem is pushed inside the sheet over the running app; its back control and Android back return to the sheet', async () => {
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      await openTipSplitter(tree);
      const launch = runningApp(tree).props.tappedAt;
      await openSheet(tree);
      const modal = tree.root.find(isHost('Modal'));
      for (const [name, back] of [
        ['the back control', () => press(button(tree, COPY.backLabel))],
        ['Android back', () => androidBack(tree)],
      ] as const) {
        await press(button(tree, COPY.reportScreenTitle));
        await waitFor(() => hasButton(tree, COPY.reportSend), 'the report form');
        h.ok(textOf(sheetCard(tree)).includes(COPY.reportScreenTitle) && !hasButton(tree, COPY.whimSheetBackToApps), `${name}: the report replaces the sheet’s rows`);
        h.ok(tree.root.findAll(isHost('Modal')).length === 1 && tree.root.findAll(isHost('Modal')).includes(modal), `${name}: inside the same sheet`);
        h.ok(runningApp(tree).props.tappedAt === launch, `${name}: over the same running app`);
        await back();
        h.ok(hasButton(tree, COPY.whimSheetBackToApps) && !hasButton(tree, COPY.reportSend), `${name}: returns to the sheet’s rows`);
      }
    });
  });

  await h.test('whim sheet: Back to your apps closes the app and goes Home', async () => {
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      await openTipSplitter(tree);
      await openSheet(tree);
      await press(button(tree, COPY.whimSheetBackToApps));
      h.ok(showing(tree, HomeScreen) && !showing(tree, MiniAppView), 'Home, with the app closed');
      h.ok(!makingSheetOpen(tree), 'and no sheet');
    });
  });

  await h.test('whim sheet: Android back closes the sheet and leaves the app running', async () => {
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      await openTipSplitter(tree);
      const launch = runningApp(tree).props.tappedAt;
      await openSheet(tree);
      await androidBack(tree);
      h.ok(!makingSheetOpen(tree), 'the sheet closes');
      h.ok(showing(tree, MiniAppView) && runningApp(tree).props.tappedAt === launch && !showing(tree, HomeScreen), 'onto the same running app');
    });
  });

  await h.test('whim sheet: words typed in the send area survive the rebuild a text-size change makes of the sheet', async () => {
    await withLauncher({ examples: true, server: never }, async ({ tree }) => {
      await openTipSplitter(tree);
      await openSheet(tree);
      await typeWords(tree, 'Round to the nearest dollar');
      const before = field(tree);
      try {
        windowMetrics.fontScale = 1.35;
        await TestRenderer.act(async () => { setColorScheme('dark'); });
        h.ok(field(tree) !== before, 'the sheet’s content is built again at the new size');
        h.eq(field(tree).props.value, 'Round to the nearest dollar', 'with the words still in the field');
      } finally {
        windowMetrics.fontScale = 1;
        await TestRenderer.act(async () => { setColorScheme('light'); });
      }
    });
  });
}
